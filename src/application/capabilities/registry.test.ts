import type { MouseKeeperDatabase } from '../../db'
import { createMouseKeeperDatabase } from '../../db'
import { MouseKeeperService } from '../../services'
import { CORE_CAPABILITY_DESCRIPTORS } from './catalog'
import { createCoreCapabilityRegistry } from './core-handlers'
import type { CapabilityRegistry } from './registry'
import type { CapabilityExecutionContext } from './types'

describe('CapabilityRegistry', () => {
  let database: MouseKeeperDatabase
  let registry: CapabilityRegistry

  beforeEach(async () => {
    database = createMouseKeeperDatabase(`capability-test-${crypto.randomUUID()}`)
    await database.open()
    registry = createCoreCapabilityRegistry(database, new MouseKeeperService(database))
  })

  afterEach(async () => {
    database.close()
    await database.delete()
  })

  function context(label: string): CapabilityExecutionContext {
    return {
      actor: 'llm',
      commandRunId: `run-${label}`,
      operationId: `operation-${label}-${crypto.randomUUID()}`
    }
  }

  it('registers every descriptor once and exposes layered agent tools', () => {
    expect(registry.list({ limit: 250 })).toHaveLength(CORE_CAPABILITY_DESCRIPTORS.length)
    expect(new Set(registry.list({ limit: 250 }).map((item) => item.id)).size).toBe(
      CORE_CAPABILITY_DESCRIPTORS.length
    )
    expect(registry.agentTools().map((tool) => tool.name)).toEqual([
      'search_capabilities',
      'execute_capability'
    ])
    expect(JSON.stringify(registry.agentTools())).not.toMatch(/api.?key|secret/i)
  })

  it('searches descriptors without exposing handlers', () => {
    const matches = registry.list({ query: '批量 转笼', domain: 'mice' })
    expect(matches.map((item) => item.id)).toContain('mouse.move.batch')
    expect(matches[0]).not.toHaveProperty('handler')
  })

  it('executes a service command with application-owned operation metadata', async () => {
    const result = await registry.execute(
      'cage.create',
      { cageNumber: 'AGENT-CAGE', maxCapacity: 5 },
      context('create-cage')
    )
    expect(result).toMatchObject({
      status: 'succeeded',
      capabilityId: 'cage.create',
      modifiesData: true
    })
    expect(result.affected).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'cage' })])
    )
    expect(await database.cages.where('normalizedCageNumber').equals('agent-cage').count()).toBe(1)
    expect(await database.activityLogs.count()).toBe(1)
  })

  it('hydrates latest revisions for updates instead of asking the model', async () => {
    const created = await registry.execute(
      'cage.create',
      { cageNumber: 'REV-CAGE', maxCapacity: 5 },
      context('revision-create')
    )
    const cageId = created.affected.find((item) => item.type === 'cage')!.id
    await registry.execute(
      'cage.update',
      { cageId, patch: { notes: '由 Agent 更新' } },
      context('revision-update')
    )
    expect(await database.cages.get(cageId)).toMatchObject({
      notes: '由 Agent 更新',
      revision: 2
    })
  })

  it('converts public mouseIds into revision-safe batch targets', async () => {
    const first = await registry.execute(
      'mouse.create',
      { earTag: 'CAP-A', strain: 'C57BL/6J', sex: 'male' },
      context('mouse-a')
    )
    const second = await registry.execute(
      'mouse.create',
      { earTag: 'CAP-B', strain: 'C57BL/6J', sex: 'female' },
      context('mouse-b')
    )
    const mouseIds = [...first.affected, ...second.affected]
      .filter((item) => item.type === 'mouse')
      .map((item) => item.id)
    await registry.execute(
      'mouse.status.batch',
      { mouseIds, status: 'reserved', occurredOn: '2026-08-01' },
      context('mouse-batch')
    )
    expect((await database.mice.bulkGet(mouseIds)).map((mouse) => mouse?.status)).toEqual([
      'reserved',
      'reserved'
    ])
  })

  it('supports generic filtered and sorted entity queries', async () => {
    await registry.execute(
      'cage.create',
      { cageNumber: 'QUERY-A', maxCapacity: 5, room: 'North' },
      context('query-a')
    )
    await registry.execute(
      'cage.create',
      { cageNumber: 'QUERY-B', maxCapacity: 4, room: 'South' },
      context('query-b')
    )
    const result = await registry.execute(
      'query.entities',
      {
        entityType: 'cage',
        filters: { room: { contains: 'south' } },
        sortBy: 'cageNumber',
        sortDirection: 'asc'
      },
      context('query-cages')
    )
    expect(result.data).toMatchObject({ total: 1, truncated: false })
    expect((result.data as { records: Array<{ cageNumber: string }> }).records[0]?.cageNumber).toBe('QUERY-B')
  })

  it('rejects missing required parameters before reaching the service', async () => {
    await expect(
      registry.execute('cage.create', { maxCapacity: 5 }, context('invalid'))
    ).rejects.toThrow('缺少必要参数 cageNumber')
    expect(await database.cages.count()).toBe(0)
  })
})
