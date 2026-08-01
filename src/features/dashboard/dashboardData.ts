import type { StatusTone } from '../../components/ui/StatusChip'

export interface DashboardMetrics {
  livingMice: number
  activeCages: number
  activeExperimentMice: number
  activeBreedingMice: number
  pendingTasks: number
  overdueTasks: number
}

export interface DashboardAttentionItem {
  id: string
  title: string
  description: string
  label: string
  tone: Extract<StatusTone, 'informative' | 'warning' | 'critical'>
  href?: string
}

export interface DashboardCompositionItem {
  id: string
  label: string
  count: number
  tone: StatusTone
}

export interface DashboardActivityItem {
  id: string
  title: string
  description: string
  occurredAtLabel: string
  href?: string
}

export interface DashboardRecentMouseItem {
  id: string
  label: string
  description: string
  statusLabel: string
  statusTone: StatusTone
  href: string
}

export interface DashboardUpcomingTaskItem {
  id: string
  title: string
  dueLabel: string
  priorityLabel: string
  href: string
}

export interface DashboardData {
  metrics: DashboardMetrics
  attentionItems: readonly DashboardAttentionItem[]
  composition: readonly DashboardCompositionItem[]
  sexComposition: readonly DashboardCompositionItem[]
  strainComposition: readonly DashboardCompositionItem[]
  ageComposition: readonly DashboardCompositionItem[]
  recentActivity: readonly DashboardActivityItem[]
  recentMice: readonly DashboardRecentMouseItem[]
  upcomingTasks: readonly DashboardUpcomingTaskItem[]
  updatedAtLabel?: string
}

export type DashboardStatus = 'ready' | 'empty' | 'loading' | 'error'

export const EMPTY_DASHBOARD_DATA: DashboardData = {
  metrics: {
    livingMice: 0,
    activeCages: 0,
    activeExperimentMice: 0,
    activeBreedingMice: 0,
    pendingTasks: 0,
    overdueTasks: 0
  },
  attentionItems: [],
  composition: [],
  sexComposition: [],
  strainComposition: [],
  ageComposition: [],
  recentActivity: [],
  recentMice: [],
  upcomingTasks: [],
  updatedAtLabel: '当前为空库'
}
