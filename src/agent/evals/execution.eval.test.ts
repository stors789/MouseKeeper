import { createApplicationCapabilityRegistry, FileBroker, type CapabilityExecutionContext } from '../../application'
import { exportDatabaseBackup, serializeBackup } from '../../backup'
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

  function capabilityContext(label: string): CapabilityExecutionContext {
    return { actor: 'llm', commandRunId: `prepare-${label}`, operationId: `prepare-${label}-${crypto.randomUUID()}` }
  }

  function harness(transcript: readonly TranscriptStep[], files?: FileBroker) {
    const model = new DeterministicTranscriptModel(transcript)
    const registry = createApplicationCapabilityRegistry(
      business,
      new MouseKeeperService(business),
      files ? { fileBroker: files } : undefined
    )
    return { model, registry, orchestrator: new AgentOrchestrator(registry, model, recovery) }
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

  it('executes and undoes a previewed CSV import while preview remains read-only', async () => {
    const files = new FileBroker()
    const request = files.request('csv-import')
    files.provide(request.id, new File(['耳标号,品系,性别\nUNDO-CSV,C57BL/6J,雌'], 'undo.csv', { type: 'text/csv' }))
    const { registry } = harness([], files)
    const preview = await registry.execute('data.csv.preview', { fileRequestId: request.id }, capabilityContext('csv'))
    expect(await business.mice.count()).toBe(0)
    const previewToken = (preview.data as { previewToken: string }).previewToken
    const committed = new AgentOrchestrator(registry, new DeterministicTranscriptModel([
      { text: '', calls: [toolCall('commit-csv', 'data.csv.import', { previewToken })] },
      { text: 'CSV 已提交。' }
    ]), recovery)
    const result = await committed.run(input('确认导入预览的 CSV'))
    expect(result.status).toBe('succeeded')
    expect(result.commandRun.recoveryKind).toBe('full-backup')
    expect(await business.mice.where('normalizedEarTag').equals('undo-csv').count()).toBe(1)
    await recovery.undo(result.commandRunId)
    expect(await business.mice.count()).toBe(0)
  })

  it('executes and undoes a previewed full backup replacement', async () => {
    const source = createMouseKeeperDatabase(`eval-restore-source-${crypto.randomUUID()}`)
    await source.open()
    try {
      await new MouseKeeperService(source).createMouse({ operationId: crypto.randomUUID(), earTag: 'RESTORED', strain: 'BALB/c', sex: 'male' })
      await new MouseKeeperService(business).createMouse({ operationId: crypto.randomUUID(), earTag: 'ORIGINAL', strain: 'C57BL/6J', sex: 'female' })
      const files = new FileBroker()
      const request = files.request('backup-restore')
      files.provide(request.id, new File([serializeBackup(await exportDatabaseBackup(source))], 'restore.json', { type: 'application/json' }))
      const { registry } = harness([], files)
      const preview = await registry.execute('data.backup.preview', { fileRequestId: request.id }, capabilityContext('restore'))
      expect((await business.mice.toArray()).map((mouse) => mouse.earTag)).toContain('ORIGINAL')
      const previewToken = (preview.data as { previewToken: string }).previewToken
      const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:eval-restore')
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
      const committed = new AgentOrchestrator(registry, new DeterministicTranscriptModel([
        { text: '', calls: [toolCall('commit-restore', 'data.backup.restore', { previewToken })] },
        { text: '备份已恢复。' }
      ]), recovery)
      const result = await committed.run(input('确认恢复预览的备份', '/data'))
      createObjectURL.mockRestore()
      revokeObjectURL.mockRestore()
      expect(result.status).toBe('succeeded')
      expect(result.commandRun.recoveryKind).toBe('full-backup')
      expect((await business.mice.toArray()).map((mouse) => mouse.earTag)).toEqual(['RESTORED'])
      await recovery.undo(result.commandRunId)
      expect((await business.mice.toArray()).map((mouse) => mouse.earTag)).toEqual(['ORIGINAL'])
    } finally {
      source.close()
      await source.delete()
    }
  })

  it('executes and undoes representative permanent deletion', async () => {
    const service = new MouseKeeperService(business)
    const task = (await service.createTask({ operationId: crypto.randomUUID(), title: '撤回永久删除', dueDate: '2026-08-02' })).value
    await service.softDeleteTask({ operationId: crypto.randomUUID(), taskId: task.id, expectedRevision: task.revision })
    const { orchestrator } = harness([
      { text: '', calls: [toolCall('purge-task', 'data.purge.execute', { entityType: 'task', entityId: task.id })] },
      { text: '已永久删除。' }
    ])
    const result = await orchestrator.run(input('永久删除回收站中的任务', '/data'))
    expect(result.status).toBe('succeeded')
    expect(result.commandRun.recoveryKind).toBe('full-backup')
    expect(await business.tasks.get(task.id)).toBeUndefined()
    await recovery.undo(result.commandRunId)
    expect(await business.tasks.get(task.id)).toMatchObject({ id: task.id, deletedFlag: 1 })
  })

  it('allows undo when a later tool fails after a real mutation', async () => {
    const { orchestrator } = harness([
      { text: '', calls: [toolCall('create-before-failure', 'cage.create', { cageNumber: 'FAILED-BUT-MUTATED', maxCapacity: 2 })] },
      { text: '', calls: [toolCall('terminal-failure', 'capability.does-not-exist', {})] },
      { text: '最后一步失败。' }
    ])
    const result = await orchestrator.run(input('创建笼位后继续处理'))
    expect(result.status).toBe('failed')
    expect(result.commandRun.changes.length).toBeGreaterThan(0)
    expect((await business.cages.toArray()).map((cage) => cage.cageNumber)).toContain('FAILED-BUT-MUTATED')
    await recovery.undo(result.commandRunId)
    expect((await business.cages.toArray()).map((cage) => cage.cageNumber)).not.toContain('FAILED-BUT-MUTATED')
  })
})
