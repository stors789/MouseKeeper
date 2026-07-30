import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft,
  FilePenLine,
  FlaskConical,
  LogOut,
  Plus,
  Trash2,
  TriangleAlert,
  UsersRound
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
  EXPERIMENT_GROUP_TYPES,
  mouseDisplayLabel,
  todayLocalDate,
  type ExperimentGroupType
} from '../../domain'
import { useToast } from '../../hooks/useToast'
import { readableError } from '../../lib/errors'
import { formatInstant } from '../../lib/format'
import {
  EXPERIMENT_GROUP_TYPE_LABELS,
  EXPERIMENT_STATUS_LABELS,
  MOUSE_SEX_LABELS,
  MOUSE_STATUS_LABELS
} from '../../lib/labels'
import { WarningRequiredError } from '../../services'
import { MouseStatusChip } from '../mice/MouseStatusChip'

function formString(data: FormData, key: string): string {
  const value = data.get(key)
  return typeof value === 'string' ? value : ''
}

function optional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

interface AssignmentWarning {
  operationId: string
  mouseIds: readonly string[]
  groupId: string
  joinedOn: string
  warnings: readonly string[]
}

export function ExperimentDetailPage({
  experimentId
}: {
  experimentId: string
}) {
  const [, navigate] = useLocation()
  const { showToast } = useToast()
  const [groupOpen, setGroupOpen] = useState(false)
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [selectedMouseIds, setSelectedMouseIds] = useState<string[]>([])
  const [assignmentWarning, setAssignmentWarning] =
    useState<AssignmentWarning>()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()

  const data = useLiveQuery(async () => {
    const experiment = await appDatabase.experiments.get(experimentId)
    if (!experiment) return { experiment: undefined }
    const [groups, assignments, mice] = await Promise.all([
      appDatabase.experimentGroups
        .filter(
          (group) =>
            group.deletedFlag === 0 && group.experimentId === experimentId
        )
        .toArray(),
      appDatabase.experimentAssignments
        .filter(
          (assignment) =>
            assignment.deletedFlag === 0 &&
            assignment.experimentId === experimentId
        )
        .toArray(),
      appDatabase.mice
        .filter((mouse) => mouse.deletedFlag === 0)
        .toArray()
    ])
    return {
      experiment,
      groups: groups.toSorted((left, right) =>
        left.name.localeCompare(right.name, 'zh-CN')
      ),
      assignments: assignments.toSorted((left, right) =>
        right.joinedAt.localeCompare(left.joinedAt)
      ),
      mice: mice.toSorted((left, right) =>
        mouseDisplayLabel(left).localeCompare(mouseDisplayLabel(right), 'zh-CN', {
          numeric: true
        })
      ),
      mouseById: new Map(mice.map((mouse) => [mouse.id, mouse]))
    }
  }, [experimentId])

  const effectiveGroupId = selectedGroupId || data?.groups?.[0]?.id || ''

  const activeAssignments = useMemo(
    () =>
      data?.assignments?.filter((assignment) => assignment.activeFlag === 1) ??
      [],
    [data?.assignments]
  )
  const activeMouseIdsForSelectedGroup = useMemo(
    () =>
      new Set(
        activeAssignments
          .filter((assignment) => assignment.groupId === effectiveGroupId)
          .map((assignment) => assignment.mouseId)
      ),
    [activeAssignments, effectiveGroupId]
  )

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    setError(undefined)
    try {
      await action()
    } catch (actionError) {
      setError(readableError(actionError))
    } finally {
      setBusy(undefined)
    }
  }

  const submitGroup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    void run('group', async () => {
      const result = await appService.createExperimentGroup({
        operationId: crypto.randomUUID(),
        experimentId,
        name: formString(values, 'name'),
        groupType: formString(values, 'groupType') as ExperimentGroupType,
        exclusionSet: optional(formString(values, 'exclusionSet')),
        intervention: optional(formString(values, 'intervention')),
        dose: optional(formString(values, 'dose')),
        frequency: optional(formString(values, 'frequency')),
        notes: optional(formString(values, 'notes'))
      })
      setGroupOpen(false)
      setSelectedGroupId(result.value.id)
      form.reset()
      showToast({
        title: '实验组别已创建',
        description: result.value.name,
        tone: 'positive'
      })
    })
  }

  const assignBatch = async (
    operationId: string,
    mouseIds: readonly string[],
    groupId: string,
    joinedOn: string,
    warningAcknowledgements?: readonly string[]
  ) =>
    appService.assignMiceToExperiment({
      operationId,
      mouseIds,
      experimentId,
      groupId,
      joinedOn,
      warningAcknowledgements
    })

  const submitAssignments = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (selectedMouseIds.length === 0) {
      setError('请至少选择一只小鼠。')
      return
    }
    const values = new FormData(event.currentTarget)
    const groupId = formString(values, 'groupId')
    const joinedOn = formString(values, 'joinedOn')
    const operationId = crypto.randomUUID()
    void run('assign', async () => {
      try {
        await assignBatch(operationId, selectedMouseIds, groupId, joinedOn)
      } catch (actionError) {
        if (actionError instanceof WarningRequiredError) {
          setAssignmentWarning({
            operationId,
            mouseIds: selectedMouseIds,
            groupId,
            joinedOn,
            warnings: actionError.warnings
          })
          return
        }
        throw actionError
      }
      const count = selectedMouseIds.length
      setAssignmentOpen(false)
      setSelectedMouseIds([])
      showToast({
        title: '实验成员已加入',
        description: `本次原子写入 ${count} 只小鼠`,
        tone: 'positive'
      })
    })
  }

  const confirmAssignments = () => {
    if (!assignmentWarning) return
    void run('assign-confirm', async () => {
      await assignBatch(
        assignmentWarning.operationId,
        assignmentWarning.mouseIds,
        assignmentWarning.groupId,
        assignmentWarning.joinedOn,
        assignmentWarning.warnings
      )
      const count = assignmentWarning.mouseIds.length
      setAssignmentWarning(undefined)
      setAssignmentOpen(false)
      setSelectedMouseIds([])
      showToast({
        title: '已确认风险并加入实验',
        description: `${count} 只小鼠已写入，确认信息已记录。`,
        tone: 'warning'
      })
    })
  }

  const exitAssignment = (assignmentId: string) => {
    void run(`exit:${assignmentId}`, async () => {
      await appService.exitExperimentAssignment({
        operationId: crypto.randomUUID(),
        assignmentId,
        exitedOn: todayLocalDate(),
        reason: '从实验详情页移出'
      })
      showToast({ title: '小鼠已退出实验组', tone: 'positive' })
    })
  }

  const deleteExperiment = () => {
    if (!data?.experiment) return
    void run('delete', async () => {
      await appService.softDeleteExperiment({
        operationId: crypto.randomUUID(),
        experimentId,
        expectedRevision: data.experiment.revision
      })
      showToast({
        title: '实验已移入回收站',
        description: '历史分组和事件仍然保留。',
        tone: 'warning'
      })
      navigate('/experiments')
    })
  }

  if (data === undefined) {
    return (
      <div className="feature-page">
        <p role="status">正在读取实验…</p>
      </div>
    )
  }
  if (!data.experiment || data.experiment.deletedFlag === 1) {
    return (
      <div className="feature-page">
        <Alert title="找不到实验" tone="critical">
          记录不存在或已移入回收站。
        </Alert>
        <Link
          className={buttonClassName({ variant: 'secondary' })}
          href="/experiments"
        >
          返回实验列表
        </Link>
      </div>
    )
  }

  const { experiment } = data
  const canAssign =
    experiment.status === 'planned' || experiment.status === 'active'

  return (
    <div className="feature-page">
      <header className="feature-page__header detail-header">
        <div>
          <p className="feature-page__eyebrow">研究 / 实验 / 详情</p>
          <div className="detail-title-row">
            <h2>{experiment.name}</h2>
            <StatusChip
              label={EXPERIMENT_STATUS_LABELS[experiment.status]}
              tone={experiment.status === 'active' ? 'positive' : 'neutral'}
            />
          </div>
          <p>
            {[experiment.code, experiment.principalInvestigator]
              .filter(Boolean)
              .join(' · ') || '未设置代码与负责人'}
          </p>
        </div>
        <div className="header-actions">
          <Link
            className={buttonClassName({ variant: 'tertiary' })}
            href="/experiments"
          >
            <ArrowLeft aria-hidden="true" size={17} />
            返回列表
          </Link>
          <Link
            className={buttonClassName({ variant: 'secondary' })}
            href={`/experiments/${encodeURIComponent(experimentId)}/edit`}
          >
            <FilePenLine aria-hidden="true" size={17} />
            编辑实验
          </Link>
          <Button
            variant="secondary"
            leadingIcon={<Plus aria-hidden="true" size={17} />}
            onClick={() => setGroupOpen(true)}
          >
            新建组别
          </Button>
          <Button
            disabled={!canAssign || data.groups.length === 0}
            leadingIcon={<UsersRound aria-hidden="true" size={17} />}
            onClick={() => setAssignmentOpen(true)}
          >
            批量加入小鼠
          </Button>
        </div>
      </header>

      {error ? (
        <Alert title="操作没有完成" tone="critical">
          {error}
        </Alert>
      ) : null}
      {!canAssign ? (
        <Alert title="实验不再接收新成员" tone="informative">
          当前状态为{EXPERIMENT_STATUS_LABELS[experiment.status]}，历史成员仍完整保留。
        </Alert>
      ) : null}

      <section className="experiment-summary">
        <dl>
          <div>
            <dt>组别</dt>
            <dd>{data.groups.length}</dd>
          </div>
          <div>
            <dt>当前成员</dt>
            <dd>{new Set(activeAssignments.map((item) => item.mouseId)).size}</dd>
          </div>
          <div>
            <dt>累计分配</dt>
            <dd>{data.assignments.length}</dd>
          </div>
          <div>
            <dt>计划日期</dt>
            <dd>
              {experiment.startDate ?? '未定'} — {experiment.endDate ?? '未定'}
            </dd>
          </div>
        </dl>
      </section>

      <div className="detail-layout">
        <div className="detail-main">
          <section className="detail-section" aria-labelledby="groups-title">
            <header className="detail-section__header">
              <div>
                <p>COHORTS</p>
                <h3 id="groups-title">实验组别与成员</h3>
              </div>
            </header>
            {data.groups.length > 0 ? (
              <div className="experiment-group-list">
                {data.groups.map((group) => {
                  const assignments = activeAssignments.filter(
                    (assignment) => assignment.groupId === group.id
                  )
                  return (
                    <article className="experiment-group-card" key={group.id}>
                      <header>
                        <div>
                          <h4>{group.name}</h4>
                          <p>
                            {EXPERIMENT_GROUP_TYPE_LABELS[group.groupType]}
                            {group.exclusionSet
                              ? ` · 互斥集 ${group.exclusionSet}`
                              : ''}
                          </p>
                        </div>
                        <StatusChip
                          label={`${assignments.length} 只`}
                          tone="informative"
                        />
                      </header>
                      {assignments.length > 0 ? (
                        <ul className="member-list">
                          {assignments.map((assignment) => {
                            const mouse = data.mouseById.get(assignment.mouseId)
                            return (
                              <li key={assignment.id}>
                                <div>
                                  {mouse ? (
                                    <Link
                                      href={`/mice/${encodeURIComponent(
                                        mouse.id
                                      )}`}
                                    >
                                      {mouseDisplayLabel(mouse)}
                                    </Link>
                                  ) : (
                                    <strong>{assignment.mouseLabelSnapshot}</strong>
                                  )}
                                  {mouse ? (
                                    <span>
                                      {MOUSE_SEX_LABELS[mouse.sex]} ·{' '}
                                      {mouse.strain}
                                    </span>
                                  ) : null}
                                </div>
                                {mouse ? (
                                  <MouseStatusChip status={mouse.status} />
                                ) : null}
                                <Button
                                  size="small"
                                  variant="tertiary"
                                  loading={busy === `exit:${assignment.id}`}
                                  leadingIcon={
                                    <LogOut aria-hidden="true" size={15} />
                                  }
                                  onClick={() => exitAssignment(assignment.id)}
                                >
                                  退出
                                </Button>
                              </li>
                            )
                          })}
                        </ul>
                      ) : (
                        <p className="muted-copy">此组暂无当前成员。</p>
                      )}
                    </article>
                  )
                })}
              </div>
            ) : (
              <EmptyState
                compact
                icon={FlaskConical}
                title="还没有实验组别"
                description="至少创建一个组别后才能加入小鼠。"
                action={
                  <Button variant="secondary" onClick={() => setGroupOpen(true)}>
                    创建组别
                  </Button>
                }
              />
            )}
          </section>

          <section className="detail-section" aria-labelledby="assignment-history-title">
            <header className="detail-section__header">
              <div>
                <p>HISTORY</p>
                <h3 id="assignment-history-title">加入与退出历史</h3>
              </div>
              <span className="section-total">{data.assignments.length} 条</span>
            </header>
            <ol className="timeline-list">
              {data.assignments.map((assignment) => (
                <li key={assignment.id}>
                  <span className="timeline-list__rail" aria-hidden="true" />
                  <div>
                    <strong>{assignment.mouseLabelSnapshot}</strong>
                    <p>
                      {assignment.groupNameSnapshot} · 加入{' '}
                      {formatInstant(assignment.joinedAt)}
                    </p>
                    <small>
                      {assignment.activeFlag === 1
                        ? '当前参与中'
                        : `退出 ${assignment.exitedAt ? formatInstant(assignment.exitedAt) : ''}${assignment.exitReason ? ` · ${assignment.exitReason}` : ''}`}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="detail-sidebar">
          <section className="detail-section">
            <header className="detail-section__header">
              <div>
                <p>PROTOCOL</p>
                <h3>实验方案</h3>
              </div>
            </header>
            <dl className="stacked-facts">
              <div>
                <dt>干预</dt>
                <dd>{experiment.intervention ?? '未记录'}</dd>
              </div>
              <div>
                <dt>剂量</dt>
                <dd>{experiment.dose ?? '未记录'}</dd>
              </div>
              <div>
                <dt>频率</dt>
                <dd>{experiment.frequency ?? '未记录'}</dd>
              </div>
              <div>
                <dt>最后更新</dt>
                <dd>{formatInstant(experiment.updatedAt)}</dd>
              </div>
            </dl>
            {experiment.description ? (
              <p className="detail-notes">{experiment.description}</p>
            ) : null}
            {experiment.notes ? (
              <p className="detail-notes">{experiment.notes}</p>
            ) : null}
          </section>

          <section className="danger-zone">
            <div>
              <h3>实验管理</h3>
              <p>仍有当前成员时不能删除；请先退出全部成员。</p>
            </div>
            <Button
              variant="danger"
              disabled={activeAssignments.length > 0}
              leadingIcon={<Trash2 aria-hidden="true" size={16} />}
              onClick={() => setDeleteOpen(true)}
            >
              移入回收站
            </Button>
          </section>
        </aside>
      </div>

      <Dialog
        open={groupOpen}
        onOpenChange={setGroupOpen}
        title="新建实验组别"
        description="共享互斥集合的组别不能同时包含同一只小鼠。"
      >
        <form className="dialog-form" onSubmit={submitGroup}>
          <Field id="group-name" label="组别名称" required>
            <Input name="name" required maxLength={240} />
          </Field>
          <div className="form-grid">
            <Field id="group-type" label="组别类型" required>
              <Select
                name="groupType"
                defaultValue="custom"
                options={EXPERIMENT_GROUP_TYPES.map((type) => ({
                  value: type,
                  label: EXPERIMENT_GROUP_TYPE_LABELS[type]
                }))}
              />
            </Field>
            <Field id="group-exclusion" label="互斥集合">
              <Input name="exclusionSet" placeholder="例如 study-arm" />
            </Field>
            <Field id="group-intervention" label="组别干预">
              <Input name="intervention" />
            </Field>
            <Field id="group-dose" label="组别剂量">
              <Input name="dose" />
            </Field>
            <Field id="group-frequency" label="组别频率">
              <Input name="frequency" />
            </Field>
          </div>
          <Field id="group-notes" label="备注">
            <Textarea name="notes" rows={3} />
          </Field>
          <div className="form-actions">
            <Button
              variant="tertiary"
              type="button"
              onClick={() => setGroupOpen(false)}
            >
              取消
            </Button>
            <Button type="submit" loading={busy === 'group'}>
              保存组别
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={assignmentOpen}
        onOpenChange={(open) => {
          setAssignmentOpen(open)
          if (!open) {
            setSelectedMouseIds([])
            setAssignmentWarning(undefined)
          }
        }}
        title="批量加入实验组"
        description="整批操作原子写入；一只失败时不会留下部分成员。"
        size="large"
      >
        {assignmentWarning ? (
          <Alert
            title="选择中包含不可用状态小鼠"
            tone="warning"
            action={
              <Button
                variant="secondary"
                loading={busy === 'assign-confirm'}
                leadingIcon={<TriangleAlert aria-hidden="true" size={16} />}
                onClick={confirmAssignments}
              >
                确认风险并整批加入
              </Button>
            }
          >
            已死亡、已安乐死或已转出的小鼠需要明确确认；请重新核对选择。
          </Alert>
        ) : (
          <form className="dialog-form" onSubmit={submitAssignments}>
            <div className="form-grid">
              <Field id="assign-group" label="目标组别" required>
                <Select
                  name="groupId"
                  value={effectiveGroupId}
                  options={data.groups.map((group) => ({
                    value: group.id,
                    label: `${group.name} · ${EXPERIMENT_GROUP_TYPE_LABELS[group.groupType]}`
                  }))}
                  onValueChange={(value) => {
                    setSelectedGroupId(value)
                    setSelectedMouseIds([])
                  }}
                />
              </Field>
              <Field id="assign-joined-on" label="加入日期" required>
                <Input
                  name="joinedOn"
                  type="date"
                  required
                  defaultValue={todayLocalDate()}
                />
              </Field>
            </div>
            <fieldset className="selection-list">
              <legend>选择小鼠</legend>
              {data.mice.map((mouse) => {
                const alreadyAssigned =
                  activeMouseIdsForSelectedGroup.has(mouse.id)
                return (
                  <label key={mouse.id}>
                    <input
                      type="checkbox"
                      checked={selectedMouseIds.includes(mouse.id)}
                      disabled={alreadyAssigned}
                      onChange={(event) =>
                        setSelectedMouseIds((current) =>
                          event.target.checked
                            ? [...current, mouse.id]
                            : current.filter((id) => id !== mouse.id)
                        )
                      }
                    />
                    <span>
                      <strong>{mouseDisplayLabel(mouse)}</strong>
                      <small>
                        {MOUSE_SEX_LABELS[mouse.sex]} · {mouse.strain} ·{' '}
                        {alreadyAssigned
                          ? '已在此组'
                          : MOUSE_STATUS_LABELS[mouse.status]}
                      </small>
                    </span>
                    <MouseStatusChip status={mouse.status} />
                  </label>
                )
              })}
            </fieldset>
            <div className="form-actions">
              <Button
                type="button"
                variant="tertiary"
                onClick={() => setAssignmentOpen(false)}
              >
                取消
              </Button>
              <Button
                type="submit"
                loading={busy === 'assign'}
                disabled={selectedMouseIds.length === 0}
              >
                加入 {selectedMouseIds.length} 只小鼠
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="将实验移入回收站？"
        description="实验组、历史分配与事件不会被级联删除。"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              loading={busy === 'delete'}
              leadingIcon={<Trash2 aria-hidden="true" size={16} />}
              onClick={deleteExperiment}
            >
              确认移入回收站
            </Button>
          </>
        }
      >
        <Alert title="删除前检查" tone="warning">
          当前成员必须为 0；如需保留项目但停止操作，建议将状态改为“已结束”或“已归档”。
        </Alert>
      </Dialog>
    </div>
  )
}
