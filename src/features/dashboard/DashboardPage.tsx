import {
  Activity,
  Baby,
  Boxes,
  ClockAlert,
  FlaskConical,
  ListTodo,
  Rat,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { Link } from 'wouter'
import { Alert } from '../../components/ui/Alert'
import { buttonClassName } from '../../components/ui/buttonStyles'
import { EmptyState } from '../../components/ui/EmptyState'
import {
  Skeleton,
  SkeletonGroup
} from '../../components/ui/Skeleton'
import {
  StatusChip
} from '../../components/ui/StatusChip'
import type {
  DashboardActivityItem,
  DashboardAttentionItem,
  DashboardCompositionItem,
  DashboardData,
  DashboardMetrics,
  DashboardStatus
} from './dashboardData'

interface MetricDefinition {
  key: keyof DashboardMetrics
  label: string
  description: string
  href: string
  icon: LucideIcon
  tone?: 'critical'
}

const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    key: 'livingMice',
    label: '存活小鼠',
    description: '当前可管理的活体记录',
    href: '/mice',
    icon: Rat
  },
  {
    key: 'activeCages',
    label: '活动笼位',
    description: '正在使用的笼位',
    href: '/cages',
    icon: Boxes
  },
  {
    key: 'activeExperimentMice',
    label: '实验成员',
    description: '进行中实验的去重小鼠',
    href: '/experiments',
    icon: FlaskConical
  },
  {
    key: 'activeBreedingMice',
    label: '繁育成员',
    description: '活动繁育组合中的小鼠',
    href: '/breeding',
    icon: Baby
  },
  {
    key: 'pendingTasks',
    label: '待处理任务',
    description: '尚未完成的本地任务',
    href: '/tasks',
    icon: ListTodo
  },
  {
    key: 'overdueTasks',
    label: '逾期任务',
    description: '已经超过截止时间',
    href: '/tasks',
    icon: ClockAlert,
    tone: 'critical'
  }
]

interface DashboardPageProps {
  data: DashboardData
  status?: DashboardStatus
  errorMessage?: string
}

function MetricStrip({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <section aria-labelledby="colony-vitals-title" className="metric-strip">
      <div className="metric-strip__heading">
        <span className="assay-rail-mark" aria-hidden="true" />
        <div>
          <h3 id="colony-vitals-title">群体读数</h3>
          <p>当前群体与工作负荷的六项核心指标</p>
        </div>
      </div>
      <dl className="metric-strip__grid">
        {METRIC_DEFINITIONS.map((definition) => {
          const Icon = definition.icon
          const value = metrics[definition.key]

          return (
            <div
              className="metric-strip__item"
              data-tone={definition.tone}
              key={definition.key}
            >
              <dt>
                <Icon aria-hidden="true" size={17} />
                <span>{definition.label}</span>
              </dt>
              <dd>{value.toLocaleString()}</dd>
              <p>{definition.description}</p>
              <Link href={definition.href}>
                查看{definition.label}
                <span className="sr-only">，当前 {value.toLocaleString()}</span>
              </Link>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

function AttentionQueue({
  items
}: {
  items: readonly DashboardAttentionItem[]
}) {
  return (
    <section
      className="dashboard-section dashboard-attention"
      aria-labelledby="attention-title"
    >
      <header className="dashboard-section__header">
        <div>
          <p className="dashboard-section__eyebrow">优先处理</p>
          <h3 id="attention-title">需要关注</h3>
        </div>
        {items.length > 0 ? (
          <StatusChip
            icon={TriangleAlert}
            label={`${items.length} 项`}
            tone="warning"
          />
        ) : null}
      </header>
      {items.length > 0 ? (
        <ul className="attention-list">
          {items.map((item) => (
            <li className="attention-list__item" key={item.id}>
              <span
                aria-hidden="true"
                className="attention-list__rail"
                data-tone={item.tone}
              />
              <div>
                <div className="attention-list__title-row">
                  <strong>{item.title}</strong>
                  <StatusChip label={item.label} tone={item.tone} />
                </div>
                <p>{item.description}</p>
              </div>
              {item.href ? (
                <Link href={item.href}>查看详情</Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          icon={Activity}
          title="目前没有需要优先处理的事项"
          description="逾期任务、容量警告和异常事件会集中显示在这里。"
          action={
            <Link
              className={buttonClassName({
                variant: 'secondary',
                size: 'small'
              })}
              href="/tasks"
            >
              查看任务工作区
            </Link>
          }
        />
      )}
    </section>
  )
}

function Composition({
  items
}: {
  items: readonly DashboardCompositionItem[]
}) {
  let total = 0
  for (const item of items) {
    total += item.count
  }

  return (
    <section
      className="dashboard-section"
      aria-labelledby="composition-title"
    >
      <header className="dashboard-section__header">
        <div>
          <p className="dashboard-section__eyebrow">当前结构</p>
          <h3 id="composition-title">状态构成</h3>
        </div>
        {total > 0 ? <span className="section-total">{total} 只</span> : null}
      </header>
      {items.length > 0 && total > 0 ? (
        <div className="composition-list">
          {items.map((item) => {
            const percentage = Math.round((item.count / total) * 100)
            const style = {
              '--composition-share': `${percentage}%`
            } as CSSProperties

            return (
              <div className="composition-row" key={item.id}>
                <div className="composition-row__label">
                  <StatusChip label={item.label} tone={item.tone} />
                  <span>
                    {item.count.toLocaleString()} · {percentage}%
                  </span>
                </div>
                <div
                  aria-label={`${item.label} ${item.count} 只，占 ${percentage}%`}
                  className="composition-row__track"
                  role="img"
                >
                  <span data-tone={item.tone} style={style} />
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <EmptyState
          compact
          icon={Rat}
          title="还没有群体构成数据"
          description="创建小鼠记录后，这里会按当前状态直接标注数量与比例。"
        />
      )}
    </section>
  )
}

function RecentActivity({
  items
}: {
  items: readonly DashboardActivityItem[]
}) {
  return (
    <section
      className="dashboard-section dashboard-activity"
      aria-labelledby="activity-title"
    >
      <header className="dashboard-section__header">
        <div>
          <p className="dashboard-section__eyebrow">可追溯记录</p>
          <h3 id="activity-title">最近活动</h3>
        </div>
        {items.length > 0 ? (
          <Link className="section-link" href="/records">
            查看全部记录
          </Link>
        ) : null}
      </header>
      {items.length > 0 ? (
        <ol className="activity-timeline">
          {items.map((item) => (
            <li key={item.id}>
              <span className="activity-timeline__tick" aria-hidden="true" />
              <div>
                <div className="activity-timeline__heading">
                  <strong>{item.title}</strong>
                  <time>{item.occurredAtLabel}</time>
                </div>
                <p>{item.description}</p>
                {item.href ? <Link href={item.href}>查看记录</Link> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          compact
          icon={Activity}
          title="还没有活动记录"
          description="建档、转笼、称重和状态变化会按时间顺序出现在这里。"
        />
      )}
    </section>
  )
}

function DashboardSkeleton() {
  return (
    <SkeletonGroup
      className="dashboard-skeleton"
      label="正在加载群体总览"
    >
      <div className="dashboard-skeleton__header">
        <Skeleton width="13rem" height="2rem" />
        <Skeleton width="9rem" height="1rem" />
      </div>
      <div className="dashboard-skeleton__metrics">
        {METRIC_DEFINITIONS.map((definition) => (
          <div key={definition.key}>
            <Skeleton width="6rem" height="1rem" />
            <Skeleton width="4rem" height="2.25rem" />
            <Skeleton width="8rem" height="0.8rem" />
          </div>
        ))}
      </div>
      <div className="dashboard-skeleton__body">
        <Skeleton height="18rem" />
        <Skeleton height="18rem" />
      </div>
    </SkeletonGroup>
  )
}

function DashboardPageHeader({
  updatedAtLabel
}: {
  updatedAtLabel?: string
}) {
  return (
    <header className="page-header dashboard-page__header">
      <div>
        <p className="page-header__eyebrow">COLONY / LOCAL WORKSPACE</p>
        <h2>群体总览</h2>
        <p>先看需要处理的事项，再查看当前群体结构和活动。</p>
      </div>
      <div className="data-freshness">
        <span aria-hidden="true" />
        <div>
          <strong>本地数据</strong>
          <small>{updatedAtLabel ?? '等待业务数据接入'}</small>
        </div>
      </div>
    </header>
  )
}

export function DashboardPage({
  data,
  errorMessage = '无法读取本地群体数据。请保留当前页面并重试。',
  status = 'ready'
}: DashboardPageProps) {
  if (status === 'loading') {
    return <DashboardSkeleton />
  }

  return (
    <div className="page dashboard-page">
      <DashboardPageHeader updatedAtLabel={data.updatedAtLabel} />
      {status === 'error' ? (
        <Alert title="群体总览加载失败" tone="critical">
          <p>{errorMessage}</p>
        </Alert>
      ) : null}
      {status === 'empty' ? (
        <Alert
          title="当前是空的本地工作区"
          tone="informative"
          action={
            <Link
              className={buttonClassName({
                variant: 'secondary',
                size: 'small'
              })}
              href="/data"
            >
              查看数据与安全
            </Link>
          }
        >
          <p>
            建立笼位和小鼠后，群体读数与活动会在这里汇总。应用壳当前不会生成占位记录。
          </p>
        </Alert>
      ) : null}
      <MetricStrip metrics={data.metrics} />
      <div className="dashboard-grid">
        <AttentionQueue items={data.attentionItems} />
        <Composition items={data.composition} />
        <RecentActivity items={data.recentActivity} />
      </div>
    </div>
  )
}
