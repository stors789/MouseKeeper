import type { MouseKeeperDatabase } from '../db/database'
import { mouseDisplayLabel, normalizeText } from '../domain/normalization'

export type SearchResultType = 'mouse' | 'cage' | 'experiment' | 'event'

export interface SearchResult {
  id: string
  type: SearchResultType
  label: string
  description: string
  href: string
}

function uniqueResults(results: readonly SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  return results.filter((result) => {
    const key = `${result.type}:${result.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function searchGlobalRecords(
  database: MouseKeeperDatabase,
  query: string,
  limitPerType = 8
): Promise<SearchResult[]> {
  const normalized = normalizeText(query)
  if (!normalized) return []

  const matchedTags = await database.tags
    .filter(
      (tag) =>
        tag.deletedFlag === 0 && tag.normalizedName.includes(normalized)
    )
    .limit(20)
    .toArray()
  const tagIds = matchedTags.map((tag) => tag.id)

  const matchedCages = await database.cages
    .filter(
      (cage) =>
        cage.deletedFlag === 0 &&
        [
          cage.normalizedCageNumber,
          cage.roomKey,
          cage.rackKey,
          cage.notes ? normalizeText(cage.notes) : undefined
        ].some((value) => value?.includes(normalized))
    )
    .limit(limitPerType)
    .toArray()
  const cageIds = matchedCages.map((cage) => cage.id)

  const [miceByTerms, miceByTags, miceByCage, experiments, events] =
    await Promise.all([
      database.mice
        .where('searchTerms')
        .startsWith(normalized)
        .distinct()
        .filter((mouse) => mouse.deletedFlag === 0)
        .limit(limitPerType)
        .toArray(),
      tagIds.length > 0
        ? database.mice
            .where('tagIds')
            .anyOf(tagIds)
            .distinct()
            .filter((mouse) => mouse.deletedFlag === 0)
            .limit(limitPerType)
            .toArray()
        : Promise.resolve([]),
      cageIds.length > 0
        ? database.mice
            .where('currentCageId')
            .anyOf(cageIds)
            .distinct()
            .filter((mouse) => mouse.deletedFlag === 0)
            .limit(limitPerType)
            .toArray()
        : Promise.resolve([]),
      database.experiments
        .where('searchTerms')
        .startsWith(normalized)
        .distinct()
        .filter((experiment) => experiment.deletedFlag === 0)
        .limit(limitPerType)
        .toArray(),
      database.mouseEvents
        .where('searchTerms')
        .startsWith(normalized)
        .distinct()
        .filter((event) => event.deletedFlag === 0)
        .limit(limitPerType)
        .toArray()
    ])

  const mice = uniqueResults(
    [...miceByTerms, ...miceByTags, ...miceByCage].map((mouse) => ({
      id: mouse.id,
      type: 'mouse' as const,
      label: mouseDisplayLabel(mouse),
      description: `${mouse.strain} · ${mouse.genotype ?? '基因型未记录'}`,
      href: `/mice/${encodeURIComponent(mouse.id)}`
    }))
  ).slice(0, limitPerType)

  return [
    ...mice,
    ...matchedCages.map((cage) => ({
      id: cage.id,
      type: 'cage' as const,
      label: cage.cageNumber,
      description: [cage.room, cage.rack, cage.purpose]
        .filter(Boolean)
        .join(' · '),
      href: `/cages/${encodeURIComponent(cage.id)}`
    })),
    ...experiments.map((experiment) => ({
      id: experiment.id,
      type: 'experiment' as const,
      label: experiment.name,
      description: [experiment.code, experiment.status]
        .filter(Boolean)
        .join(' · '),
      href: `/experiments/${encodeURIComponent(experiment.id)}`
    })),
    ...events.map((event) => ({
      id: event.id,
      type: 'event' as const,
      label: event.title,
      description: `${event.occurredOn} · ${event.eventType}`,
      href: `/mice/${encodeURIComponent(event.mouseId)}?tab=timeline`
    }))
  ]
}
