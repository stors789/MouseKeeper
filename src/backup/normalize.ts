import {
  makeActiveKey,
  makeCompositeKey,
  normalizeOptionalText,
  normalizeText
} from '../domain'
import type { BackupData } from './types'

function isPresent(value: string | undefined): value is string {
  return value !== undefined
}

export function prepareRestoredData(data: BackupData): BackupData {
  const activeCageByMouse = new Map(
    data.cageAssignments
      .filter(
        assignment =>
          assignment.deletedFlag === 0 && assignment.endedAt === undefined
      )
      .map(assignment => [assignment.mouseId, assignment.cageId])
  )
  const groupById = new Map(
    data.experimentGroups.map(group => [group.id, group])
  )

  return {
    mice: data.mice.map(mouse => {
      const normalizedEarTag = normalizeOptionalText(mouse.earTag)
      const normalizedExperimentNumber = normalizeOptionalText(
        mouse.experimentNumber
      )
      const normalizedAlias = normalizeOptionalText(mouse.alias)
      const genotypeKey = normalizeOptionalText(mouse.genotype)
      return {
        ...mouse,
        normalizedEarTag,
        activeEarTagKey:
          mouse.deletedFlag === 0
            ? makeActiveKey('ear', mouse.earTag)
            : undefined,
        normalizedExperimentNumber,
        normalizedAlias,
        strainKey: normalizeText(mouse.strain),
        genotypeKey,
        currentCageId: activeCageByMouse.get(mouse.id)
      }
    }),
    cages: data.cages.map(cage => ({
      ...cage,
      normalizedCageNumber: normalizeText(cage.cageNumber),
      activeCageNumberKey:
        cage.deletedFlag === 0
          ? makeActiveKey('cage', cage.cageNumber)
          : undefined,
      roomKey: normalizeOptionalText(cage.room),
      rackKey: normalizeOptionalText(cage.rack)
    })),
    cageAssignments: data.cageAssignments.map(assignment => {
      const active =
        assignment.deletedFlag === 0 && assignment.endedAt === undefined
      return {
        ...assignment,
        activeFlag: active ? 1 : 0,
        activeMouseKey: active ? assignment.mouseId : undefined
      }
    }),
    breedingPairs: data.breedingPairs.map(pair => ({
      ...pair,
      activePairKey:
        pair.deletedFlag === 0 &&
        (pair.status === 'planned' || pair.status === 'active')
          ? makeCompositeKey('pair', pair.sireId, pair.damId)
          : undefined
    })),
    litters: data.litters.map(litter => ({
      ...litter,
      normalizedLitterNumber: normalizeText(litter.litterNumber),
      activeLitterKey:
        litter.deletedFlag === 0
          ? makeCompositeKey(
              'litter',
              litter.breedingPairId,
              litter.litterNumber
            )
          : undefined
    })),
    experiments: data.experiments.map(experiment => ({
      ...experiment,
      normalizedCode: normalizeOptionalText(experiment.code),
      normalizedName: normalizeText(experiment.name),
      activeExperimentCodeKey:
        experiment.deletedFlag === 0
          ? makeActiveKey('experiment', experiment.code)
          : undefined
    })),
    experimentGroups: data.experimentGroups.map(group => ({
      ...group,
      normalizedName: normalizeText(group.name),
      activeGroupNameKey:
        group.deletedFlag === 0
          ? makeCompositeKey(
              'experiment-group',
              group.experimentId,
              group.name
            )
          : undefined
    })),
    experimentAssignments: data.experimentAssignments.map(assignment => {
      const active =
        assignment.deletedFlag === 0 && assignment.exitedAt === undefined
      const exclusionSet = groupById.get(assignment.groupId)?.exclusionSet
      return {
        ...assignment,
        activeFlag: active ? 1 : 0,
        activeGroupMouseKey: active
          ? makeCompositeKey(
              'experiment-group-mouse',
              assignment.groupId,
              assignment.mouseId
            )
          : undefined,
        activeExclusionMouseKey:
          active && isPresent(exclusionSet)
            ? makeCompositeKey(
                'experiment-exclusion',
                assignment.experimentId,
                exclusionSet,
                assignment.mouseId
              )
            : undefined
      }
    }),
    mouseEvents: data.mouseEvents.map(event => ({ ...event })),
    weightRecords: data.weightRecords.map(weight => ({ ...weight })),
    tasks: data.tasks.map(task => ({ ...task })),
    tags: data.tags.map(tag => ({
      ...tag,
      normalizedName: normalizeText(tag.name),
      activeNameKey:
        tag.deletedFlag === 0 ? makeActiveKey('tag', tag.name) : undefined
    })),
    activityLogs: data.activityLogs.map(log => ({ ...log })),
    savedViews: data.savedViews.map(view => ({
      ...view,
      normalizedName: normalizeText(view.name),
      activeScopeNameKey:
        view.deletedFlag === 0
          ? makeCompositeKey('saved-view', view.scope, view.name)
          : undefined
    })),
    appSettings: data.appSettings.map(settings => ({ ...settings })),
    backupMetadata: data.backupMetadata.map(metadata => ({ ...metadata }))
  }
}
