import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft,
  FilePenLine,
  LogOut,
  MousePointer2,
  Plus,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'wouter'
import { appDatabase, appService } from '../../app/runtime'
import { Alert } from '../../components/ui/Alert'
import { Button, buttonClassName } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Field } from '../../components/ui/Field'
import { Select } from '../../components/ui/Select'
import { StatusChip } from '../../components/ui/StatusChip'
import { Textarea } from '../../components/ui/Textarea'
import { mouseDisplayLabel } from '../../domain'
import { useToast } from '../../hooks/useToast'
import { readableError } from '../../lib/errors'
import { formatAgeWeeks, formatInstant } from '../../lib/format'
import {
  CAGE_STATUS_LABELS,
  MOUSE_SEX_LABELS,
  MOUSE_STATUS_LABELS,
  isTerminalMouseStatus
} from '../../lib/labels'
import { WarningRequiredError } from '../../services'
import { MouseStatusChip } from '../mice/MouseStatusChip'

function formString(data: FormData, key: string): string {
  const value = data.get(key)
  return typeof value === 'string' ? value : ''
}

interface CapacityWarning {
  operationId: string
  mouseId: string
  warnings: readonly string[]
}

export function CageDetailPage({ cageId }: { cageId: string }) {
  const [, navigate] = useLocation()
  const { showToast } = useToast()
  const [assignOpen, setAssignOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [capacityWarning, setCapacityWarning] = useState<CapacityWarning>()
  const data = useLiveQuery(async () => {
    const cage = await appDatabase.cages.get(cageId)
    if (!cage) return { cage: undefined }
    const [activeAssignments, history, mice] = await Promise.all([
      appDatabase.cageAssignments
        .filter(
          (assignment) =>
            assignment.deletedFlag === 0 &&
            assignment.cageId === cageId &&
            assignment.activeFlag === 1
        )
        .toArray(),
      appDatabase.cageAssignments
        .filter(
          (assignment) =>
            assignment.deletedFlag === 0 && assignment.cageId === cageId
        )
        .toArray(),
      appDatabase.mice
        .filter((mouse) => mouse.deletedFlag === 0)
        .toArray()
    ])
    const mouseById = new Map(mice.map((mouse) => [mouse.id, mouse]))
    const occupants = activeAssignments.flatMap((assignment) => {
      const mouse = mouseById.get(assignment.mouseId)
      return mouse ? [{ mouse, assignment }] : []
    })
    return {
      cage,
      occupants,
      candidates: mice.filter(
        (mouse) =>
          !isTerminalMouseStatus(mouse.status) &&
          mouse.currentCageId !== cageId
      ),
      history: history.toSorted((left, right) =>
        right.startedAt.localeCompare(left.startedAt)
      ),
      mouseById
    }
  }, [cageId])

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

  const submitAssignment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const mouseId = formString(values, 'mouseId')
    const reason = formString(values, 'reason').trim() || undefined
    const operationId = crypto.randomUUID()
    void run('assign', async () => {
      try {
        await appService.moveMouse({
          operationId,
          mouseId,
          cageId,
          reason
        })
      } catch (actionError) {
        if (actionError instanceof WarningRequiredError) {
          setCapacityWarning({
            operationId,
            mouseId,
            warnings: actionError.warnings
          })
          return
        }
        throw actionError
      }
      setAssignOpen(false)
      showToast({ title: '小鼠已移入笼位', tone: 'positive' })
    })
  }

  const confirmCapacity = () => {
    if (!capacityWarning) return
    void run('assign-confirm', async () => {
      await appService.moveMouse({
        operationId: capacityWarning.operationId,
        mouseId: capacityWarning.mouseId,
        cageId,
        reason: '明确确认超容分配',
        warningAcknowledgements: capacityWarning.warnings
      })
      setCapacityWarning(undefined)
      setAssignOpen(false)
      showToast({
        title: '已确认超容并完成分配',
        tone: 'warning'
      })
    })
  }

  const removeMouse = (mouseId: string) => {
    void run(`remove:${mouseId}`, async () => {
      await appService.leaveCage({
        operationId: crypto.randomUUID(),
        mouseId,
        reason: `从笼位 ${data?.cage?.cageNumber ?? cageId} 移出`
      })
      showToast({ title: '小鼠已移出笼位', tone: 'positive' })
    })
  }

  const deleteCage = () => {
    if (!data?.cage) return
    void run('delete', async () => {
      await appService.softDeleteCage({
        operationId: crypto.randomUUID(),
        cageId,
        expectedRevision: data.cage.revision
      })
      showToast({
        title: '笼位已移入回收站',
        description: '可在“数据与安全”页面恢复。',
        tone: 'warning'
      })
      navigate('/cages')
    })
  }

  if (data === undefined) {
    return (
      <div className="feature-page">
        <p role="status">正在读取笼位…</p>
      </div>
    )
  }
  if (!data.cage || data.cage.deletedFlag === 1) {
    return (
      <div className="feature-page">
        <Alert title="找不到当前笼位" tone="critical">
          记录不存在或已移入回收站。
        </Alert>
        <Link className={buttonClassName({ variant: 'secondary' })} href="/cages">
          返回笼位列表
        </Link>
      </div>
    )
  }

  const { cage, occupants } = data
  const occupancyRatio =
    cage.maxCapacity > 0 ? occupants.length / cage.maxCapacity : 0
  const capacityTone =
    occupancyRatio > 1
      ? 'critical'
      : occupancyRatio >= 0.8
        ? 'warning'
        : 'positive'
  const birthDates = occupants
    .flatMap(({ mouse }) => (mouse.birthDate ? [mouse.birthDate] : []))
    .toSorted()
  const strains = [
    ...new Set(occupants.map(({ mouse }) => mouse.strain))
  ].sort()
  const genotypes = [
    ...new Set(
      occupants.flatMap(({ mouse }) =>
        mouse.genotype ? [mouse.genotype] : []
      )
    )
  ].sort()

  return (
    <div className="feature-page">
      <header className="feature-page__header detail-header">
        <div>
          <p className="feature-page__eyebrow">群体管理 / 笼位 / 详情</p>
          <div className="detail-title-row">
            <h2>{cage.cageNumber}</h2>
            <StatusChip
              label={CAGE_STATUS_LABELS[cage.status]}
              tone={cage.status === 'active' ? 'positive' : 'neutral'}
            />
          </div>
          <p>
            {[cage.room, cage.rack, cage.purpose]
              .filter(Boolean)
              .join(' · ') || '位置与用途未记录'}
          </p>
        </div>
        <div className="header-actions">
          <Link className={buttonClassName({ variant: 'tertiary' })} href="/cages">
            <ArrowLeft aria-hidden="true" size={17} />
            返回列表
          </Link>
          <Link
            className={buttonClassName({ variant: 'secondary' })}
            href={`/cages/${encodeURIComponent(cageId)}/edit`}
          >
            <FilePenLine aria-hidden="true" size={17} />
            编辑笼位
          </Link>
          <Button
            disabled={cage.status === 'inactive' || cage.status === 'retired'}
            leadingIcon={<Plus aria-hidden="true" size={17} />}
            onClick={() => setAssignOpen(true)}
          >
            移入小鼠
          </Button>
        </div>
      </header>

      {error ? (
        <Alert title="操作没有完成" tone="critical">
          {error}
        </Alert>
      ) : null}
      {occupancyRatio >= 0.8 ? (
        <Alert
          title={occupancyRatio > 1 ? '笼位已超出容量' : '笼位接近容量上限'}
          tone={occupancyRatio > 1 ? 'critical' : 'warning'}
        >
          当前 {occupants.length} / {cage.maxCapacity} 只；新增分配会要求明确确认。
        </Alert>
      ) : null}

      <section className="cage-capacity-panel" aria-labelledby="capacity-title">
        <div>
          <p>CAPACITY</p>
          <h3 id="capacity-title">当前容量</h3>
        </div>
        <strong>
          {occupants.length} <span>/ {cage.maxCapacity}</span>
        </strong>
        <div
          className="capacity-track"
          data-tone={capacityTone}
          role="meter"
          aria-label={`笼位 ${cage.cageNumber} 当前容量`}
          aria-valuemin={0}
          aria-valuemax={cage.maxCapacity}
          aria-valuenow={occupants.length}
        >
          <span style={{ width: `${Math.min(occupancyRatio * 100, 100)}%` }} />
        </div>
      </section>

      <div className="detail-layout">
        <div className="detail-main">
          <section className="detail-section" aria-labelledby="occupants-title">
            <header className="detail-section__header">
              <div>
                <p>OCCUPANTS</p>
                <h3 id="occupants-title">当前小鼠</h3>
              </div>
              <span className="section-total">{occupants.length} 只</span>
            </header>
            {occupants.length > 0 ? (
              <div className="desktop-record-table">
                <table>
                  <thead>
                    <tr>
                      <th>耳标 / 编号</th>
                      <th>状态</th>
                      <th>性别</th>
                      <th>周龄</th>
                      <th>品系 / 基因型</th>
                      <th>
                        <span className="sr-only">操作</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {occupants.map(({ mouse }) => (
                      <tr key={mouse.id}>
                        <td>
                          <Link
                            className="record-primary-link"
                            href={`/mice/${encodeURIComponent(mouse.id)}`}
                          >
                            {mouseDisplayLabel(mouse)}
                          </Link>
                        </td>
                        <td>
                          <MouseStatusChip status={mouse.status} />
                        </td>
                        <td>{MOUSE_SEX_LABELS[mouse.sex]}</td>
                        <td>{formatAgeWeeks(mouse.birthDate)}</td>
                        <td>
                          <strong>{mouse.strain}</strong>
                          <span>{mouse.genotype ?? '未记录'}</span>
                        </td>
                        <td>
                          <Button
                            size="small"
                            variant="tertiary"
                            loading={busy === `remove:${mouse.id}`}
                            leadingIcon={<LogOut aria-hidden="true" size={15} />}
                            onClick={() => removeMouse(mouse.id)}
                          >
                            移出
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                compact
                icon={MousePointer2}
                title="当前笼位为空"
                description="从可用小鼠中选择成员，或在小鼠详情页完成转笼。"
                action={
                  <Button variant="secondary" onClick={() => setAssignOpen(true)}>
                    移入小鼠
                  </Button>
                }
              />
            )}
          </section>

          <section className="detail-section" aria-labelledby="cage-history-title">
            <header className="detail-section__header">
              <div>
                <p>TRACEABILITY</p>
                <h3 id="cage-history-title">转笼历史</h3>
              </div>
              <span className="section-total">{data.history.length} 条</span>
            </header>
            {data.history.length > 0 ? (
              <ol className="timeline-list">
                {data.history.map((assignment) => (
                  <li key={assignment.id}>
                    <span className="timeline-list__rail" aria-hidden="true" />
                    <div>
                      <strong>
                        {data.mouseById.has(assignment.mouseId) ? (
                          <Link
                            href={`/mice/${encodeURIComponent(
                              assignment.mouseId
                            )}`}
                          >
                            {mouseDisplayLabel(
                              data.mouseById.get(assignment.mouseId)!
                            )}
                          </Link>
                        ) : (
                          assignment.mouseLabelSnapshot
                        )}
                      </strong>
                      <p>
                        移入 {formatInstant(assignment.startedAt)}
                        {assignment.endedAt
                          ? ` · 移出 ${formatInstant(assignment.endedAt)}`
                          : ' · 当前仍在笼'}
                      </p>
                      <small>
                        {assignment.endReason ??
                          assignment.startReason ??
                          '未记录原因'}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted-copy">暂无转笼历史。</p>
            )}
          </section>
        </div>

        <aside className="detail-sidebar">
          <section className="detail-section">
            <header className="detail-section__header">
              <div>
                <p>COMPOSITION</p>
                <h3>笼内概览</h3>
              </div>
            </header>
            <dl className="stacked-facts">
              <div>
                <dt>性别组成</dt>
                <dd>
                  {MOUSE_SEX_LABELS.male}{' '}
                  {occupants.filter(({ mouse }) => mouse.sex === 'male').length}
                  {' · '}
                  {MOUSE_SEX_LABELS.female}{' '}
                  {
                    occupants.filter(({ mouse }) => mouse.sex === 'female')
                      .length
                  }
                </dd>
              </div>
              <div>
                <dt>出生日期范围</dt>
                <dd>
                  {birthDates.length > 0
                    ? `${birthDates[0]} — ${birthDates.at(-1)}`
                    : '未记录'}
                </dd>
              </div>
              <div>
                <dt>品系</dt>
                <dd>{strains.join('、') || cage.primaryStrain || '未记录'}</dd>
              </div>
              <div>
                <dt>基因型</dt>
                <dd>{genotypes.join('、') || '未记录'}</dd>
              </div>
            </dl>
          </section>

          <section className="detail-section">
            <header className="detail-section__header">
              <div>
                <p>METADATA</p>
                <h3>笼位信息</h3>
              </div>
            </header>
            <dl className="stacked-facts">
              <div>
                <dt>主要品系</dt>
                <dd>{cage.primaryStrain ?? '未指定'}</dd>
              </div>
              <div>
                <dt>用途</dt>
                <dd>{cage.purpose ?? '未指定'}</dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>{formatInstant(cage.createdAt)}</dd>
              </div>
              <div>
                <dt>最后更新</dt>
                <dd>{formatInstant(cage.updatedAt)}</dd>
              </div>
            </dl>
            {cage.notes ? <p className="detail-notes">{cage.notes}</p> : null}
          </section>

          <section className="danger-zone">
            <div>
              <h3>笼位管理</h3>
              <p>有当前小鼠时不能删除；请先逐只转移或移出。</p>
            </div>
            <Button
              variant="danger"
              disabled={occupants.length > 0}
              leadingIcon={<Trash2 aria-hidden="true" size={16} />}
              onClick={() => setDeleteOpen(true)}
            >
              移入回收站
            </Button>
          </section>
        </aside>
      </div>

      <Dialog
        open={assignOpen}
        onOpenChange={(open) => {
          setAssignOpen(open)
          if (!open) setCapacityWarning(undefined)
        }}
        title="将小鼠移入此笼位"
        description="如小鼠已有笼位，保存会原子结束旧分配并建立新分配。"
      >
        {capacityWarning ? (
          <Alert
            title="超过笼位最大容量"
            tone="warning"
            action={
              <Button
                variant="secondary"
                loading={busy === 'assign-confirm'}
                leadingIcon={<TriangleAlert aria-hidden="true" size={16} />}
                onClick={confirmCapacity}
              >
                明确确认并继续
              </Button>
            }
          >
            请先核对目标笼位；确认后警告会记录到活动日志。
          </Alert>
        ) : data.candidates.length > 0 ? (
          <form className="dialog-form" onSubmit={submitAssignment}>
            <Field id="assign-mouse" label="小鼠" required>
              <Select
                name="mouseId"
                options={data.candidates.map((mouse) => ({
                  value: mouse.id,
                  label: [
                    mouseDisplayLabel(mouse),
                    MOUSE_STATUS_LABELS[mouse.status],
                    mouse.strain,
                    mouse.currentCageId ? '当前在其他笼位' : '未分笼'
                  ].join(' · ')
                }))}
              />
            </Field>
            <Field id="assign-reason" label="转笼原因">
              <Textarea name="reason" rows={3} />
            </Field>
            <div className="form-actions">
              <Button
                type="button"
                variant="tertiary"
                onClick={() => setAssignOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" loading={busy === 'assign'}>
                保存分配
              </Button>
            </div>
          </form>
        ) : (
          <EmptyState
            compact
            icon={MousePointer2}
            title="没有可分配的小鼠"
            description="终止状态和已在当前笼位的小鼠不会出现在候选列表。"
            action={
              <Link
                className={buttonClassName({ variant: 'secondary' })}
                href="/mice/new"
              >
                新建小鼠
              </Link>
            }
          />
        )}
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="将笼位移入回收站？"
        description="软删除后不能接收小鼠，但可从回收站恢复。"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              loading={busy === 'delete'}
              leadingIcon={<Trash2 aria-hidden="true" size={16} />}
              onClick={deleteCage}
            >
              确认移入回收站
            </Button>
          </>
        }
      >
        <Alert title="删除前检查" tone="warning">
          当前小鼠数量必须为 0；历史转笼记录不会被删除。
        </Alert>
      </Dialog>
    </div>
  )
}
