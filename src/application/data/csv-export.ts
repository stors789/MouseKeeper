import { mouseDisplayLabel } from '../../domain'
import type { MouseKeeperDatabase } from '../../db'
import {
  exportCagesCsv,
  exportEventsCsv,
  exportExperimentsCsv,
  exportMiceCsv,
  exportWeightsCsv
} from '../../import-export/exporters'

export type CsvExportKind = 'mice' | 'cages' | 'experiments' | 'weights' | 'events'

export async function buildCsvExport(
  database: MouseKeeperDatabase,
  kind: CsvExportKind
): Promise<{ csv: string; rowCount: number }> {
  const [mice, cages, cageAssignments, experiments, groups, experimentAssignments, weights, events, tags] =
    await Promise.all([
      database.mice.toArray(),
      database.cages.toArray(),
      database.cageAssignments.toArray(),
      database.experiments.toArray(),
      database.experimentGroups.toArray(),
      database.experimentAssignments.toArray(),
      database.weightRecords.toArray(),
      database.mouseEvents.toArray(),
      database.tags.toArray()
    ])
  const cageById = new Map(cages.map((cage) => [cage.id, cage]))
  const tagById = new Map(tags.map((tag) => [tag.id, tag]))
  const mouseById = new Map(mice.map((mouse) => [mouse.id, mouse]))
  const experimentById = new Map(experiments.map((experiment) => [experiment.id, experiment]))

  if (kind === 'mice') {
    const records = mice.filter((mouse) => mouse.deletedFlag === 0).map((mouse) => ({
      mouse,
      cageNumber: mouse.currentCageId ? cageById.get(mouse.currentCageId)?.cageNumber : undefined,
      tagNames: mouse.tagIds.flatMap((tagId) => {
        const tag = tagById.get(tagId)
        return tag ? [tag.name] : []
      })
    }))
    return { csv: exportMiceCsv(records), rowCount: records.length }
  }

  if (kind === 'cages') {
    const countByCage = new Map<string, number>()
    for (const assignment of cageAssignments) {
      if (assignment.deletedFlag === 0 && assignment.activeFlag === 1) {
        countByCage.set(assignment.cageId, (countByCage.get(assignment.cageId) ?? 0) + 1)
      }
    }
    const records = cages.filter((cage) => cage.deletedFlag === 0).map((cage) => ({
      cage,
      currentCount: countByCage.get(cage.id) ?? 0
    }))
    return { csv: exportCagesCsv(records), rowCount: records.length }
  }

  if (kind === 'experiments') {
    const groupCounts = new Map<string, number>()
    for (const group of groups) {
      if (group.deletedFlag === 0) groupCounts.set(group.experimentId, (groupCounts.get(group.experimentId) ?? 0) + 1)
    }
    const activeMouseIds = new Map<string, Set<string>>()
    for (const assignment of experimentAssignments) {
      if (assignment.deletedFlag !== 0 || assignment.activeFlag !== 1) continue
      const ids = activeMouseIds.get(assignment.experimentId) ?? new Set<string>()
      ids.add(assignment.mouseId)
      activeMouseIds.set(assignment.experimentId, ids)
    }
    const records = experiments.filter((experiment) => experiment.deletedFlag === 0).map((experiment) => ({
      experiment,
      groupCount: groupCounts.get(experiment.id) ?? 0,
      activeMouseCount: activeMouseIds.get(experiment.id)?.size ?? 0
    }))
    return { csv: exportExperimentsCsv(records), rowCount: records.length }
  }

  if (kind === 'weights') {
    const records = weights.filter((weight) => weight.deletedFlag === 0).map((weight) => ({
      weight,
      mouseLabel: mouseById.has(weight.mouseId)
        ? mouseDisplayLabel(mouseById.get(weight.mouseId)!)
        : weight.mouseId
    }))
    return { csv: exportWeightsCsv(records), rowCount: records.length }
  }

  const records = events.filter((event) => event.deletedFlag === 0).map((event) => ({
    event,
    mouseLabel: mouseById.has(event.mouseId)
      ? mouseDisplayLabel(mouseById.get(event.mouseId)!)
      : event.mouseId,
    cageNumber: event.cageId ? cageById.get(event.cageId)?.cageNumber : undefined,
    experimentName: event.experimentId ? experimentById.get(event.experimentId)?.name : undefined
  }))
  return { csv: exportEventsCsv(records), rowCount: records.length }
}
