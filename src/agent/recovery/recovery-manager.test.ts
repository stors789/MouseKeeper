import { createMouseKeeperDatabase, type MouseKeeperDatabase } from '../../db'
import { MouseKeeperService } from '../../services'
import { createCoreCapabilityRegistry, type CapabilityExecutionContext } from '../../application'
import { AgentDatabase } from './database'
import { RecoveryConflictError, RecoveryManager } from './recovery-manager'

describe('RecoveryManager', () => {
  let business: MouseKeeperDatabase
  let history: AgentDatabase
  let service: MouseKeeperService
  let recovery: RecoveryManager

  beforeEach(async () => {
    business = createMouseKeeperDatabase(`recovery-business-${crypto.randomUUID()}`)
    history = new AgentDatabase(`recovery-history-${crypto.randomUUID()}`)
    await Promise.all([business.open(), history.open()])
    service = new MouseKeeperService(business)
    recovery = new RecoveryManager(business, history)
  })

  afterEach(async () => {
    business.close()
    history.close()
    await Promise.all([business.delete(), history.delete()])
  })

  function context(runId: string): CapabilityExecutionContext {
    return {
      actor: 'llm',
      commandRunId: runId,
      operationId: `${runId}-${crypto.randomUUID()}`
    }
  }

  it('persists a crash-safe running checkpoint and redacts prompt secrets', async () => {
    const token = await recovery.begin({
      sessionId: 'session-1',
      prompt: 'API Key: sk-this-should-never-be-stored'
    })
    const stored = await history.commandRuns.get(token.id)
    expect(stored).toMatchObject({ status: 'running', recoveryKind: 'full-backup' })
    expect(stored?.prompt).not.toContain('sk-this')
    expect(stored?.fullBefore).toBeDefined()
  })

  it('records exact row diffs and undoes a whole command', async () => {
    const registry = createCoreCapabilityRegistry(business, service)
    const token = await recovery.begin({ sessionId: 'session-1', prompt: '创建 C-UNDO 笼位' })
    const result = await registry.execute(
      'cage.create',
      { cageNumber: 'C-UNDO', maxCapacity: 5 },
      context(token.id)
    )
    const run = await recovery.finish(token, {
      status: 'succeeded',
      capabilityIds: ['cage.create'],
      traces: [],
      summary: result.summary
    })
    expect(run.recoveryKind).toBe('row-diff')
    expect(run.changes.some((change) => change.table === 'cages')).toBe(true)
    expect(run.changes.some((change) => change.table === 'activityLogs')).toBe(true)

    const undone = await recovery.undo(run.id)
    expect(undone.restoredRows).toBe(run.changes.length)
    expect(await business.cages.count()).toBe(0)
    expect(await business.activityLogs.count()).toBe(0)
    expect((await history.commandRuns.get(run.id))?.status).toBe('undone')
  })

  it('blocks undo when an affected row changed after the command', async () => {
    const registry = createCoreCapabilityRegistry(business, service)
    const token = await recovery.begin({ sessionId: 'session-1', prompt: '创建后更新' })
    const created = await registry.execute(
      'cage.create',
      { cageNumber: 'C-CONFLICT', maxCapacity: 5 },
      context(token.id)
    )
    const run = await recovery.finish(token, {
      status: 'succeeded',
      capabilityIds: ['cage.create'],
      traces: [],
      summary: created.summary
    })
    const cageId = created.affected.find((item) => item.type === 'cage')!.id
    const cage = (await business.cages.get(cageId))!
    await service.updateCage({
      operationId: `later-${crypto.randomUUID()}`,
      cageId,
      expectedRevision: cage.revision,
      patch: { notes: '后续修改' }
    })

    await expect(recovery.undo(run.id)).rejects.toBeInstanceOf(RecoveryConflictError)
    expect((await history.commandRuns.get(run.id))?.status).toBe('undo-conflict')
    expect((await business.cages.get(cageId))?.notes).toBe('后续修改')
  })

  it('promotes large cross-row changes to a full recovery point', async () => {
    const registry = createCoreCapabilityRegistry(business, service)
    const token = await recovery.begin({ sessionId: 'session-1', prompt: '批量创建 30 只' })
    await registry.execute(
      'mouse.create.batch',
      {
        entries: Array.from({ length: 30 }, (_, index) => ({
          earTag: `FULL-${index + 1}`,
          strain: 'C57BL/6J',
          sex: 'unknown'
        }))
      },
      context(token.id)
    )
    const run = await recovery.finish(token, {
      status: 'succeeded',
      capabilityIds: ['mouse.create.batch'],
      traces: [],
      summary: '批量创建完成'
    })
    expect(run.recoveryKind).toBe('full-backup')
    expect(run.fullBefore).toBeDefined()
  })
})
