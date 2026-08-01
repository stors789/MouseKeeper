import { useLiveQuery } from 'dexie-react-hooks'
import {
  BookmarkPlus,
  FilterX,
  LayoutGrid,
  List,
  MoveRight,
  Plus,
  Search,
  SlidersHorizontal,
  Tags,
  Trash2
} from 'lucide-react'
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent
} from 'react'
import { Link } from 'wouter'
import { appDatabase, appService } from '../../app/runtime'
import { APPLICATION_EVENT_NAMES, readApplicationViewCommand, viewCommandFromEvent } from '../../application'
import { Alert } from '../../components/ui/Alert'
import {
  Button,
  buttonClassName
} from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Field } from '../../components/ui/Field'
import { Input } from '../../components/ui/Input'
import { Skeleton, SkeletonGroup } from '../../components/ui/Skeleton'
import {
  MOUSE_SEXES,
  MOUSE_STATUSES,
  mouseDisplayLabel,
  normalizeText,
  todayLocalDate,
  type Mouse,
  type MouseSex,
  type MouseStatus,
  type SavedView
} from '../../domain'
import { useToast } from '../../hooks/useToast'
import { readableError } from '../../lib/errors'
import { formatAgeWeeks, formatInstant } from '../../lib/format'
import {
  MOUSE_SEX_LABELS,
  MOUSE_STATUS_LABELS
} from '../../lib/labels'
import { WarningRequiredError } from '../../services'
import { MouseStatusChip } from './MouseStatusChip'

const PAGE_SIZE = 50
const VIEW_PREFERENCE_KEY = 'mousekeeper:mice-view-mode'

type ViewMode = 'table' | 'cards'
type MouseSort =
  | 'updated-desc'
  | 'updated-asc'
  | 'label-asc'
  | 'strain-asc'
  | 'age-youngest'
  | 'age-oldest'
type BatchAction = 'status' | 'move' | 'tag-add' | 'tag-remove'

const MOUSE_SORTS = new Set<string>([
  'updated-desc', 'updated-asc', 'label-asc', 'strain-asc',
  'age-youngest', 'age-oldest'
])

interface MouseListRecord {
  mouse: Mouse
  cageNumber?: string
  tagNames: string[]
  experimentIds: string[]
  experimentNames: string[]
}

interface MiceWorkspaceData {
  records: MouseListRecord[]
  cages: Array<{ id: string; cageNumber: string }>
  tags: Array<{ id: string; name: string }>
  experiments: Array<{ id: string; name: string }>
  savedViews: SavedView[]
}

interface PendingMove {
  operationId: string
  mouseIds: string[]
  cageId: string
  warnings: readonly string[]
}

function initialViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_PREFERENCE_KEY) === 'cards'
      ? 'cards'
      : 'table'
  } catch {
    return 'table'
  }
}

function matchesQuery(record: MouseListRecord, query: string): boolean {
  if (!query) return true
  const fields = [
    record.mouse.earTag,
    record.mouse.experimentNumber,
    record.mouse.name,
    record.mouse.alias,
    record.mouse.strain,
    record.mouse.genotype,
    record.mouse.notes,
    record.cageNumber,
    ...record.tagNames,
    ...record.experimentNames
  ]
  return fields.some(
    value => value && normalizeText(value).includes(query)
  )
}

function sortRecords(
  records: readonly MouseListRecord[],
  sort: MouseSort
): MouseListRecord[] {
  return records.toSorted((left, right) => {
    if (sort === 'updated-asc') {
      return left.mouse.updatedAt.localeCompare(right.mouse.updatedAt)
    }
    if (sort === 'label-asc') {
      return mouseDisplayLabel(left.mouse).localeCompare(
        mouseDisplayLabel(right.mouse),
        'zh-CN'
      )
    }
    if (sort === 'strain-asc') {
      return (
        left.mouse.strain.localeCompare(right.mouse.strain, 'zh-CN') ||
        mouseDisplayLabel(left.mouse).localeCompare(
          mouseDisplayLabel(right.mouse),
          'zh-CN'
        )
      )
    }
    if (sort === 'age-youngest') {
      return (right.mouse.birthDate ?? '').localeCompare(
        left.mouse.birthDate ?? ''
      )
    }
    if (sort === 'age-oldest') {
      return (left.mouse.birthDate ?? '9999-99-99').localeCompare(
        right.mouse.birthDate ?? '9999-99-99'
      )
    }
    return right.mouse.updatedAt.localeCompare(left.mouse.updatedAt)
  })
}

function MiceLoading() {
  return (
    <SkeletonGroup label="正在加载小鼠档案">
      <div className="record-table-skeleton">
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton height={44} key={index} />
        ))}
      </div>
    </SkeletonGroup>
  )
}

function jsonObject(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

function stringValue(
  value: unknown,
  allowed?: ReadonlySet<string>
): string | undefined {
  if (typeof value !== 'string') return undefined
  return !allowed || allowed.has(value) ? value : undefined
}

export function MicePage() {
  const { showToast } = useToast()
  const initialView = useMemo(() => readApplicationViewCommand('mice'), [])
  const data = useLiveQuery(async (): Promise<MiceWorkspaceData> => {
    const [
      mice,
      cages,
      tags,
      experiments,
      assignments,
      savedViews
    ] = await Promise.all([
      appDatabase.mice.toArray(),
      appDatabase.cages.toArray(),
      appDatabase.tags.toArray(),
      appDatabase.experiments.toArray(),
      appDatabase.experimentAssignments
        .filter(
          assignment =>
            assignment.deletedFlag === 0 &&
            assignment.activeFlag === 1
        )
        .toArray(),
      appDatabase.savedViews
        .filter(
          view => view.deletedFlag === 0 && view.scope === 'mice'
        )
        .toArray()
    ])
    const cageById = new Map(
      cages.map(cage => [cage.id, cage.cageNumber])
    )
    const tagById = new Map(tags.map(tag => [tag.id, tag.name]))
    const experimentById = new Map(
      experiments.map(experiment => [experiment.id, experiment.name])
    )
    const assignmentIdsByMouse = new Map<string, string[]>()
    for (const assignment of assignments) {
      const current = assignmentIdsByMouse.get(assignment.mouseId) ?? []
      current.push(assignment.experimentId)
      assignmentIdsByMouse.set(assignment.mouseId, current)
    }

    return {
      records: mice.map(mouse => {
        const experimentIds = assignmentIdsByMouse.get(mouse.id) ?? []
        return {
          mouse,
          cageNumber: mouse.currentCageId
            ? cageById.get(mouse.currentCageId)
            : undefined,
          tagNames: mouse.tagIds.flatMap(tagId => {
            const name = tagById.get(tagId)
            return name ? [name] : []
          }),
          experimentIds,
          experimentNames: experimentIds.flatMap(experimentId => {
            const name = experimentById.get(experimentId)
            return name ? [name] : []
          })
        }
      }),
      cages: cages
        .filter(cage => cage.deletedFlag === 0)
        .map(cage => ({ id: cage.id, cageNumber: cage.cageNumber }))
        .toSorted((left, right) =>
          left.cageNumber.localeCompare(right.cageNumber, 'zh-CN')
        ),
      tags: tags
        .filter(tag => tag.deletedFlag === 0)
        .map(tag => ({ id: tag.id, name: tag.name }))
        .toSorted((left, right) =>
          left.name.localeCompare(right.name, 'zh-CN')
        ),
      experiments: experiments
        .filter(experiment => experiment.deletedFlag === 0)
        .map(experiment => ({
          id: experiment.id,
          name: experiment.name
        }))
        .toSorted((left, right) =>
          left.name.localeCompare(right.name, 'zh-CN')
        ),
      savedViews: savedViews.toSorted((left, right) =>
        (right.lastUsedAt ?? right.updatedAt).localeCompare(
          left.lastUsedAt ?? left.updatedAt
        )
      )
    }
  }, [])

  const [query, setQuery] = useState(() => stringValue(initialView.query) ?? '')
  const deferredQuery = useDeferredValue(normalizeText(query))
  const [status, setStatus] = useState<MouseStatus | 'all'>(() => (stringValue(initialView.status, new Set(['all', ...MOUSE_STATUSES])) ?? 'all') as MouseStatus | 'all')
  const [sex, setSex] = useState<MouseSex | 'all'>(() => (stringValue(initialView.sex, new Set(['all', ...MOUSE_SEXES])) ?? 'all') as MouseSex | 'all')
  const [strain, setStrain] = useState(() => stringValue(initialView.strain) ?? 'all')
  const [genotype, setGenotype] = useState(() => stringValue(initialView.genotype) ?? 'all')
  const [cageId, setCageId] = useState(() => stringValue(initialView.cageId) ?? 'all')
  const [tagId, setTagId] = useState(() => stringValue(initialView.tagId) ?? 'all')
  const [experimentId, setExperimentId] = useState(() => stringValue(initialView.experimentId) ?? 'all')
  const [birthFrom, setBirthFrom] = useState(() => stringValue(initialView.birthFrom) ?? '')
  const [birthTo, setBirthTo] = useState(() => stringValue(initialView.birthTo) ?? '')
  const [includeDeleted, setIncludeDeleted] = useState(() => initialView.includeDeleted === true)
  const [sort, setSort] = useState<MouseSort>(() => (stringValue(initialView.sort, MOUSE_SORTS) ?? 'updated-desc') as MouseSort)
  const [viewMode, setViewMode] = useState<ViewMode>(() => initialView.viewMode === 'cards' || initialView.viewMode === 'table' ? initialView.viewMode : initialViewMode())
  const [page, setPage] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchAction, setBatchAction] = useState<BatchAction>()
  const [batchStatus, setBatchStatus] = useState<MouseStatus>('reserved')
  const [batchCageId, setBatchCageId] = useState('')
  const [batchTagId, setBatchTagId] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchError, setBatchError] = useState<string>()
  const [pendingMove, setPendingMove] = useState<PendingMove>()
  const [saveViewOpen, setSaveViewOpen] = useState(false)
  const [saveViewName, setSaveViewName] = useState('')
  const [saveViewBusy, setSaveViewBusy] = useState(false)
  const [saveViewError, setSaveViewError] = useState<string>()
  const [activeViewId, setActiveViewId] = useState('')

  useEffect(() => {
    const handleView = (event: Event) => {
      const state = viewCommandFromEvent(event, 'mice')
      if (!state) return
      const nextStatus = stringValue(state.status, new Set(['all', ...MOUSE_STATUSES]))
      const nextSex = stringValue(state.sex, new Set(['all', ...MOUSE_SEXES]))
      const nextSort = stringValue(state.sort, MOUSE_SORTS)
      if (typeof state.query === 'string') setQuery(state.query)
      if (nextStatus) setStatus(nextStatus as MouseStatus | 'all')
      if (nextSex) setSex(nextSex as MouseSex | 'all')
      if (typeof state.strain === 'string') setStrain(state.strain)
      if (typeof state.genotype === 'string') setGenotype(state.genotype)
      if (typeof state.cageId === 'string') setCageId(state.cageId)
      if (typeof state.tagId === 'string') setTagId(state.tagId)
      if (typeof state.experimentId === 'string') setExperimentId(state.experimentId)
      if (typeof state.birthFrom === 'string') setBirthFrom(state.birthFrom)
      if (typeof state.birthTo === 'string') setBirthTo(state.birthTo)
      if (typeof state.includeDeleted === 'boolean') setIncludeDeleted(state.includeDeleted)
      if (nextSort) setSort(nextSort as MouseSort)
      if (state.viewMode === 'table' || state.viewMode === 'cards') setViewMode(state.viewMode)
      setPage(0)
      setActiveViewId('')
    }
    globalThis.addEventListener(APPLICATION_EVENT_NAMES.view, handleView)
    return () => globalThis.removeEventListener(APPLICATION_EVENT_NAMES.view, handleView)
  }, [])

  const strainOptions = useMemo(
    () =>
      [...new Set(data?.records.map(record => record.mouse.strain) ?? [])]
        .toSorted((left, right) => left.localeCompare(right, 'zh-CN')),
    [data?.records]
  )
  const genotypeOptions = useMemo(
    () =>
      [
        ...new Set(
          data?.records.flatMap(record =>
            record.mouse.genotype ? [record.mouse.genotype] : []
          ) ?? []
        )
      ].toSorted((left, right) => left.localeCompare(right, 'zh-CN')),
    [data?.records]
  )

  const filtered = useMemo(() => {
    if (!data) return []
    return sortRecords(
      data.records.filter(record => {
        const mouse = record.mouse
        return (
          (includeDeleted || mouse.deletedFlag === 0) &&
          (status === 'all' || mouse.status === status) &&
          (sex === 'all' || mouse.sex === sex) &&
          (strain === 'all' || mouse.strain === strain) &&
          (genotype === 'all' || mouse.genotype === genotype) &&
          (cageId === 'all' || mouse.currentCageId === cageId) &&
          (tagId === 'all' || mouse.tagIds.includes(tagId)) &&
          (experimentId === 'all' ||
            record.experimentIds.includes(experimentId)) &&
          (!birthFrom ||
            Boolean(mouse.birthDate && mouse.birthDate >= birthFrom)) &&
          (!birthTo ||
            Boolean(mouse.birthDate && mouse.birthDate <= birthTo)) &&
          matchesQuery(record, deferredQuery)
        )
      }),
      sort
    )
  }, [
    birthFrom,
    birthTo,
    cageId,
    data,
    deferredQuery,
    experimentId,
    genotype,
    includeDeleted,
    sex,
    sort,
    status,
    strain,
    tagId
  ])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE
  )
  const selectedRecords = useMemo(
    () =>
      (data?.records ?? []).filter(
        record =>
          selectedIds.has(record.mouse.id) &&
          record.mouse.deletedFlag === 0
      ),
    [data?.records, selectedIds]
  )
  const allVisibleSelected =
    visible.length > 0 &&
    visible.every(record => selectedIds.has(record.mouse.id))
  const hasFilters =
    Boolean(query) ||
    status !== 'all' ||
    sex !== 'all' ||
    strain !== 'all' ||
    genotype !== 'all' ||
    cageId !== 'all' ||
    tagId !== 'all' ||
    experimentId !== 'all' ||
    Boolean(birthFrom) ||
    Boolean(birthTo) ||
    includeDeleted

  const clearFilters = () => {
    setQuery('')
    setStatus('all')
    setSex('all')
    setStrain('all')
    setGenotype('all')
    setCageId('all')
    setTagId('all')
    setExperimentId('all')
    setBirthFrom('')
    setBirthTo('')
    setIncludeDeleted(false)
    setSort('updated-desc')
    setActiveViewId('')
    setPage(0)
  }

  const setPreferredView = (mode: ViewMode) => {
    setViewMode(mode)
    try {
      localStorage.setItem(VIEW_PREFERENCE_KEY, mode)
    } catch {
      // The view still works when storage is unavailable.
    }
  }

  const toggleSelected = (mouseId: string, checked: boolean) => {
    setSelectedIds(current => {
      const next = new Set(current)
      if (checked) next.add(mouseId)
      else next.delete(mouseId)
      return next
    })
  }

  const toggleVisible = (checked: boolean) => {
    setSelectedIds(current => {
      const next = new Set(current)
      for (const record of visible) {
        if (record.mouse.deletedFlag === 1) continue
        if (checked) next.add(record.mouse.id)
        else next.delete(record.mouse.id)
      }
      return next
    })
  }

  const closeBatch = () => {
    setBatchAction(undefined)
    setBatchError(undefined)
    setPendingMove(undefined)
  }

  const finishBatch = (title: string, description: string) => {
    showToast({ title, description, tone: 'positive' })
    setSelectedIds(new Set())
    closeBatch()
  }

  const runBatch = async () => {
    if (!batchAction || selectedRecords.length === 0) return
    setBatchBusy(true)
    setBatchError(undefined)
    try {
      if (batchAction === 'status') {
        const targets = selectedRecords
          .filter(record => record.mouse.status !== batchStatus)
          .map(record => ({
            mouseId: record.mouse.id,
            expectedRevision: record.mouse.revision
          }))
        if (targets.length === 0) {
          throw new Error('所选小鼠已经是目标状态。')
        }
        await appService.changeMiceStatus({
          operationId: crypto.randomUUID(),
          targets,
          status: batchStatus,
          occurredOn: todayLocalDate(),
          reason: '小鼠列表批量状态更新'
        })
        finishBatch('批量状态已更新', `已更新 ${targets.length} 只小鼠。`)
        return
      }
      if (batchAction === 'move') {
        if (!batchCageId) throw new Error('请选择目标笼位。')
        const mouseIds = selectedRecords
          .filter(record => record.mouse.currentCageId !== batchCageId)
          .map(record => record.mouse.id)
        if (mouseIds.length === 0) {
          throw new Error('所选小鼠已经在目标笼位。')
        }
        const operationId = crypto.randomUUID()
        try {
          await appService.moveMice({
            operationId,
            mouseIds,
            cageId: batchCageId,
            reason: '小鼠列表批量转笼'
          })
        } catch (error) {
          if (error instanceof WarningRequiredError) {
            setPendingMove({
              operationId,
              mouseIds,
              cageId: batchCageId,
              warnings: error.warnings
            })
            return
          }
          throw error
        }
        finishBatch('批量转笼完成', `已转移 ${mouseIds.length} 只小鼠。`)
        return
      }
      if (!batchTagId) throw new Error('请选择标签。')
      const targets = selectedRecords.map(record => ({
        mouseId: record.mouse.id,
        expectedRevision: record.mouse.revision
      }))
      const result = await appService.setMiceTags({
        operationId: crypto.randomUUID(),
        targets,
        addTagIds: batchAction === 'tag-add' ? [batchTagId] : undefined,
        removeTagIds:
          batchAction === 'tag-remove' ? [batchTagId] : undefined
      })
      finishBatch(
        batchAction === 'tag-add' ? '标签已批量添加' : '标签已批量移除',
        `更新 ${result.value.updatedMouseIds.length} 只，跳过 ${result.value.skippedMouseIds.length} 只。`
      )
    } catch (error) {
      setBatchError(readableError(error))
    } finally {
      setBatchBusy(false)
    }
  }

  const confirmPendingMove = async () => {
    if (!pendingMove) return
    setBatchBusy(true)
    setBatchError(undefined)
    try {
      await appService.moveMice({
        operationId: pendingMove.operationId,
        mouseIds: pendingMove.mouseIds,
        cageId: pendingMove.cageId,
        reason: '小鼠列表批量转笼（已确认容量警告）',
        warningAcknowledgements: pendingMove.warnings
      })
      finishBatch(
        '已确认并完成批量转笼',
        `已转移 ${pendingMove.mouseIds.length} 只小鼠，警告已写入审计日志。`
      )
    } catch (error) {
      setBatchError(readableError(error))
    } finally {
      setBatchBusy(false)
    }
  }

  const currentFilters = () => ({
    query,
    status,
    sex,
    strain,
    genotype,
    cageId,
    tagId,
    experimentId,
    birthFrom,
    birthTo,
    includeDeleted
  })

  const createSavedView = async () => {
    if (!saveViewName.trim()) {
      setSaveViewError('请填写视图名称。')
      return
    }
    setSaveViewBusy(true)
    setSaveViewError(undefined)
    try {
      const result = await appService.createSavedView({
        operationId: crypto.randomUUID(),
        scope: 'mice',
        name: saveViewName.trim(),
        filters: currentFilters(),
        sort: { value: sort },
        columns: { viewMode }
      })
      setActiveViewId(result.value.id)
      setSaveViewOpen(false)
      setSaveViewName('')
      showToast({
        title: '筛选视图已保存',
        description: result.value.name,
        tone: 'positive'
      })
    } catch (error) {
      setSaveViewError(readableError(error))
    } finally {
      setSaveViewBusy(false)
    }
  }

  const applySavedView = (event: ChangeEvent<HTMLSelectElement>) => {
    const viewId = event.target.value
    setActiveViewId(viewId)
    if (!viewId) return
    const view = data?.savedViews.find(item => item.id === viewId)
    if (!view) return
    const filters = jsonObject(view.filters)
    const savedSort = jsonObject(view.sort)
    const columns = jsonObject(view.columns)
    const statuses = new Set<string>(['all', ...MOUSE_STATUSES])
    const sexes = new Set<string>(['all', ...MOUSE_SEXES])
    const sorts = new Set<string>([
      'updated-desc',
      'updated-asc',
      'label-asc',
      'strain-asc',
      'age-youngest',
      'age-oldest'
    ])
    setQuery(stringValue(filters?.query) ?? '')
    setStatus(
      (stringValue(filters?.status, statuses) ?? 'all') as
        | MouseStatus
        | 'all'
    )
    setSex(
      (stringValue(filters?.sex, sexes) ?? 'all') as MouseSex | 'all'
    )
    setStrain(stringValue(filters?.strain) ?? 'all')
    setGenotype(stringValue(filters?.genotype) ?? 'all')
    setCageId(stringValue(filters?.cageId) ?? 'all')
    setTagId(stringValue(filters?.tagId) ?? 'all')
    setExperimentId(stringValue(filters?.experimentId) ?? 'all')
    setBirthFrom(stringValue(filters?.birthFrom) ?? '')
    setBirthTo(stringValue(filters?.birthTo) ?? '')
    setIncludeDeleted(filters?.includeDeleted === true)
    setSort(
      (stringValue(savedSort?.value, sorts) ??
        'updated-desc') as MouseSort
    )
    const savedMode = stringValue(
      columns?.viewMode,
      new Set(['table', 'cards'])
    ) as ViewMode | undefined
    if (savedMode) setPreferredView(savedMode)
    setPage(0)
    setSelectedIds(new Set())
  }

  const updateActiveView = async () => {
    const view = data?.savedViews.find(item => item.id === activeViewId)
    if (!view) return
    try {
      await appService.updateSavedView({
        operationId: crypto.randomUUID(),
        savedViewId: view.id,
        expectedRevision: view.revision,
        patch: {
          filters: currentFilters(),
          sort: { value: sort },
          columns: { viewMode }
        }
      })
      showToast({
        title: '保存视图已更新',
        description: view.name,
        tone: 'positive'
      })
    } catch (error) {
      showToast({
        title: '没有更新保存视图',
        description: readableError(error),
        tone: 'critical'
      })
    }
  }

  const deleteActiveView = async () => {
    const view = data?.savedViews.find(item => item.id === activeViewId)
    if (!view) return
    try {
      await appService.softDeleteSavedView({
        operationId: crypto.randomUUID(),
        savedViewId: view.id,
        expectedRevision: view.revision
      })
      setActiveViewId('')
      showToast({
        title: '保存视图已删除',
        description: view.name,
        tone: 'positive'
      })
    } catch (error) {
      showToast({
        title: '无法删除保存视图',
        description: readableError(error),
        tone: 'critical'
      })
    }
  }

  const cardList = (
    className: string,
    label: string
  ) => (
    <ul className={className} aria-label={label}>
      {visible.map(({ mouse, cageNumber, tagNames }) => (
        <li className="mobile-record-card" key={mouse.id}>
          <span
            className="mobile-record-card__rail"
            aria-hidden="true"
          />
          <div className="mobile-record-card__body">
            <div className="mobile-record-card__title">
              <label className="record-selection">
                <input
                  aria-label={`选择 ${mouseDisplayLabel(mouse)}`}
                  checked={selectedIds.has(mouse.id)}
                  disabled={mouse.deletedFlag === 1}
                  type="checkbox"
                  onChange={event =>
                    toggleSelected(mouse.id, event.target.checked)
                  }
                />
                <Link href={`/mice/${encodeURIComponent(mouse.id)}`}>
                  {mouseDisplayLabel(mouse)}
                </Link>
              </label>
              {mouse.deletedFlag === 1 ? (
                <span className="record-deleted-label">回收站</span>
              ) : (
                <MouseStatusChip status={mouse.status} />
              )}
            </div>
            <p>
              {mouse.earTag ? `耳标 ${mouse.earTag} · ` : ''}
              {MOUSE_SEX_LABELS[mouse.sex]} ·{' '}
              {formatAgeWeeks(mouse.birthDate)}
            </p>
            <p>
              {mouse.strain} · {mouse.genotype ?? '基因型未记录'}
            </p>
            <div className="mobile-record-card__meta">
              <span>笼位 {cageNumber ?? '未分配'}</span>
              {tagNames.length > 0 ? (
                <span>{tagNames.slice(0, 2).join(' · ')}</span>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="feature-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">群体管理 / 小鼠</p>
          <h2>小鼠档案</h2>
          <p>
            {data
              ? `${filtered.length.toLocaleString()} 条当前结果`
              : '正在读取本地数据库'}
          </p>
        </div>
        <div className="feature-page__actions">
          <Link
            className={buttonClassName({ variant: 'secondary' })}
            href="/mice/bulk-create"
          >
            批量建档
          </Link>
          <Link
            className={buttonClassName({ variant: 'primary' })}
            href="/mice/new"
          >
            <Plus aria-hidden="true" size={17} />
            新建小鼠
          </Link>
        </div>
      </header>

      <section aria-label="保存视图" className="saved-view-toolbar">
        <label>
          <span>保存视图</span>
          <select value={activeViewId} onChange={applySavedView}>
            <option value="">当前临时筛选</option>
            {data?.savedViews.map(view => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          leadingIcon={<BookmarkPlus aria-hidden="true" size={16} />}
          variant="secondary"
          onClick={() => setSaveViewOpen(true)}
        >
          另存视图
        </Button>
        {activeViewId ? (
          <>
            <Button variant="tertiary" onClick={() => void updateActiveView()}>
              更新当前视图
            </Button>
            <Button
              aria-label="删除当前保存视图"
              leadingIcon={<Trash2 aria-hidden="true" size={16} />}
              variant="tertiary"
              onClick={() => void deleteActiveView()}
            >
              删除
            </Button>
          </>
        ) : null}
        <div className="view-mode-switch" aria-label="列表显示方式">
          <button
            aria-label="表格视图"
            aria-pressed={viewMode === 'table'}
            type="button"
            onClick={() => setPreferredView('table')}
          >
            <List aria-hidden="true" size={17} />
          </button>
          <button
            aria-label="卡片视图"
            aria-pressed={viewMode === 'cards'}
            type="button"
            onClick={() => setPreferredView('cards')}
          >
            <LayoutGrid aria-hidden="true" size={17} />
          </button>
        </div>
      </section>

      <section aria-label="搜索和筛选" className="filter-toolbar">
        <label className="filter-search">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">搜索小鼠</span>
          <input
            value={query}
            placeholder="搜索耳标、编号、名称、笼位、品系、基因型、实验或标签"
            onChange={event => {
              setQuery(event.target.value)
              setPage(0)
            }}
          />
        </label>
        <label className="filter-select">
          <SlidersHorizontal aria-hidden="true" size={16} />
          <span className="sr-only">按状态筛选</span>
          <select
            value={status}
            onChange={event => {
              setStatus(event.target.value as MouseStatus | 'all')
              setPage(0)
            }}
          >
            <option value="all">全部状态</option>
            {MOUSE_STATUSES.map(value => (
              <option key={value} value={value}>
                {MOUSE_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-select">
          <span className="sr-only">按性别筛选</span>
          <select
            value={sex}
            onChange={event => {
              setSex(event.target.value as MouseSex | 'all')
              setPage(0)
            }}
          >
            <option value="all">全部性别</option>
            {MOUSE_SEXES.map(value => (
              <option key={value} value={value}>
                {MOUSE_SEX_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-select">
          <span className="sr-only">排序</span>
          <select
            value={sort}
            onChange={event => {
              setSort(event.target.value as MouseSort)
              setPage(0)
            }}
          >
            <option value="updated-desc">最近更新</option>
            <option value="updated-asc">最早更新</option>
            <option value="label-asc">编号升序</option>
            <option value="strain-asc">品系升序</option>
            <option value="age-youngest">周龄从小到大</option>
            <option value="age-oldest">周龄从大到小</option>
          </select>
        </label>
        {hasFilters ? (
          <button className="filter-clear" type="button" onClick={clearFilters}>
            <FilterX aria-hidden="true" size={16} />
            清除筛选
          </button>
        ) : null}
        <details className="advanced-filters">
          <summary>更多筛选</summary>
          <div className="advanced-filters__grid">
            <label>
              <span>品系</span>
              <select
                value={strain}
                onChange={event => {
                  setStrain(event.target.value)
                  setPage(0)
                }}
              >
                <option value="all">全部品系</option>
                {strainOptions.map(value => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>基因型</span>
              <select
                value={genotype}
                onChange={event => {
                  setGenotype(event.target.value)
                  setPage(0)
                }}
              >
                <option value="all">全部基因型</option>
                {genotypeOptions.map(value => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>笼位</span>
              <select
                value={cageId}
                onChange={event => {
                  setCageId(event.target.value)
                  setPage(0)
                }}
              >
                <option value="all">全部笼位</option>
                {data?.cages.map(cage => (
                  <option key={cage.id} value={cage.id}>
                    {cage.cageNumber}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>标签</span>
              <select
                value={tagId}
                onChange={event => {
                  setTagId(event.target.value)
                  setPage(0)
                }}
              >
                <option value="all">全部标签</option>
                {data?.tags.map(tag => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>实验</span>
              <select
                value={experimentId}
                onChange={event => {
                  setExperimentId(event.target.value)
                  setPage(0)
                }}
              >
                <option value="all">全部实验</option>
                {data?.experiments.map(experiment => (
                  <option key={experiment.id} value={experiment.id}>
                    {experiment.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>出生日期从</span>
              <input
                type="date"
                value={birthFrom}
                onChange={event => {
                  setBirthFrom(event.target.value)
                  setPage(0)
                }}
              />
            </label>
            <label>
              <span>出生日期至</span>
              <input
                type="date"
                value={birthTo}
                onChange={event => {
                  setBirthTo(event.target.value)
                  setPage(0)
                }}
              />
            </label>
            <label className="advanced-filters__check">
              <input
                checked={includeDeleted}
                type="checkbox"
                onChange={event => {
                  setIncludeDeleted(event.target.checked)
                  setPage(0)
                }}
              />
              <span>包含回收站记录</span>
            </label>
          </div>
        </details>
      </section>

      {selectedRecords.length > 0 ? (
        <section aria-label="批量操作" className="batch-action-bar">
          <strong>已选择 {selectedRecords.length} 只</strong>
          <Button variant="secondary" onClick={() => setBatchAction('status')}>
            批量状态
          </Button>
          <Button
            leadingIcon={<MoveRight aria-hidden="true" size={16} />}
            variant="secondary"
            onClick={() => setBatchAction('move')}
          >
            批量转笼
          </Button>
          <Button
            leadingIcon={<Tags aria-hidden="true" size={16} />}
            variant="secondary"
            onClick={() => setBatchAction('tag-add')}
          >
            添加标签
          </Button>
          <Button variant="secondary" onClick={() => setBatchAction('tag-remove')}>
            移除标签
          </Button>
          <Button variant="tertiary" onClick={() => setSelectedIds(new Set())}>
            取消选择
          </Button>
        </section>
      ) : null}

      {data === undefined ? (
        <MiceLoading />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title={hasFilters ? '没有符合条件的小鼠' : '还没有小鼠记录'}
          description={
            hasFilters
              ? '调整或清除筛选条件后再试。'
              : '创建第一只小鼠，或前往数据与安全页面导入规范化 CSV。'
          }
          action={
            hasFilters ? (
              <button
                className={buttonClassName({ variant: 'secondary' })}
                type="button"
                onClick={clearFilters}
              >
                清除筛选
              </button>
            ) : (
              <Link
                className={buttonClassName({ variant: 'primary' })}
                href="/mice/new"
              >
                创建第一只小鼠
              </Link>
            )
          }
        />
      ) : (
        <>
          {viewMode === 'table' ? (
            <>
              <div className="desktop-record-table">
                <table>
                  <caption className="sr-only">
                    小鼠列表，共 {filtered.length} 条
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="record-select-column">
                        <input
                          aria-label="选择当前页全部小鼠"
                          checked={allVisibleSelected}
                          type="checkbox"
                          onChange={event =>
                            toggleVisible(event.target.checked)
                          }
                        />
                      </th>
                      <th scope="col">耳标 / 编号</th>
                      <th scope="col">状态</th>
                      <th scope="col">性别</th>
                      <th scope="col">周龄</th>
                      <th scope="col">品系 / 基因型</th>
                      <th scope="col">笼位</th>
                      <th scope="col">更新</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(({ mouse, cageNumber, tagNames }) => (
                      <tr key={mouse.id}>
                        <td className="record-select-column">
                          <input
                            aria-label={`选择 ${mouseDisplayLabel(mouse)}`}
                            checked={selectedIds.has(mouse.id)}
                            disabled={mouse.deletedFlag === 1}
                            type="checkbox"
                            onChange={event =>
                              toggleSelected(mouse.id, event.target.checked)
                            }
                          />
                        </td>
                        <td>
                          <Link
                            className="record-primary-link"
                            href={`/mice/${encodeURIComponent(mouse.id)}`}
                          >
                            {mouseDisplayLabel(mouse)}
                          </Link>
                          <span>{mouse.experimentNumber ?? mouse.name ?? '—'}</span>
                        </td>
                        <td>
                          {mouse.deletedFlag === 1 ? (
                            <span className="record-deleted-label">回收站</span>
                          ) : (
                            <MouseStatusChip status={mouse.status} />
                          )}
                        </td>
                        <td>{MOUSE_SEX_LABELS[mouse.sex]}</td>
                        <td>{formatAgeWeeks(mouse.birthDate)}</td>
                        <td>
                          <strong>{mouse.strain}</strong>
                          <span>{mouse.genotype ?? '基因型未记录'}</span>
                          {tagNames.length > 0 ? (
                            <small>{tagNames.slice(0, 2).join(' · ')}</small>
                          ) : null}
                        </td>
                        <td>{cageNumber ?? '未分配'}</td>
                        <td>{formatInstant(mouse.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {cardList('mobile-record-list', '小鼠列表')}
            </>
          ) : (
            cardList(
              'mobile-record-list mobile-record-list--forced',
              '小鼠卡片列表'
            )
          )}

          <nav aria-label="小鼠列表分页" className="pagination">
            <span>
              {safePage * PAGE_SIZE + 1}–
              {Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} /{' '}
              {filtered.length}
            </span>
            <div>
              <button
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage(current => Math.max(0, current - 1))}
              >
                上一页
              </button>
              <span>
                第 {safePage + 1} / {pageCount} 页
              </span>
              <button
                type="button"
                disabled={safePage >= pageCount - 1}
                onClick={() =>
                  setPage(current => Math.min(pageCount - 1, current + 1))
                }
              >
                下一页
              </button>
            </div>
          </nav>
        </>
      )}

      <Dialog
        description={`将对当前选择的 ${selectedRecords.length} 只活动小鼠执行单一事务；任一记录失败会整体回滚。`}
        open={batchAction !== undefined}
        title={
          batchAction === 'status'
            ? '批量更新状态'
            : batchAction === 'move'
              ? '批量转笼'
              : batchAction === 'tag-add'
                ? '批量添加标签'
                : '批量移除标签'
        }
        onOpenChange={open => {
          if (!open) closeBatch()
        }}
        footer={
          <>
            <Button variant="secondary" onClick={closeBatch}>
              取消
            </Button>
            <Button
              loading={batchBusy}
              variant={pendingMove ? 'danger' : 'primary'}
              onClick={() =>
                void (pendingMove ? confirmPendingMove() : runBatch())
              }
            >
              {pendingMove ? '确认警告并继续' : '执行批量操作'}
            </Button>
          </>
        }
      >
        <div className="dialog-form-stack">
          {batchError ? (
            <Alert title="批量操作未执行" tone="critical">
              {batchError}
            </Alert>
          ) : null}
          {pendingMove ? (
            <Alert title="目标笼位将超过容量" tone="warning">
              继续会把 {pendingMove.mouseIds.length} 只小鼠转入目标笼位；确认会记录在审计日志中。
            </Alert>
          ) : null}
          {batchAction === 'status' ? (
            <label className="native-field">
              <span>目标状态</span>
              <select
                value={batchStatus}
                onChange={event =>
                  setBatchStatus(event.target.value as MouseStatus)
                }
              >
                {MOUSE_STATUSES.map(value => (
                  <option key={value} value={value}>
                    {MOUSE_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {batchAction === 'move' ? (
            <label className="native-field">
              <span>目标笼位</span>
              <select
                value={batchCageId}
                onChange={event => {
                  setBatchCageId(event.target.value)
                  setPendingMove(undefined)
                }}
              >
                <option value="">请选择</option>
                {data?.cages.map(cage => (
                  <option key={cage.id} value={cage.id}>
                    {cage.cageNumber}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {batchAction === 'tag-add' || batchAction === 'tag-remove' ? (
            <label className="native-field">
              <span>标签</span>
              <select
                value={batchTagId}
                onChange={event => setBatchTagId(event.target.value)}
              >
                <option value="">请选择</option>
                {data?.tags.map(tag => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        description="保存当前筛选、排序和显示方式；视图会随本地备份一起导出。"
        open={saveViewOpen}
        title="保存小鼠视图"
        onOpenChange={setSaveViewOpen}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSaveViewOpen(false)}>
              取消
            </Button>
            <Button loading={saveViewBusy} onClick={() => void createSavedView()}>
              保存视图
            </Button>
          </>
        }
      >
        <div className="dialog-form-stack">
          {saveViewError ? (
            <Alert title="无法保存视图" tone="critical">
              {saveViewError}
            </Alert>
          ) : null}
          <Field id="saved-view-name" label="视图名称" required>
            <Input
              autoFocus
              value={saveViewName}
              onChange={event => setSaveViewName(event.target.value)}
            />
          </Field>
        </div>
      </Dialog>
    </div>
  )
}
