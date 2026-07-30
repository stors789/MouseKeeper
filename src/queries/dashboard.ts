import type {
  ActivityLog,
  MouseStatus,
  Task
} from '../domain/types'
import { todayLocalDate } from '../domain/dates'
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
  attention: Array<{
    id: string
    kind: 'overdue-task' | 'cage-capacity' | 'abnormal-event'
    title: string
    description: string
    severity: 'informative' | 'warning' | 'critical'
    href: string
  }>
  recentActivity: ActivityLog[]
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
    recentActivity
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
      .toArray()
  ])

  const statusCounts = emptyStatusCounts()
  let livingMice = 0
  for (const mouse of mice) {
    statusCounts[mouse.status] += 1
    if (LIVING_STATUSES.has(mouse.status)) livingMice += 1
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
    if (ratio < 0.8) continue
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
    attention: attention.slice(0, 10),
    recentActivity,
    generatedAt: new Date().toISOString()
  }
}
