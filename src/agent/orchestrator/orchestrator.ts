import type { CapabilityDescriptor, CapabilityExecutionResult, CapabilityRegistry, EntityReference } from '../../application'
import type { CommandToolTrace, RecoveryManager, RecoveryStartToken } from '../recovery'
import type { NormalizedMessage, NormalizedToolCall } from '../provider'
import { buildAgentInstructions } from './system-prompt'
import type { AgentModelClient, AgentOrchestratorOptions, AgentProgress, AgentRunInput, AgentRunResult } from './types'

interface SessionState {
  messages: NormalizedMessage[]
  recent: EntityReference[]
}

function serializeToolResult(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized.length <= 48_000) return serialized
  return JSON.stringify({ truncated: true, preview: serialized.slice(0, 47_000) })
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : '未知错误'
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏密钥]')
    .replace(/(authorization|api[-_ ]?key)\s*[:=]\s*\S+/gi, '$1: [已隐藏]')
    .slice(0, 2_000)
}

function stringArgument(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback
}

function uniqueAffected(results: readonly CapabilityExecutionResult[]): EntityReference[] {
  const refs = new Map<string, EntityReference>()
  for (const result of results) {
    for (const entity of result.affected) refs.set(`${entity.type}:${entity.id}`, entity)
  }
  return [...refs.values()]
}

export class AgentOrchestrator {
  readonly #sessions = new Map<string, SessionState>()

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly model: AgentModelClient,
    private readonly recovery: RecoveryManager
  ) {}

  clearSession(sessionId: string): void {
    this.#sessions.delete(sessionId)
  }

  private progress(options: AgentOrchestratorOptions, event: AgentProgress): void {
    options.onProgress?.(event)
  }

  private async executeTool(
    call: NormalizedToolCall,
    input: AgentRunInput,
    token: RecoveryStartToken,
    results: CapabilityExecutionResult[],
    traces: CommandToolTrace[],
    signal: AbortSignal,
    options: AgentOrchestratorOptions
  ): Promise<string> {
    const startedAt = new Date().toISOString()
    const capabilityId = call.name === 'execute_capability'
      ? stringArgument(call.arguments.capabilityId, 'unknown')
      : call.name
    const trace: CommandToolTrace = {
      capabilityId,
      startedAt,
      status: 'running'
    }
    traces.push(trace)
    this.progress(options, { type: 'tool-started', trace: structuredClone(trace) })
    try {
      let output: unknown
      if (call.name === 'search_capabilities') {
        const kind = typeof call.arguments.kind === 'string'
          ? call.arguments.kind as CapabilityDescriptor['kind']
          : undefined
        output = this.registry.list({
          query: typeof call.arguments.query === 'string' ? call.arguments.query : '',
          domain: typeof call.arguments.domain === 'string' ? call.arguments.domain : undefined,
          kind,
          modifiesData: typeof call.arguments.modifiesData === 'boolean'
            ? call.arguments.modifiesData
            : undefined,
          limit: typeof call.arguments.limit === 'number' ? call.arguments.limit : 20
        })
      } else if (call.name === 'execute_capability') {
        const id = stringArgument(call.arguments.capabilityId)
        const capabilityInput = call.arguments.input
        const result = await this.registry.execute(id, capabilityInput, {
          actor: 'llm',
          commandRunId: token.id,
          operationId: `${token.id}:${call.id}`,
          signal,
          currentRoute: input.context.currentRoute,
          selected: input.context.selected,
          recent: uniqueAffected(results)
        })
        results.push(result)
        output = result
        trace.summary = result.summary
      } else {
        throw new Error(`模型调用了未知工具：${call.name}`)
      }
      trace.status = 'succeeded'
      trace.completedAt = new Date().toISOString()
      this.progress(options, {
        type: 'tool-completed',
        trace: structuredClone(trace),
        result: results.at(-1)
      })
      return serializeToolResult(output)
    } catch (error) {
      trace.status = 'failed'
      trace.completedAt = new Date().toISOString()
      trace.error = safeError(error)
      this.progress(options, { type: 'tool-completed', trace: structuredClone(trace) })
      return serializeToolResult({
        status: 'failed',
        error: trace.error,
        instruction: '根据错误修正参数、改用查询解析对象，或只在确实无法继续时询问用户。'
      })
    }
  }

  async run(
    input: AgentRunInput,
    signal?: AbortSignal,
    options: AgentOrchestratorOptions = {}
  ): Promise<AgentRunResult> {
    const token = await this.recovery.begin({
      sessionId: input.sessionId,
      prompt: input.prompt,
      presetId: input.preset.id,
      model: input.preset.model
    })
    this.progress(options, { type: 'started', commandRunId: token.id })
    const session = this.#sessions.get(input.sessionId) ?? { messages: [], recent: [] }
    const starterCapabilities = [
      ...this.registry.list({ domain: 'query', limit: 4 }),
      ...this.registry.list({ domain: input.context.currentRoute.split('/')[1] || 'query', limit: 4 })
    ]
    const instructions = buildAgentInstructions({
      context: input.context,
      recent: session.recent,
      starterCapabilities,
      presetName: input.preset.name,
      model: input.preset.model
    })
    const messages: NormalizedMessage[] = [
      ...session.messages,
      { role: 'user', content: input.prompt }
    ]
    const results: CapabilityExecutionResult[] = []
    const traces: CommandToolTrace[] = []
    let finalText = ''
    let rounds = 0
    let lastResponseId: string | undefined
    try {
      for (rounds = 1; rounds <= input.preset.maxToolRounds; rounds += 1) {
        signal?.throwIfAborted()
        this.progress(options, { type: 'thinking', round: rounds })
        const response = await this.model.generate(
          input.profile,
          input.preset,
          {
            instructions,
            messages,
            tools: this.registry.agentTools(),
            previousResponseId: lastResponseId
          },
          signal
        )
        lastResponseId = response.id
        messages.push({
          role: 'assistant',
          content: response.text,
          toolCalls: response.toolCalls
        })
        if (response.text) {
          finalText = response.text
          this.progress(options, { type: 'text', text: finalText })
        }
        if (response.toolCalls.length === 0) break
        for (const call of response.toolCalls) {
          const output = await this.executeTool(
            call,
            input,
            token,
            results,
            traces,
            signal ?? new AbortController().signal,
            options
          )
          messages.push({ role: 'tool', toolCallId: call.id, content: output })
        }
      }
      if (rounds > input.preset.maxToolRounds) {
        throw new Error(`已达到最大工具轮次 ${input.preset.maxToolRounds}，停止继续执行`)
      }
      const affected = uniqueAffected(results)
      const capabilityIds = results.map((result) => result.capabilityId)
      const forceFullBackup = capabilityIds.some((id) => {
        const policy = this.registry.get(id)?.descriptor.recovery
        return policy === 'full-backup'
      })
      const commandRun = await this.recovery.finish(token, {
        status: 'succeeded',
        capabilityIds,
        traces,
        summary: finalText || results.map((result) => result.summary).join('；') || '命令已处理',
        forceFullBackup
      })
      session.messages = messages.slice(-Math.max(2, input.preset.historyLimit))
      session.recent = affected.slice(-30)
      this.#sessions.set(input.sessionId, session)
      this.progress(options, { type: 'completed', commandRun })
      return {
        commandRunId: token.id,
        status: 'succeeded',
        text: finalText || commandRun.summary || '命令已处理',
        results,
        affected,
        commandRun,
        rounds
      }
    } catch (error) {
      const message = safeError(error)
      const commandRun = await this.recovery.finish(token, {
        status: 'failed',
        capabilityIds: results.map((result) => result.capabilityId),
        traces,
        summary: finalText || undefined,
        error: message,
        forceFullBackup: results.some((result) =>
          this.registry.get(result.capabilityId)?.descriptor.recovery === 'full-backup'
        )
      })
      this.progress(options, { type: 'failed', message, commandRun })
      return {
        commandRunId: token.id,
        status: 'failed',
        text: finalText,
        results,
        affected: uniqueAffected(results),
        commandRun,
        rounds: Math.min(rounds, input.preset.maxToolRounds),
        error: message
      }
    }
  }
}
