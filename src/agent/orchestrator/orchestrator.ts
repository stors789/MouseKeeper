import type { CapabilityDescriptor, CapabilityExecutionResult, CapabilityRegistry, EntityReference } from '../../application'
import type { CommandToolTrace, RecoveryManager, RecoveryStartToken } from '../recovery'
import type { NormalizedMessage, NormalizedToolCall } from '../provider'
import { buildAgentInstructions } from './system-prompt'
import type { AgentModelClient, AgentOrchestratorOptions, AgentProgress, AgentRunInput, AgentRunResult } from './types'

interface SessionState {
  messages: NormalizedMessage[]
  recent: EntityReference[]
}

export function retainCompleteSessionTurns(
  messages: readonly NormalizedMessage[],
  limit: number
): NormalizedMessage[] {
  const turns: NormalizedMessage[][] = []
  for (const message of messages) {
    if (message.role === 'user' || turns.length === 0) turns.push([message])
    else turns.at(-1)!.push(message)
  }
  const kept: NormalizedMessage[][] = []
  let count = 0
  for (const turn of turns.toReversed()) {
    if (kept.length > 0 && count + turn.length > limit) break
    kept.unshift(turn)
    count += turn.length
  }
  return structuredClone((kept.length > 0 ? kept : turns.slice(-1)).flat())
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

function capabilityTokens(value: string): string[] {
  const normalized = value.toLocaleLowerCase()
  const latin = normalized.match(/[a-z0-9.]{2,}/g) ?? []
  const chinese = (normalized.match(/[\u3400-\u9fff]+/g) ?? []).flatMap((part) => {
    if (part.length < 2) return [part]
    return Array.from({ length: part.length - 1 }, (_, index) => part.slice(index, index + 2))
  })
  return [...new Set([...latin, ...chinese])]
}

function relevantCapabilities(
  catalog: readonly CapabilityDescriptor[],
  prompt: string,
  route: string
): CapabilityDescriptor[] {
  const tokens = capabilityTokens(prompt)
  const routeDomain = route.split('/')[1]
  return catalog
    .map((item, index) => {
      const haystack = `${item.id} ${item.domain} ${item.name} ${item.description}`.toLocaleLowerCase()
      const tokenScore = tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0)
      const routeScore = routeDomain && item.domain === routeDomain ? 2 : 0
      const queryScore = ['query.search', 'query.entities'].includes(item.id) ? 1 : 0
      return { item, index, score: tokenScore + routeScore + queryScore }
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 14)
    .map(({ item }) => item)
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
        const capability = this.registry.get(id)
        if (capability?.descriptor.modifiesData) {
          await this.recovery.prepareMutation(token)
        }
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
    const capabilityCatalog = this.registry.list({ limit: 250 })
    const starterCapabilities = relevantCapabilities(
      capabilityCatalog,
      input.prompt,
      input.context.currentRoute
    )
    const instructions = buildAgentInstructions({
      context: input.context,
      recent: session.recent,
      starterCapabilities,
      capabilityCatalog,
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
        let streamedText = ''
        const response = await this.model.generate(
          input.profile,
          input.preset,
          {
            instructions,
            messages,
            tools: this.registry.agentTools(),
            previousResponseId: lastResponseId
          },
          signal,
          (event) => {
            if (event.type !== 'text-delta') return
            streamedText += event.delta
            this.progress(options, { type: 'text-delta', delta: event.delta, text: streamedText })
          }
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
      const lastTrace = traces.at(-1)
      if (lastTrace?.status === 'failed') {
        throw new Error(`最后一步 ${lastTrace.capabilityId} 未完成：${lastTrace.error ?? '工具执行失败'}`)
      }
      const affected = uniqueAffected(results)
      const capabilityIds = results.map((result) => result.capabilityId)
      const forceFullBackup = traces.some(({ capabilityId: id }) => {
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
      const requestedHistory = Number.isFinite(input.preset.historyLimit)
        ? Math.max(2, input.preset.historyLimit)
        : 20
      const sessionCapacity = Math.min(400, Math.max(40, requestedHistory * 4))
      session.messages = retainCompleteSessionTurns(messages, sessionCapacity)
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
        forceFullBackup: traces.some(({ capabilityId }) =>
          this.registry.get(capabilityId)?.descriptor.recovery === 'full-backup'
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
