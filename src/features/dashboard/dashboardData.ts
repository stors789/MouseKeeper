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

export interface DashboardData {
  metrics: DashboardMetrics
  attentionItems: readonly DashboardAttentionItem[]
  composition: readonly DashboardCompositionItem[]
  recentActivity: readonly DashboardActivityItem[]
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
  recentActivity: [],
  updatedAtLabel: '当前为空库'
}
