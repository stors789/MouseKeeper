import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CheckCircle2, ListTodo, Plus } from 'lucide-react'
import { Link } from 'wouter'
import { buttonClassName } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton, SkeletonGroup } from '../../components/ui/Skeleton'
import { StatusChip } from '../../components/ui/StatusChip'
import { db } from '../../db'
import type { Task, TaskStatus } from '../../domain'
import { formatLocalDate } from '../../lib/format'
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS
} from '../../lib/labels'

function taskTone(task: Task) {
  if (task.status === 'completed') return 'positive' as const
  if (task.status === 'cancelled') return 'neutral' as const
  const boundary = `${task.dueDate}T${task.dueTime ?? '23:59'}`
  const now = new Date()
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes()
  ).padStart(2, '0')}`
  return boundary < `${today}T${time}` ? ('critical' as const) : ('informative' as const)
}

export function TasksPage() {
  const tasks = useLiveQuery(
    () =>
      db.tasks
        .filter((task) => task.deletedFlag === 0)
        .toArray()
        .then((items) =>
          items.toSorted((left, right) =>
            left.dueSortKey.localeCompare(right.dueSortKey)
          )
        ),
    []
  )
  const [status, setStatus] = useState<TaskStatus | 'all'>('pending')
  const visible = useMemo(
    () =>
      tasks?.filter((task) => status === 'all' || task.status === status) ?? [],
    [status, tasks]
  )

  return (
    <div className="feature-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">工作 / 任务</p>
          <h2>任务</h2>
          <p>{tasks ? `${visible.length} 项当前结果` : '正在读取本地任务'}</p>
        </div>
        <Link
          className={buttonClassName({ variant: 'primary' })}
          href="/tasks/new"
        >
          <Plus aria-hidden="true" size={17} />
          新建任务
        </Link>
      </header>

      <div className="segmented-tabs" role="tablist" aria-label="任务状态">
        {(
          [
            ['pending', '待处理'],
            ['completed', '已完成'],
            ['cancelled', '已取消'],
            ['all', '全部']
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={status === value}
            key={value}
            role="tab"
            type="button"
            onClick={() => setStatus(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tasks === undefined ? (
        <SkeletonGroup label="正在加载任务">
          <div className="task-list">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton height={68} key={index} />
            ))}
          </div>
        </SkeletonGroup>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={status === 'completed' ? CheckCircle2 : ListTodo}
          title={status === 'pending' ? '没有待处理任务' : '这个分类目前为空'}
          description={
            status === 'pending'
              ? '从任一对象详情或这里创建下一项本地任务。'
              : '切换分类查看其他任务。'
          }
          action={
            status === 'pending' ? (
              <Link
                className={buttonClassName({ variant: 'primary' })}
                href="/tasks/new"
              >
                创建任务
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="task-list" aria-label="任务列表">
          {visible.map((task) => {
            const tone = taskTone(task)
            return (
              <li key={task.id}>
                <span className="task-list__rail" data-tone={tone} />
                <div>
                  <strong>{task.title}</strong>
                  <p>
                    截止 {formatLocalDate(task.dueDate)}
                    {task.dueTime ? ` ${task.dueTime}` : ''} ·{' '}
                    {TASK_PRIORITY_LABELS[task.priority]}优先级
                  </p>
                </div>
                <StatusChip
                  label={
                    tone === 'critical'
                      ? '已逾期'
                      : TASK_STATUS_LABELS[task.status]
                  }
                  tone={tone}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
