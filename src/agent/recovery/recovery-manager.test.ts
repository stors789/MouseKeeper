import Dexie from 'dexie'
import { BACKUP_TABLE_NAMES } from '../../backup'
import { createMouseKeeperDatabase, type MouseKeeperDatabase } from '../../db'
import { MouseKeeperService } from '../../services'
import { createCoreCapabilityRegistry, type CapabilityExecutionContext } from '../../application'
import { AgentDatabase } from './database'
import {
  MAX_RETAINED_COMMAND_RUNS,
  RecoveryConflictError,
  RecoveryManager,
  snapshotBusinessData
} from './recovery-manager'
import type { AgentCommandRun } from './types'

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

  it('starts light, then persists a crash-safe checkpoint before mutation', async () => {
    const token = await recovery.begin({
      sessionId: 'session-1',
      prompt: 'API Key: sk-this-should-never-be-stored'
    })
    const light = await history.commandRuns.get(token.id)
    expect(light).toMatchObject({ status: 'running', recoveryKind: 'none' })
    expect(light?.prompt).not.toContain('sk-this')
    expect(light?.fullBefore).toBeUndefined()

    await recovery.prepareMutation(token)
    const prepared = await history.commandRuns.get(token.id)
    expect(prepared).toMatchObject({ status: 'running', recoveryKind: 'full-backup' })
    expect(prepared?.fullBefore).toBeDefined()
  })

  it('reads every backup table inside one readonly Dexie transaction', async () => {
    const observations: Array<{ mode?: string; hasAllTables: boolean }> = []
    const restores = BACKUP_TABLE_NAMES.map((tableName) => {
      const table = business.table(tableName)
      const original = table.toArray.bind(table)
      const replacement = async (): Promise<unknown[]> => {
        const transaction = Dexie.currentTransaction
        observations.push({
          mode: transaction?.mode,
          hasAllTables: BACKUP_TABLE_NAMES.every((name) => {
            if (!transaction) return false
            try {
              transaction.table(name)
              return true
            } catch {
              return false
            }
          })
        })
        return original()
      }
      Object.assign(table, { toArray: replacement })
      return () => Object.assign(table, { toArray: original })
    })

    await snapshotBusinessData(business)

    expect(observations).toHaveLength(BACKUP_TABLE_NAMES.length)
    expect(observations.every((item) => item.mode === 'readonly')).toBe(true)
    expect(observations.every((item) => item.hasAllTables)).toBe(true)
    for (const restore of restores) restore()
  })

  it('does zero business snapshots for a read-only command', async () => {
    let snapshots = 0
    recovery = new RecoveryManager(business, history, {
      snapshot: async (database) => {
        snapshots += 1
        return snapshotBusinessData(database)
      }
    })
    const token = await recovery.begin({ sessionId: 'session-1', prompt: '查询全部笼位' })
    const run = await recovery.finish(token, {
      status: 'succeeded', capabilityIds: ['query.entities'], traces: [], summary: '查询完成'
    })
    expect(snapshots).toBe(0)
    expect(run).toMatchObject({ recoveryKind: 'none', changes: [], preferenceChanges: [] })
  })

  it('prepares once under concurrent calls and persists before returning', async () => {
    let snapshots = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    recovery = new RecoveryManager(business, history, {
      snapshot: async (database) => {
        snapshots += 1
        await gate
        return snapshotBusinessData(database)
      }
    })
    const token = await recovery.begin({ sessionId: 'session-1', prompt: '并发准备' })
    const first = recovery.prepareMutation(token)
    const second = recovery.prepareMutation(token)
    await Promise.resolve()
    expect(snapshots).toBe(1)
    release()
    await Promise.all([first, second])
    expect(snapshots).toBe(1)
    expect((await history.commandRuns.get(token.id))?.fullBefore).toBeDefined()
  })

  it('limits a mutating command to one before and one after snapshot', async () => {
    let snapshots = 0
    recovery = new RecoveryManager(business, history, {
      snapshot: async (database) => {
        snapshots += 1
        return snapshotBusinessData(database)
      }
    })
    const token = await recovery.begin({ sessionId: 'session-1', prompt: '创建笼位' })
    expect(snapshots).toBe(0)
    await recovery.prepareMutation(token)
    expect(snapshots).toBe(1)
    await service.createCage({ operationId: 'snapshot-count', cageNumber: 'COUNTED', maxCapacity: 3 })
    await recovery.finish(token, {
      status: 'succeeded', capabilityIds: ['cage.create'], traces: [], summary: '完成'
    })
    expect(snapshots).toBe(2)
  })

  it('records exact row diffs and undoes a whole command', async () => {
    const registry = createCoreCapabilityRegistry(business, service)
    const token = await recovery.begin({ sessionId: 'session-1', prompt: '创建 C-UNDO 笼位' })
    await recovery.prepareMutation(token)
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
    await recovery.prepareMutation(token)
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
    await recovery.prepareMutation(token)
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

  it('captures and conflict-checks non-secret application preferences', async () => {
    window.localStorage.setItem('mousekeeper:theme:v1', 'light')
    const token = await recovery.begin({ sessionId: 'session-1', prompt: '切换主题' })
    await recovery.prepareMutation(token)
    window.localStorage.setItem('mousekeeper:theme:v1', 'dark')
    const run = await recovery.finish(token, {
      status: 'succeeded',
      capabilityIds: ['settings.theme.set'],
      traces: [],
      summary: '主题已切换'
    })
    expect(run.preferenceChanges).toEqual([
      { key: 'mousekeeper:theme:v1', before: 'light', after: 'dark' }
    ])
    await recovery.undo(run.id)
    expect(window.localStorage.getItem('mousekeeper:theme:v1')).toBe('light')
  })

  it('keeps failed-but-mutated commands undoable', async () => {
    const token = await recovery.begin({ sessionId: 'session-1', prompt: '写入后失败' })
    await recovery.prepareMutation(token)
    const cage = (await service.createCage({
      operationId: 'failed-cage-operation', cageNumber: 'FAILED', maxCapacity: 4
    })).value
    const run = await recovery.finish(token, {
      status: 'failed', capabilityIds: [], traces: [], error: '模拟后续失败'
    })
    expect(run.status).toBe('failed')
    expect(run.changes.some((change) => change.id === cage.id)).toBe(true)
    await recovery.undo(run.id)
    expect(await business.cages.get(cage.id)).toBeUndefined()
  })

  it('bounds terminal history without deleting running commands', async () => {
    const base = (index: number, status: AgentCommandRun['status']): AgentCommandRun => ({
      id: `seed-${index}`,
      sessionId: 'seed',
      prompt: `seed ${index}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      status,
      capabilityIds: [],
      traces: [],
      changes: [],
      preferenceChanges: [],
      recoveryKind: 'none'
    })
    await history.commandRuns.bulkPut([
      ...Array.from({ length: 199 }, (_, index) => base(index, 'succeeded')),
      base(199, 'running'),
      base(200, 'running')
    ])

    const token = await recovery.begin({ id: 'new-running', sessionId: 'session-1', prompt: '新命令' })
    const records = await history.commandRuns.toArray()
    expect(records).toHaveLength(MAX_RETAINED_COMMAND_RUNS)
    expect(records.filter((record) => record.status === 'running').map((record) => record.id).sort())
      .toEqual(['new-running', 'seed-199', 'seed-200'])
    expect(await history.commandRuns.get('seed-0')).toBeUndefined()
    expect(await history.commandRuns.get(token.id)).toBeDefined()
  })
})
