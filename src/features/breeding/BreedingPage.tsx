import { useLiveQuery } from 'dexie-react-hooks'
import { Baby, CalendarDays, Dna, Plus } from 'lucide-react'
import { Link } from 'wouter'
import { buttonClassName } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton, SkeletonGroup } from '../../components/ui/Skeleton'
import { StatusChip } from '../../components/ui/StatusChip'
import { db } from '../../db'
import { mouseDisplayLabel } from '../../domain/normalization'
import type { BreedingPair, Litter, Mouse } from '../../domain/types'
import { formatLocalDate } from '../../lib/format'
import { BREEDING_STATUS_LABELS } from '../../lib/labels'

interface BreedingRecord {
  pair: BreedingPair
  sire?: Mouse
  dam?: Mouse
  litters: Litter[]
}

function breedingTone(status: BreedingPair['status']) {
  if (status === 'active') return 'warning' as const
  if (status === 'completed') return 'positive' as const
  if (status === 'cancelled') return 'neutral' as const
  return 'informative' as const
}

export function BreedingPage() {
  const records = useLiveQuery(async (): Promise<BreedingRecord[]> => {
    const [pairs, mice, litters] = await Promise.all([
      db.breedingPairs
        .filter((pair) => pair.deletedFlag === 0)
        .toArray(),
      db.mice.toArray(),
      db.litters.filter((litter) => litter.deletedFlag === 0).toArray()
    ])
    const mouseById = new Map(mice.map((mouse) => [mouse.id, mouse]))
    const littersByPair = new Map<string, Litter[]>()
    for (const litter of litters) {
      const current = littersByPair.get(litter.breedingPairId) ?? []
      current.push(litter)
      littersByPair.set(litter.breedingPairId, current)
    }

    return pairs
      .map((pair) => ({
        pair,
        sire: mouseById.get(pair.sireId),
        dam: mouseById.get(pair.damId),
        litters: (littersByPair.get(pair.id) ?? []).toSorted((left, right) =>
          right.bornOn.localeCompare(left.bornOn)
        )
      }))
      .toSorted((left, right) =>
        right.pair.pairedOn.localeCompare(left.pair.pairedOn)
      )
  }, [])

  return (
    <div className="feature-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">研究 / 繁育</p>
          <h2>繁育与窝记录</h2>
          <p>{records ? `${records.length} 个繁育组合` : '正在读取繁育记录'}</p>
        </div>
        <Link
          className={buttonClassName({ variant: 'primary' })}
          href="/breeding/new"
        >
          <Plus aria-hidden="true" size={17} />
          新建繁育组合
        </Link>
      </header>

      {records === undefined ? (
        <SkeletonGroup label="正在加载繁育组合">
          <div className="record-grid">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton height={174} key={index} />
            ))}
          </div>
        </SkeletonGroup>
      ) : records.length === 0 ? (
        <EmptyState
          icon={Dna}
          title="还没有繁育组合"
          description="选择父本和母本，记录合笼日期；性别和状态异常会在保存前提示。"
          action={
            <Link
              className={buttonClassName({ variant: 'primary' })}
              href="/breeding/new"
            >
              创建繁育组合
            </Link>
          }
        />
      ) : (
        <ul className="record-grid" aria-label="繁育组合">
          {records.map(({ pair, sire, dam, litters }) => (
            <li className="breeding-record" key={pair.id}>
              <div className="breeding-record__header">
                <div>
                  <Link href={`/breeding/${encodeURIComponent(pair.id)}`}>
                    {sire ? mouseDisplayLabel(sire) : '父本记录缺失'} ×{' '}
                    {dam ? mouseDisplayLabel(dam) : '母本记录缺失'}
                  </Link>
                  <p>合笼 {formatLocalDate(pair.pairedOn)}</p>
                </div>
                <StatusChip
                  icon={Dna}
                  label={BREEDING_STATUS_LABELS[pair.status]}
                  tone={breedingTone(pair.status)}
                />
              </div>
              <dl className="record-fact-grid">
                <div>
                  <dt>父本</dt>
                  <dd>{sire ? mouseDisplayLabel(sire) : '关联记录缺失'}</dd>
                </div>
                <div>
                  <dt>母本</dt>
                  <dd>{dam ? mouseDisplayLabel(dam) : '关联记录缺失'}</dd>
                </div>
                <div>
                  <dt>预计生产</dt>
                  <dd>{formatLocalDate(pair.expectedDeliveryDate)}</dd>
                </div>
                <div>
                  <dt>窝记录</dt>
                  <dd>{litters.length} 窝</dd>
                </div>
              </dl>
              {litters[0] ? (
                <p className="record-footnote">
                  <Baby aria-hidden="true" size={15} />
                  最近窝 {litters[0].litterNumber} · {litters[0].aliveCount} 只存活
                </p>
              ) : (
                <p className="record-footnote">
                  <CalendarDays aria-hidden="true" size={15} />
                  尚无窝记录
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
