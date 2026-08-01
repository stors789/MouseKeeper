import { useDeferredValue, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Boxes,
  Gauge,
  Plus,
  Search,
  TriangleAlert
} from 'lucide-react'
import { Link } from 'wouter'
import { buttonClassName } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton, SkeletonGroup } from '../../components/ui/Skeleton'
import { StatusChip } from '../../components/ui/StatusChip'
import { db } from '../../db'
import type { Cage, Mouse } from '../../domain'
import { normalizeText } from '../../domain/normalization'
import { CAGE_STATUS_LABELS, MOUSE_SEX_LABELS } from '../../lib/labels'

interface CageListRecord {
  cage: Cage
  mice: Mouse[]
}

const PAGE_SIZE = 48

function capacityTone(record: CageListRecord, warningThreshold: number) {
  if (record.cage.maxCapacity <= 0) return 'neutral' as const
  const ratio = record.mice.length / record.cage.maxCapacity
  if (ratio > 1) return 'critical' as const
  if (ratio >= warningThreshold) return 'warning' as const
  return 'positive' as const
}

export function CagesPage() {
  const records = useLiveQuery(async (): Promise<CageListRecord[]> => {
    const [cages, assignments, mice] = await Promise.all([
      db.cages.filter((cage) => cage.deletedFlag === 0).toArray(),
      db.cageAssignments
        .filter(
          (assignment) =>
            assignment.deletedFlag === 0 && assignment.activeFlag === 1
        )
        .toArray(),
      db.mice.filter((mouse) => mouse.deletedFlag === 0).toArray()
    ])
    const mouseById = new Map(mice.map((mouse) => [mouse.id, mouse]))
    const miceByCage = new Map<string, Mouse[]>()
    for (const assignment of assignments) {
      const mouse = mouseById.get(assignment.mouseId)
      if (!mouse) continue
      const current = miceByCage.get(assignment.cageId) ?? []
      current.push(mouse)
      miceByCage.set(assignment.cageId, current)
    }
    return cages
      .map((cage) => ({ cage, mice: miceByCage.get(cage.id) ?? [] }))
      .toSorted((left, right) =>
        left.cage.cageNumber.localeCompare(right.cage.cageNumber, 'zh-CN', {
          numeric: true
        })
      )
  }, [])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const capacityWarningPercent =
    useLiveQuery(
      async () =>
        (await db.appSettings.get('app-settings'))?.capacityWarningPercent ??
        0.8,
      []
    ) ?? 0.8
  const deferredQuery = useDeferredValue(normalizeText(query))

  const filtered = useMemo(() => {
    if (!records || !deferredQuery) return records ?? []
    return records.filter(({ cage }) =>
      [
        cage.cageNumber,
        cage.room,
        cage.rack,
        cage.purpose,
        cage.primaryStrain,
        cage.notes
      ].some((value) => value && normalizeText(value).includes(deferredQuery))
    )
  }, [deferredQuery, records])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE
  )

  return (
    <div className="feature-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">群体管理 / 笼位</p>
          <h2>笼位管理</h2>
          <p>
            {records
              ? `${filtered.length.toLocaleString()} 个当前笼位`
              : '正在读取笼位与容量'}
          </p>
        </div>
        <Link
          className={buttonClassName({ variant: 'primary' })}
          href="/cages/new"
        >
          <Plus aria-hidden="true" size={17} />
          新建笼位
        </Link>
      </header>

      <section aria-label="搜索笼位" className="filter-toolbar">
        <label className="filter-search">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">搜索笼位</span>
          <input
            value={query}
            placeholder="搜索编号、房间、架位、用途或品系"
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(0)
            }}
          />
        </label>
      </section>

      {records === undefined ? (
        <SkeletonGroup label="正在加载笼位">
          <div className="record-grid">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton height={154} key={index} />
            ))}
          </div>
        </SkeletonGroup>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={query ? '没有匹配的笼位' : '还没有笼位'}
          description={
            query
              ? '尝试缩短搜索词或清除搜索。'
              : '先建立笼位，之后可在建档或转笼流程中分配小鼠。'
          }
          action={
            query ? (
              <button
                className={buttonClassName({ variant: 'secondary' })}
                type="button"
                onClick={() => {
                  setQuery('')
                  setPage(0)
                }}
              >
                清除搜索
              </button>
            ) : (
              <Link
                className={buttonClassName({ variant: 'primary' })}
                href="/cages/new"
              >
                创建第一个笼位
              </Link>
            )
          }
        />
      ) : (
        <>
          <ul className="record-grid" aria-label="笼位列表">
            {visible.map((record) => {
              const { cage, mice } = record
              const males = mice.filter((mouse) => mouse.sex === 'male').length
              const females = mice.filter(
                (mouse) => mouse.sex === 'female'
              ).length
              const ratio =
                cage.maxCapacity > 0
                  ? Math.min((mice.length / cage.maxCapacity) * 100, 100)
                  : 0
              const tone = capacityTone(record, capacityWarningPercent)

              return (
                <li className="cage-record" key={cage.id}>
                  <div className="cage-record__title">
                    <div>
                      <Link href={`/cages/${encodeURIComponent(cage.id)}`}>
                        {cage.cageNumber}
                      </Link>
                      <p>
                        {[cage.room, cage.rack, cage.purpose]
                          .filter(Boolean)
                          .join(' · ') || '位置与用途未记录'}
                      </p>
                    </div>
                    <StatusChip
                      icon={tone === 'critical' ? TriangleAlert : Gauge}
                      label={`${mice.length} / ${cage.maxCapacity}`}
                      tone={tone}
                    />
                  </div>
                  <div
                    className="capacity-track"
                    data-tone={tone}
                    role="meter"
                    aria-label={`笼位 ${cage.cageNumber} 容量`}
                    aria-valuemin={0}
                    aria-valuemax={cage.maxCapacity}
                    aria-valuenow={Math.min(mice.length, cage.maxCapacity)}
                    aria-valuetext={`${mice.length} / ${cage.maxCapacity}${mice.length > cage.maxCapacity ? '，已超容' : ''}`}
                  >
                    <span style={{ width: `${ratio}%` }} />
                  </div>
                  <dl className="cage-record__facts">
                    <div>
                      <dt>状态</dt>
                      <dd>{CAGE_STATUS_LABELS[cage.status]}</dd>
                    </div>
                    <div>
                      <dt>性别组成</dt>
                      <dd>
                        {MOUSE_SEX_LABELS.male} {males} ·{' '}
                        {MOUSE_SEX_LABELS.female} {females}
                      </dd>
                    </div>
                    <div>
                      <dt>主要品系</dt>
                      <dd>{cage.primaryStrain ?? '未指定'}</dd>
                    </div>
                  </dl>
                </li>
              )
            })}
          </ul>
          <nav aria-label="笼位列表分页" className="pagination">
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
    </div>
  )
}
