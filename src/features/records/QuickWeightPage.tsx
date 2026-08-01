import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft,
  CheckCircle2,
  Search,
  TriangleAlert
} from 'lucide-react'
import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import { Link } from 'wouter'
import { appDatabase, appService } from '../../app/runtime'
import { Alert } from '../../components/ui/Alert'
import { Button, buttonClassName } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import {
  WEIGHT_UNITS,
  mouseDisplayLabel,
  normalizeText,
  todayLocalDate,
  type WeightUnit
} from '../../domain'
import { useToast } from '../../hooks/useToast'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { readableError } from '../../lib/errors'
import { MOUSE_SEX_LABELS } from '../../lib/labels'
import {
  WarningRequiredError,
  type RecordWeightsInput
} from '../../services'

interface PendingWeightBatch {
  operationId: string
  entries: RecordWeightsInput['entries']
  warnings: readonly string[]
}

export function QuickWeightPage() {
  const { showToast } = useToast()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(normalizeText(query))
  const [cageId, setCageId] = useState('all')
  const [measuredOn, setMeasuredOn] = useState(todayLocalDate())
  const [unit, setUnit] = useState<WeightUnit>('g')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState<PendingWeightBatch>()
  const inputRefs = useRef(new Map<string, HTMLInputElement>())
  const data = useLiveQuery(async () => {
    const [mice, cages, weights] = await Promise.all([
      appDatabase.mice
        .filter(
          (mouse) =>
            mouse.deletedFlag === 0 &&
            !['dead', 'euthanized', 'transferred'].includes(mouse.status)
        )
        .toArray(),
      appDatabase.cages
        .filter((cage) => cage.deletedFlag === 0)
        .sortBy('cageNumber'),
      appDatabase.weightRecords
        .filter((weight) => weight.deletedFlag === 0)
        .toArray()
    ])
    const latestByMouse = new Map<
      string,
      (typeof weights)[number]
    >()
    for (const weight of weights) {
      const current = latestByMouse.get(weight.mouseId)
      if (!current || weight.measuredAt > current.measuredAt) {
        latestByMouse.set(weight.mouseId, weight)
      }
    }
    const cageById = new Map(cages.map((cage) => [cage.id, cage]))
    return {
      cages,
      cageById,
      latestByMouse,
      mice: mice.toSorted((left, right) => {
        const leftCage = left.currentCageId
          ? cageById.get(left.currentCageId)?.cageNumber
          : ''
        const rightCage = right.currentCageId
          ? cageById.get(right.currentCageId)?.cageNumber
          : ''
        return (
          leftCage?.localeCompare(rightCage ?? '', 'zh-CN', {
            numeric: true
          }) ||
          mouseDisplayLabel(left).localeCompare(
            mouseDisplayLabel(right),
            'zh-CN',
            { numeric: true }
          )
        )
      })
    }
  }, [])

  const visibleMice = useMemo(
    () =>
      data?.mice.filter((mouse) => {
        if (cageId !== 'all' && mouse.currentCageId !== cageId) return false
        if (!deferredQuery) return true
        return [
          mouse.earTag,
          mouse.experimentNumber,
          mouse.name,
          mouse.alias,
          mouse.strain,
          mouse.genotype
        ].some(
          (value) => value && normalizeText(value).includes(deferredQuery)
        )
      }) ?? [],
    [cageId, data?.mice, deferredQuery]
  )

  const validDraftCount = useMemo(
    () =>
      Object.values(drafts).filter((value) => {
        const number = Number(value)
        return value.trim() !== '' && Number.isFinite(number) && number > 0
      }).length,
    [drafts]
  )
  useUnsavedChanges(
    !busy && Object.values(drafts).some(value => value.trim() !== '')
  )

  const makeEntries = (): RecordWeightsInput['entries'] =>
    (data?.mice ?? []).flatMap((mouse) => {
      const raw = drafts[mouse.id]?.trim()
      if (!raw) return []
      const value = Number(raw)
      if (!Number.isFinite(value) || value <= 0) return []
      return [
        {
          mouseId: mouse.id,
          measuredOn,
          value,
          unit
        }
      ]
    })

  const saveBatch = async (
    operationId: string,
    entries: RecordWeightsInput['entries'],
    warningAcknowledgements?: readonly string[]
  ) => {
    await appService.recordWeights({
      operationId,
      entries,
      warningAcknowledgements
    })
  }

  const submit = async () => {
    const entries = makeEntries()
    if (entries.length === 0) {
      setError('请至少输入一个大于 0 的有效体重。')
      return
    }
    setBusy(true)
    setError(undefined)
    const operationId = crypto.randomUUID()
    try {
      await saveBatch(operationId, entries)
      const savedIds = new Set(entries.map((entry) => entry.mouseId))
      setDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([mouseId]) => !savedIds.has(mouseId))
        )
      )
      showToast({
        title: '批量体重已保存',
        description: `${entries.length} 条记录已原子写入`,
        tone: 'positive'
      })
    } catch (actionError) {
      if (actionError instanceof WarningRequiredError) {
        setPending({
          operationId,
          entries,
          warnings: actionError.warnings
        })
      } else {
        setError(readableError(actionError))
      }
    } finally {
      setBusy(false)
    }
  }

  const confirmAnomalies = async () => {
    if (!pending) return
    setBusy(true)
    setError(undefined)
    try {
      await saveBatch(
        pending.operationId,
        pending.entries,
        pending.warnings
      )
      const savedIds = new Set(pending.entries.map((entry) => entry.mouseId))
      setDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([mouseId]) => !savedIds.has(mouseId))
        )
      )
      showToast({
        title: '异常值已确认并保存',
        description: `${pending.entries.length} 条记录已写入`,
        tone: 'warning'
      })
      setPending(undefined)
    } catch (actionError) {
      setError(readableError(actionError))
    } finally {
      setBusy(false)
    }
  }

  const focusNext = (
    event: KeyboardEvent<HTMLInputElement>,
    currentId: string
  ) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const index = visibleMice.findIndex((mouse) => mouse.id === currentId)
    const next = visibleMice[index + 1]
    if (next) {
      inputRefs.current.get(next.id)?.focus()
      inputRefs.current.get(next.id)?.select()
    }
  }

  return (
    <div className="feature-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">研究 / 记录 / 快速称重</p>
          <h2>快速称重</h2>
          <p>Enter 移至下一只；整批校验通过后才会写入数据库。</p>
        </div>
        <Link
          className={buttonClassName({ variant: 'tertiary' })}
          href="/records"
        >
          <ArrowLeft aria-hidden="true" size={17} />
          返回记录中心
        </Link>
      </header>

      {error ? (
        <Alert title="没有保存体重" tone="critical">
          {error}
        </Alert>
      ) : null}
      {pending ? (
        <Alert
          title="整批中检测到明显异常值"
          tone="warning"
          action={
            <div className="alert-actions">
              <Button variant="tertiary" onClick={() => setPending(undefined)}>
                返回核对
              </Button>
              <Button
                variant="secondary"
                loading={busy}
                leadingIcon={<TriangleAlert aria-hidden="true" size={16} />}
                onClick={() => void confirmAnomalies()}
              >
                确认异常并保存整批
              </Button>
            </div>
          }
        >
          保存尚未发生。请核对单位和小数点；确认后所有行会一次写入。
        </Alert>
      ) : null}

      <section className="quick-weight-controls" aria-label="称重批次设置">
        <label className="filter-search">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">搜索小鼠</span>
          <input
            value={query}
            placeholder="搜索耳标、编号、名称、品系或基因型"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Select
          ariaLabel="按笼位筛选"
          value={cageId}
          options={[
            { value: 'all', label: '全部笼位' },
            ...(data?.cages ?? []).map((cage) => ({
              value: cage.id,
              label: cage.cageNumber
            }))
          ]}
          onValueChange={setCageId}
        />
        <Input
          aria-label="测量日期"
          type="date"
          max={todayLocalDate()}
          value={measuredOn}
          onChange={(event) => setMeasuredOn(event.target.value)}
        />
        <Select
          ariaLabel="体重单位"
          value={unit}
          options={WEIGHT_UNITS.map((value) => ({
            value,
            label: value
          }))}
          onValueChange={(value) => setUnit(value as WeightUnit)}
        />
      </section>

      {data === undefined ? (
        <p role="status">正在读取待称重小鼠…</p>
      ) : visibleMice.length === 0 ? (
        <EmptyState
          icon={Search}
          title="没有符合条件的可称重小鼠"
          description="终止状态小鼠不会进入快速称重队列。"
        />
      ) : (
        <section className="quick-weight-sheet" aria-labelledby="weight-sheet-title">
          <header>
            <div>
              <p>MEASUREMENT SHEET</p>
              <h3 id="weight-sheet-title">称重队列</h3>
            </div>
            <span>
              显示 {visibleMice.length} 只 · 待保存 {validDraftCount} 条
            </span>
          </header>
          <div className="quick-weight-table" role="table">
            <div className="quick-weight-row quick-weight-row--header" role="row">
              <span role="columnheader">小鼠</span>
              <span role="columnheader">笼位</span>
              <span role="columnheader">上次体重</span>
              <span role="columnheader">本次体重</span>
            </div>
            {visibleMice.map((mouse) => {
              const latest = data.latestByMouse.get(mouse.id)
              const cage = mouse.currentCageId
                ? data.cageById.get(mouse.currentCageId)
                : undefined
              return (
                <div className="quick-weight-row" role="row" key={mouse.id}>
                  <div role="cell">
                    <Link href={`/mice/${encodeURIComponent(mouse.id)}`}>
                      {mouseDisplayLabel(mouse)}
                    </Link>
                    <small>
                      {MOUSE_SEX_LABELS[mouse.sex]} · {mouse.strain}
                    </small>
                  </div>
                  <span data-label="笼位" role="cell">
                    {cage?.cageNumber ?? '未分笼'}
                  </span>
                  <span data-label="上次体重" role="cell">
                    {latest
                      ? `${latest.value} ${latest.unit} · ${latest.measuredOn}`
                      : '无记录'}
                  </span>
                  <label role="cell">
                    <span className="responsive-cell-label">
                      {mouseDisplayLabel(mouse)} 本次体重（{unit}）
                    </span>
                    <Input
                      ref={(element) => {
                        if (element) inputRefs.current.set(mouse.id, element)
                        else inputRefs.current.delete(mouse.id)
                      }}
                      disabled={Boolean(pending)}
                      inputMode="decimal"
                      min="0.001"
                      step="0.001"
                      type="number"
                      value={drafts[mouse.id] ?? ''}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [mouse.id]: event.target.value
                        }))
                      }
                      onKeyDown={(event) => focusNext(event, mouse.id)}
                    />
                    <span>{unit}</span>
                  </label>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <div className="sticky-save-bar">
        <div>
          <CheckCircle2 aria-hidden="true" size={18} />
          <span>
            {validDraftCount > 0
              ? `${validDraftCount} 条有效输入等待保存`
              : '输入体重后再保存'}
          </span>
        </div>
        <Button
          disabled={validDraftCount === 0 || Boolean(pending)}
          loading={busy}
          onClick={() => void submit()}
        >
          保存整批体重
        </Button>
      </div>
    </div>
  )
}
