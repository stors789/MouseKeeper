import { z } from 'zod'

import {
  BACKUP_KINDS,
  BACKUP_STATUSES,
  BREEDING_PAIR_STATUSES,
  CAGE_STATUSES,
  EXPERIMENT_GROUP_TYPES,
  EXPERIMENT_STATUSES,
  MOUSE_EVENT_TYPES,
  MOUSE_SEXES,
  MOUSE_STATUSES,
  SAVED_VIEW_SCOPES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  WEIGHT_UNITS
} from './types'
import type { JsonValue } from './types'
import {
  isIsoInstant,
  isValidLocalDate,
  isValidLocalTime,
  todayLocalDate
} from './dates'

const MAX_SHORT_TEXT = 256
const MAX_NOTES = 20_000
const MAX_CUSTOM_BYTES = 64_000

export const idSchema = z.string().trim().min(1).max(128)
export const isoInstantSchema = z.string().refine(isIsoInstant, {
  message: 'Expected a canonical UTC ISO-8601 instant'
})
export const localDateSchema = z.string().refine(isValidLocalDate, {
  message: 'Expected a valid YYYY-MM-DD calendar date'
})
export const localTimeSchema = z.string().refine(isValidLocalTime, {
  message: 'Expected a valid HH:mm time'
})
export const shortTextSchema = z.string().trim().min(1).max(MAX_SHORT_TEXT)
export const optionalShortTextSchema = z
  .string()
  .trim()
  .max(MAX_SHORT_TEXT)
  .optional()
export const notesSchema = z.string().max(MAX_NOTES).optional()

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
)

const customSchema = z
  .record(z.string().max(128), jsonValueSchema)
  .refine(value => JSON.stringify(value).length <= MAX_CUSTOM_BYTES, {
    message: `custom data must be at most ${MAX_CUSTOM_BYTES} serialized bytes`
  })
  .optional()

const storedEntityObjectSchema = z.object({
  id: idSchema,
  schemaVersion: z.number().int().positive(),
  revision: z.number().int().positive(),
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
  deletedAt: isoInstantSchema.nullable(),
  deletedFlag: z.union([z.literal(0), z.literal(1)]),
  origin: z.enum(['user', 'sample', 'import', 'system']),
  sampleBatchId: idSchema.optional(),
  importBatchId: idSchema.optional(),
  custom: customSchema
})

type StoredEntityValidationValue = z.infer<typeof storedEntityObjectSchema>

function validateStoredEntityFields(
  value: StoredEntityValidationValue,
  context: z.RefinementCtx
): void {
  if ((value.deletedAt === null ? 0 : 1) !== value.deletedFlag) {
    context.addIssue({
      code: 'custom',
      path: ['deletedFlag'],
      message: 'deletedFlag must match deletedAt'
    })
  }
  if (value.origin === 'sample' && !value.sampleBatchId) {
    context.addIssue({
      code: 'custom',
      path: ['sampleBatchId'],
      message: 'Sample records require sampleBatchId'
    })
  }
}

export const storedEntitySchema = storedEntityObjectSchema.superRefine(
  validateStoredEntityFields
)

const baseShape = storedEntityObjectSchema

export const mouseSchema = baseShape
  .safeExtend({
    earTag: optionalShortTextSchema,
    normalizedEarTag: optionalShortTextSchema,
    activeEarTagKey: optionalShortTextSchema,
    experimentNumber: optionalShortTextSchema,
    normalizedExperimentNumber: optionalShortTextSchema,
    name: optionalShortTextSchema,
    alias: optionalShortTextSchema,
    normalizedAlias: optionalShortTextSchema,
    strain: shortTextSchema,
    strainKey: shortTextSchema,
    genotype: optionalShortTextSchema,
    genotypeKey: optionalShortTextSchema,
    sex: z.enum(MOUSE_SEXES),
    birthDate: localDateSchema.optional(),
    sireId: idSchema.optional(),
    damId: idSchema.optional(),
    litterId: idSchema.optional(),
    currentCageId: idSchema.optional(),
    status: z.enum(MOUSE_STATUSES),
    source: optionalShortTextSchema,
    coatColor: optionalShortTextSchema,
    notes: notesSchema,
    tagIds: z.array(idSchema).max(256),
    searchTerms: z.array(z.string().min(1).max(256)).max(64)
  })
  .superRefine((mouse, context) => {
    validateStoredEntityFields(mouse, context)
    if (mouse.sireId === mouse.id || mouse.damId === mouse.id) {
      context.addIssue({
        code: 'custom',
        path: mouse.sireId === mouse.id ? ['sireId'] : ['damId'],
        message: 'A mouse cannot be its own parent'
      })
    }
    if (mouse.sireId && mouse.sireId === mouse.damId) {
      context.addIssue({
        code: 'custom',
        path: ['damId'],
        message: 'Sire and dam must be different mice'
      })
    }
    if (mouse.birthDate && mouse.birthDate > todayLocalDate()) {
      context.addIssue({
        code: 'custom',
        path: ['birthDate'],
        message: 'Birth date cannot be in the future'
      })
    }
  })

export const cageSchema = baseShape
  .safeExtend({
    cageNumber: shortTextSchema,
    normalizedCageNumber: shortTextSchema,
    activeCageNumberKey: optionalShortTextSchema,
    room: optionalShortTextSchema,
    roomKey: optionalShortTextSchema,
    rack: optionalShortTextSchema,
    rackKey: optionalShortTextSchema,
    maxCapacity: z.number().int().positive().max(10_000),
    primaryStrain: optionalShortTextSchema,
    purpose: optionalShortTextSchema,
    status: z.enum(CAGE_STATUSES),
    notes: notesSchema
  })
  .superRefine(validateStoredEntityFields)

export const cageAssignmentSchema = baseShape
  .safeExtend({
    mouseId: idSchema,
    cageId: idSchema,
    startedAt: isoInstantSchema,
    endedAt: isoInstantSchema.optional(),
    activeFlag: z.union([z.literal(0), z.literal(1)]),
    activeMouseKey: idSchema.optional(),
    startReason: optionalShortTextSchema,
    endReason: optionalShortTextSchema,
    startedEventId: idSchema.optional(),
    endedEventId: idSchema.optional(),
    cageNumberSnapshot: shortTextSchema,
    mouseLabelSnapshot: shortTextSchema
  })
  .superRefine((assignment, context) => {
    validateStoredEntityFields(assignment, context)
    const shouldBeActive =
      assignment.endedAt === undefined && assignment.deletedFlag === 0
    if ((shouldBeActive ? 1 : 0) !== assignment.activeFlag) {
      context.addIssue({
        code: 'custom',
        path: ['activeFlag'],
        message: 'activeFlag must match endedAt and deletedFlag'
      })
    }
    if (shouldBeActive && assignment.activeMouseKey !== assignment.mouseId) {
      context.addIssue({
        code: 'custom',
        path: ['activeMouseKey'],
        message: 'Active assignments require activeMouseKey equal to mouseId'
      })
    }
    if (!shouldBeActive && assignment.activeMouseKey !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['activeMouseKey'],
        message: 'Inactive assignments cannot have activeMouseKey'
      })
    }
    if (assignment.endedAt && assignment.endedAt < assignment.startedAt) {
      context.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: 'endedAt cannot precede startedAt'
      })
    }
  })

export const breedingPairSchema = baseShape
  .safeExtend({
    sireId: idSchema,
    damId: idSchema,
    pairedOn: localDateSchema,
    separatedOn: localDateSchema.optional(),
    expectedDeliveryDate: localDateSchema.optional(),
    status: z.enum(BREEDING_PAIR_STATUSES),
    activePairKey: optionalShortTextSchema,
    notes: notesSchema,
    warningAcknowledgements: z.array(z.string().min(1).max(128)).optional()
  })
  .superRefine((pair, context) => {
    validateStoredEntityFields(pair, context)
    if (pair.sireId === pair.damId) {
      context.addIssue({
        code: 'custom',
        path: ['damId'],
        message: 'Sire and dam must be different mice'
      })
    }
    if (pair.separatedOn && pair.separatedOn < pair.pairedOn) {
      context.addIssue({
        code: 'custom',
        path: ['separatedOn'],
        message: 'Separated date cannot precede paired date'
      })
    }
    if (
      pair.expectedDeliveryDate &&
      pair.expectedDeliveryDate < pair.pairedOn
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expectedDeliveryDate'],
        message: 'Expected delivery date cannot precede paired date'
      })
    }
    if (
      (pair.status === 'planned' || pair.status === 'active') &&
      pair.separatedOn
    ) {
      context.addIssue({
        code: 'custom',
        path: ['separatedOn'],
        message: 'A current breeding pair cannot have a separated date'
      })
    }
    if (pair.status === 'separated' && !pair.separatedOn) {
      context.addIssue({
        code: 'custom',
        path: ['separatedOn'],
        message: 'A separated breeding pair requires a separated date'
      })
    }
  })

export const litterSchema = baseShape
  .safeExtend({
    breedingPairId: idSchema,
    litterNumber: shortTextSchema,
    normalizedLitterNumber: shortTextSchema,
    activeLitterKey: optionalShortTextSchema,
    sireId: idSchema,
    damId: idSchema,
    bornOn: localDateSchema,
    bornCount: z.number().int().nonnegative(),
    aliveCount: z.number().int().nonnegative(),
    weanedOn: localDateSchema.optional(),
    notes: notesSchema
  })
  .superRefine((litter, context) => {
    validateStoredEntityFields(litter, context)
    if (litter.aliveCount > litter.bornCount) {
      context.addIssue({
        code: 'custom',
        path: ['aliveCount'],
        message: 'aliveCount cannot exceed bornCount'
      })
    }
    if (litter.weanedOn && litter.weanedOn < litter.bornOn) {
      context.addIssue({
        code: 'custom',
        path: ['weanedOn'],
        message: 'Weaned date cannot precede birth date'
      })
    }
  })

export const experimentSchema = baseShape
  .safeExtend({
    code: optionalShortTextSchema,
    normalizedCode: optionalShortTextSchema,
    activeExperimentCodeKey: optionalShortTextSchema,
    name: shortTextSchema,
    normalizedName: shortTextSchema,
    description: notesSchema,
    startDate: localDateSchema.optional(),
    endDate: localDateSchema.optional(),
    status: z.enum(EXPERIMENT_STATUSES),
    intervention: optionalShortTextSchema,
    dose: optionalShortTextSchema,
    frequency: optionalShortTextSchema,
    principalInvestigator: optionalShortTextSchema,
    notes: notesSchema,
    searchTerms: z.array(z.string().min(1).max(256)).max(64)
  })
  .superRefine((experiment, context) => {
    validateStoredEntityFields(experiment, context)
    if (
      experiment.startDate &&
      experiment.endDate &&
      experiment.endDate < experiment.startDate
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date cannot precede start date'
      })
    }
  })

export const experimentGroupSchema = baseShape
  .safeExtend({
    experimentId: idSchema,
    name: shortTextSchema,
    normalizedName: shortTextSchema,
    groupType: z.enum(EXPERIMENT_GROUP_TYPES),
    activeGroupNameKey: optionalShortTextSchema,
    exclusionSet: optionalShortTextSchema,
    intervention: optionalShortTextSchema,
    dose: optionalShortTextSchema,
    frequency: optionalShortTextSchema,
    notes: notesSchema
  })
  .superRefine(validateStoredEntityFields)

export const experimentAssignmentSchema = baseShape
  .safeExtend({
    mouseId: idSchema,
    experimentId: idSchema,
    groupId: idSchema,
    joinedAt: isoInstantSchema,
    exitedAt: isoInstantSchema.optional(),
    exitReason: optionalShortTextSchema,
    activeFlag: z.union([z.literal(0), z.literal(1)]),
    activeGroupMouseKey: optionalShortTextSchema,
    activeExclusionMouseKey: optionalShortTextSchema,
    joinedEventId: idSchema.optional(),
    exitedEventId: idSchema.optional(),
    experimentNameSnapshot: shortTextSchema,
    groupNameSnapshot: shortTextSchema,
    mouseLabelSnapshot: shortTextSchema
  })
  .superRefine((assignment, context) => {
    validateStoredEntityFields(assignment, context)
    const shouldBeActive =
      assignment.exitedAt === undefined && assignment.deletedFlag === 0
    if ((shouldBeActive ? 1 : 0) !== assignment.activeFlag) {
      context.addIssue({
        code: 'custom',
        path: ['activeFlag'],
        message: 'activeFlag must match exitedAt and deletedFlag'
      })
    }
    if (assignment.exitedAt && assignment.exitedAt < assignment.joinedAt) {
      context.addIssue({
        code: 'custom',
        path: ['exitedAt'],
        message: 'exitedAt cannot precede joinedAt'
      })
    }
  })

export const entityTypeSchema = z.enum([
  'mouse',
  'cage',
  'cageAssignment',
  'breedingPair',
  'litter',
  'experiment',
  'experimentGroup',
  'experimentAssignment',
  'mouseEvent',
  'weightRecord',
  'task',
  'tag',
  'activityLog',
  'savedView',
  'appSettings',
  'backupMetadata'
])

export const mouseEventSchema = baseShape
  .safeExtend({
    eventType: z.enum(MOUSE_EVENT_TYPES),
    occurredOn: localDateSchema,
    occurredTime: localTimeSchema.optional(),
    timeZone: shortTextSchema,
    occurredAt: isoInstantSchema,
    mouseId: idSchema,
    cageId: idSchema.optional(),
    experimentId: idSchema.optional(),
    title: shortTextSchema,
    normalizedTitle: shortTextSchema,
    description: notesSchema,
    payloadVersion: z.number().int().positive(),
    payload: jsonValueSchema,
    sourceType: entityTypeSchema.optional(),
    sourceId: idSchema.optional(),
    snapshot: z
      .object({
        mouseLabel: optionalShortTextSchema,
        cageNumber: optionalShortTextSchema,
        experimentName: optionalShortTextSchema
      })
      .strict()
      .optional(),
    searchTerms: z.array(z.string().min(1).max(256)).max(64)
  })
  .superRefine(validateStoredEntityFields)

export const weightRecordSchema = baseShape
  .safeExtend({
    mouseId: idSchema,
    eventId: idSchema,
    measuredOn: localDateSchema,
    measuredTime: localTimeSchema.optional(),
    timeZone: shortTextSchema,
    measuredAt: isoInstantSchema,
    value: z.number().positive().finite(),
    unit: z.enum(WEIGHT_UNITS),
    valueGrams: z.number().positive().finite(),
    notes: notesSchema,
    anomalyAcknowledged: z.boolean().optional()
  })
  .superRefine((weight, context) => {
    validateStoredEntityFields(weight, context)
    const expectedGrams = weight.unit === 'g' ? weight.value : weight.value / 1000
    if (Math.abs(expectedGrams - weight.valueGrams) > 0.000_001) {
      context.addIssue({
        code: 'custom',
        path: ['valueGrams'],
        message: 'valueGrams must match value and unit'
      })
    }
  })

export const taskSchema = baseShape
  .safeExtend({
    title: shortTextSchema,
    dueDate: localDateSchema,
    dueTime: localTimeSchema.optional(),
    dueSortKey: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    mouseId: idSchema.optional(),
    cageId: idSchema.optional(),
    experimentId: idSchema.optional(),
    priority: z.enum(TASK_PRIORITIES),
    status: z.enum(TASK_STATUSES),
    notes: notesSchema,
    completedAt: isoInstantSchema.optional()
  })
  .superRefine((task, context) => {
    validateStoredEntityFields(task, context)
    if ((task.status === 'completed') !== (task.completedAt !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'completedAt must be set exactly when the task is completed'
      })
    }
  })

export const tagSchema = baseShape
  .safeExtend({
    name: shortTextSchema,
    normalizedName: shortTextSchema,
    activeNameKey: optionalShortTextSchema,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    description: notesSchema
  })
  .superRefine(validateStoredEntityFields)

export const activityLogSchema = baseShape
  .safeExtend({
    operationId: idSchema,
    occurredAt: isoInstantSchema,
    action: shortTextSchema,
    primaryEntityType: entityTypeSchema,
    primaryEntityId: idSchema,
    primaryEntityKey: shortTextSchema,
    entityRefKeys: z.array(shortTextSchema).max(1_000),
    summary: z.string().trim().min(1).max(2_000),
    changedFields: z.array(shortTextSchema).max(256).optional(),
    warningAcknowledgements: z.array(shortTextSchema).max(64).optional(),
    resultEntityIds: z.array(idSchema).max(10_000).optional(),
    metadata: jsonValueSchema.optional()
  })
  .superRefine(validateStoredEntityFields)

export const savedViewSchema = baseShape
  .safeExtend({
    scope: z.enum(SAVED_VIEW_SCOPES),
    name: shortTextSchema,
    normalizedName: shortTextSchema,
    activeScopeNameKey: optionalShortTextSchema,
    queryVersion: z.number().int().positive(),
    filters: jsonValueSchema,
    sort: jsonValueSchema,
    columns: jsonValueSchema.optional(),
    lastUsedAt: isoInstantSchema.optional()
  })
  .superRefine(validateStoredEntityFields)

export const appSettingsSchema = baseShape
  .safeExtend({
    appName: shortTextSchema,
    locale: shortTextSchema,
    timeZone: shortTextSchema,
    weekStartsOn: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6)
    ]),
    capacityWarningPercent: z.number().min(0).max(1),
    weightAnomalyPercent: z.number().positive().max(10),
    notificationPreferences: z
      .object({
        enabled: z.boolean(),
        reminderMinutesBefore: z.number().int().nonnegative().max(525_600)
      })
      .strict(),
    lastIntegrityCheckAt: isoInstantSchema.optional(),
    databaseInstanceId: idSchema
  })
  .superRefine(validateStoredEntityFields)

export const backupMetadataSchema = baseShape
  .safeExtend({
    backupId: idSchema,
    kind: z.enum(BACKUP_KINDS),
    status: z.enum(BACKUP_STATUSES),
    backupFormatVersion: z.number().int().positive(),
    backupSchemaVersion: z.number().int().positive(),
    appVersion: shortTextSchema,
    exportedAt: isoInstantSchema,
    fileName: optionalShortTextSchema,
    checksum: z.string().min(1).max(256).optional(),
    tableCounts: z
      .record(z.string(), z.number().int().nonnegative())
      .optional(),
    sourceDatabaseInstanceId: idSchema.optional(),
    errorCode: optionalShortTextSchema,
    errorSummary: z.string().max(2_000).optional()
  })
  .superRefine(validateStoredEntityFields)

export const entitySchemas = {
  mice: mouseSchema,
  cages: cageSchema,
  cageAssignments: cageAssignmentSchema,
  breedingPairs: breedingPairSchema,
  litters: litterSchema,
  experiments: experimentSchema,
  experimentGroups: experimentGroupSchema,
  experimentAssignments: experimentAssignmentSchema,
  mouseEvents: mouseEventSchema,
  weightRecords: weightRecordSchema,
  tasks: taskSchema,
  tags: tagSchema,
  activityLogs: activityLogSchema,
  savedViews: savedViewSchema,
  appSettings: appSettingsSchema,
  backupMetadata: backupMetadataSchema
} as const
