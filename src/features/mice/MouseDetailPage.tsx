import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft,
  Boxes,
  CalendarClock,
  Dna,
  FilePenLine,
  FlaskConical,
  History,
  NotebookPen,
  Plus,
  Save,
  Scale,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'wouter'
import { appDatabase, appService } from '../../app/runtime'
import { Alert } from '../../components/ui/Alert'
import { Button, buttonClassName } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Field } from '../../components/ui/Field'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { StatusChip } from '../../components/ui/StatusChip'
import { Textarea } from '../../components/ui/Textarea'
import {
  MOUSE_EVENT_TYPES,
  MOUSE_STATUSES,
  WEIGHT_UNITS,
  mouseDisplayLabel,
  todayLocalDate,
  type MouseEventType,
  type MouseStatus,
  type WeightUnit
} from '../../domain'
import { useToast } from '../../hooks/useToast'
import { readableError } from '../../lib/errors'
import { formatAgeWeeks, formatInstant } from '../../lib/format'
import {
  EVENT_TYPE_LABELS,
  EXPERIMENT_STATUS_LABELS,
  MOUSE_SEX_LABELS,
  MOUSE_STATUS_LABELS,
  isTerminalMouseStatus
} from '../../lib/labels'
import { WarningRequiredError } from '../../services'
import { MouseStatusChip } from './MouseStatusChip'

const EVENT_OPTIONS = MOUSE_EVENT_TYPES.filter(
  (type): type is Exclude<MouseEventType, 'weight'> => type !== 'weight'
)

function optional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

function formString(data: FormData, key: string): string {
  const value = data.get(key)
  return typeof value === 'string' ? value : ''
}

function DetailItem({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children || '—'}</dd>
    </div>
  )
}

interface MoveWarning {
  operationId: string
  cageId: string
  warnings: readonly string[]
}

interface WeightWarning {
  operationId: string
  value: number
  unit: WeightUnit
  measuredOn: string
  notes?: string
  warnings: readonly string[]
}

export function MouseDetailPage({ mouseId }: { mouseId: string }) {
  const [, navigate] = useLocation()
  const { showToast } = useToast()
  const [error, setError] = useState<string>()
  const [statusOpen, setStatusOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [eventOpen, setEventOpen] = useState(false)
  const [weightOpen, setWeightOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [moveWarning, setMoveWarning] = useState<MoveWarning>()
  const [weightWarning, setWeightWarning] = useState<WeightWarning>()
  const [busyAction, setBusyAction] = useState<string>()

  const data = useLiveQuery(async () => {
    const mouse = await appDatabase.mice.get(mouseId)
    if (!mouse) return { mouse: undefined }
    const [
      cage,
      sire,
      dam,
      offspring,
      weights,
      events,
      assignments,
      experiments,
      groups,
      tags,
      allCages,
      allTags
    ] = await Promise.all([
      mouse.currentCageId
        ? appDatabase.cages.get(mouse.currentCageId)
        : Promise.resolve(undefined),
      mouse.sireId
        ? appDatabase.mice.get(mouse.sireId)
        : Promise.resolve(undefined),
      mouse.damId
        ? appDatabase.mice.get(mouse.damId)
        : Promise.resolve(undefined),
      appDatabase.mice
        .filter(
          (candidate) =>
            candidate.deletedFlag === 0 &&
            (candidate.sireId === mouseId || candidate.damId === mouseId)
        )
        .toArray(),
      appDatabase.weightRecords
        .filter(
          (weight) =>
            weight.deletedFlag === 0 && weight.mouseId === mouseId
        )
        .toArray(),
      appDatabase.mouseEvents
        .filter(
          (event) => event.deletedFlag === 0 && event.mouseId === mouseId
        )
        .toArray(),
      appDatabase.experimentAssignments
        .filter(
          (assignment) =>
            assignment.deletedFlag === 0 && assignment.mouseId === mouseId
        )
        .toArray(),
      appDatabase.experiments.toArray(),
      appDatabase.experimentGroups.toArray(),
      appDatabase.tags.bulkGet(mouse.tagIds),
      appDatabase.cages
        .filter(
          (candidate) =>
            candidate.deletedFlag === 0 &&
            candidate.status !== 'inactive' &&
            candidate.status !== 'retired'
        )
        .toArray(),
      appDatabase.tags
        .filter((tag) => tag.deletedFlag === 0)
        .sortBy('name')
    ])
    return {
      mouse,
      cage,
      sire,
      dam,
      offspring: offspring.toSorted((left, right) =>
        (left.birthDate ?? '').localeCompare(right.birthDate ?? '')
      ),
      weights: weights.toSorted((left, right) =>
        right.measuredAt.localeCompare(left.measuredAt)
      ),
      events: events.toSorted((left, right) =>
        right.occurredAt.localeCompare(left.occurredAt)
      ),
      assignments: assignments.toSorted((left, right) =>
        right.joinedAt.localeCompare(left.joinedAt)
      ),
      experimentById: new Map(
        experiments.map((experiment) => [experiment.id, experiment])
      ),
      groupById: new Map(groups.map((group) => [group.id, group])),
      tags: tags.filter((tag) => tag !== undefined),
      allCages,
      allTags
    }
  }, [mouseId])

  const currentWeight = data?.weights?.[0]
  const previousWeight = data?.weights?.[1]
  const weightChange =
    currentWeight && previousWeight
      ? currentWeight.valueGrams - previousWeight.valueGrams
      : undefined
  const weightMax = useMemo(
    () =>
      Math.max(
        1,
        ...(data?.weights?.slice(0, 12).map((item) => item.valueGrams) ?? [])
      ),
    [data?.weights]
  )

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyAction(key)
    setError(undefined)
    try {
      await action()
    } catch (actionError) {
      setError(readableError(actionError))
    } finally {
      setBusyAction(undefined)
    }
  }

  const submitStatus = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!data?.mouse) return
    const values = new FormData(event.currentTarget)
    const status = formString(values, 'status') as MouseStatus
    const occurredOn = formString(values, 'occurredOn')
    const reason = optional(formString(values, 'reason'))
    void runAction('status', async () => {
      await appService.changeMouseStatus({
        operationId: crypto.randomUUID(),
        mouseId,
        expectedRevision: data.mouse.revision,
        status,
        occurredOn,
        reason
      })
      setStatusOpen(false)
      showToast({
        title: '状态已更新',
        description: `当前状态：${MOUSE_STATUS_LABELS[status]}`,
        tone: 'positive'
      })
    })
  }

  const submitMove = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const cageId = formString(values, 'cageId')
    const reason = optional(formString(values, 'reason'))
    const operationId = crypto.randomUUID()
    void runAction('move', async () => {
      try {
        await appService.moveMouse({
          operationId,
          mouseId,
          cageId,
          reason
        })
      } catch (actionError) {
        if (actionError instanceof WarningRequiredError) {
          setMoveWarning({
            operationId,
            cageId,
            warnings: actionError.warnings
          })
          return
        }
        throw actionError
      }
      setMoveOpen(false)
      setMoveWarning(undefined)
      showToast({ title: '笼位分配已更新', tone: 'positive' })
    })
  }

  const confirmMove = () => {
    if (!moveWarning) return
    void runAction('move-confirm', async () => {
      await appService.moveMouse({
        operationId: moveWarning.operationId,
        mouseId,
        cageId: moveWarning.cageId,
        reason: '明确确认超容转笼',
        warningAcknowledgements: moveWarning.warnings
      })
      setMoveOpen(false)
      setMoveWarning(undefined)
      showToast({
        title: '已确认并完成转笼',
        description: '容量警告已记录在活动日志中。',
        tone: 'warning'
      })
    })
  }

  const leaveCage = () => {
    void runAction('leave', async () => {
      await appService.leaveCage({
        operationId: crypto.randomUUID(),
        mouseId,
        reason: '从小鼠详情页移出'
      })
      showToast({ title: '已移出当前笼位', tone: 'positive' })
    })
  }

  const submitEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const eventType = formString(values, 'eventType') as Exclude<
      MouseEventType,
      'weight'
    >
    void runAction('event', async () => {
      await appService.createMouseEvent({
        operationId: crypto.randomUUID(),
        mouseId,
        eventType,
        occurredOn: formString(values, 'occurredOn'),
        occurredTime: optional(formString(values, 'occurredTime')),
        title: formString(values, 'title'),
        description: optional(formString(values, 'description')),
        cageId: data?.mouse?.currentCageId
      })
      setEventOpen(false)
      showToast({ title: '事件已记录', tone: 'positive' })
    })
  }

  const submitWeight = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const value = Number(values.get('value'))
    const unit = formString(values, 'unit') as WeightUnit
    const measuredOn = formString(values, 'measuredOn')
    const notes = optional(formString(values, 'notes'))
    const operationId = crypto.randomUUID()
    void runAction('weight', async () => {
      try {
        await appService.recordWeight({
          operationId,
          mouseId,
          measuredOn,
          value,
          unit,
          notes
        })
      } catch (actionError) {
        if (actionError instanceof WarningRequiredError) {
          setWeightWarning({
            operationId,
            value,
            unit,
            measuredOn,
            notes,
            warnings: actionError.warnings
          })
          return
        }
        throw actionError
      }
      setWeightOpen(false)
      setWeightWarning(undefined)
      showToast({ title: '体重已记录', tone: 'positive' })
    })
  }

  const confirmWeight = () => {
    if (!weightWarning) return
    void runAction('weight-confirm', async () => {
      await appService.recordWeight({
        operationId: weightWarning.operationId,
        mouseId,
        measuredOn: weightWarning.measuredOn,
        value: weightWarning.value,
        unit: weightWarning.unit,
        notes: weightWarning.notes,
        warningAcknowledgements: weightWarning.warnings
      })
      setWeightOpen(false)
      setWeightWarning(undefined)
      showToast({
        title: '异常体重已确认并保存',
        description: '确认信息已进入活动日志。',
        tone: 'warning'
      })
    })
  }

  const toggleTag = (tagId: string) => {
    if (!data?.mouse) return
    const tagIds = data.mouse.tagIds.includes(tagId)
      ? data.mouse.tagIds.filter((id) => id !== tagId)
      : [...data.mouse.tagIds, tagId]
    void runAction(`tag:${tagId}`, async () => {
      await appService.setMouseTags({
        operationId: crypto.randomUUID(),
        mouseId,
        expectedRevision: data.mouse.revision,
        tagIds
      })
    })
  }

  const createTag = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!data?.mouse) return
    const form = event.currentTarget
    const values = new FormData(form)
    const name = formString(values, 'tagName').trim()
    if (!name) return
    void runAction('new-tag', async () => {
      const result = await appService.createTag({
        operationId: crypto.randomUUID(),
        name
      })
      const latestMouse = await appDatabase.mice.get(mouseId)
      if (!latestMouse) throw new Error('小鼠档案已不存在')
      await appService.setMouseTags({
        operationId: crypto.randomUUID(),
        mouseId,
        expectedRevision: latestMouse.revision,
        tagIds: [...latestMouse.tagIds, result.value.id]
      })
      form.reset()
      showToast({ title: '标签已创建并添加', tone: 'positive' })
    })
  }

  const deleteMouse = () => {
    if (!data?.mouse) return
    void runAction('delete', async () => {
      await appService.softDeleteMouse({
        operationId: crypto.randomUUID(),
        mouseId,
        expectedRevision: data.mouse.revision,
        reason: '用户从详情页移入回收站'
      })
      showToast({
        title: '小鼠已移入回收站',
        description: '可在“数据与安全”中恢复。',
        tone: 'warning'
      })
      navigate('/mice')
    })
  }

  if (data === undefined) {
    return (
      <div className="feature-page">
        <p role="status">正在读取小鼠档案…</p>
      </div>
    )
  }

  if (!data.mouse || data.mouse.deletedFlag === 1) {
    return (
      <div className="feature-page">
        <Alert title="找不到当前小鼠档案" tone="critical">
          记录不存在或已移入回收站。
        </Alert>
        <Link
          className={buttonClassName({ variant: 'secondary' })}
          href="/mice"
        >
          返回小鼠列表
        </Link>
      </div>
    )
  }

  const { mouse } = data

  return (
    <div className="feature-page">
      <header className="feature-page__header detail-header">
        <div>
          <p className="feature-page__eyebrow">群体管理 / 小鼠 / 档案</p>
          <div className="detail-title-row">
            <h2>{mouseDisplayLabel(mouse)}</h2>
            <MouseStatusChip status={mouse.status} />
          </div>
          <p>
            {[mouse.strain, mouse.genotype, MOUSE_SEX_LABELS[mouse.sex]]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="header-actions">
          <Link
            className={buttonClassName({ variant: 'tertiary' })}
            href="/mice"
          >
            <ArrowLeft aria-hidden="true" size={17} />
            返回列表
          </Link>
          <Link
            className={buttonClassName({ variant: 'secondary' })}
            href={`/mice/${encodeURIComponent(mouseId)}/edit`}
          >
            <FilePenLine aria-hidden="true" size={17} />
            编辑档案
          </Link>
        </div>
      </header>

      {error ? (
        <Alert title="操作没有完成" tone="critical">
          {error}
        </Alert>
      ) : null}
      {isTerminalMouseStatus(mouse.status) ? (
        <Alert title="终止状态档案" tone="informative">
          此小鼠已处于{MOUSE_STATUS_LABELS[mouse.status]}状态；历史记录仍可查看，
          但不应继续分配笼位或新增实验操作。
        </Alert>
      ) : null}

      <nav aria-label="档案快捷操作" className="detail-action-bar">
        <Button
          variant="secondary"
          leadingIcon={<CalendarClock aria-hidden="true" size={17} />}
          onClick={() => setStatusOpen(true)}
        >
          更改状态
        </Button>
        <Button
          variant="secondary"
          disabled={isTerminalMouseStatus(mouse.status)}
          leadingIcon={<Boxes aria-hidden="true" size={17} />}
          onClick={() => setMoveOpen(true)}
        >
          {mouse.currentCageId ? '转笼' : '分配笼位'}
        </Button>
        {mouse.currentCageId ? (
          <Button
            variant="tertiary"
            loading={busyAction === 'leave'}
            onClick={leaveCage}
          >
            移出当前笼位
          </Button>
        ) : null}
        <Button
          variant="secondary"
          disabled={isTerminalMouseStatus(mouse.status)}
          leadingIcon={<Scale aria-hidden="true" size={17} />}
          onClick={() => setWeightOpen(true)}
        >
          记录体重
        </Button>
        <Button
          variant="secondary"
          leadingIcon={<NotebookPen aria-hidden="true" size={17} />}
          onClick={() => setEventOpen(true)}
        >
          记录事件
        </Button>
      </nav>

      <div className="detail-layout">
        <div className="detail-main">
          <section className="detail-section" aria-labelledby="mouse-basic-title">
            <header className="detail-section__header">
              <div>
                <p>IDENTITY</p>
                <h3 id="mouse-basic-title">基本信息</h3>
              </div>
            </header>
            <dl className="detail-facts">
              <DetailItem label="耳标号">{mouse.earTag}</DetailItem>
              <DetailItem label="实验编号">
                {mouse.experimentNumber}
              </DetailItem>
              <DetailItem label="名称 / 别名">
                {[mouse.name, mouse.alias].filter(Boolean).join(' / ')}
              </DetailItem>
              <DetailItem label="品系">{mouse.strain}</DetailItem>
              <DetailItem label="基因型">{mouse.genotype}</DetailItem>
              <DetailItem label="性别">
                {MOUSE_SEX_LABELS[mouse.sex]}
              </DetailItem>
              <DetailItem label="出生日期">{mouse.birthDate}</DetailItem>
              <DetailItem label="当前周龄">
                {formatAgeWeeks(mouse.birthDate)}
              </DetailItem>
              <DetailItem label="来源">{mouse.source}</DetailItem>
              <DetailItem label="毛色">{mouse.coatColor}</DetailItem>
              <DetailItem label="创建时间">
                {formatInstant(mouse.createdAt)}
              </DetailItem>
              <DetailItem label="最后更新">
                {formatInstant(mouse.updatedAt)}
              </DetailItem>
            </dl>
            {mouse.notes ? <p className="detail-notes">{mouse.notes}</p> : null}
          </section>

          <section
            className="detail-section"
            aria-labelledby="mouse-weight-title"
          >
            <header className="detail-section__header">
              <div>
                <p>MEASUREMENTS</p>
                <h3 id="mouse-weight-title">体重趋势</h3>
              </div>
              <span className="section-total">
                {data.weights.length} 条记录
              </span>
            </header>
            {data.weights.length > 0 ? (
              <>
                <div className="weight-summary">
                  <strong>
                    {currentWeight?.value} {currentWeight?.unit}
                  </strong>
                  <span>
                    {weightChange === undefined
                      ? '暂无相邻变化'
                      : `较上次 ${weightChange >= 0 ? '+' : ''}${weightChange.toFixed(2)} g`}
                  </span>
                </div>
                <ol className="weight-spark-list">
                  {data.weights.slice(0, 12).map((weight) => (
                    <li key={weight.id}>
                      <time>{weight.measuredOn}</time>
                      <span className="weight-spark-list__track">
                        <span
                          style={{
                            width: `${Math.max(
                              4,
                              (weight.valueGrams / weightMax) * 100
                            )}%`
                          }}
                        />
                      </span>
                      <strong>
                        {weight.value} {weight.unit}
                      </strong>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <EmptyState
                compact
                icon={Scale}
                title="还没有体重记录"
                description="记录首次体重后，这里会显示相邻变化和最近趋势。"
              />
            )}
          </section>

          <section
            className="detail-section"
            aria-labelledby="mouse-timeline-title"
          >
            <header className="detail-section__header">
              <div>
                <p>TRACEABILITY</p>
                <h3 id="mouse-timeline-title">完整时间线</h3>
              </div>
              <Link className="section-link" href={`/records?mouse=${mouse.id}`}>
                在记录中心查看
              </Link>
            </header>
            {data.events.length > 0 ? (
              <ol className="timeline-list">
                {data.events.map((item) => (
                  <li key={item.id}>
                    <span className="timeline-list__rail" aria-hidden="true" />
                    <div>
                      <div className="timeline-list__title">
                        <strong>{item.title}</strong>
                        <StatusChip
                          label={EVENT_TYPE_LABELS[item.eventType]}
                          tone={
                            item.eventType === 'abnormality'
                              ? 'warning'
                              : 'neutral'
                          }
                        />
                      </div>
                      {item.description ? <p>{item.description}</p> : null}
                      <time>
                        {item.occurredOn}
                        {item.occurredTime ? ` ${item.occurredTime}` : ''}
                      </time>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                compact
                icon={History}
                title="还没有时间线事件"
                description="状态、转笼、实验、体重及一般事件都会保留在这里。"
              />
            )}
          </section>
        </div>

        <aside className="detail-sidebar" aria-label="关联信息">
          <section className="detail-section">
            <header className="detail-section__header">
              <div>
                <p>LOCATION</p>
                <h3>当前笼位</h3>
              </div>
            </header>
            {data.cage ? (
              <Link
                className="relation-card"
                href={`/cages/${encodeURIComponent(data.cage.id)}`}
              >
                <Boxes aria-hidden="true" size={19} />
                <span>
                  <strong>{data.cage.cageNumber}</strong>
                  <small>
                    {[data.cage.room, data.cage.rack]
                      .filter(Boolean)
                      .join(' · ') || '位置未记录'}
                  </small>
                </span>
              </Link>
            ) : (
              <p className="muted-copy">当前未分配笼位。</p>
            )}
          </section>

          <section className="detail-section">
            <header className="detail-section__header">
              <div>
                <p>LINEAGE</p>
                <h3>谱系</h3>
              </div>
            </header>
            <div className="relation-stack">
              <div className="relation-row">
                <span>父本</span>
                {data.sire ? (
                  <Link href={`/mice/${encodeURIComponent(data.sire.id)}`}>
                    {mouseDisplayLabel(data.sire)}
                  </Link>
                ) : (
                  <strong>未关联</strong>
                )}
              </div>
              <div className="relation-row">
                <span>母本</span>
                {data.dam ? (
                  <Link href={`/mice/${encodeURIComponent(data.dam.id)}`}>
                    {mouseDisplayLabel(data.dam)}
                  </Link>
                ) : (
                  <strong>未关联</strong>
                )}
              </div>
            </div>
            {data.offspring.length > 0 ? (
              <div className="compact-link-list">
                <p>直接后代 · {data.offspring.length}</p>
                {data.offspring.slice(0, 8).map((child) => (
                  <Link
                    href={`/mice/${encodeURIComponent(child.id)}`}
                    key={child.id}
                  >
                    <Dna aria-hidden="true" size={15} />
                    {mouseDisplayLabel(child)}
                  </Link>
                ))}
              </div>
            ) : null}
          </section>

          <section className="detail-section">
            <header className="detail-section__header">
              <div>
                <p>EXPERIMENTS</p>
                <h3>实验参与</h3>
              </div>
            </header>
            {data.assignments.length > 0 ? (
              <div className="compact-link-list">
                {data.assignments.map((assignment) => {
                  const experiment = data.experimentById.get(
                    assignment.experimentId
                  )
                  const group = data.groupById.get(assignment.groupId)
                  return (
                    <Link
                      href={`/experiments/${encodeURIComponent(
                        assignment.experimentId
                      )}`}
                      key={assignment.id}
                    >
                      <FlaskConical aria-hidden="true" size={15} />
                      <span>
                        <strong>
                          {experiment?.name ??
                            assignment.experimentNameSnapshot}
                        </strong>
                        <small>
                          {group?.name ?? assignment.groupNameSnapshot} ·{' '}
                          {assignment.activeFlag === 1
                            ? '参与中'
                            : `已退出 ${assignment.exitedAt?.slice(0, 10) ?? ''}`}
                          {experiment
                            ? ` · ${EXPERIMENT_STATUS_LABELS[experiment.status]}`
                            : ''}
                        </small>
                      </span>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <p className="muted-copy">暂无实验参与记录。</p>
            )}
          </section>

          <section className="detail-section">
            <header className="detail-section__header">
              <div>
                <p>LABELS</p>
                <h3>标签</h3>
              </div>
            </header>
            <div className="tag-picker">
              {data.allTags.map((tag) => (
                <label key={tag.id}>
                  <input
                    checked={mouse.tagIds.includes(tag.id)}
                    disabled={Boolean(busyAction)}
                    type="checkbox"
                    onChange={() => toggleTag(tag.id)}
                  />
                  <span>{tag.name}</span>
                </label>
              ))}
            </div>
            <form className="inline-create-form" onSubmit={createTag}>
              <Input
                aria-label="新标签名称"
                maxLength={120}
                name="tagName"
                placeholder="新标签名称"
              />
              <Button
                type="submit"
                size="small"
                variant="secondary"
                leadingIcon={<Plus aria-hidden="true" size={15} />}
                loading={busyAction === 'new-tag'}
              >
                添加
              </Button>
            </form>
          </section>

          <section className="danger-zone">
            <div>
              <h3>档案管理</h3>
              <p>软删除会结束当前笼位、实验和繁育关联，可在回收站恢复档案本身。</p>
            </div>
            <Button
              variant="danger"
              leadingIcon={<Trash2 aria-hidden="true" size={16} />}
              onClick={() => setDeleteOpen(true)}
            >
              移入回收站
            </Button>
          </section>
        </aside>
      </div>

      <Dialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        title="更改小鼠状态"
        description="终止状态会同时结束当前笼位、实验和活动繁育关系。"
        footer={null}
      >
        <form className="dialog-form" onSubmit={submitStatus}>
          <Field id="status-next" label="新状态" required>
            <Select
              name="status"
              defaultValue={mouse.status}
              options={MOUSE_STATUSES.map((value) => ({
                value,
                label: MOUSE_STATUS_LABELS[value],
                disabled: value === mouse.status
              }))}
            />
          </Field>
          <Field id="status-date" label="发生日期" required>
            <Input
              defaultValue={todayLocalDate()}
              max={todayLocalDate()}
              name="occurredOn"
              required
              type="date"
            />
          </Field>
          <Field id="status-reason" label="原因">
            <Textarea name="reason" rows={3} />
          </Field>
          <div className="form-actions">
            <Button
              variant="tertiary"
              type="button"
              onClick={() => setStatusOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              loading={busyAction === 'status'}
              leadingIcon={<Save aria-hidden="true" size={16} />}
            >
              保存状态
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={moveOpen}
        onOpenChange={(open) => {
          setMoveOpen(open)
          if (!open) setMoveWarning(undefined)
        }}
        title={mouse.currentCageId ? '转移笼位' : '分配笼位'}
        description="每次变更都会结束旧分配并写入可追溯事件。"
      >
        {moveWarning ? (
          <Alert
            title="目标笼位容量不足"
            tone="warning"
            action={
              <Button
                variant="secondary"
                loading={busyAction === 'move-confirm'}
                leadingIcon={<TriangleAlert aria-hidden="true" size={16} />}
                onClick={confirmMove}
              >
                明确确认并继续
              </Button>
            }
          >
            此次超容操作会被记录；如非必要，请先选择其他笼位。
          </Alert>
        ) : (
          <form className="dialog-form" onSubmit={submitMove}>
            <Field id="move-cage" label="目标笼位" required>
              <Select
                name="cageId"
                options={data.allCages
                  .filter((cage) => cage.id !== mouse.currentCageId)
                  .map((cage) => ({
                    value: cage.id,
                    label: [
                      cage.cageNumber,
                      cage.room,
                      `${cage.maxCapacity} 只上限`
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  }))}
              />
            </Field>
            <Field id="move-reason" label="变更原因">
              <Textarea name="reason" rows={3} />
            </Field>
            <div className="form-actions">
              <Button
                variant="tertiary"
                type="button"
                onClick={() => setMoveOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" loading={busyAction === 'move'}>
                保存笼位变更
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog
        open={eventOpen}
        onOpenChange={setEventOpen}
        title="记录事件"
        description="一般观察、给药、采样和操作等记录将加入完整时间线。"
      >
        <form className="dialog-form" onSubmit={submitEvent}>
          <Field id="event-type" label="事件类型" required>
            <Select
              name="eventType"
              defaultValue="observation"
              options={EVENT_OPTIONS.map((value) => ({
                value,
                label: EVENT_TYPE_LABELS[value]
              }))}
            />
          </Field>
          <div className="form-grid">
            <Field id="event-date" label="发生日期" required>
              <Input
                defaultValue={todayLocalDate()}
                name="occurredOn"
                required
                type="date"
              />
            </Field>
            <Field id="event-time" label="发生时间">
              <Input name="occurredTime" type="time" />
            </Field>
          </div>
          <Field id="event-title" label="标题" required>
            <Input maxLength={200} name="title" required />
          </Field>
          <Field id="event-description" label="描述">
            <Textarea maxLength={10_000} name="description" rows={5} />
          </Field>
          <div className="form-actions">
            <Button
              variant="tertiary"
              type="button"
              onClick={() => setEventOpen(false)}
            >
              取消
            </Button>
            <Button type="submit" loading={busyAction === 'event'}>
              保存事件
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={weightOpen}
        onOpenChange={(open) => {
          setWeightOpen(open)
          if (!open) setWeightWarning(undefined)
        }}
        title="记录体重"
        description="明显异常值会要求确认，但不会无理由阻止保存。"
      >
        {weightWarning ? (
          <Alert
            title="检测到明显异常值"
            tone="warning"
            action={
              <Button
                variant="secondary"
                loading={busyAction === 'weight-confirm'}
                onClick={confirmWeight}
              >
                确认数值并保存
              </Button>
            }
          >
            请重新核对单位和小数点；确认后原值会按输入保存。
          </Alert>
        ) : (
          <form className="dialog-form" onSubmit={submitWeight}>
            <div className="form-grid">
              <Field id="weight-value" label="体重" required>
                <Input
                  min="0.001"
                  name="value"
                  required
                  step="0.001"
                  type="number"
                />
              </Field>
              <Field id="weight-unit" label="单位" required>
                <Select
                  name="unit"
                  defaultValue="g"
                  options={WEIGHT_UNITS.map((value) => ({
                    value,
                    label: value
                  }))}
                />
              </Field>
              <Field id="weight-date" label="日期" required>
                <Input
                  defaultValue={todayLocalDate()}
                  name="measuredOn"
                  required
                  type="date"
                />
              </Field>
            </div>
            <Field id="weight-notes" label="备注">
              <Textarea name="notes" rows={3} />
            </Field>
            <div className="form-actions">
              <Button
                variant="tertiary"
                type="button"
                onClick={() => setWeightOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" loading={busyAction === 'weight'}>
                保存体重
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="将小鼠移入回收站？"
        description="此操作不会永久删除档案，但会结束当前活动关系。"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              loading={busyAction === 'delete'}
              leadingIcon={<Trash2 aria-hidden="true" size={16} />}
              onClick={deleteMouse}
            >
              确认移入回收站
            </Button>
          </>
        }
      >
        <Alert title="受影响的关联" tone="warning">
          当前笼位、进行中的实验分组和活动繁育组合会安全结束；历史事件不会被删除。
        </Alert>
      </Dialog>
    </div>
  )
}
