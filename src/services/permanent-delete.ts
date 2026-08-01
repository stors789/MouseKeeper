import {
  activityLogSchema,
  MANUAL_MOUSE_EVENT_TYPES,
  type EntityType
} from '../domain'
import type { MouseKeeperDatabase } from '../db'

export type PurgeEntityType =
  | 'mouse'
  | 'cage'
  | 'experiment'
  | 'task'
  | 'tag'
  | 'mouseEvent'

const MANUAL_EVENT_TYPES = new Set<string>(MANUAL_MOUSE_EVENT_TYPES)

export interface PurgePreview {
  entityType: PurgeEntityType
  entityId: string
  label: string
  canPurge: boolean
  blockers: string[]
  deleteCounts: Record<string, number>
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0)
}

function isRecord(
  value: unknown
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

export async function createPurgePreview(
  database: MouseKeeperDatabase,
  entityType: PurgeEntityType,
  entityId: string
): Promise<PurgePreview> {
  if (entityType === 'mouse') {
    const mouse = await database.mice.get(entityId)
    if (!mouse || mouse.deletedFlag !== 1) {
      throw new Error('只能永久删除回收站中的小鼠')
    }
    const [
      children,
      breedingPairs,
      litters,
      cageAssignments,
      experimentAssignments,
      events,
      weights,
      tasks
    ] = await Promise.all([
      database.mice.filter(
        (item) => item.sireId === entityId || item.damId === entityId
      ).count(),
      database.breedingPairs.filter(
        (pair) => pair.sireId === entityId || pair.damId === entityId
      ).count(),
      database.litters.filter(
        (litter) => litter.sireId === entityId || litter.damId === entityId
      ).count(),
      database.cageAssignments
        .where('mouseId')
        .equals(entityId)
        .count(),
      database.experimentAssignments
        .where('mouseId')
        .equals(entityId)
        .count(),
      database.mouseEvents.where('mouseId').equals(entityId).count(),
      database.weightRecords.where('mouseId').equals(entityId).count(),
      database.tasks.where('mouseId').equals(entityId).count()
    ])
    const blockers = [
      children > 0 && `${children} 只后代仍引用此小鼠`,
      breedingPairs > 0 && `${breedingPairs} 个繁育组合仍引用此小鼠`,
      litters > 0 && `${litters} 个窝记录仍引用此小鼠`
    ].filter((item): item is string => Boolean(item))
    return {
      entityType,
      entityId,
      label: mouse.earTag ?? mouse.experimentNumber ?? mouse.name ?? mouse.id,
      canPurge: blockers.length === 0,
      blockers,
      deleteCounts: {
        mice: 1,
        cageAssignments,
        experimentAssignments,
        mouseEvents: events,
        weightRecords: weights,
        tasks
      }
    }
  }

  if (entityType === 'cage') {
    const cage = await database.cages.get(entityId)
    if (!cage || cage.deletedFlag !== 1) {
      throw new Error('只能永久删除回收站中的笼位')
    }
    const [assignments, events, tasks] = await Promise.all([
      database.cageAssignments.where('cageId').equals(entityId).count(),
      database.mouseEvents.where('cageId').equals(entityId).count(),
      database.tasks.where('cageId').equals(entityId).count()
    ])
    const blockers = [
      assignments > 0 && `${assignments} 条转笼历史仍引用此笼位`,
      events > 0 && `${events} 条事件仍引用此笼位`,
      tasks > 0 && `${tasks} 条任务仍引用此笼位`
    ].filter((item): item is string => Boolean(item))
    return {
      entityType,
      entityId,
      label: cage.cageNumber,
      canPurge: blockers.length === 0,
      blockers,
      deleteCounts: { cages: 1 }
    }
  }

  if (entityType === 'experiment') {
    const experiment = await database.experiments.get(entityId)
    if (!experiment || experiment.deletedFlag !== 1) {
      throw new Error('只能永久删除回收站中的实验')
    }
    const [groups, assignments, events, tasks] = await Promise.all([
      database.experimentGroups
        .where('experimentId')
        .equals(entityId)
        .count(),
      database.experimentAssignments
        .where('experimentId')
        .equals(entityId)
        .count(),
      database.mouseEvents.where('experimentId').equals(entityId).count(),
      database.tasks.where('experimentId').equals(entityId).count()
    ])
    const blockers = [
      groups > 0 && `${groups} 个组别仍引用此实验`,
      assignments > 0 && `${assignments} 条成员历史仍引用此实验`,
      events > 0 && `${events} 条事件仍引用此实验`,
      tasks > 0 && `${tasks} 条任务仍引用此实验`
    ].filter((item): item is string => Boolean(item))
    return {
      entityType,
      entityId,
      label: experiment.name,
      canPurge: blockers.length === 0,
      blockers,
      deleteCounts: { experiments: 1 }
    }
  }

  if (entityType === 'task') {
    const task = await database.tasks.get(entityId)
    if (!task || task.deletedFlag !== 1) {
      throw new Error('只能永久删除回收站中的任务')
    }
    return {
      entityType,
      entityId,
      label: task.title,
      canPurge: true,
      blockers: [],
      deleteCounts: { tasks: 1 }
    }
  }

  if (entityType === 'mouseEvent') {
    const event = await database.mouseEvents.get(entityId)
    if (!event || event.deletedFlag !== 1) {
      throw new Error('只能永久删除回收站中的事件')
    }
    const weights = await database.weightRecords
      .where('eventId')
      .equals(entityId)
      .toArray()
    const blockers = [
      event.eventType !== 'weight' &&
        !MANUAL_EVENT_TYPES.has(event.eventType) &&
        '系统业务事件必须随业务历史保留',
      event.eventType === 'weight' &&
        (weights.length !== 1 || weights[0]?.deletedFlag !== 1) &&
        '体重事件缺少配对的已删除体重记录'
    ].filter((item): item is string => Boolean(item))
    return {
      entityType,
      entityId,
      label: event.title,
      canPurge: blockers.length === 0,
      blockers,
      deleteCounts: {
        mouseEvents: 1,
        weightRecords: weights.length
      }
    }
  }

  const tag = await database.tags.get(entityId)
  if (!tag || tag.deletedFlag !== 1) {
    throw new Error('只能永久删除回收站中的标签')
  }
  const mice = await database.mice
    .where('tagIds')
    .equals(entityId)
    .count()
  const blockers = mice > 0 ? [`${mice} 只小鼠仍引用此标签`] : []
  return {
    entityType,
    entityId,
    label: tag.name,
    canPurge: blockers.length === 0,
    blockers,
    deleteCounts: { tags: 1 }
  }
}

async function addPurgeAudit(
  database: MouseKeeperDatabase,
  preview: PurgePreview,
  operationId: string,
  now: string
): Promise<void> {
  const primaryEntityType = preview.entityType as EntityType
  await database.activityLogs.add(
    activityLogSchema.parse({
      id: crypto.randomUUID(),
      schemaVersion: 1,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedFlag: 0,
      origin: 'user',
      operationId,
      occurredAt: now,
      action: `${preview.entityType}.purge`,
      primaryEntityType,
      primaryEntityId: preview.entityId,
      primaryEntityKey: `${preview.entityType}:${preview.entityId}`,
      entityRefKeys: [],
      summary: `Permanently deleted ${preview.entityType} ${preview.label}`,
      resultEntityIds: [],
      metadata: {
        label: preview.label,
        deletedRecords: sumCounts(preview.deleteCounts)
      }
    })
  )
}

export async function purgeDeletedEntity(
  database: MouseKeeperDatabase,
  preview: PurgePreview,
  operationId: string = crypto.randomUUID()
): Promise<number> {
  const now = new Date().toISOString()
  let deletedCount = 0
  await database.transaction('rw', database.tables, async () => {
    const expectedAction = `${preview.entityType}.purge`
    const replay = await database.activityLogs
      .where('operationId')
      .equals(operationId)
      .first()
    if (replay) {
      const metadata = isRecord(replay.metadata)
        ? replay.metadata
        : undefined
      if (
        replay.action !== expectedAction ||
        replay.primaryEntityId !== preview.entityId ||
        typeof metadata?.deletedRecords !== 'number'
      ) {
        throw new Error('永久删除 operationId 已用于不同请求')
      }
      deletedCount = metadata.deletedRecords
      return
    }
    const latest = await createPurgePreview(
      database,
      preview.entityType,
      preview.entityId
    )
    if (!latest.canPurge) {
      throw new Error(`仍有引用，不能永久删除：${latest.blockers.join('；')}`)
    }
    if (latest.entityType === 'mouse') {
      const eventIds = (
        await database.mouseEvents.where('mouseId').equals(latest.entityId).toArray()
      ).map((event) => event.id)
      await database.weightRecords.where('mouseId').equals(latest.entityId).delete()
      if (eventIds.length > 0) {
        await database.mouseEvents.bulkDelete(eventIds)
      }
      await database.cageAssignments
        .where('mouseId')
        .equals(latest.entityId)
        .delete()
      await database.experimentAssignments
        .where('mouseId')
        .equals(latest.entityId)
        .delete()
      await database.tasks.where('mouseId').equals(latest.entityId).delete()
      await database.mice.delete(latest.entityId)
    } else if (latest.entityType === 'cage') {
      await database.cages.delete(latest.entityId)
    } else if (latest.entityType === 'experiment') {
      await database.experiments.delete(latest.entityId)
    } else if (latest.entityType === 'task') {
      await database.tasks.delete(latest.entityId)
    } else if (latest.entityType === 'mouseEvent') {
      await database.weightRecords
        .where('eventId')
        .equals(latest.entityId)
        .delete()
      await database.mouseEvents.delete(latest.entityId)
    } else {
      await database.tags.delete(latest.entityId)
    }
    await addPurgeAudit(database, latest, operationId, now)
    deletedCount = sumCounts(latest.deleteCounts)
  })
  return deletedCount
}
