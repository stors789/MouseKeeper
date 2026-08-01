import type { Table } from 'dexie'
import { loadDashboardSnapshot } from '../../queries/dashboard'
import { searchGlobalRecords } from '../../queries/search'
import { scanIntegrity, type MouseKeeperDatabase } from '../../db'
import type { MouseKeeperService } from '../../services'
import { CORE_CAPABILITY_DESCRIPTORS } from './catalog'
import { CapabilityRegistry } from './registry'
import type { CapabilityDescriptor, CapabilityExecutionContext, CapabilityExecutionResult, EntityReference } from './types'

const SERVICE_METHOD_BY_CAPABILITY: Readonly<Record<string, string>> = {
  'mouse.create': 'createMouseWithCage',
  'mouse.create.batch': 'createMice',
  'mouse.update': 'updateMouse',
  'mouse.status.set': 'changeMouseStatus',
  'mouse.status.batch': 'changeMiceStatus',
  'mouse.move': 'moveMouse',
  'mouse.move.batch': 'moveMice',
  'mouse.cage.leave': 'leaveCage',
  'mouse.tags.set': 'setMouseTags',
  'mouse.tags.batch': 'setMiceTags',
  'mouse.delete': 'softDeleteMouse',
  'mouse.restore': 'restoreMouse',
  'cage.create': 'createCage',
  'cage.update': 'updateCage',
  'cage.delete': 'softDeleteCage',
  'cage.restore': 'restoreCage',
  'breeding.create': 'createBreedingPair',
  'breeding.update': 'updateBreedingPair',
  'breeding.litter.create': 'createLitterWithOffspring',
  'experiment.create': 'createExperimentWithInitialGroup',
  'experiment.update': 'updateExperiment',
  'experiment.group.create': 'createExperimentGroup',
  'experiment.assign': 'assignMouseToExperiment',
  'experiment.assign.batch': 'assignMiceToExperiment',
  'experiment.exit': 'exitExperimentAssignment',
  'experiment.exit.batch': 'exitExperimentAssignments',
  'experiment.delete': 'softDeleteExperiment',
  'experiment.restore': 'restoreExperiment',
  'event.create': 'createMouseEvent',
  'event.update': 'updateMouseEvent',
  'event.delete': 'softDeleteMouseEvent',
  'event.restore': 'restoreMouseEvent',
  'weight.record': 'recordWeight',
  'weight.record.batch': 'recordWeights',
  'task.create': 'createTask',
  'task.update': 'updateTask',
  'task.status.set': 'setTaskStatus',
  'task.delete': 'softDeleteTask',
  'task.restore': 'restoreTask',
  'tag.create': 'createTag',
  'tag.delete': 'softDeleteTag',
  'tag.restore': 'restoreTag',
  'saved-view.create': 'createSavedView',
  'saved-view.update': 'updateSavedView',
  'saved-view.delete': 'softDeleteSavedView',
  'saved-view.restore': 'restoreSavedView',
  'sample.create': 'generateSampleData',
  'sample.delete': 'deleteSampleBatch'
}

const REVISION_TABLES = [
  ['mouseId', 'mice'],
  ['cageId', 'cages'],
  ['breedingPairId', 'breedingPairs'],
  ['experimentId', 'experiments'],
  ['eventId', 'mouseEvents'],
  ['taskId', 'tasks'],
  ['tagId', 'tags'],
  ['savedViewId', 'savedViews']
] as const

type EntityLike = { id: string; revision?: number; [key: string]: unknown }

function isEntityLike(value: unknown): value is EntityLike {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as { id?: unknown }).id === 'string'
  )
}

function inferEntityType(value: EntityLike): string {
  if ('earTag' in value || 'strainKey' in value) return 'mouse'
  if ('cageNumber' in value && 'maxCapacity' in value) return 'cage'
  if ('mouseId' in value && 'cageId' in value && 'startedAt' in value) return 'cageAssignment'
  if ('sireId' in value && 'damId' in value && 'pairedOn' in value) return 'breedingPair'
  if ('litterNumber' in value) return 'litter'
  if ('groupType' in value && 'experimentId' in value) return 'experimentGroup'
  if ('groupId' in value && 'joinedAt' in value) return 'experimentAssignment'
  if ('eventType' in value && 'occurredAt' in value) return 'mouseEvent'
  if ('valueGrams' in value) return 'weightRecord'
  if ('dueDate' in value && 'priority' in value) return 'task'
  if ('normalizedName' in value && 'color' in value) return 'tag'
  if ('queryVersion' in value) return 'savedView'
  if ('name' in value && 'status' in value && 'searchTerms' in value) return 'experiment'
  return 'entity'
}

function entityHref(type: string, id: string): string | undefined {
  if (type === 'mouse') return `/mice/${id}`
  if (type === 'cage') return `/cages/${id}`
  if (type === 'experiment') return `/experiments/${id}`
  if (type === 'breedingPair') return `/breeding/${id}`
  return undefined
}

function collectAffected(value: unknown, found = new Map<string, EntityReference>()): EntityReference[] {
  if (Array.isArray(value)) {
    for (const item of value) collectAffected(item, found)
    return [...found.values()]
  }
  if (!value || typeof value !== 'object') return [...found.values()]
  if (isEntityLike(value)) {
    const type = inferEntityType(value)
    const key = `${type}:${value.id}`
    found.set(key, {
      type,
      id: value.id,
      revision: typeof value.revision === 'number' ? value.revision : undefined,
      href: entityHref(type, value.id)
    })
  }
  for (const nested of Object.values(value)) collectAffected(nested, found)
  return [...found.values()]
}

async function addLatestRevision(
  database: MouseKeeperDatabase,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const result = structuredClone(input)
  if (result.expectedRevision === undefined) {
    for (const [idKey, tableName] of REVISION_TABLES) {
      if (typeof result[idKey] !== 'string') continue
      const record = await database.table(tableName).get(result[idKey]) as { revision?: number } | undefined
      if (record?.revision !== undefined) result.expectedRevision = record.revision
      break
    }
  }
  return result
}

async function normalizeServiceInput(
  database: MouseKeeperDatabase,
  capabilityId: string,
  raw: Record<string, unknown>,
  context: CapabilityExecutionContext
): Promise<Record<string, unknown>> {
  const input = await addLatestRevision(database, raw)
  if (capabilityId === 'mouse.status.batch' || capabilityId === 'mouse.tags.batch') {
    const mouseIds = Array.isArray(input.mouseIds) ? input.mouseIds.filter((item): item is string => typeof item === 'string') : []
    const mice = await database.mice.bulkGet(mouseIds)
    input.targets = mice.flatMap((mouse) =>
      mouse ? [{ mouseId: mouse.id, expectedRevision: mouse.revision }] : []
    )
    delete input.mouseIds
  }
  return {
    ...input,
    operationId: context.operationId,
    origin: 'user'
  }
}

function serviceHandler(
  database: MouseKeeperDatabase,
  service: MouseKeeperService,
  descriptor: CapabilityDescriptor,
  methodName: string
) {
  return {
    async execute(
      raw: Readonly<Record<string, unknown>>,
      context: CapabilityExecutionContext
    ): Promise<CapabilityExecutionResult> {
      const input = await normalizeServiceInput(database, descriptor.id, { ...raw }, context)
      const method = (service as unknown as Record<string, unknown>)[methodName]
      if (typeof method !== 'function') throw new Error(`业务服务不存在：${methodName}`)
      const command = await (method as (value: unknown) => Promise<unknown>).call(service, input)
      const result = command as { value?: unknown; warnings?: readonly string[] }
      const data = result.value ?? command
      const affected = collectAffected(data)
      return {
        status: 'succeeded',
        capabilityId: descriptor.id,
        summary: `${descriptor.name}完成${affected.length > 0 ? `，影响 ${affected.length} 条记录` : ''}`,
        data,
        affected,
        warnings: [...(result.warnings ?? [])],
        modifiesData: true,
        open: affected.find((item) => item.href)?.href
          ? {
              href: affected.find((item) => item.href)!.href!,
              label: '打开受影响记录'
            }
          : undefined
      }
    }
  }
}

const ENTITY_TABLES: Readonly<Record<string, string>> = {
  mouse: 'mice', cage: 'cages', cageAssignment: 'cageAssignments',
  breedingPair: 'breedingPairs', litter: 'litters', experiment: 'experiments',
  experimentGroup: 'experimentGroups', experimentAssignment: 'experimentAssignments',
  mouseEvent: 'mouseEvents', weightRecord: 'weightRecords', task: 'tasks', tag: 'tags',
  activityLog: 'activityLogs', savedView: 'savedViews', backupMetadata: 'backupMetadata'
}

function compareFilter(actual: unknown, expected: unknown): boolean {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    return Array.isArray(actual) ? actual.includes(expected) : actual === expected
  }
  const operators = expected as Record<string, unknown>
  if ('eq' in operators && actual !== operators.eq) return false
  if ('in' in operators && Array.isArray(operators.in) && !operators.in.includes(actual)) return false
  if ('contains' in operators) {
    const needle = String(operators.contains).toLocaleLowerCase()
    if (Array.isArray(actual)) {
      if (!actual.some((item) => String(item).toLocaleLowerCase().includes(needle))) return false
    } else if (!String(actual ?? '').toLocaleLowerCase().includes(needle)) return false
  }
  if ('gte' in operators && String(actual ?? '') < String(operators.gte)) return false
  if ('lte' in operators && String(actual ?? '') > String(operators.lte)) return false
  return true
}

async function queryEntities(
  database: MouseKeeperDatabase,
  input: Readonly<Record<string, unknown>>
) {
  const type = String(input.entityType)
  const tableName = ENTITY_TABLES[type]
  if (!tableName) throw new Error(`不支持的实体类型：${type}`)
  const table = database.table(tableName) as Table<Record<string, unknown>, string>
  let records = await table.toArray()
  if (input.includeDeleted !== true) {
    records = records.filter((item) => item.deletedFlag !== 1)
  }
  const filters = input.filters && typeof input.filters === 'object' && !Array.isArray(input.filters)
    ? input.filters as Record<string, unknown>
    : {}
  records = records.filter((item) =>
    Object.entries(filters).every(([key, value]) => compareFilter(item[key], value))
  )
  const text = typeof input.text === 'string' ? input.text.trim().toLocaleLowerCase() : ''
  if (text) records = records.filter((item) => JSON.stringify(item).toLocaleLowerCase().includes(text))
  const sortBy = typeof input.sortBy === 'string' ? input.sortBy : 'updatedAt'
  const direction = input.sortDirection === 'asc' ? 1 : -1
  records.sort((left, right) => direction * String(left[sortBy] ?? '').localeCompare(String(right[sortBy] ?? '')))
  const total = records.length
  const limit = Math.max(1, Math.min(typeof input.limit === 'number' ? input.limit : 100, 500))
  return { entityType: type, total, truncated: total > limit, records: records.slice(0, limit) }
}

export function createCoreCapabilityRegistry(
  database: MouseKeeperDatabase,
  service: MouseKeeperService
): CapabilityRegistry {
  const registry = new CapabilityRegistry()
  for (const descriptor of CORE_CAPABILITY_DESCRIPTORS) {
    if (descriptor.id === 'query.dashboard') {
      registry.register(descriptor, {
        async execute() {
          return { status: 'succeeded', capabilityId: descriptor.id, summary: '已读取群体总览', data: await loadDashboardSnapshot(database), affected: [], warnings: [], modifiesData: false }
        }
      })
      continue
    }
    if (descriptor.id === 'query.search') {
      registry.register(descriptor, {
        async execute(input) {
          const results = await searchGlobalRecords(database, String(input.query), typeof input.limit === 'number' ? input.limit : 25)
          return { status: 'succeeded', capabilityId: descriptor.id, summary: `找到 ${results.length} 个结果`, data: results, affected: [], warnings: [], modifiesData: false }
        }
      })
      continue
    }
    if (descriptor.id === 'query.entities') {
      registry.register(descriptor, {
        async execute(input) {
          const data = await queryEntities(database, input)
          return { status: 'succeeded', capabilityId: descriptor.id, summary: `找到 ${data.total} 条记录`, data, affected: [], warnings: [], modifiesData: false }
        }
      })
      continue
    }
    if (descriptor.id === 'query.integrity') {
      registry.register(descriptor, {
        async execute() {
          const data = await scanIntegrity(database)
          return { status: 'succeeded', capabilityId: descriptor.id, summary: data.ok ? '数据库完整性检查通过' : `发现 ${data.issues.length} 个问题`, data, affected: [], warnings: [], modifiesData: false }
        }
      })
      continue
    }
    const method = SERVICE_METHOD_BY_CAPABILITY[descriptor.id]
    if (!method) throw new Error(`能力没有 handler：${descriptor.id}`)
    registry.register(descriptor, serviceHandler(database, service, descriptor, method))
  }
  return registry
}
