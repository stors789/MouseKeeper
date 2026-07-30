import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Activity, NotebookPen, Scale } from 'lucide-react'
import { Link } from 'wouter'
import { buttonClassName } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton, SkeletonGroup } from '../../components/ui/Skeleton'
import { StatusChip } from '../../components/ui/StatusChip'
import { db } from '../../db'
import { mouseDisplayLabel } from '../../domain/normalization'
import type { MouseEvent, WeightRecord } from '../../domain/types'
import { formatInstant, formatWeight } from '../../lib/format'
import { EVENT_TYPE_LABELS } from '../../lib/labels'

type RecordsTab = 'events' | 'weights' | 'activity'

export function RecordsPage() {
  const data = useLiveQuery(async () => {
    const [events, weights, activities, mice] = await Promise.all([
      db.mouseEvents
        .orderBy('occurredAt')
        .reverse()
        .filter((event) => event.deletedFlag === 0)
        .limit(100)
        .toArray(),
      db.weightRecords
        .orderBy('measuredAt')
        .reverse()
        .filter((weight) => weight.deletedFlag === 0)
        .limit(100)
        .toArray(),
      db.activityLogs
        .orderBy('occurredAt')
        .reverse()
        .filter((activity) => activity.deletedFlag === 0)
        .limit(100)
        .toArray(),
      db.mice.toArray()
    ])
    return {
      events,
      weights,
      activities,
      mouseById: new Map(mice.map((mouse) => [mouse.id, mouse]))
    }
  }, [])
  const [tab, setTab] = useState<RecordsTab>('events')

  const count = useMemo(() => {
    if (!data) return 0
    if (tab === 'events') return data.events.length
    if (tab === 'weights') return data.weights.length
    return data.activities.length
  }, [data, tab])

  return (
    <div className="feature-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">研究 / 记录</p>
          <h2>记录中心</h2>
          <p>最近 {count} 条{tab === 'events' ? '事件' : tab === 'weights' ? '体重' : '活动'}</p>
        </div>
        <Link
          className={buttonClassName({ variant: 'primary' })}
          href="/records/weights/quick"
        >
          <Scale aria-hidden="true" size={17} />
          快速称重
        </Link>
      </header>

      <div className="segmented-tabs" role="tablist" aria-label="记录类型">
        {(
          [
            ['events', '事件'],
            ['weights', '体重'],
            ['activity', '活动日志']
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={tab === value}
            key={value}
            role="tab"
            type="button"
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {data === undefined ? (
        <SkeletonGroup label="正在加载记录">
          <div className="timeline-list">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton height={72} key={index} />
            ))}
          </div>
        </SkeletonGroup>
      ) : count === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title="这个记录分类目前为空"
          description="从小鼠详情添加事件，或使用快速称重连续录入。"
          action={
            <Link
              className={buttonClassName({ variant: 'secondary' })}
              href="/mice"
            >
              查找小鼠
            </Link>
          }
        />
      ) : tab === 'events' ? (
        <EventList
          events={data.events}
          mouseLabel={(id) => {
            const mouse = data.mouseById.get(id)
            return mouse ? mouseDisplayLabel(mouse) : `缺失记录 ${id}`
          }}
        />
      ) : tab === 'weights' ? (
        <WeightList
          weights={data.weights}
          mouseLabel={(id) => {
            const mouse = data.mouseById.get(id)
            return mouse ? mouseDisplayLabel(mouse) : `缺失记录 ${id}`
          }}
        />
      ) : (
        <ol className="timeline-list">
          {data.activities.map((activity) => (
            <li key={activity.id}>
              <span className="timeline-list__rail" aria-hidden="true" />
              <div>
                <strong>{activity.summary}</strong>
                <p>{activity.action}</p>
              </div>
              <time dateTime={activity.occurredAt}>
                {formatInstant(activity.occurredAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function EventList({
  events,
  mouseLabel
}: {
  events: MouseEvent[]
  mouseLabel: (mouseId: string) => string
}) {
  return (
    <ol className="timeline-list">
      {events.map((event) => (
        <li key={event.id}>
          <span className="timeline-list__rail" aria-hidden="true" />
          <div>
            <strong>{event.title}</strong>
            <p>
              <Link href={`/mice/${encodeURIComponent(event.mouseId)}`}>
                {mouseLabel(event.mouseId)}
              </Link>
              {event.description ? ` · ${event.description}` : ''}
            </p>
          </div>
          <div className="timeline-list__aside">
            <StatusChip
              icon={Activity}
              label={EVENT_TYPE_LABELS[event.eventType]}
              tone={event.eventType === 'abnormality' ? 'warning' : 'neutral'}
            />
            <time dateTime={event.occurredAt}>
              {formatInstant(event.occurredAt)}
            </time>
          </div>
        </li>
      ))}
    </ol>
  )
}

function WeightList({
  weights,
  mouseLabel
}: {
  weights: WeightRecord[]
  mouseLabel: (mouseId: string) => string
}) {
  return (
    <ol className="timeline-list">
      {weights.map((weight) => (
        <li key={weight.id}>
          <span className="timeline-list__rail" aria-hidden="true" />
          <div>
            <strong>{formatWeight(weight.valueGrams)}</strong>
            <p>
              <Link href={`/mice/${encodeURIComponent(weight.mouseId)}`}>
                {mouseLabel(weight.mouseId)}
              </Link>
              {weight.notes ? ` · ${weight.notes}` : ''}
            </p>
          </div>
          <time dateTime={weight.measuredAt}>
            {formatInstant(weight.measuredAt)}
          </time>
        </li>
      ))}
    </ol>
  )
}
