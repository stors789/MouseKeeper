import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Activity, NotebookPen, Scale, Search, X } from 'lucide-react'
import { Link } from 'wouter'
import { Button, buttonClassName } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Input'
import { Skeleton, SkeletonGroup } from '../../components/ui/Skeleton'
import { StatusChip } from '../../components/ui/StatusChip'
import { db } from '../../db'
import {
  mouseDisplayLabel,
  normalizeText
} from '../../domain/normalization'
import type { MouseEvent, WeightRecord } from '../../domain/types'
import { formatInstant, formatWeight } from '../../lib/format'
import { EVENT_TYPE_LABELS } from '../../lib/labels'

type RecordsTab = 'events' | 'weights' | 'activity'

export function RecordsPage() {
  const searchParams = new URLSearchParams(window.location.search)
  const mouseFilter = searchParams.get('mouse') ?? ''
  const data = useLiveQuery(async () => {
    const eventsQuery = mouseFilter
      ? db.mouseEvents
          .where('mouseId')
          .equals(mouseFilter)
          .filter((event) => event.deletedFlag === 0)
          .toArray()
          .then((events) =>
            events
              .toSorted((left, right) =>
                right.occurredAt.localeCompare(left.occurredAt)
              )
              .slice(0, 100)
          )
      : db.mouseEvents
          .orderBy('occurredAt')
          .reverse()
          .filter((event) => event.deletedFlag === 0)
          .limit(100)
          .toArray()
    const weightsQuery = mouseFilter
      ? db.weightRecords
          .where('mouseId')
          .equals(mouseFilter)
          .filter((weight) => weight.deletedFlag === 0)
          .toArray()
          .then((weights) =>
            weights
              .toSorted((left, right) =>
                right.measuredAt.localeCompare(left.measuredAt)
              )
              .slice(0, 100)
          )
      : db.weightRecords
          .orderBy('measuredAt')
          .reverse()
          .filter((weight) => weight.deletedFlag === 0)
          .limit(100)
          .toArray()
    const activitiesQuery = mouseFilter
      ? Promise.all([
          db.activityLogs
            .where('primaryEntityKey')
            .equals(`mouse:${mouseFilter}`)
            .toArray(),
          db.activityLogs
            .where('entityRefKeys')
            .equals(`mouse:${mouseFilter}`)
            .toArray()
        ]).then((activityGroups) =>
            [...new Map(
              activityGroups
                .flat()
                .filter((activity) => activity.deletedFlag === 0)
                .map((activity) => [activity.id, activity])
            ).values()]
              .toSorted((left, right) =>
                right.occurredAt.localeCompare(left.occurredAt)
              )
              .slice(0, 100)
          )
      : db.activityLogs
          .orderBy('occurredAt')
          .reverse()
          .filter((activity) => activity.deletedFlag === 0)
          .limit(100)
          .toArray()
    const [events, weights, activities, mice] = await Promise.all([
      eventsQuery,
      weightsQuery,
      activitiesQuery,
      db.mice.toArray()
    ])
    return {
      events,
      weights,
      activities,
      mouseById: new Map(mice.map((mouse) => [mouse.id, mouse]))
    }
  }, [mouseFilter])
  const [tab, setTab] = useState<RecordsTab>('events')
  const [query, setQuery] = useState('')
  const normalizedQuery = normalizeText(query)
  const filteredEvents = useMemo(
    () =>
      data?.events.filter(
        (event) =>
          (!mouseFilter || event.mouseId === mouseFilter) &&
          (!normalizedQuery ||
            normalizeText(
              [
                event.title,
                event.description,
                event.snapshot?.mouseLabel,
                event.snapshot?.cageNumber,
                event.snapshot?.experimentName
              ]
                .filter(Boolean)
                .join(' ')
            ).includes(normalizedQuery))
      ) ?? [],
    [data?.events, mouseFilter, normalizedQuery]
  )
  const filteredWeights = useMemo(
    () =>
      data?.weights.filter((weight) => {
        const mouse = data.mouseById.get(weight.mouseId)
        return (
          (!mouseFilter || weight.mouseId === mouseFilter) &&
          (!normalizedQuery ||
            normalizeText(
              `${mouse ? mouseDisplayLabel(mouse) : weight.mouseId} ${weight.notes ?? ''}`
            ).includes(normalizedQuery))
        )
      }) ?? [],
    [data, mouseFilter, normalizedQuery]
  )
  const filteredActivities = useMemo(
    () =>
      data?.activities.filter(
        (activity) =>
          (!mouseFilter ||
            activity.primaryEntityKey === `mouse:${mouseFilter}` ||
            activity.entityRefKeys.includes(`mouse:${mouseFilter}`)) &&
          (!normalizedQuery ||
            normalizeText(
              `${activity.summary} ${activity.action}`
            ).includes(normalizedQuery))
      ) ?? [],
    [data?.activities, mouseFilter, normalizedQuery]
  )

  const count = useMemo(() => {
    if (!data) return 0
    if (tab === 'events') return filteredEvents.length
    if (tab === 'weights') return filteredWeights.length
    return filteredActivities.length
  }, [
    data,
    filteredActivities.length,
    filteredEvents.length,
    filteredWeights.length,
    tab
  ])

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

      <div className="segmented-tabs" role="group" aria-label="记录类型筛选">
        {(
          [
            ['events', '事件'],
            ['weights', '体重'],
            ['activity', '活动日志']
          ] as const
        ).map(([value, label]) => (
          <button
            aria-pressed={tab === value}
            data-active={tab === value || undefined}
            key={value}
            type="button"
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="records-filter-row">
        <label className="filter-search">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">搜索当前记录</span>
          <Input
            type="search"
            value={query}
            placeholder="搜索标题、描述、小鼠或备注"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        {mouseFilter ? (
          <Button
            size="small"
            variant="tertiary"
            leadingIcon={<X aria-hidden="true" size={15} />}
            onClick={() => {
              window.history.pushState(null, '', '/records')
              window.dispatchEvent(
                new PopStateEvent('popstate', { state: null })
              )
            }}
          >
            清除小鼠范围
          </Button>
        ) : null}
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
          events={filteredEvents}
          mouseLabel={(id) => {
            const mouse = data.mouseById.get(id)
            return mouse ? mouseDisplayLabel(mouse) : `缺失记录 ${id}`
          }}
        />
      ) : tab === 'weights' ? (
        <WeightList
          weights={filteredWeights}
          mouseLabel={(id) => {
            const mouse = data.mouseById.get(id)
            return mouse ? mouseDisplayLabel(mouse) : `缺失记录 ${id}`
          }}
        />
      ) : (
        <ol className="timeline-list">
          {filteredActivities.map((activity) => (
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
