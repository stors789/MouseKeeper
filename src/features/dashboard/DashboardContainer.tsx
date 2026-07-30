import { useLiveQuery } from 'dexie-react-hooks'
import { appDatabase } from '../../app/runtime'
import { formatInstant } from '../../lib/format'
import { MOUSE_STATUS_LABELS } from '../../lib/labels'
import { loadDashboardSnapshot } from '../../queries/dashboard'
import { DashboardPage } from './DashboardPage'
import {
  EMPTY_DASHBOARD_DATA,
  type DashboardData
} from './dashboardData'

const STATUS_TONES = {
  alive: 'positive',
  experimental: 'informative',
  breeding: 'warning',
  reserved: 'informative',
  transferred: 'neutral',
  dead: 'critical',
  euthanized: 'critical',
  other: 'neutral'
} as const

function entityHref(type: string, id: string): string | undefined {
  if (type === 'mouse') return `/mice/${encodeURIComponent(id)}`
  if (type === 'cage') return `/cages/${encodeURIComponent(id)}`
  if (type === 'experiment') {
    return `/experiments/${encodeURIComponent(id)}`
  }
  if (type === 'breedingPair') {
    return `/breeding/${encodeURIComponent(id)}`
  }
  if (type === 'task') return '/tasks'
  return '/records'
}

export function DashboardContainer() {
  const snapshot = useLiveQuery(() => loadDashboardSnapshot(appDatabase), [])
  if (!snapshot) {
    return <DashboardPage data={EMPTY_DASHBOARD_DATA} status="loading" />
  }

  const data: DashboardData = {
    metrics: snapshot.metrics,
    attentionItems: snapshot.attention.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      label:
        item.kind === 'overdue-task'
          ? '已逾期'
          : item.kind === 'cage-capacity'
            ? '容量'
            : '异常',
      tone: item.severity,
      href: item.href
    })),
    composition: Object.entries(snapshot.statusCounts)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => ({
        id: status,
        label: MOUSE_STATUS_LABELS[
          status as keyof typeof MOUSE_STATUS_LABELS
        ],
        count,
        tone: STATUS_TONES[status as keyof typeof STATUS_TONES]
      })),
    recentActivity: snapshot.recentActivity.map((activity) => ({
      id: activity.id,
      title: activity.summary,
      description: activity.action,
      occurredAtLabel: formatInstant(activity.occurredAt),
      href: entityHref(
        activity.primaryEntityType,
        activity.primaryEntityId
      )
    })),
    updatedAtLabel: `更新于 ${formatInstant(snapshot.generatedAt)}`
  }
  const empty =
    Object.values(snapshot.metrics).every((value) => value === 0) &&
    snapshot.recentActivity.length === 0
  return (
    <DashboardPage data={data} status={empty ? 'empty' : 'ready'} />
  )
}
