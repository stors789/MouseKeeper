import type {
  ActivityLog,
  Mouse,
  MouseSex,
  MouseStatus,
  Task
} from '../domain/types'
import {
  calculateAgeWeeks,
  todayLocalDate
} from '../domain/dates'
import type { MouseKeeperDatabase } from '../db/database'

const LIVING_STATUSES = new Set<MouseStatus>([
  'alive',
  'experimental',
  'breeding',
  'reserved'
])

export interface DashboardSnapshot {
  metrics: {
    livingMice: number
    activeCages: number
    activeExperimentMice: number
    activeBreedingMice: number
    pendingTasks: number
    overdueTasks: number
  }
  statusCounts: Readonly<Record<MouseStatus, number>>
  sexCounts: Readonly<Record<MouseSex, number>>
  strainCounts: Array<{ label: string; count: number }>
  ageCounts: Array<{ id: string; label: string; count: number }>
  attention: Array<{
    id: string
    kind: 'overdue-task' | 'cage-capacity' | 'abnormal-event'
    title: string
    description: string
    severity: 'informative' | 'warning' | 'critical'
    href: string
  }>
  recentActivity: ActivityLog[]
  recentMice: Mouse[]
  upcomingTasks: Task[]
  generatedAt: string
}

function emptyStatusCounts(): Record<MouseStatus, number> {
  return {
    alive: 0,
    experimental: 0,
    breeding: 0,
    reserved: 0,
    transferred: 0,
    dead: 0,
    euthanized: 0,
    other: 0
  }
}

function isTaskOverdue(task: Task, today: string): boolean {
  if (task.status !== 'pending' || task.deletedFlag === 1) return false
  const dueBoundary = task.dueTime
    ? `${task.dueDate}T${task.dueTime}`
    : `${task.dueDate}T23:59`
  return dueBoundary < `${today}T${new Date().toTimeString().slice(0, 5)}`
}

export async function loadDashboardSnapshot(
  database: MouseKeeperDatabase,
  today = todayLocalDate()
): Promise<DashboardSnapshot> {
  const [
    mice,
    cages,
    assignments,
    experimentAssignments,
    breedingPairs,
    tasks,
    recentEvents,
    recentActivity,
    settings
  ] = await Promise.all([
    database.mice.filter((mouse) => mouse.deletedFlag === 0).toArray(),
    database.cages.filter((cage) => cage.deletedFlag === 0).toArray(),
    database.cageAssignments
      .filter(
        (assignment) =>
          assignment.deletedFlag === 0 && assignment.activeFlag === 1
      )
      .toArray(),
    database.experimentAssignments
      .filter(
        (assignment) =>
          assignment.deletedFlag === 0 && assignment.activeFlag === 1
      )
      .toArray(),
    database.breedingPairs
      .filter(
        (pair) => pair.deletedFlag === 0 && pair.status === 'active'
      )
      .toArray(),
    database.tasks
      .filter((task) => task.deletedFlag === 0 && task.status === 'pending')
      .toArray(),
    database.mouseEvents
      .orderBy('occurredAt')
      .reverse()
      .filter((event) => event.deletedFlag === 0)
      .limit(100)
      .toArray(),
    database.activityLogs
      .orderBy('occurredAt')
      .reverse()
      .filter((activity) => activity.deletedFlag === 0)
      .limit(12)
      .toArray(),
    database.appSettings.get('app-settings')
  ])

  const statusCounts = emptyStatusCounts()
  const sexCounts: Record<MouseSex, number> = {
    male: 0,
    female: 0,
    unknown: 0,
    intersex: 0,
    other: 0
  }
  const strainMap = new Map<string, number>()
  const ageCounts = [
    { id: '0-3', label: '0–3 周', count: 0 },
    { id: '4-8', label: '4–8 周', count: 0 },
    { id: '9-16', label: '9–16 周', count: 0 },
    { id: '17-32', label: '17–32 周', count: 0 },
    { id: '33+', label: '33 周以上', count: 0 },
    { id: 'unknown', label: '周龄未知', count: 0 }
  ]
  let livingMice = 0
  for (const mouse of mice) {
    statusCounts[mouse.status] += 1
    sexCounts[mouse.sex] += 1
    strainMap.set(mouse.strain, (strainMap.get(mouse.strain) ?? 0) + 1)
    let ageBucketId = 'unknown'
    if (mouse.birthDate) {
      const weeks = calculateAgeWeeks(mouse.birthDate, today)
      if (weeks <= 3) ageBucketId = '0-3'
      else if (weeks <= 8) ageBucketId = '4-8'
      else if (weeks <= 16) ageBucketId = '9-16'
      else if (weeks <= 32) ageBucketId = '17-32'
      else ageBucketId = '33+'
    }
    const ageBucket = ageCounts.find((item) => item.id === ageBucketId)
    if (ageBucket) ageBucket.count += 1
    if (LIVING_STATUSES.has(mouse.status)) livingMice += 1
  }
  const sortedStrains = [...strainMap.entries()].toSorted(
    (left, right) =>
      right[1] - left[1] ||
      left[0].localeCompare(right[0], 'zh-CN', { numeric: true })
  )
  const topStrains = sortedStrains.slice(0, 5).map(([label, count]) => ({
    label,
    count
  }))
  if (sortedStrains.length > 5) {
    topStrains.push({
      label: '其他品系',
      count: sortedStrains
        .slice(5)
        .reduce((sum, [, count]) => sum + count, 0)
    })
  }

  const experimentMouseIds = new Set(
    experimentAssignments.map((assignment) => assignment.mouseId)
  )
  const breedingMouseIds = new Set<string>()
  for (const pair of breedingPairs) {
    breedingMouseIds.add(pair.sireId)
    breedingMouseIds.add(pair.damId)
  }

  const overdueTasks = tasks.filter((task) => isTaskOverdue(task, today))
  const occupancyByCage = new Map<string, number>()
  for (const assignment of assignments) {
    occupancyByCage.set(
      assignment.cageId,
      (occupancyByCage.get(assignment.cageId) ?? 0) + 1
    )
  }

  const attention: DashboardSnapshot['attention'] = []
  const capacityWarningPercent = settings?.capacityWarningPercent ?? 0.8
  for (const task of overdueTasks.slice(0, 5)) {
    attention.push({
      id: `task:${task.id}`,
      kind: 'overdue-task',
      title: task.title,
      description: `截止 ${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ''}`,
      severity: 'critical',
      href: `/tasks?focus=${encodeURIComponent(task.id)}`
    })
  }

  for (const cage of cages) {
    if (cage.maxCapacity <= 0) continue
    const count = occupancyByCage.get(cage.id) ?? 0
    const ratio = count / cage.maxCapacity
    if (ratio < capacityWarningPercent) continue
    attention.push({
      id: `cage:${cage.id}`,
      kind: 'cage-capacity',
      title: `笼位 ${cage.cageNumber}`,
      description: `${count} / ${cage.maxCapacity} 只小鼠`,
      severity: ratio > 1 ? 'critical' : 'warning',
      href: `/cages/${encodeURIComponent(cage.id)}`
    })
  }

  for (const event of recentEvents) {
    if (event.eventType !== 'abnormality') continue
    attention.push({
      id: `event:${event.id}`,
      kind: 'abnormal-event',
      title: event.title,
      description: event.description ?? `发生于 ${event.occurredOn}`,
      severity: 'warning',
      href: `/mice/${encodeURIComponent(event.mouseId)}?tab=timeline`
    })
    if (
      attention.filter((item) => item.kind === 'abnormal-event').length >= 3
    ) {
      break
    }
  }

  attention.sort((left, right) => {
    const score = { critical: 2, warning: 1, informative: 0 }
    return score[right.severity] - score[left.severity]
  })

  return {
    metrics: {
      livingMice,
      activeCages: cages.filter((cage) => cage.status === 'active').length,
      activeExperimentMice: experimentMouseIds.size,
      activeBreedingMice: breedingMouseIds.size,
      pendingTasks: tasks.length,
      overdueTasks: overdueTasks.length
    },
    statusCounts,
    sexCounts,
    strainCounts: topStrains,
    ageCounts,
    attention: attention.slice(0, 10),
    recentActivity,
    recentMice: mice
      .toSorted((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      )
      .slice(0, 5),
    upcomingTasks: tasks
      .filter((task) => !isTaskOverdue(task, today))
      .toSorted((left, right) =>
        left.dueSortKey.localeCompare(right.dueSortKey)
      )
      .slice(0, 5),
    generatedAt: new Date().toISOString()
  }
}
