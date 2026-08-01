import type { ZodType } from 'zod'

import {
  activityLogSchema,
  appSettingsSchema,
  backupMetadataSchema,
  breedingPairSchema,
  cageAssignmentSchema,
  cageSchema,
  experimentAssignmentSchema,
  experimentGroupSchema,
  experimentSchema,
  litterSchema,
  localDateTimeToInstant,
  mouseEventSchema,
  mouseSchema,
  savedViewSchema,
  tagSchema,
  taskSchema,
  weightRecordSchema
} from '../domain'
import type {
  ExperimentAssignment,
  Mouse,
  MouseEvent,
  WeightRecord
} from '../domain'
import type { MouseKeeperDatabase } from './database'

export type IntegritySeverity = 'error' | 'warning'

export interface IntegrityIssue {
  severity: IntegritySeverity
  code: string
  table: string
  recordId?: string
  message: string
  relatedIds?: string[]
}

export interface IntegrityReport {
  checkedAt: string
  ok: boolean
  counts: Record<string, number>
  issues: IntegrityIssue[]
}

function addSchemaIssues(
  issues: IntegrityIssue[],
  table: string,
  records: readonly unknown[],
  schema: ZodType
): void {
  for (const record of records) {
    const result = schema.safeParse(record)
    if (result.success) {
      continue
    }
    const recordId =
      typeof record === 'object' &&
      record !== null &&
      'id' in record &&
      typeof record.id === 'string'
        ? record.id
        : undefined
    issues.push({
      severity: 'error',
      code: 'invalid-record',
      table,
      recordId,
      message: result.error.issues
        .slice(0, 3)
        .map(issue => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')
    })
  }
}

function findPedigreeCycles(mice: readonly Mouse[]): IntegrityIssue[] {
  const miceById = new Map(mice.map(mouse => [mouse.id, mouse]))
  const state = new Map<string, 'visiting' | 'done'>()
  const issues: IntegrityIssue[] = []

  const visit = (mouseId: string, path: string[]): void => {
    if (state.get(mouseId) === 'done') {
      return
    }
    if (state.get(mouseId) === 'visiting') {
      const cycleStart = path.indexOf(mouseId)
      const cycle = [...path.slice(Math.max(0, cycleStart)), mouseId]
      issues.push({
        severity: 'error',
        code: 'pedigree-cycle',
        table: 'mice',
        recordId: mouseId,
        relatedIds: cycle,
        message: `Pedigree cycle detected: ${cycle.join(' -> ')}`
      })
      return
    }

    const mouse = miceById.get(mouseId)
    if (!mouse) {
      return
    }
    state.set(mouseId, 'visiting')
    for (const parentId of [mouse.sireId, mouse.damId]) {
      if (parentId) {
        visit(parentId, [...path, mouseId])
      }
    }
    state.set(mouseId, 'done')
  }

  for (const mouse of mice) {
    visit(mouse.id, [])
  }
  return issues
}

function checkExperimentAssignment(
  assignment: ExperimentAssignment,
  groupExperimentId: string | undefined,
  mouseIds: ReadonlySet<string>,
  experimentIds: ReadonlySet<string>,
  issues: IntegrityIssue[]
): void {
  if (!mouseIds.has(assignment.mouseId)) {
    issues.push({
      severity: 'error',
      code: 'missing-mouse',
      table: 'experimentAssignments',
      recordId: assignment.id,
      relatedIds: [assignment.mouseId],
      message: `Experiment assignment references missing mouse ${assignment.mouseId}`
    })
  }
  if (!experimentIds.has(assignment.experimentId)) {
    issues.push({
      severity: 'error',
      code: 'missing-experiment',
      table: 'experimentAssignments',
      recordId: assignment.id,
      relatedIds: [assignment.experimentId],
      message: `Experiment assignment references missing experiment ${assignment.experimentId}`
    })
  }
  if (!groupExperimentId) {
    issues.push({
      severity: 'error',
      code: 'missing-experiment-group',
      table: 'experimentAssignments',
      recordId: assignment.id,
      relatedIds: [assignment.groupId],
      message: `Experiment assignment references missing group ${assignment.groupId}`
    })
  } else if (groupExperimentId !== assignment.experimentId) {
    issues.push({
      severity: 'error',
      code: 'group-experiment-mismatch',
      table: 'experimentAssignments',
      recordId: assignment.id,
      relatedIds: [assignment.groupId, assignment.experimentId],
      message: 'Experiment assignment group belongs to a different experiment'
    })
  }
}

function checkWeightEventPair(
  weight: WeightRecord,
  event: MouseEvent | undefined,
  issues: IntegrityIssue[]
): void {
  if (!event) {
    issues.push({
      severity: 'error',
      code: 'missing-weight-event',
      table: 'weightRecords',
      recordId: weight.id,
      relatedIds: [weight.eventId],
      message: `Weight record references missing event ${weight.eventId}`
    })
    return
  }
  if (
    event.eventType !== 'weight' ||
    event.mouseId !== weight.mouseId ||
    event.sourceId !== weight.id
  ) {
    issues.push({
      severity: 'error',
      code: 'weight-event-mismatch',
      table: 'weightRecords',
      recordId: weight.id,
      relatedIds: [event.id],
      message: 'Weight record and event are not a consistent one-to-one pair'
    })
  }
}

export async function scanIntegrity(
  database: MouseKeeperDatabase
): Promise<IntegrityReport> {
  return database.transaction('r', database.tables, async () => {
    const [
      mice,
      cages,
      cageAssignments,
      breedingPairs,
      litters,
      experiments,
      experimentGroups,
      experimentAssignments,
      mouseEvents,
      weightRecords,
      tasks,
      tags,
      activityLogs,
      savedViews,
      appSettings,
      backupMetadata
    ] = await Promise.all([
      database.mice.toArray(),
      database.cages.toArray(),
      database.cageAssignments.toArray(),
      database.breedingPairs.toArray(),
      database.litters.toArray(),
      database.experiments.toArray(),
      database.experimentGroups.toArray(),
      database.experimentAssignments.toArray(),
      database.mouseEvents.toArray(),
      database.weightRecords.toArray(),
      database.tasks.toArray(),
      database.tags.toArray(),
      database.activityLogs.toArray(),
      database.savedViews.toArray(),
      database.appSettings.toArray(),
      database.backupMetadata.toArray()
    ])

    const counts: Record<string, number> = {
      mice: mice.length,
      cages: cages.length,
      cageAssignments: cageAssignments.length,
      breedingPairs: breedingPairs.length,
      litters: litters.length,
      experiments: experiments.length,
      experimentGroups: experimentGroups.length,
      experimentAssignments: experimentAssignments.length,
      mouseEvents: mouseEvents.length,
      weightRecords: weightRecords.length,
      tasks: tasks.length,
      tags: tags.length,
      activityLogs: activityLogs.length,
      savedViews: savedViews.length,
      appSettings: appSettings.length,
      backupMetadata: backupMetadata.length
    }
    const issues: IntegrityIssue[] = []

    addSchemaIssues(issues, 'mice', mice, mouseSchema)
    addSchemaIssues(issues, 'cages', cages, cageSchema)
    addSchemaIssues(
      issues,
      'cageAssignments',
      cageAssignments,
      cageAssignmentSchema
    )
    addSchemaIssues(issues, 'breedingPairs', breedingPairs, breedingPairSchema)
    addSchemaIssues(issues, 'litters', litters, litterSchema)
    addSchemaIssues(issues, 'experiments', experiments, experimentSchema)
    addSchemaIssues(
      issues,
      'experimentGroups',
      experimentGroups,
      experimentGroupSchema
    )
    addSchemaIssues(
      issues,
      'experimentAssignments',
      experimentAssignments,
      experimentAssignmentSchema
    )
    addSchemaIssues(issues, 'mouseEvents', mouseEvents, mouseEventSchema)
    addSchemaIssues(
      issues,
      'weightRecords',
      weightRecords,
      weightRecordSchema
    )
    addSchemaIssues(issues, 'tasks', tasks, taskSchema)
    addSchemaIssues(issues, 'tags', tags, tagSchema)
    addSchemaIssues(issues, 'activityLogs', activityLogs, activityLogSchema)
    addSchemaIssues(issues, 'savedViews', savedViews, savedViewSchema)
    addSchemaIssues(issues, 'appSettings', appSettings, appSettingsSchema)
    addSchemaIssues(
      issues,
      'backupMetadata',
      backupMetadata,
      backupMetadataSchema
    )

    const mouseById = new Map(mice.map(mouse => [mouse.id, mouse]))
    const mouseIds = new Set(mouseById.keys())
    const cageById = new Map(cages.map(cage => [cage.id, cage]))
    const cageIds = new Set(cageById.keys())
    const breedingPairById = new Map(
      breedingPairs.map(pair => [pair.id, pair])
    )
    const litterById = new Map(litters.map(litter => [litter.id, litter]))
    const experimentIds = new Set(
      experiments.map(experiment => experiment.id)
    )
    const tagIds = new Set(tags.map(tag => tag.id))
    const groupExperimentById = new Map(
      experimentGroups.map(group => [group.id, group.experimentId])
    )
    const eventById = new Map(mouseEvents.map(event => [event.id, event]))
    const activeAssignmentByMouse = new Map<string, string>()

    for (const mouse of mice) {
      for (const [role, parentId] of [
        ['sire', mouse.sireId],
        ['dam', mouse.damId]
      ] as const) {
        const parent = parentId ? mouseById.get(parentId) : undefined
        if (parentId && !parent) {
          issues.push({
            severity: 'error',
            code: `missing-${role}`,
            table: 'mice',
            recordId: mouse.id,
            relatedIds: [parentId],
            message: `Mouse references missing ${role} ${parentId}`
          })
        } else if (
          parent?.birthDate &&
          mouse.birthDate &&
          mouse.birthDate < parent.birthDate
        ) {
          issues.push({
            severity: 'error',
            code: 'parent-after-offspring',
            table: 'mice',
            recordId: mouse.id,
            relatedIds: [parent.id],
            message: `Mouse birth date precedes ${role} birth date`
          })
        }
      }
      if (mouse.litterId) {
        const litter = litterById.get(mouse.litterId)
        if (!litter) {
          issues.push({
            severity: 'error',
            code: 'missing-litter',
            table: 'mice',
            recordId: mouse.id,
            relatedIds: [mouse.litterId],
            message: `Mouse references missing litter ${mouse.litterId}`
          })
        } else if (
          mouse.sireId !== litter.sireId ||
          mouse.damId !== litter.damId ||
          mouse.birthDate !== litter.bornOn
        ) {
          issues.push({
            severity: 'error',
            code: 'litter-offspring-mismatch',
            table: 'mice',
            recordId: mouse.id,
            relatedIds: [litter.id],
            message:
              'Mouse litter link does not match the litter parents and birth date'
          })
        }
      }
      for (const tagId of mouse.tagIds) {
        if (!tagIds.has(tagId)) {
          issues.push({
            severity: 'error',
            code: 'missing-tag',
            table: 'mice',
            recordId: mouse.id,
            relatedIds: [tagId],
            message: `Mouse references missing tag ${tagId}`
          })
        }
      }
    }
    issues.push(...findPedigreeCycles(mice))

    for (const pair of breedingPairs) {
      for (const [role, mouseId] of [
        ['sire', pair.sireId],
        ['dam', pair.damId]
      ] as const) {
        const parent = mouseById.get(mouseId)
        if (!parent) {
          issues.push({
            severity: 'error',
            code: `missing-${role}`,
            table: 'breedingPairs',
            recordId: pair.id,
            relatedIds: [mouseId],
            message: `Breeding pair references missing ${role} ${mouseId}`
          })
        } else if (
          parent.birthDate &&
          pair.pairedOn < parent.birthDate
        ) {
          issues.push({
            severity: 'error',
            code: 'breeding-before-parent-birth',
            table: 'breedingPairs',
            recordId: pair.id,
            relatedIds: [parent.id],
            message: `Breeding pair date precedes ${role} birth date`
          })
        }
      }
    }

    for (const litter of litters) {
      const pair = breedingPairById.get(litter.breedingPairId)
      if (!pair) {
        issues.push({
          severity: 'error',
          code: 'missing-breeding-pair',
          table: 'litters',
          recordId: litter.id,
          relatedIds: [litter.breedingPairId],
          message: `Litter references missing breeding pair ${litter.breedingPairId}`
        })
      } else if (
        pair.sireId !== litter.sireId ||
        pair.damId !== litter.damId
      ) {
        issues.push({
          severity: 'error',
          code: 'litter-pair-mismatch',
          table: 'litters',
          recordId: litter.id,
          relatedIds: [pair.id],
          message: 'Litter parents do not match its breeding pair'
        })
      }
      for (const [role, mouseId] of [
        ['sire', litter.sireId],
        ['dam', litter.damId]
      ] as const) {
        if (!mouseIds.has(mouseId)) {
          issues.push({
            severity: 'error',
            code: `missing-${role}`,
            table: 'litters',
            recordId: litter.id,
            relatedIds: [mouseId],
            message: `Litter references missing ${role} ${mouseId}`
          })
        }
      }
    }

    for (const assignment of cageAssignments) {
      if (!mouseById.has(assignment.mouseId)) {
        issues.push({
          severity: 'error',
          code: 'missing-mouse',
          table: 'cageAssignments',
          recordId: assignment.id,
          relatedIds: [assignment.mouseId],
          message: `Cage assignment references missing mouse ${assignment.mouseId}`
        })
      }
      if (!cageIds.has(assignment.cageId)) {
        issues.push({
          severity: 'error',
          code: 'missing-cage',
          table: 'cageAssignments',
          recordId: assignment.id,
          relatedIds: [assignment.cageId],
          message: `Cage assignment references missing cage ${assignment.cageId}`
        })
      }
      if (assignment.activeFlag === 1 && assignment.deletedFlag === 0) {
        const cage = cageById.get(assignment.cageId)
        if (cage?.status === 'inactive' || cage?.status === 'retired') {
          issues.push({
            severity: 'error',
            code: 'active-assignment-in-unavailable-cage',
            table: 'cageAssignments',
            recordId: assignment.id,
            relatedIds: [cage.id],
            message: 'Active cage assignment references an inactive or retired cage'
          })
        }
        const previous = activeAssignmentByMouse.get(assignment.mouseId)
        if (previous) {
          issues.push({
            severity: 'error',
            code: 'multiple-active-cages',
            table: 'cageAssignments',
            recordId: assignment.id,
            relatedIds: [previous, assignment.id, assignment.mouseId],
            message: 'Mouse has more than one active cage assignment'
          })
        } else {
          activeAssignmentByMouse.set(assignment.mouseId, assignment.id)
        }
      }
    }

    for (const mouse of mice) {
      const assignmentId = activeAssignmentByMouse.get(mouse.id)
      const assignment = assignmentId
        ? cageAssignments.find(item => item.id === assignmentId)
        : undefined
      if (mouse.currentCageId !== assignment?.cageId) {
        issues.push({
          severity: 'error',
          code: 'current-cage-projection-mismatch',
          table: 'mice',
          recordId: mouse.id,
          relatedIds: [mouse.currentCageId, assignment?.cageId].filter(
            (value): value is string => value !== undefined
          ),
          message: 'Mouse currentCageId does not match its active assignment'
        })
      }
    }

    for (const assignment of experimentAssignments) {
      checkExperimentAssignment(
        assignment,
        groupExperimentById.get(assignment.groupId),
        mouseIds,
        experimentIds,
        issues
      )
    }

    for (const group of experimentGroups) {
      if (!experimentIds.has(group.experimentId)) {
        issues.push({
          severity: 'error',
          code: 'missing-experiment',
          table: 'experimentGroups',
          recordId: group.id,
          relatedIds: [group.experimentId],
          message: `Experiment group references missing experiment ${group.experimentId}`
        })
      }
    }

    const activeExperimentMemberships = new Map<string, string>()
    for (const assignment of experimentAssignments) {
      if (assignment.activeFlag !== 1 || assignment.deletedFlag !== 0) {
        continue
      }
      const key = `${assignment.experimentId}:${assignment.mouseId}`
      const previous = activeExperimentMemberships.get(key)
      if (previous) {
        issues.push({
          severity: 'error',
          code: 'multiple-active-experiment-memberships',
          table: 'experimentAssignments',
          recordId: assignment.id,
          relatedIds: [previous, assignment.id, assignment.mouseId],
          message:
            'Mouse has more than one active assignment in the same experiment'
        })
      } else {
        activeExperimentMemberships.set(key, assignment.id)
      }
    }

    for (const weight of weightRecords) {
      if (!mouseIds.has(weight.mouseId)) {
        issues.push({
          severity: 'error',
          code: 'missing-mouse',
          table: 'weightRecords',
          recordId: weight.id,
          relatedIds: [weight.mouseId],
          message: `Weight record references missing mouse ${weight.mouseId}`
        })
      }
      try {
        const expectedMeasuredAt = localDateTimeToInstant(
          weight.measuredOn,
          weight.measuredTime ?? '00:00',
          weight.timeZone
        )
        if (expectedMeasuredAt !== weight.measuredAt) {
          issues.push({
            severity: 'error',
            code: 'weight-time-mismatch',
            table: 'weightRecords',
            recordId: weight.id,
            message:
              'Weight date, time, time zone, and measuredAt are inconsistent'
          })
        }
      } catch (error) {
        issues.push({
          severity: 'error',
          code: 'invalid-weight-time-zone',
          table: 'weightRecords',
          recordId: weight.id,
          message:
            error instanceof Error
              ? error.message
              : 'Weight time zone could not be resolved'
        })
      }
      checkWeightEventPair(weight, eventById.get(weight.eventId), issues)
    }

    for (const event of mouseEvents) {
      if (!mouseIds.has(event.mouseId)) {
        issues.push({
          severity: 'error',
          code: 'missing-mouse',
          table: 'mouseEvents',
          recordId: event.id,
          relatedIds: [event.mouseId],
          message: `Mouse event references missing mouse ${event.mouseId}`
        })
      }
      if (event.cageId && !cageIds.has(event.cageId)) {
        issues.push({
          severity: 'error',
          code: 'missing-cage',
          table: 'mouseEvents',
          recordId: event.id,
          relatedIds: [event.cageId],
          message: `Mouse event references missing cage ${event.cageId}`
        })
      }
      if (
        event.experimentId &&
        !experimentIds.has(event.experimentId)
      ) {
        issues.push({
          severity: 'error',
          code: 'missing-experiment',
          table: 'mouseEvents',
          recordId: event.id,
          relatedIds: [event.experimentId],
          message: `Mouse event references missing experiment ${event.experimentId}`
        })
      }
      try {
        const expectedOccurredAt = localDateTimeToInstant(
          event.occurredOn,
          event.occurredTime ?? '00:00',
          event.timeZone
        )
        if (expectedOccurredAt !== event.occurredAt) {
          issues.push({
            severity: 'error',
            code: 'event-time-mismatch',
            table: 'mouseEvents',
            recordId: event.id,
            message:
              'Event date, time, time zone, and occurredAt are inconsistent'
          })
        }
      } catch (error) {
        issues.push({
          severity: 'error',
          code: 'invalid-event-time-zone',
          table: 'mouseEvents',
          recordId: event.id,
          message:
            error instanceof Error
              ? error.message
              : 'Event time zone could not be resolved'
        })
      }
      if (
        event.eventType === 'weight' &&
        !weightRecords.some(weight => weight.eventId === event.id)
      ) {
        issues.push({
          severity: 'error',
          code: 'missing-event-weight-record',
          table: 'mouseEvents',
          recordId: event.id,
          message: 'Weight event has no matching WeightRecord'
        })
      }
    }

    for (const task of tasks) {
      for (const [field, id, ids] of [
        ['mouse', task.mouseId, mouseIds],
        ['cage', task.cageId, cageIds],
        ['experiment', task.experimentId, experimentIds]
      ] as const) {
        if (id && !ids.has(id)) {
          issues.push({
            severity: 'error',
            code: `missing-${field}`,
            table: 'tasks',
            recordId: task.id,
            relatedIds: [id],
            message: `Task references missing ${field} ${id}`
          })
        }
      }
    }

    if (appSettings.length > 1) {
      issues.push({
        severity: 'error',
        code: 'multiple-app-settings',
        table: 'appSettings',
        message: 'AppSettings must be a singleton'
      })
    }

    return {
      checkedAt: new Date().toISOString(),
      ok: !issues.some(issue => issue.severity === 'error'),
      counts,
      issues
    }
  })
}
