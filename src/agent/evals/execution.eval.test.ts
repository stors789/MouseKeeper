import { createApplicationCapabilityRegistry } from '../../application'
import { createMouseKeeperDatabase, type MouseKeeperDatabase } from '../../db'
import { MouseKeeperService } from '../../services'
import { AgentOrchestrator, type AgentRunInput } from '../orchestrator'
import { createDefaultProviderSettings } from '../provider/defaults'
import { AgentDatabase } from '../recovery/database'
import { RecoveryManager } from '../recovery/recovery-manager'
import { DeterministicTranscriptModel, toolCall, type TranscriptStep } from './deterministic-model'

describe('offline Agent execution evals with production registry and databases', () => {
  let business: MouseKeeperDatabase
  let history: AgentDatabase
  let recovery: RecoveryManager
  const settings = createDefaultProviderSettings('2026-08-01T00:00:00.000Z')

  beforeEach(async () => {
    business = createMouseKeeperDatabase(`eval-execution-business-${crypto.randomUUID()}`)
    history = new AgentDatabase(`eval-execution-history-${crypto.randomUUID()}`)
    await Promise.all([business.open(), history.open()])
    recovery = new RecoveryManager(business, history)
  })

  afterEach(async () => {
    business.close()
    history.close()
    await Promise.all([business.delete(), history.delete()])
    localStorage.clear()
  })

  function input(prompt: string, route = '/mice'): AgentRunInput {
    return {
      sessionId: `offline-${crypto.randomUUID()}`,
      prompt,
      profile: settings.profiles[0]!,
      preset: { ...settings.presets[0]!, stream: false },
      context: {
        currentRoute: route,
        selected: [],
        visibleFilters: {},
        locale: 'zh-CN',
        timeZone: 'Asia/Shanghai',
        now: '2026-08-01T12:00:00+08:00'
      }
    }
  }

  function harness(transcript: readonly TranscriptStep[]) {
    const model = new DeterministicTranscriptModel(transcript)
    const registry = createApplicationCapabilityRegistry(business, new MouseKeeperService(business))
    return { model, orchestrator: new AgentOrchestrator(registry, model, recovery) }
  }

  it('executes a real create, records exact trace/data diff, and precisely undoes it', async () => {
    const { orchestrator } = harness([
      { text: '', calls: [toolCall('create-cage', 'cage.create', { cageNumber: 'EVAL-CAGE', maxCapacity: 5 })] },
      { text: '已创建 EVAL-CAGE。' }
    ])
    const result = await orchestrator.run(input('创建容量 5 的 EVAL-CAGE'))
    expect(result.status).toBe('succeeded')
    expect(result.commandRun.capabilityIds).toEqual(['cage.create'])
    expect(result.commandRun.traces).toEqual([expect.objectContaining({ capabilityId: 'cage.create', status: 'succeeded' })])
    expect((await business.cages.toArray()).filter((cage) => cage.cageNumber === 'EVAL-CAGE')).toHaveLength(1)
    expect(result.commandRun.recoveryKind).toBe('row-diff')
    expect(result.commandRun.changes.some((change) => change.table === 'cages')).toBe(true)
    await recovery.undo(result.commandRunId)
    expect((await business.cages.toArray()).filter((cage) => cage.cageNumber === 'EVAL-CAGE')).toHaveLength(0)
  })

  it('uses a real prior tool result in a dependent compound workflow with one recovery boundary', async () => {
    const { orchestrator, model } = harness([
      { text: '', calls: [toolCall('compound-cage', 'cage.create', { cageNumber: 'EVAL-COMPOUND', maxCapacity: 4 })] },
      (request) => {
        const payload = JSON.parse(request.messages.at(-1)!.content) as { affected: Array<{ type: string; id: string }> }
        const cageId = payload.affected.find((item) => item.type === 'cage')!.id
        return { text: '', calls: [toolCall('compound-mouse', 'mouse.create', { earTag: 'EVAL-M1', strain: 'C57BL/6J', sex: 'female', initialCageId: cageId })] }
      },
      { text: '笼位、小鼠和初始分笼已完成。' }
    ])
    const result = await orchestrator.run(input('创建笼位，再创建小鼠放进去'))
    expect(result.status).toBe('succeeded')
    expect(result.commandRun.capabilityIds).toEqual(['cage.create', 'mouse.create'])
    expect(result.commandRun.traces.map((trace) => trace.capabilityId)).toEqual(['cage.create', 'mouse.create'])
    expect(new Set(result.commandRun.traces.map((trace) => trace.capabilityId)).size).toBe(2)
    expect((await business.mice.toArray()).filter((mouse) => mouse.earTag === 'EVAL-M1')).toHaveLength(1)
    expect(await business.cageAssignments.count()).toBe(1)
    expect(result.commandRun.recoveryKind).toBe('full-backup')
    expect(model.requests[1]?.messages.at(-1)?.role).toBe('tool')
  })

  it('records a view preference through the real extended handler and restores it on undo', async () => {
    const { orchestrator } = harness([
      { text: '', calls: [toolCall('configure-view', 'view.configure', { workspace: 'mice', state: { sex: 'female', sort: 'age-oldest' } })] },
      { text: '已应用视图。' }
    ])
    const result = await orchestrator.run(input('只看雌鼠，按出生日期排序'))
    expect(localStorage.getItem('mousekeeper:view-command:mice')).toContain('female')
    expect(result.commandRun.preferenceChanges).toHaveLength(1)
    expect(result.commandRun.recoveryKind).toBe('row-diff')
    await recovery.undo(result.commandRunId)
    expect(localStorage.getItem('mousekeeper:view-command:mice')).toBeNull()
  })

  it('keeps a real read-only dashboard query at recovery none', async () => {
    const { orchestrator } = harness([
      { text: '', calls: [toolCall('dashboard', 'query.dashboard', {})] },
      { text: '已读取总览。' }
    ])
    const result = await orchestrator.run(input('查看群体总览', '/'))
    expect(result.status).toBe('succeeded')
    expect(result.results[0]).toEqual(expect.objectContaining({ capabilityId: 'query.dashboard', modifiesData: false }))
    expect(result.commandRun.recoveryKind).toBe('none')
    expect(result.commandRun.changes).toEqual([])
  })

  it('returns a failed tool trace, then safely corrects it without hiding the failure', async () => {
    const { orchestrator } = harness([
      { text: '', calls: [toolCall('wrong-tool', 'cage.missing', {})] },
      { text: '', calls: [toolCall('corrected-tool', 'cage.create', { cageNumber: 'EVAL-CORRECTED', maxCapacity: 3 })] },
      { text: '已修正并完成。' }
    ])
    const result = await orchestrator.run(input('创建 EVAL-CORRECTED 笼位'))
    expect(result.status).toBe('succeeded')
    expect(result.commandRun.traces.map((trace) => trace.status)).toEqual(['failed', 'succeeded'])
    expect(result.commandRun.capabilityIds).toEqual(['cage.create'])
    expect((await business.cages.toArray()).filter((cage) => cage.cageNumber === 'EVAL-CORRECTED')).toHaveLength(1)
  })
})
