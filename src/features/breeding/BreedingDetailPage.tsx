import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft,
  Baby,
  CalendarCheck,
  Dna,
  Plus,
  Save,
  UserRound
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'wouter'
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
  BREEDING_PAIR_STATUSES,
  MOUSE_SEXES,
  mouseDisplayLabel,
  todayLocalDate,
  type BreedingPairStatus,
  type MouseSex
} from '../../domain'
import { useToast } from '../../hooks/useToast'
import { readableError } from '../../lib/errors'
import { formatInstant } from '../../lib/format'
import {
  BREEDING_STATUS_LABELS,
  MOUSE_SEX_LABELS
} from '../../lib/labels'
import type { OffspringInput } from '../../services'
import type { UpdateBreedingPairInput } from '../../services'

interface OffspringDraft {
  key: string
  earTag: string
  sex: MouseSex
  strain: string
  genotype: string
}

interface PairEditDraft {
  revision: number
  status: BreedingPairStatus
  separatedOn: string
  expectedDeliveryDate: string
  notes: string
}

function formString(data: FormData, key: string): string {
  const value = data.get(key)
  return typeof value === 'string' ? value : ''
}

function optional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

function newOffspring(): OffspringDraft {
  return {
    key: crypto.randomUUID(),
    earTag: '',
    sex: 'unknown',
    strain: '',
    genotype: ''
  }
}

export function BreedingDetailPage({
  breedingPairId
}: {
  breedingPairId: string
}) {
  const { showToast } = useToast()
  const [pairDraft, setPairDraft] = useState<PairEditDraft>()
  const [litterOpen, setLitterOpen] = useState(false)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [dialogError, setDialogError] = useState<string>()
  const [offspring, setOffspring] = useState<OffspringDraft[]>([])
  const data = useLiveQuery(async () => {
    const pair = await appDatabase.breedingPairs.get(breedingPairId)
    if (!pair) return { pair: undefined }
    const [sire, dam, litters] = await Promise.all([
      appDatabase.mice.get(pair.sireId),
      appDatabase.mice.get(pair.damId),
      appDatabase.litters
        .filter(
          (litter) =>
            litter.deletedFlag === 0 &&
            litter.breedingPairId === breedingPairId
        )
        .toArray()
    ])
    const litterIds = new Set(litters.map((litter) => litter.id))
    const mice = await appDatabase.mice
      .filter(
        (mouse) =>
          mouse.deletedFlag === 0 &&
          Boolean(mouse.litterId && litterIds.has(mouse.litterId))
      )
      .toArray()
    return {
      pair,
      sire,
      dam,
      litters: litters.toSorted((left, right) =>
        right.bornOn.localeCompare(left.bornOn)
      ),
      offspring: mice
    }
  }, [breedingPairId])

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

  const submitStatus = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!data?.pair || !pairDraft) return
    setDialogError(undefined)
    if (data.pair.revision !== pairDraft.revision) {
      setDialogError('档案已在其他位置更新。请关闭弹窗，核对最新值后重试。')
      return
    }
    const patch: UpdateBreedingPairInput['patch'] = {}
    if (pairDraft.status !== data.pair.status) {
      patch.status = pairDraft.status
    }
    if ((optional(pairDraft.separatedOn) ?? '') !== (data.pair.separatedOn ?? '')) {
      patch.separatedOn = optional(pairDraft.separatedOn) ?? null
    }
    if (
      (optional(pairDraft.expectedDeliveryDate) ?? '') !==
      (data.pair.expectedDeliveryDate ?? '')
    ) {
      patch.expectedDeliveryDate =
        optional(pairDraft.expectedDeliveryDate) ?? null
    }
    if ((optional(pairDraft.notes) ?? '') !== (data.pair.notes ?? '')) {
      patch.notes = optional(pairDraft.notes) ?? null
    }
    if (Object.keys(patch).length === 0) {
      setDialogError('没有需要保存的更改。')
      return
    }
    void run('status', async () => {
      try {
        await appService.updateBreedingPair({
          operationId: crypto.randomUUID(),
          breedingPairId,
          expectedRevision: pairDraft.revision,
          patch
        })
      } catch (actionError) {
        setDialogError(readableError(actionError))
        return
      }
      setPairDraft(undefined)
      showToast({
        title: '繁育组合已更新',
        description: BREEDING_STATUS_LABELS[pairDraft.status],
        tone: 'positive'
      })
    })
  }

  const updateOffspring = (
    key: string,
    patch: Partial<Omit<OffspringDraft, 'key'>>
  ) => {
    setOffspring((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item))
    )
  }

  const submitLitter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const litterNumber = formString(values, 'litterNumber').trim()
    const bornOn = formString(values, 'bornOn')
    const bornCount = Number(formString(values, 'bornCount'))
    const aliveCount = Number(formString(values, 'aliveCount'))
    const weanedOn = optional(formString(values, 'weanedOn'))
    const notes = optional(formString(values, 'notes'))
    const children: OffspringInput[] = offspring.map((child) => ({
      earTag: optional(child.earTag),
      sex: child.sex,
      strain: optional(child.strain),
      genotype: optional(child.genotype)
    }))
    setDialogError(undefined)
    if (offspring.some((child) => !child.earTag.trim())) {
      setDialogError('批量创建的每只后代都需要耳标号；也可以删除空白后代行。')
      return
    }
    if (bornOn < (data?.pair?.pairedOn ?? '')) {
      setDialogError('出生日期不能早于此组合的合笼日期。')
      return
    }
    if (
      !Number.isInteger(bornCount) ||
      !Number.isInteger(aliveCount) ||
      bornCount < 0 ||
      aliveCount < 0 ||
      aliveCount > bornCount ||
      children.length > aliveCount
    ) {
      setDialogError('数量必须为非负整数，并满足：建档后代 ≤ 存活数量 ≤ 出生数量。')
      return
    }
    void run('litter', async () => {
      try {
        await appService.createLitterWithOffspring({
          operationId: crypto.randomUUID(),
          breedingPairId,
          litterNumber,
          bornOn,
          bornCount,
          aliveCount,
          weanedOn,
          notes,
          offspring: children
        })
      } catch (actionError) {
        setDialogError(readableError(actionError))
        return
      }
      setLitterOpen(false)
      setOffspring([])
      showToast({
        title: '窝记录已创建',
        description:
          children.length > 0
            ? `同时创建 ${children.length} 只后代档案`
            : '未创建后代档案',
        tone: 'positive'
      })
    })
  }

  if (data === undefined) {
    return (
      <div className="feature-page">
        <p role="status">正在读取繁育组合…</p>
      </div>
    )
  }
  if (!data.pair || data.pair.deletedFlag === 1) {
    return (
      <div className="feature-page">
        <Alert title="找不到繁育组合" tone="critical">
          记录不存在或已删除。
        </Alert>
        <Link
          className={buttonClassName({ variant: 'secondary' })}
          href="/breeding"
        >
          返回繁育列表
        </Link>
      </div>
    )
  }

  const { pair } = data
  const pairTitle = `${data.sire ? mouseDisplayLabel(data.sire) : '未知父本'} × ${
    data.dam ? mouseDisplayLabel(data.dam) : '未知母本'
  }`
  const canAddLitter = pair.status === 'active' || pair.status === 'planned'

  return (
    <div className="feature-page">
      <header className="feature-page__header detail-header">
        <div>
          <p className="feature-page__eyebrow">研究 / 繁育 / 详情</p>
          <div className="detail-title-row">
            <h2>{pairTitle}</h2>
            <StatusChip
              label={BREEDING_STATUS_LABELS[pair.status]}
              tone={pair.status === 'active' ? 'positive' : 'neutral'}
            />
          </div>
          <p>合笼于 {pair.pairedOn}</p>
        </div>
        <div className="header-actions">
          <Link
            className={buttonClassName({ variant: 'tertiary' })}
            href="/breeding"
          >
            <ArrowLeft aria-hidden="true" size={17} />
            返回列表
          </Link>
          <Button
            variant="secondary"
            leadingIcon={<CalendarCheck aria-hidden="true" size={17} />}
            onClick={() => {
              setDialogError(undefined)
              setPairDraft({
                revision: pair.revision,
                status: pair.status,
                separatedOn: pair.separatedOn ?? '',
                expectedDeliveryDate: pair.expectedDeliveryDate ?? '',
                notes: pair.notes ?? ''
              })
            }}
          >
            更新进度
          </Button>
          <Button
            disabled={!canAddLitter}
            leadingIcon={<Baby aria-hidden="true" size={17} />}
            onClick={() => setLitterOpen(true)}
          >
            新建窝记录
          </Button>
        </div>
      </header>

      {error ? (
        <Alert title="操作没有完成" tone="critical">
          {error}
        </Alert>
      ) : null}
      {pair.warningAcknowledgements &&
      pair.warningAcknowledgements.length > 0 ? (
        <Alert title="此组合曾确认业务警告" tone="warning">
          创建时检测到性别、状态或重复历史异常，确认记录已保留。
        </Alert>
      ) : null}

      <div className="detail-layout">
        <div className="detail-main">
          <section className="detail-section" aria-labelledby="litters-title">
            <header className="detail-section__header">
              <div>
                <p>LITTERS</p>
                <h3 id="litters-title">窝记录</h3>
              </div>
              <span className="section-total">{data.litters.length} 窝</span>
            </header>
            {data.litters.length > 0 ? (
              <ul className="record-grid record-grid--compact">
                {data.litters.map((litter) => (
                  <li className="litter-record" key={litter.id}>
                    <div>
                      <Baby aria-hidden="true" size={18} />
                      <strong>{litter.litterNumber}</strong>
                    </div>
                    <dl className="stacked-facts">
                      <div>
                        <dt>出生</dt>
                        <dd>{litter.bornOn}</dd>
                      </div>
                      <div>
                        <dt>出生 / 存活</dt>
                        <dd>
                          {litter.bornCount} / {litter.aliveCount}
                        </dd>
                      </div>
                      <div>
                        <dt>断奶</dt>
                        <dd>{litter.weanedOn ?? '未记录'}</dd>
                      </div>
                    </dl>
                    {litter.notes ? <p>{litter.notes}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={Baby}
                title="还没有窝记录"
                description="记录出生数量，并可在同一事务中批量建立后代档案。"
                action={
                  canAddLitter ? (
                    <Button
                      variant="secondary"
                      onClick={() => setLitterOpen(true)}
                    >
                      新建第一窝
                    </Button>
                  ) : undefined
                }
              />
            )}
          </section>

          <section className="detail-section" aria-labelledby="offspring-title">
            <header className="detail-section__header">
              <div>
                <p>LINEAGE</p>
                <h3 id="offspring-title">直接后代</h3>
              </div>
              <span className="section-total">{data.offspring.length} 只</span>
            </header>
            {data.offspring.length > 0 ? (
              <div className="relation-grid">
                {data.offspring.map((mouse) => (
                  <Link
                    className="relation-card"
                    href={`/mice/${encodeURIComponent(mouse.id)}`}
                    key={mouse.id}
                  >
                    <Dna aria-hidden="true" size={18} />
                    <span>
                      <strong>{mouseDisplayLabel(mouse)}</strong>
                      <small>
                        {MOUSE_SEX_LABELS[mouse.sex]} · {mouse.strain} ·{' '}
                        {mouse.birthDate ?? '出生日期未记录'}
                      </small>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted-copy">暂无已建档的直接后代。</p>
            )}
          </section>
        </div>

        <aside className="detail-sidebar">
          <section className="detail-section">
            <header className="detail-section__header">
              <div>
                <p>PARENTS</p>
                <h3>父母档案</h3>
              </div>
            </header>
            <div className="relation-stack">
              {data.sire ? (
                <Link
                  className="relation-card"
                  href={`/mice/${encodeURIComponent(data.sire.id)}`}
                >
                  <UserRound aria-hidden="true" size={18} />
                  <span>
                    <strong>父本 · {mouseDisplayLabel(data.sire)}</strong>
                    <small>
                      {MOUSE_SEX_LABELS[data.sire.sex]} · {data.sire.strain}
                    </small>
                  </span>
                </Link>
              ) : null}
              {data.dam ? (
                <Link
                  className="relation-card"
                  href={`/mice/${encodeURIComponent(data.dam.id)}`}
                >
                  <UserRound aria-hidden="true" size={18} />
                  <span>
                    <strong>母本 · {mouseDisplayLabel(data.dam)}</strong>
                    <small>
                      {MOUSE_SEX_LABELS[data.dam.sex]} · {data.dam.strain}
                    </small>
                  </span>
                </Link>
              ) : null}
            </div>
          </section>

          <section className="detail-section">
            <header className="detail-section__header">
              <div>
                <p>SCHEDULE</p>
                <h3>关键日期</h3>
              </div>
            </header>
            <dl className="stacked-facts">
              <div>
                <dt>合笼日期</dt>
                <dd>{pair.pairedOn}</dd>
              </div>
              <div>
                <dt>预计生产</dt>
                <dd>{pair.expectedDeliveryDate ?? '未记录'}</dd>
              </div>
              <div>
                <dt>分笼日期</dt>
                <dd>{pair.separatedOn ?? '未记录'}</dd>
              </div>
              <div>
                <dt>最后更新</dt>
                <dd>{formatInstant(pair.updatedAt)}</dd>
              </div>
            </dl>
            {pair.notes ? <p className="detail-notes">{pair.notes}</p> : null}
          </section>
        </aside>
      </div>

      <Dialog
        open={Boolean(pairDraft)}
        onOpenChange={(open) => {
          if (!open) {
            setPairDraft(undefined)
            setDialogError(undefined)
          }
        }}
        title="更新繁育进度"
        description="结束当前组合会释放活动组合唯一键，但保留全部历史。"
      >
        {dialogError ? (
          <Alert title="没有保存进度" tone="critical">
            {dialogError}
          </Alert>
        ) : null}
        <form className="dialog-form" onSubmit={submitStatus}>
          <Field id="pair-status" label="状态" required>
            <Select
              value={pairDraft?.status}
              options={BREEDING_PAIR_STATUSES.map((status) => {
                const allowed: Record<BreedingPairStatus, readonly BreedingPairStatus[]> = {
                  planned: ['planned', 'active', 'cancelled'],
                  active: ['active', 'separated', 'completed', 'cancelled'],
                  separated: ['separated', 'completed'],
                  completed: ['completed'],
                  cancelled: ['cancelled']
                }
                return {
                  value: status,
                  label: BREEDING_STATUS_LABELS[status],
                  disabled: !allowed[pair.status].includes(status)
                }
              })}
              onValueChange={(status) =>
                setPairDraft((current) =>
                  current
                    ? { ...current, status: status as BreedingPairStatus }
                    : current
                )
              }
            />
          </Field>
          <div className="form-grid">
            <Field id="pair-delivery" label="预计生产日期">
              <Input
                value={pairDraft?.expectedDeliveryDate ?? ''}
                min={pair.pairedOn}
                type="date"
                onChange={(event) =>
                  setPairDraft((current) =>
                    current
                      ? {
                          ...current,
                          expectedDeliveryDate: event.target.value
                        }
                      : current
                  )
                }
              />
            </Field>
            <Field id="pair-separated" label="分笼日期">
              <Input
                value={pairDraft?.separatedOn ?? ''}
                min={pair.pairedOn}
                type="date"
                required={pairDraft?.status === 'separated'}
                onChange={(event) =>
                  setPairDraft((current) =>
                    current
                      ? { ...current, separatedOn: event.target.value }
                      : current
                  )
                }
              />
            </Field>
          </div>
          <Field id="pair-notes" label="备注">
            <Textarea
              value={pairDraft?.notes ?? ''}
              rows={4}
              onChange={(event) =>
                setPairDraft((current) =>
                  current
                    ? { ...current, notes: event.target.value }
                    : current
                )
              }
            />
          </Field>
          <div className="form-actions">
            <Button
              type="button"
              variant="tertiary"
              onClick={() => setPairDraft(undefined)}
            >
              取消
            </Button>
            <Button
              type="submit"
              loading={busy === 'status'}
              leadingIcon={<Save aria-hidden="true" size={16} />}
            >
              保存进度
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={litterOpen}
        onOpenChange={(open) => {
          setLitterOpen(open)
          if (!open) setOffspring([])
        }}
        title="新建窝记录"
        description="窝记录与选择创建的后代会在一个事务中写入，任一失败则全部回滚。"
        size="large"
      >
        {dialogError ? (
          <Alert title="没有保存窝记录" tone="critical">
            {dialogError}
          </Alert>
        ) : null}
        <form className="dialog-form" onSubmit={submitLitter}>
          <div className="form-grid">
            <Field id="litter-number" label="窝号" required>
              <Input name="litterNumber" required maxLength={120} />
            </Field>
            <Field id="litter-born-on" label="出生日期" required>
              <Input
                name="bornOn"
                required
                type="date"
                defaultValue={todayLocalDate()}
                min={pair.pairedOn}
                max={todayLocalDate()}
              />
            </Field>
            <Field id="litter-born-count" label="出生数量" required>
              <Input name="bornCount" min={0} required type="number" />
            </Field>
            <Field id="litter-alive-count" label="存活数量" required>
              <Input name="aliveCount" min={0} required type="number" />
            </Field>
            <Field id="litter-weaned-on" label="断奶日期">
              <Input name="weanedOn" type="date" />
            </Field>
          </div>
          <Field id="litter-notes" label="窝记录备注">
            <Textarea name="notes" rows={3} />
          </Field>

          <section className="offspring-editor" aria-labelledby="offspring-editor-title">
            <header>
              <div>
                <h4 id="offspring-editor-title">批量创建后代档案</h4>
                <p>不需要现在建档时可保留为空；添加行后每只后代必须填写耳标。</p>
              </div>
              <Button
                type="button"
                size="small"
                variant="secondary"
                leadingIcon={<Plus aria-hidden="true" size={15} />}
                onClick={() =>
                  setOffspring((current) => [...current, newOffspring()])
                }
              >
                添加后代
              </Button>
            </header>
            {offspring.map((child, index) => (
              <div className="offspring-row" key={child.key}>
                <span>{index + 1}</span>
                <Input
                  aria-label={`后代 ${index + 1} 耳标`}
                  placeholder="耳标号"
                  value={child.earTag}
                  onChange={(event) =>
                    updateOffspring(child.key, { earTag: event.target.value })
                  }
                />
                <Select
                  ariaLabel={`后代 ${index + 1} 性别`}
                  value={child.sex}
                  options={MOUSE_SEXES.map((sex) => ({
                    value: sex,
                    label: MOUSE_SEX_LABELS[sex]
                  }))}
                  onValueChange={(sex) =>
                    updateOffspring(child.key, { sex: sex as MouseSex })
                  }
                />
                <Input
                  aria-label={`后代 ${index + 1} 品系`}
                  placeholder={data.sire?.strain ?? data.dam?.strain ?? '品系'}
                  value={child.strain}
                  onChange={(event) =>
                    updateOffspring(child.key, { strain: event.target.value })
                  }
                />
                <Input
                  aria-label={`后代 ${index + 1} 基因型`}
                  placeholder="基因型"
                  value={child.genotype}
                  onChange={(event) =>
                    updateOffspring(child.key, {
                      genotype: event.target.value
                    })
                  }
                />
                <Button
                  type="button"
                  size="small"
                  variant="tertiary"
                  onClick={() =>
                    setOffspring((current) =>
                      current.filter((item) => item.key !== child.key)
                    )
                  }
                >
                  删除
                </Button>
              </div>
            ))}
          </section>

          <div className="form-actions">
            <Button
              type="button"
              variant="tertiary"
              onClick={() => setLitterOpen(false)}
            >
              取消
            </Button>
            <Button type="submit" loading={busy === 'litter'}>
              保存窝记录
              {offspring.length > 0 ? `及 ${offspring.length} 只后代` : ''}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
