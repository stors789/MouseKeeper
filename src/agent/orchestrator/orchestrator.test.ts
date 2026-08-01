import { createCoreCapabilityRegistry } from '../../application'
import { createMouseKeeperDatabase, type MouseKeeperDatabase } from '../../db'
import { MouseKeeperService } from '../../services'
import { ProviderClient } from '../provider/client'
import { createDefaultProviderSettings } from '../provider/defaults'
import { SecretStore } from '../provider/secret-store'
import type { NormalizedLLMRequest, NormalizedLLMResult, NormalizedToolCall } from '../provider/types'
import { AgentDatabase } from '../recovery/database'
import { RecoveryManager } from '../recovery/recovery-manager'
import { AgentOrchestrator } from './orchestrator'
import type { AgentModelClient, AgentRunInput } from './types'

function call(id: string, name: string, args: Record<string, unknown>): NormalizedToolCall {
  return { id, name, arguments: args, rawArguments: JSON.stringify(args) }
}

class ScriptedModel implements AgentModelClient {
  readonly requests: NormalizedLLMRequest[] = []

  constructor(
    private readonly script: (
      input: NormalizedLLMRequest,
      index: number
    ) => NormalizedLLMResult | Promise<NormalizedLLMResult>
  ) {}

  async generate(
    _profile: AgentRunInput['profile'],
    _preset: AgentRunInput['preset'],
    input: NormalizedLLMRequest
  ): Promise<NormalizedLLMResult> {
    this.requests.push(structuredClone(input))
    return await this.script(input, this.requests.length - 1)
  }
}

describe('AgentOrchestrator', () => {
  let business: MouseKeeperDatabase
  let history: AgentDatabase
  let recovery: RecoveryManager
  const settings = createDefaultProviderSettings('2026-08-01T00:00:00.000Z')

  beforeEach(async () => {
    business = createMouseKeeperDatabase(`orchestrator-business-${crypto.randomUUID()}`)
    history = new AgentDatabase(`orchestrator-history-${crypto.randomUUID()}`)
    await Promise.all([business.open(), history.open()])
    recovery = new RecoveryManager(business, history)
  })

  afterEach(async () => {
    business.close()
    history.close()
    await Promise.all([business.delete(), history.delete()])
  })

  function runInput(prompt: string): AgentRunInput {
    return {
      sessionId: 'session-test',
      prompt,
      profile: settings.profiles[0]!,
      preset: { ...settings.presets[0]!, stream: false },
      context: {
        currentRoute: '/mice',
        selected: [],
        visibleFilters: { sex: 'female' },
        locale: 'zh-CN',
        timeZone: 'Asia/Shanghai',
        now: '2026-08-01T12:00:00+08:00'
      }
    }
  }

  function orchestrator(model: AgentModelClient) {
    return new AgentOrchestrator(
      createCoreCapabilityRegistry(business, new MouseKeeperService(business)),
      model,
      recovery
    )
  }

  it('executes an unambiguous mutation directly and records one undo boundary', async () => {
    const model = new ScriptedModel((_input, index) =>
      index === 0
        ? {
            id: 'response-1',
            text: '',
            toolCalls: [call('call-create', 'execute_capability', {
              capabilityId: 'cage.create',
              input: { cageNumber: 'NL-CAGE', maxCapacity: 5 }
            })],
            effective: { requested: settings.presets[0]!, omitted: [] }
          }
        : {
            id: 'response-2',
            text: '已创建笼位 NL-CAGE，可撤回。',
            toolCalls: [],
            effective: { requested: settings.presets[0]!, omitted: [] }
          }
    )
    const result = await orchestrator(model).run(runInput('创建一个容量 5 的 NL-CAGE 笼位'))
    expect(result).toMatchObject({ status: 'succeeded', rounds: 2 })
    expect(await business.cages.count()).toBe(1)
    expect(result.commandRun).toMatchObject({ recoveryKind: 'row-diff', capabilityIds: ['cage.create'] })
  })

  it('executes dependent compound steps using prior real tool output', async () => {
    const model = new ScriptedModel((input, index) => {
      if (index === 0) {
        return {
          text: '', toolCalls: [call('create-cage', 'execute_capability', {
            capabilityId: 'cage.create', input: { cageNumber: 'COMPOUND', maxCapacity: 4 }
          })], effective: { requested: settings.presets[0]!, omitted: [] }
        }
      }
      if (index === 1) {
        const toolMessage = input.messages.at(-1)!
        const output = JSON.parse(toolMessage.content) as { affected: Array<{ type: string; id: string }> }
        const cageId = output.affected.find((item) => item.type === 'cage')!.id
        return {
          text: '', toolCalls: [call('create-mouse', 'execute_capability', {
            capabilityId: 'mouse.create',
            input: { earTag: 'CMP-1', strain: 'C57BL/6J', sex: 'female', initialCageId: cageId }
          })], effective: { requested: settings.presets[0]!, omitted: [] }
        }
      }
      return {
        text: '已创建笼位、小鼠并完成初始分笼。',
        toolCalls: [],
        effective: { requested: settings.presets[0]!, omitted: [] }
      }
    })
    const result = await orchestrator(model).run(runInput('创建笼位，再创建一只小鼠放进去'))
    expect(result.status).toBe('succeeded')
    expect(result.commandRun.capabilityIds).toEqual(['cage.create', 'mouse.create'])
    expect(await business.cageAssignments.count()).toBe(1)
    expect(result.commandRun.recoveryKind).toBe('full-backup')
  })

  it('returns tool errors to the model so it can correct the next call', async () => {
    const model = new ScriptedModel((input, index) => {
      if (index === 0) {
        return {
          text: '', toolCalls: [call('bad', 'execute_capability', { capabilityId: 'cage.missing', input: {} })],
          effective: { requested: settings.presets[0]!, omitted: [] }
        }
      }
      if (index === 1) {
        expect(input.messages.at(-1)?.content).toContain('未知或不可用')
        return {
          text: '', toolCalls: [call('good', 'execute_capability', { capabilityId: 'cage.create', input: { cageNumber: 'RECOVERED', maxCapacity: 3 } })],
          effective: { requested: settings.presets[0]!, omitted: [] }
        }
      }
      return { text: '已改用正确能力完成。', toolCalls: [], effective: { requested: settings.presets[0]!, omitted: [] } }
    })
    const result = await orchestrator(model).run(runInput('创建笼位'))
    expect(result.error).toBeUndefined()
    expect(result.status).toBe('succeeded')
    expect(result.commandRun.traces.map((trace) => trace.status)).toEqual(['failed', 'succeeded'])
  })

  it('does not report success when the final tool call failed', async () => {
    const model = new ScriptedModel((_input, index) => index === 0
      ? {
          text: '',
          toolCalls: [call('bad-final', 'execute_capability', { capabilityId: 'cage.missing', input: {} })],
          effective: { requested: settings.presets[0]!, omitted: [] }
        }
      : {
          text: '操作已经完成。',
          toolCalls: [],
          effective: { requested: settings.presets[0]!, omitted: [] }
        })
    const result = await orchestrator(model).run(runInput('执行一个不存在的能力'))
    expect(result.status).toBe('failed')
    expect(result.error).toContain('最后一步 cage.missing 未完成')
    expect(result.commandRun.traces.at(-1)?.status).toBe('failed')
  })

  it('includes explicit route, filters, date and recent entities in context', async () => {
    const model = new ScriptedModel(() => ({
      text: '已查看上下文。',
      toolCalls: [],
      effective: { requested: settings.presets[0]!, omitted: [] }
    }))
    await orchestrator(model).run(runInput('这些是什么？'))
    expect(model.requests[0]?.instructions).toContain('/mice')
    expect(model.requests[0]?.instructions).toContain('female')
    expect(model.requests[0]?.instructions).toContain('2026-08-01')
    expect(model.requests[0]?.instructions).toContain('只有唯一来源时直接解析')
  })

  it('stops at the configured tool-round limit without inventing success', async () => {
    const model = new ScriptedModel((_input, index) => ({
      text: '',
      toolCalls: [call(`search-${index}`, 'search_capabilities', { query: '小鼠' })],
      effective: { requested: settings.presets[0]!, omitted: [] }
    }))
    const input = runInput('一直找')
    input.preset = { ...input.preset, maxToolRounds: 2 }
    const result = await orchestrator(model).run(input)
    expect(result).toMatchObject({ status: 'failed', rounds: 2 })
    expect(result.error).toContain('最大工具轮次 2')
    expect(result.commandRun.recoveryKind).toBe('none')
  })

  it('honors cancellation before requesting the model', async () => {
    const model = new ScriptedModel(() => ({
      text: '不应到达', toolCalls: [], effective: { requested: settings.presets[0]!, omitted: [] }
    }))
    const controller = new AbortController()
    controller.abort(new DOMException('Stopped', 'AbortError'))
    const result = await orchestrator(model).run(runInput('停止'), controller.signal)
    expect(result.status).toBe('failed')
    expect(model.requests).toHaveLength(0)
  })

  it('forwards provider text deltas as live progress without treating them as completion', async () => {
    const model: AgentModelClient = {
      generate(_profile, _preset, _input, _signal, onEvent) {
        onEvent?.({ type: 'response-started', id: 'stream-1' })
        onEvent?.({ type: 'text-delta', delta: '正在' })
        onEvent?.({ type: 'text-delta', delta: '处理' })
        return Promise.resolve({
          id: 'stream-1',
          text: '正在处理',
          toolCalls: [],
          effective: { requested: settings.presets[0]!, omitted: [] }
        })
      }
    }
    const progress: string[] = []
    const result = await orchestrator(model).run(runInput('流式回答'), undefined, {
      onProgress: (event) => {
        if (event.type === 'text-delta') progress.push(event.text)
      }
    })
    expect(progress).toEqual(['正在', '正在处理'])
    expect(result).toMatchObject({ status: 'succeeded', text: '正在处理' })
  })

  it.each([
    ['drop-oldest', 'current-only'],
    ['summarize-then-trim', 'local-summary'],
    ['fail', 'fails-before-fetch']
  ] as const)('keeps a complete tool turn in session so %s is applied by the next real ProviderClient request', async (strategy, expectation) => {
    const bodies: Array<Record<string, unknown>> = []
    let requestIndex = 0
    const fakeFetch = ((_url: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('expected JSON request body')
      bodies.push(JSON.parse(init.body) as Record<string, unknown>)
      requestIndex += 1
      if (requestIndex === 1) {
        return Promise.resolve(new Response(JSON.stringify({
          id: 'provider-tool',
          status: 'completed',
          output: [{
            type: 'function_call',
            call_id: `create-${strategy}`,
            name: 'execute_capability',
            arguments: JSON.stringify({
              capabilityId: 'cage.create',
              input: { cageNumber: `CTX-${strategy}`, maxCapacity: 3 }
            })
          }]
        })))
      }
      return Promise.resolve(new Response(JSON.stringify({
        id: `provider-final-${requestIndex}`,
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: requestIndex === 2 ? '第一条完成' : '第二条完成' }] }]
      })))
    }) as typeof fetch
    const client = new ProviderClient(new SecretStore(undefined, undefined), fakeFetch)
    const agent = orchestrator(client)
    const first = runInput('创建测试笼位')
    first.sessionId = `context-${strategy}`
    first.preset = { ...first.preset, historyLimit: 4, contextStrategy: strategy }
    await expect(agent.run(first)).resolves.toMatchObject({ status: 'succeeded' })

    const second = { ...runInput('检查刚才的结果'), sessionId: first.sessionId, preset: first.preset }
    const result = await agent.run(second)
    if (expectation === 'fails-before-fetch') {
      expect(result.status).toBe('failed')
      expect(result.error).toContain('超过本地上限 4')
      expect(bodies).toHaveLength(2)
      return
    }

    expect(result.status).toBe('succeeded')
    expect(bodies).toHaveLength(3)
    const nextInput = JSON.stringify(bodies[2]?.input)
    if (expectation === 'current-only') {
      expect(nextInput).toContain('检查刚才的结果')
      expect(nextInput).not.toContain('create-')
      expect(nextInput).not.toContain('第一条完成')
    } else {
      expect(nextInput).toContain('本地历史摘要')
      expect(nextInput).toContain(`create-${strategy}`)
      expect(nextInput).toContain('检查刚才的结果')
    }
  })
})
