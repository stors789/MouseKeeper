import { useLiveQuery } from 'dexie-react-hooks'
import { FlaskConical, Plus } from 'lucide-react'
import { Link } from 'wouter'
import { buttonClassName } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton, SkeletonGroup } from '../../components/ui/Skeleton'
import { StatusChip } from '../../components/ui/StatusChip'
import { db } from '../../db'
import type {
  Experiment,
  ExperimentAssignment,
  ExperimentGroup
} from '../../domain'
import { formatLocalDate } from '../../lib/format'
import { EXPERIMENT_STATUS_LABELS } from '../../lib/labels'

interface ExperimentRecord {
  experiment: Experiment
  groups: ExperimentGroup[]
  activeAssignments: ExperimentAssignment[]
}

function experimentTone(status: Experiment['status']) {
  if (status === 'active') return 'informative' as const
  if (status === 'completed') return 'positive' as const
  if (status === 'cancelled' || status === 'archived') return 'neutral' as const
  return 'warning' as const
}

export function ExperimentsPage() {
  const records = useLiveQuery(async (): Promise<ExperimentRecord[]> => {
    const [experiments, groups, assignments] = await Promise.all([
      db.experiments
        .filter((experiment) => experiment.deletedFlag === 0)
        .toArray(),
      db.experimentGroups
        .filter((group) => group.deletedFlag === 0)
        .toArray(),
      db.experimentAssignments
        .filter(
          (assignment) =>
            assignment.deletedFlag === 0 && assignment.activeFlag === 1
        )
        .toArray()
    ])

    return experiments
      .map((experiment) => ({
        experiment,
        groups: groups.filter((group) => group.experimentId === experiment.id),
        activeAssignments: assignments.filter(
          (assignment) => assignment.experimentId === experiment.id
        )
      }))
      .toSorted((left, right) =>
        right.experiment.updatedAt.localeCompare(left.experiment.updatedAt)
      )
  }, [])

  return (
    <div className="feature-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">研究 / 实验</p>
          <h2>实验管理</h2>
          <p>{records ? `${records.length} 个实验` : '正在读取实验与组别'}</p>
        </div>
        <Link
          className={buttonClassName({ variant: 'primary' })}
          href="/experiments/new"
        >
          <Plus aria-hidden="true" size={17} />
          新建实验
        </Link>
      </header>

      {records === undefined ? (
        <SkeletonGroup label="正在加载实验">
          <div className="record-grid">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton height={168} key={index} />
            ))}
          </div>
        </SkeletonGroup>
      ) : records.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="还没有实验"
          description="建立实验和至少一个组别，再从实验详情加入小鼠。"
          action={
            <Link
              className={buttonClassName({ variant: 'primary' })}
              href="/experiments/new"
            >
              创建第一个实验
            </Link>
          }
        />
      ) : (
        <ul className="record-grid" aria-label="实验列表">
          {records.map(({ experiment, groups, activeAssignments }) => (
            <li className="experiment-record" key={experiment.id}>
              <div className="experiment-record__header">
                <div>
                  <Link href={`/experiments/${encodeURIComponent(experiment.id)}`}>
                    {experiment.name}
                  </Link>
                  <p>{experiment.code ?? '未设置实验编号'}</p>
                </div>
                <StatusChip
                  icon={FlaskConical}
                  label={EXPERIMENT_STATUS_LABELS[experiment.status]}
                  tone={experimentTone(experiment.status)}
                />
              </div>
              <dl className="record-fact-grid">
                <div>
                  <dt>起止日期</dt>
                  <dd>
                    {formatLocalDate(experiment.startDate)} –{' '}
                    {formatLocalDate(experiment.endDate)}
                  </dd>
                </div>
                <div>
                  <dt>负责人</dt>
                  <dd>{experiment.principalInvestigator ?? '未记录'}</dd>
                </div>
                <div>
                  <dt>组别</dt>
                  <dd>{groups.length} 个</dd>
                </div>
                <div>
                  <dt>活动成员</dt>
                  <dd>{new Set(activeAssignments.map((item) => item.mouseId)).size} 只</dd>
                </div>
              </dl>
              <p className="record-footnote">
                {experiment.intervention ?? experiment.description ?? '暂无干预说明'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
