import { useDeferredValue, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { FilterX, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { Link } from 'wouter'
import { buttonClassName } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton, SkeletonGroup } from '../../components/ui/Skeleton'
import { db } from '../../db'
import {
  MOUSE_SEXES,
  MOUSE_STATUSES,
  type Mouse,
  type MouseSex,
  type MouseStatus
} from '../../domain'
import { mouseDisplayLabel, normalizeText } from '../../domain/normalization'
import { formatAgeWeeks, formatInstant } from '../../lib/format'
import {
  MOUSE_SEX_LABELS,
  MOUSE_STATUS_LABELS
} from '../../lib/labels'
import { MouseStatusChip } from './MouseStatusChip'

const PAGE_SIZE = 50

interface MouseListRecord {
  mouse: Mouse
  cageNumber?: string
  tagNames: string[]
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
    ...record.tagNames
  ]
  return fields.some((value) => value && normalizeText(value).includes(query))
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

export function MicePage() {
  const records = useLiveQuery(async (): Promise<MouseListRecord[]> => {
    const [mice, cages, tags] = await Promise.all([
      db.mice.filter((mouse) => mouse.deletedFlag === 0).toArray(),
      db.cages.toArray(),
      db.tags.toArray()
    ])
    const cageById = new Map(cages.map((cage) => [cage.id, cage.cageNumber]))
    const tagById = new Map(tags.map((tag) => [tag.id, tag.name]))

    return mice.map((mouse) => ({
      mouse,
      cageNumber: mouse.currentCageId
        ? cageById.get(mouse.currentCageId)
        : undefined,
      tagNames: mouse.tagIds.flatMap((tagId) => {
        const name = tagById.get(tagId)
        return name ? [name] : []
      })
    }))
  }, [])
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(normalizeText(query))
  const [status, setStatus] = useState<MouseStatus | 'all'>('all')
  const [sex, setSex] = useState<MouseSex | 'all'>('all')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    if (!records) return []
    return records
      .filter(
        (record) =>
          (status === 'all' || record.mouse.status === status) &&
          (sex === 'all' || record.mouse.sex === sex) &&
          matchesQuery(record, deferredQuery)
      )
      .toSorted((left, right) =>
        right.mouse.updatedAt.localeCompare(left.mouse.updatedAt)
      )
  }, [deferredQuery, records, sex, status])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE
  )
  const hasFilters = Boolean(query) || status !== 'all' || sex !== 'all'

  const clearFilters = () => {
    setQuery('')
    setStatus('all')
    setSex('all')
    setPage(0)
  }

  return (
    <div className="feature-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">群体管理 / 小鼠</p>
          <h2>小鼠档案</h2>
          <p>
            {records
              ? `${filtered.length.toLocaleString()} 条当前结果`
              : '正在读取本地数据库'}
          </p>
        </div>
        <Link
          className={buttonClassName({ variant: 'primary' })}
          href="/mice/new"
        >
          <Plus aria-hidden="true" size={17} />
          新建小鼠
        </Link>
      </header>

      <section aria-label="搜索和筛选" className="filter-toolbar">
        <label className="filter-search">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">搜索小鼠</span>
          <input
            value={query}
            placeholder="搜索耳标、编号、名称、笼位、品系、基因型、标签或备注"
            onChange={(event) => {
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
            onChange={(event) => {
              setStatus(event.target.value as MouseStatus | 'all')
              setPage(0)
            }}
          >
            <option value="all">全部状态</option>
            {MOUSE_STATUSES.map((value) => (
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
            onChange={(event) => {
              setSex(event.target.value as MouseSex | 'all')
              setPage(0)
            }}
          >
            <option value="all">全部性别</option>
            {MOUSE_SEXES.map((value) => (
              <option key={value} value={value}>
                {MOUSE_SEX_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        {hasFilters ? (
          <button className="filter-clear" type="button" onClick={clearFilters}>
            <FilterX aria-hidden="true" size={16} />
            清除筛选
          </button>
        ) : null}
      </section>

      {records === undefined ? (
        <MiceLoading />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title={hasFilters ? '没有符合条件的小鼠' : '还没有小鼠记录'}
          description={
            hasFilters
              ? `当前 ${[query && '搜索词', status !== 'all' && '状态', sex !== 'all' && '性别'].filter(Boolean).length} 个条件没有匹配结果。`
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
          <div className="desktop-record-table">
            <table>
              <caption className="sr-only">
                小鼠列表，共 {filtered.length} 条
              </caption>
              <thead>
                <tr>
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
                      <MouseStatusChip status={mouse.status} />
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

          <ul className="mobile-record-list" aria-label="小鼠列表">
            {visible.map(({ mouse, cageNumber, tagNames }) => (
              <li className="mobile-record-card" key={mouse.id}>
                <span className="mobile-record-card__rail" aria-hidden="true" />
                <div className="mobile-record-card__title">
                  <Link href={`/mice/${encodeURIComponent(mouse.id)}`}>
                    {mouseDisplayLabel(mouse)}
                  </Link>
                  <MouseStatusChip status={mouse.status} />
                </div>
                <p>
                  {mouse.earTag ? `耳标 ${mouse.earTag} · ` : ''}
                  {MOUSE_SEX_LABELS[mouse.sex]} · {formatAgeWeeks(mouse.birthDate)}
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
              </li>
            ))}
          </ul>

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
                onClick={() => setPage((current) => Math.max(0, current - 1))}
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
                  setPage((current) => Math.min(pageCount - 1, current + 1))
                }
              >
                下一页
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  )
}
