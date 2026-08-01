import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Check,
  CheckCircle2,
  FilePenLine,
  ListRestart,
  ListTodo,
  Plus,
  Trash2,
  X
} from 'lucide-react'
import { Link } from 'wouter'
import { APPLICATION_EVENT_NAMES, readApplicationViewCommand, viewCommandFromEvent } from '../../application'
import { Alert } from '../../components/ui/Alert'
import { Button, buttonClassName } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Select } from '../../components/ui/Select'
import { Skeleton, SkeletonGroup } from '../../components/ui/Skeleton'
import { StatusChip } from '../../components/ui/StatusChip'
import { db } from '../../db'
import {
  mouseDisplayLabel,
  todayLocalDate,
  type Task,
  type TaskStatus
} from '../../domain'
import { appService } from '../../app/runtime'
import { useToast } from '../../hooks/useToast'
import { readableError } from '../../lib/errors'
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
  const { showToast } = useToast()
  const initialView = useMemo(() => readApplicationViewCommand('tasks'), [])
  const focusTaskId =
    new URLSearchParams(window.location.search).get('focus') ?? ''
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
  const [status, setStatus] = useState<TaskStatus | 'all'>(() => initialView.status === 'all' || initialView.status === 'pending' || initialView.status === 'completed' || initialView.status === 'cancelled' ? initialView.status : 'pending')
  const [dueScope, setDueScope] = useState<
    'all' | 'today' | 'upcoming' | 'overdue'
  >(() => initialView.dueScope === 'today' || initialView.dueScope === 'upcoming' || initialView.dueScope === 'overdue' ? initialView.dueScope : 'all')
  const [relatedKey, setRelatedKey] = useState(() => typeof initialView.relatedKey === 'string' ? initialView.relatedKey : 'all')
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const relations = useLiveQuery(async () => {
    const [mice, cages, experiments] = await Promise.all([
      db.mice.filter((item) => item.deletedFlag === 0).toArray(),
      db.cages.filter((item) => item.deletedFlag === 0).toArray(),
      db.experiments.filter((item) => item.deletedFlag === 0).toArray()
    ])
    return [
      ...mice.map((mouse) => ({
        value: `mouse:${mouse.id}`,
        label: `小鼠 · ${mouseDisplayLabel(mouse)}`
      })),
      ...cages.map((cage) => ({
        value: `cage:${cage.id}`,
        label: `笼位 · ${cage.cageNumber}`
      })),
      ...experiments.map((experiment) => ({
        value: `experiment:${experiment.id}`,
        label: `实验 · ${experiment.name}`
      }))
    ].toSorted((left, right) =>
      left.label.localeCompare(right.label, 'zh-CN', { numeric: true })
    )
  }, [])
  useEffect(() => {
    const handleView = (event: Event) => {
      const state = viewCommandFromEvent(event, 'tasks')
      if (!state) return
      if (state.status === 'all' || state.status === 'pending' || state.status === 'completed' || state.status === 'cancelled') setStatus(state.status)
      if (state.dueScope === 'all' || state.dueScope === 'today' || state.dueScope === 'upcoming' || state.dueScope === 'overdue') setDueScope(state.dueScope)
      if (typeof state.relatedKey === 'string') setRelatedKey(state.relatedKey)
    }
    globalThis.addEventListener(APPLICATION_EVENT_NAMES.view, handleView)
    return () => globalThis.removeEventListener(APPLICATION_EVENT_NAMES.view, handleView)
  }, [])
  const visible = useMemo(
    () => {
      const today = todayLocalDate()
      const upcomingDate = new Date(`${today}T12:00:00`)
      upcomingDate.setDate(upcomingDate.getDate() + 7)
      const upcomingBoundary = [
        upcomingDate.getFullYear(),
        String(upcomingDate.getMonth() + 1).padStart(2, '0'),
        String(upcomingDate.getDate()).padStart(2, '0')
      ].join('-')
      return (
        tasks?.filter((task) => {
          if (status !== 'all' && task.status !== status) return false
          if (dueScope === 'today' && task.dueDate !== today) return false
          if (
            dueScope === 'upcoming' &&
            (task.status !== 'pending' ||
              task.dueDate <= today ||
              task.dueDate > upcomingBoundary)
          ) {
            return false
          }
          if (dueScope === 'overdue' && taskTone(task) !== 'critical') {
            return false
          }
          if (relatedKey !== 'all') {
            const separator = relatedKey.indexOf(':')
            const type = relatedKey.slice(0, separator)
            const id = relatedKey.slice(separator + 1)
            if (
              (type === 'mouse' && task.mouseId !== id) ||
              (type === 'cage' && task.cageId !== id) ||
              (type === 'experiment' && task.experimentId !== id)
            ) {
              return false
            }
          }
          return true
        }) ?? []
      )
    },
    [dueScope, relatedKey, status, tasks]
  )

  useEffect(() => {
    if (!focusTaskId || !visible.some((task) => task.id === focusTaskId)) {
      return undefined
    }
    const frame = requestAnimationFrame(() => {
      const task = document.getElementById(`task-${focusTaskId}`)
      task?.scrollIntoView({ block: 'center' })
      task?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusTaskId, visible])

  const setTaskStatus = async (task: Task, nextStatus: TaskStatus) => {
    setBusy(task.id)
    setError(undefined)
    try {
      await appService.setTaskStatus({
        operationId: crypto.randomUUID(),
        taskId: task.id,
        expectedRevision: task.revision,
        status: nextStatus
      })
      showToast({
        title:
          nextStatus === 'completed'
            ? '任务已完成'
            : nextStatus === 'cancelled'
              ? '任务已取消'
              : '任务已恢复',
        tone: nextStatus === 'cancelled' ? 'warning' : 'positive'
      })
    } catch (actionError) {
      setError(readableError(actionError))
    } finally {
      setBusy(undefined)
    }
  }

  const deleteTask = async (task: Task) => {
    setBusy(task.id)
    setError(undefined)
    try {
      await appService.softDeleteTask({
        operationId: crypto.randomUUID(),
        taskId: task.id,
        expectedRevision: task.revision
      })
      showToast({
        title: '任务已移入回收站',
        description: '可在“数据与安全”页面恢复。',
        tone: 'warning'
      })
    } catch (actionError) {
      setError(readableError(actionError))
    } finally {
      setBusy(undefined)
    }
  }

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

      {error ? (
        <Alert title="任务操作没有完成" tone="critical">
          {error}
        </Alert>
      ) : null}

      <div className="segmented-tabs" role="group" aria-label="任务状态筛选">
        {(
          [
            ['pending', '待处理'],
            ['completed', '已完成'],
            ['cancelled', '已取消'],
            ['all', '全部']
          ] as const
        ).map(([value, label]) => (
          <button
            aria-pressed={status === value}
            data-active={status === value || undefined}
            key={value}
            type="button"
            onClick={() => setStatus(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="filter-row task-filter-row">
        <Select
          ariaLabel="截止时间筛选"
          value={dueScope}
          options={[
            { value: 'all', label: '全部日期' },
            { value: 'today', label: '今日任务' },
            { value: 'upcoming', label: '未来 7 天' },
            { value: 'overdue', label: '已逾期' }
          ]}
          onValueChange={(value) =>
            setDueScope(value as typeof dueScope)
          }
        />
        <Select
          ariaLabel="关联对象筛选"
          value={relatedKey}
          options={[
            { value: 'all', label: '全部关联对象' },
            ...(relations ?? [])
          ]}
          onValueChange={setRelatedKey}
        />
        {dueScope !== 'all' || relatedKey !== 'all' ? (
          <Button
            size="small"
            variant="tertiary"
            onClick={() => {
              setDueScope('all')
              setRelatedKey('all')
            }}
          >
            清除日期与关联筛选
          </Button>
        ) : null}
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
              <li
                data-focused={task.id === focusTaskId || undefined}
                id={`task-${task.id}`}
                key={task.id}
                tabIndex={task.id === focusTaskId ? -1 : undefined}
              >
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
                <div className="row-actions">
                  <Link
                    className={buttonClassName({
                      variant: 'tertiary',
                      size: 'small'
                    })}
                    href={`/tasks/${encodeURIComponent(task.id)}/edit`}
                  >
                    <FilePenLine aria-hidden="true" size={15} />
                    编辑
                  </Link>
                  {task.status === 'pending' ? (
                    <>
                      <Button
                        size="small"
                        variant="secondary"
                        loading={busy === task.id}
                        leadingIcon={<Check aria-hidden="true" size={15} />}
                        onClick={() => void setTaskStatus(task, 'completed')}
                      >
                        完成
                      </Button>
                      <Button
                        size="small"
                        variant="tertiary"
                        disabled={busy === task.id}
                        leadingIcon={<X aria-hidden="true" size={15} />}
                        onClick={() => void setTaskStatus(task, 'cancelled')}
                      >
                        取消
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="small"
                      variant="secondary"
                      loading={busy === task.id}
                      leadingIcon={<ListRestart aria-hidden="true" size={15} />}
                      onClick={() => void setTaskStatus(task, 'pending')}
                    >
                      恢复
                    </Button>
                  )}
                  <Button
                    aria-label={`删除任务 ${task.title}`}
                    size="icon"
                    variant="tertiary"
                    disabled={busy === task.id}
                    leadingIcon={<Trash2 aria-hidden="true" size={15} />}
                    onClick={() => void deleteTask(task)}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
