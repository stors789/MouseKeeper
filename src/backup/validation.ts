import { z, type ZodType } from 'zod'

import { APP_CONFIG } from '../config/app'
import {
  entitySchemas,
  idSchema,
  instantToLocalDateTime,
  isoInstantSchema,
  normalizeText
} from '../domain'
import type {
  CageAssignment,
  ExperimentAssignment,
  Mouse
} from '../domain'
import { calculateBackupChecksum } from './canonical'
import { prepareRestoredData } from './normalize'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLE_NAMES,
  BackupValidationError,
  DEFAULT_MAX_BACKUP_BYTES
} from './types'
import type {
  BackupData,
  BackupEnvelope,
  BackupInput,
  BackupIssue,
  BackupTableCounts,
  BackupTableName,
  BackupValidationOptions,
  ValidatedBackup
} from './types'

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const MAX_JSON_DEPTH = 100

const envelopeSchema = z
  .object({
    format: z.string(),
    backupFormatVersion: z.number().int().positive(),
    schemaVersion: z.number().int().positive(),
    appVersion: z.string().trim().min(1).max(256),
    exportedAt: isoInstantSchema,
    backupId: idSchema,
    databaseInstanceId: idSchema,
    tableCounts: z.record(z.string(), z.number().int().nonnegative()),
    integrity: z
      .object({
        algorithm: z.literal('SHA-256'),
        canonicalPayloadDigest: z.string().regex(/^[0-9a-f]{64}$/)
      })
      .strict(),
    data: z.record(z.string(), z.array(z.unknown()))
  })
  .strict()

const schemasByTable: Record<BackupTableName, ZodType> = entitySchemas

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function issue(
  code: BackupIssue['code'],
  message: string,
  details: Partial<Omit<BackupIssue, 'severity' | 'code' | 'message'>> = {},
  severity: BackupIssue['severity'] = 'error'
): BackupIssue {
  return { severity, code, message, ...details }
}

function assertSafeJson(value: unknown, path = '$', depth = 0): void {
  if (depth > MAX_JSON_DEPTH) {
    throw new BackupValidationError([
      issue('unsafe-json', `JSON nesting exceeds ${MAX_JSON_DEPTH}`, { path })
    ])
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertSafeJson(item, `${path}[${index}]`, depth + 1)
    )
    return
  }
  if (!isRecord(value)) {
    return
  }
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new BackupValidationError([
        issue('unsafe-json', `Forbidden JSON key "${key}"`, {
          path: `${path}.${key}`
        })
      ])
    }
    assertSafeJson(item, `${path}.${key}`, depth + 1)
  }
}

async function readBackupInput(
  input: BackupInput,
  maxBytes: number
): Promise<{ text: string; size: number }> {
  let bytes: Uint8Array

  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input)
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input)
  } else if (input instanceof Uint8Array) {
    bytes = input
  } else {
    if (input.size > maxBytes) {
      throw new BackupValidationError([
        issue(
          'file-too-large',
          `Backup is ${input.size} bytes; limit is ${maxBytes} bytes`
        )
      ])
    }
    bytes = new Uint8Array(await input.arrayBuffer())
  }

  if (bytes.byteLength > maxBytes) {
    throw new BackupValidationError([
      issue(
        'file-too-large',
        `Backup is ${bytes.byteLength} bytes; limit is ${maxBytes} bytes`
      )
    ])
  }

  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      size: bytes.byteLength
    }
  } catch {
    throw new BackupValidationError([
      issue('invalid-utf8', 'Backup is not valid UTF-8')
    ])
  }
}

function checkRequiredTables(
  value: unknown,
  container: 'data' | 'tableCounts'
): BackupIssue[] {
  if (!isRecord(value)) {
    return [
      issue('invalid-envelope', `${container} must be an object`, {
        path: container
      })
    ]
  }

  const issues: BackupIssue[] = []
  const expected = new Set<string>(BACKUP_TABLE_NAMES)
  for (const table of BACKUP_TABLE_NAMES) {
    if (!(table in value)) {
      issues.push(
        issue('missing-table', `${container} is missing ${table}`, {
          path: `${container}.${table}`,
          table
        })
      )
    } else if (
      container === 'data' &&
      !Array.isArray(value[table])
    ) {
      issues.push(
        issue('invalid-envelope', `data.${table} must be an array`, {
          path: `data.${table}`,
          table
        })
      )
    }
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      issues.push(
        issue('unexpected-table', `${container} contains unknown table ${key}`, {
          path: `${container}.${key}`
        })
      )
    }
  }
  return issues
}

function validateRows(
  rawData: Record<string, unknown[]>,
  expectedSchemaVersion: number
): { data: BackupData; issues: BackupIssue[] } {
  const issues: BackupIssue[] = []

  for (const table of BACKUP_TABLE_NAMES) {
    const seenIds = new Set<string>()
    rawData[table]?.forEach((row, index) => {
      const rowId =
        isRecord(row) && typeof row.id === 'string' ? row.id : undefined
      if (rowId) {
        if (seenIds.has(rowId)) {
          issues.push(
            issue(
              'duplicate-primary-key',
              `${table} contains duplicate id ${rowId}`,
              {
                table,
                recordId: rowId,
                path: `data.${table}[${index}].id`
              }
            )
          )
        }
        seenIds.add(rowId)
      }

      const result = schemasByTable[table].safeParse(row)
      if (!result.success) {
        for (const zodIssue of result.error.issues.slice(0, 5)) {
          issues.push(
            issue(
              'invalid-row',
              `${table}[${index}]: ${zodIssue.message}`,
              {
                table,
                recordId: rowId,
                path: `data.${table}[${index}]${
                  zodIssue.path.length > 0
                    ? `.${zodIssue.path.join('.')}`
                    : ''
                }`
              }
            )
          )
        }
      } else if (isRecord(row)) {
        if (row.schemaVersion !== expectedSchemaVersion) {
          issues.push(
            issue(
              'invalid-row',
              `${table}[${index}] schemaVersion does not match the backup envelope`,
              {
                table,
                recordId: rowId,
                path: `data.${table}[${index}].schemaVersion`
              }
            )
          )
        }
        if (
          typeof row.createdAt === 'string' &&
          typeof row.updatedAt === 'string' &&
          row.createdAt > row.updatedAt
        ) {
          issues.push(
            issue(
              'invalid-row',
              `${table}[${index}] updatedAt precedes createdAt`,
              { table, recordId: rowId }
            )
          )
        }
        if (
          typeof row.deletedAt === 'string' &&
          typeof row.updatedAt === 'string' &&
          row.deletedAt > row.updatedAt
        ) {
          issues.push(
            issue(
              'invalid-row',
              `${table}[${index}] deletedAt follows updatedAt`,
              { table, recordId: rowId }
            )
          )
        }
      }
    })
  }

  return {
    data: rawData as unknown as BackupData,
    issues
  }
}

function addMissingReference(
  issues: BackupIssue[],
  table: BackupTableName,
  recordId: string,
  field: string,
  targetId: string,
  targetTable: BackupTableName,
  severity: BackupIssue['severity'] = 'error'
): void {
  issues.push(
    issue(
      'missing-reference',
      `${table}.${field} references missing ${targetTable} record ${targetId}`,
      {
        table,
        recordId,
        relatedIds: [targetId],
        path: `data.${table}.${recordId}.${field}`
      },
      severity
    )
  )
}

function checkReference(
  issues: BackupIssue[],
  ids: ReadonlySet<string>,
  table: BackupTableName,
  recordId: string,
  field: string,
  targetId: string | undefined,
  targetTable: BackupTableName,
  severity: BackupIssue['severity'] = 'error'
): void {
  if (targetId && !ids.has(targetId)) {
    addMissingReference(
      issues,
      table,
      recordId,
      field,
      targetId,
      targetTable,
      severity
    )
  }
}

function checkUniqueValues<T>(
  issues: BackupIssue[],
  table: BackupTableName,
  records: readonly T[],
  label: string,
  getId: (record: T) => string,
  getValue: (record: T) => string | undefined
): void {
  const seen = new Map<string, string>()
  for (const record of records) {
    const value = getValue(record)
    if (!value) {
      continue
    }
    const previous = seen.get(value)
    if (previous) {
      issues.push(
        issue(
          'duplicate-active-relation',
          `${table} duplicates ${label} "${value}"`,
          {
            table,
            recordId: getId(record),
            relatedIds: [previous, getId(record)]
          }
        )
      )
    } else {
      seen.set(value, getId(record))
    }
  }
}

function checkPedigreeCycles(mice: readonly Mouse[]): BackupIssue[] {
  const mouseById = new Map(mice.map(mouse => [mouse.id, mouse]))
  const state = new Map<string, 'visiting' | 'done'>()
  const issues: BackupIssue[] = []

  const visit = (mouseId: string, path: string[]): void => {
    if (state.get(mouseId) === 'done') {
      return
    }
    if (state.get(mouseId) === 'visiting') {
      const start = path.indexOf(mouseId)
      const cycle = [...path.slice(Math.max(0, start)), mouseId]
      issues.push(
        issue('relation-mismatch', `Pedigree cycle: ${cycle.join(' -> ')}`, {
          table: 'mice',
          recordId: mouseId,
          relatedIds: cycle
        })
      )
      return
    }
    const mouse = mouseById.get(mouseId)
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

  mice.forEach(mouse => visit(mouse.id, []))
  return issues
}

function checkDerivedFields(
  original: BackupData,
  prepared: BackupData
): BackupIssue[] {
  const issues: BackupIssue[] = []
  const fieldsByTable: Partial<
    Record<BackupTableName, readonly string[]>
  > = {
    mice: [
      'normalizedEarTag',
      'activeEarTagKey',
      'normalizedExperimentNumber',
      'normalizedAlias',
      'strainKey',
      'genotypeKey',
      'currentCageId'
    ],
    cages: [
      'normalizedCageNumber',
      'activeCageNumberKey',
      'roomKey',
      'rackKey'
    ],
    cageAssignments: ['activeFlag', 'activeMouseKey'],
    breedingPairs: ['activePairKey'],
    litters: ['normalizedLitterNumber', 'activeLitterKey'],
    experiments: [
      'normalizedCode',
      'normalizedName',
      'activeExperimentCodeKey'
    ],
    experimentGroups: ['normalizedName', 'activeGroupNameKey'],
    experimentAssignments: [
      'activeFlag',
      'activeGroupMouseKey',
      'activeExclusionMouseKey'
    ],
    tags: ['normalizedName', 'activeNameKey'],
    savedViews: ['normalizedName', 'activeScopeNameKey']
  }

  for (const table of BACKUP_TABLE_NAMES) {
    const fields = fieldsByTable[table]
    if (!fields) {
      continue
    }
    const preparedById = new Map(
      prepared[table].map(record => [record.id, record])
    )
    for (const record of original[table]) {
      const normalized = preparedById.get(record.id)
      if (!normalized) {
        continue
      }
      for (const field of fields) {
        const currentValue = (
          record as unknown as Record<string, unknown>
        )[field]
        const expectedValue = (
          normalized as unknown as Record<string, unknown>
        )[field]
        if (currentValue !== expectedValue) {
          issues.push(
            issue(
              'relation-mismatch',
              `${table}.${field} does not match its authoritative fields`,
              {
                table,
                recordId: record.id,
                path: `data.${table}.${record.id}.${field}`
              }
            )
          )
        }
      }
    }
  }
  return issues
}

function validateReferences(data: BackupData): BackupIssue[] {
  const issues: BackupIssue[] = []
  const mouseById = new Map(data.mice.map(mouse => [mouse.id, mouse]))
  const mouseIds = new Set(mouseById.keys())
  const cageById = new Map(data.cages.map(cage => [cage.id, cage]))
  const cageIds = new Set(cageById.keys())
  const pairById = new Map(data.breedingPairs.map(pair => [pair.id, pair]))
  const pairIds = new Set(pairById.keys())
  const litterById = new Map(data.litters.map(litter => [litter.id, litter]))
  const litterIds = new Set(litterById.keys())
  const experimentById = new Map(
    data.experiments.map(experiment => [experiment.id, experiment])
  )
  const experimentIds = new Set(experimentById.keys())
  const groupById = new Map(
    data.experimentGroups.map(group => [group.id, group])
  )
  const groupIds = new Set(groupById.keys())
  const eventById = new Map(data.mouseEvents.map(event => [event.id, event]))
  const eventIds = new Set(eventById.keys())
  const tagIds = new Set(data.tags.map(tag => tag.id))

  for (const mouse of data.mice) {
    checkReference(
      issues,
      mouseIds,
      'mice',
      mouse.id,
      'sireId',
      mouse.sireId,
      'mice'
    )
    for (const [role, parentId] of [
      ['sire', mouse.sireId],
      ['dam', mouse.damId]
    ] as const) {
      const parent = parentId ? mouseById.get(parentId) : undefined
      if (
        parent?.birthDate &&
        mouse.birthDate &&
        mouse.birthDate < parent.birthDate
      ) {
        issues.push(
          issue(
            'relation-mismatch',
            `Mouse birth date precedes ${role} birth date`,
            {
              table: 'mice',
              recordId: mouse.id,
              relatedIds: [parent.id]
            }
          )
        )
      }
    }
    checkReference(
      issues,
      mouseIds,
      'mice',
      mouse.id,
      'damId',
      mouse.damId,
      'mice'
    )
    checkReference(
      issues,
      litterIds,
      'mice',
      mouse.id,
      'litterId',
      mouse.litterId,
      'litters'
    )
    checkReference(
      issues,
      cageIds,
      'mice',
      mouse.id,
      'currentCageId',
      mouse.currentCageId,
      'cages'
    )
    for (const tagId of mouse.tagIds) {
      checkReference(
        issues,
        tagIds,
        'mice',
        mouse.id,
        'tagIds',
        tagId,
        'tags'
      )
    }
    const litter = mouse.litterId
      ? litterById.get(mouse.litterId)
      : undefined
    if (
      litter &&
      (mouse.sireId !== litter.sireId ||
        mouse.damId !== litter.damId ||
        mouse.birthDate !== litter.bornOn)
    ) {
      issues.push(
        issue(
          'relation-mismatch',
          'Mouse litter link does not match the litter parents and birth date',
          {
            table: 'mice',
            recordId: mouse.id,
            relatedIds: [litter.id]
          }
        )
      )
    }
  }
  issues.push(...checkPedigreeCycles(data.mice))

  const activeCageByMouse = new Map<string, CageAssignment>()
  for (const assignment of data.cageAssignments) {
    checkReference(
      issues,
      mouseIds,
      'cageAssignments',
      assignment.id,
      'mouseId',
      assignment.mouseId,
      'mice'
    )
    checkReference(
      issues,
      cageIds,
      'cageAssignments',
      assignment.id,
      'cageId',
      assignment.cageId,
      'cages'
    )
    checkReference(
      issues,
      eventIds,
      'cageAssignments',
      assignment.id,
      'startedEventId',
      assignment.startedEventId,
      'mouseEvents'
    )
    checkReference(
      issues,
      eventIds,
      'cageAssignments',
      assignment.id,
      'endedEventId',
      assignment.endedEventId,
      'mouseEvents'
    )
    if (assignment.activeFlag === 1 && assignment.deletedFlag === 0) {
      const previous = activeCageByMouse.get(assignment.mouseId)
      if (previous) {
        issues.push(
          issue(
            'duplicate-active-relation',
            `Mouse ${assignment.mouseId} has multiple active cages`,
            {
              table: 'cageAssignments',
              recordId: assignment.id,
              relatedIds: [previous.id, assignment.id, assignment.mouseId]
            }
          )
        )
      } else {
        activeCageByMouse.set(assignment.mouseId, assignment)
      }
      if (
        mouseById.get(assignment.mouseId)?.deletedFlag === 1 ||
        cageById.get(assignment.cageId)?.deletedFlag === 1
      ) {
        issues.push(
          issue(
            'relation-mismatch',
            'An active cage assignment cannot reference a deleted record',
            {
              table: 'cageAssignments',
              recordId: assignment.id
            }
          )
        )
      }
      const cage = cageById.get(assignment.cageId)
      if (cage?.status === 'inactive' || cage?.status === 'retired') {
        issues.push(
          issue(
            'relation-mismatch',
            'An active cage assignment cannot reference an inactive or retired cage',
            {
              table: 'cageAssignments',
              recordId: assignment.id,
              relatedIds: [cage.id]
            }
          )
        )
      }
    }
  }

  for (const mouse of data.mice) {
    const activeCageId = activeCageByMouse.get(mouse.id)?.cageId
    if (mouse.currentCageId !== activeCageId) {
      issues.push(
        issue(
          'relation-mismatch',
          'Mouse currentCageId does not match its active assignment',
          {
            table: 'mice',
            recordId: mouse.id,
            relatedIds: [mouse.currentCageId, activeCageId].filter(
              (value): value is string => value !== undefined
            )
          }
        )
      )
    }
  }

  for (const pair of data.breedingPairs) {
    checkReference(
      issues,
      mouseIds,
      'breedingPairs',
      pair.id,
      'sireId',
      pair.sireId,
      'mice'
    )
    if (
      pair.deletedFlag === 0 &&
      (pair.status === 'planned' || pair.status === 'active') &&
      (mouseById.get(pair.sireId)?.deletedFlag === 1 ||
        mouseById.get(pair.damId)?.deletedFlag === 1)
    ) {
      issues.push(
        issue(
          'relation-mismatch',
          'An active breeding pair cannot reference a deleted mouse',
          { table: 'breedingPairs', recordId: pair.id }
        )
      )
    }
    checkReference(
      issues,
      mouseIds,
      'breedingPairs',
      pair.id,
      'damId',
      pair.damId,
      'mice'
    )
    for (const [role, parentId] of [
      ['sire', pair.sireId],
      ['dam', pair.damId]
    ] as const) {
      const parent = mouseById.get(parentId)
      if (parent?.birthDate && pair.pairedOn < parent.birthDate) {
        issues.push(
          issue(
            'relation-mismatch',
            `Breeding pair date precedes ${role} birth date`,
            {
              table: 'breedingPairs',
              recordId: pair.id,
              relatedIds: [parent.id]
            }
          )
        )
      }
    }
  }

  for (const litter of data.litters) {
    checkReference(
      issues,
      pairIds,
      'litters',
      litter.id,
      'breedingPairId',
      litter.breedingPairId,
      'breedingPairs'
    )
    checkReference(
      issues,
      mouseIds,
      'litters',
      litter.id,
      'sireId',
      litter.sireId,
      'mice'
    )
    checkReference(
      issues,
      mouseIds,
      'litters',
      litter.id,
      'damId',
      litter.damId,
      'mice'
    )
    const pair = pairById.get(litter.breedingPairId)
    if (
      pair &&
      (pair.sireId !== litter.sireId || pair.damId !== litter.damId)
    ) {
      issues.push(
        issue(
          'relation-mismatch',
          'Litter parent snapshots do not match its breeding pair',
          { table: 'litters', recordId: litter.id }
        )
      )
    }
  }

  for (const group of data.experimentGroups) {
    checkReference(
      issues,
      experimentIds,
      'experimentGroups',
      group.id,
      'experimentId',
      group.experimentId,
      'experiments'
    )
  }

  const activeExperimentKeys = new Map<string, ExperimentAssignment>()
  for (const assignment of data.experimentAssignments) {
    checkReference(
      issues,
      mouseIds,
      'experimentAssignments',
      assignment.id,
      'mouseId',
      assignment.mouseId,
      'mice'
    )
    checkReference(
      issues,
      experimentIds,
      'experimentAssignments',
      assignment.id,
      'experimentId',
      assignment.experimentId,
      'experiments'
    )
    checkReference(
      issues,
      groupIds,
      'experimentAssignments',
      assignment.id,
      'groupId',
      assignment.groupId,
      'experimentGroups'
    )
    const group = groupById.get(assignment.groupId)
    if (group && group.experimentId !== assignment.experimentId) {
      issues.push(
        issue(
          'relation-mismatch',
          'Experiment assignment group belongs to another experiment',
          { table: 'experimentAssignments', recordId: assignment.id }
        )
      )
    }
    if (assignment.activeFlag === 1 && assignment.deletedFlag === 0) {
      if (
        mouseById.get(assignment.mouseId)?.deletedFlag === 1 ||
        experimentById.get(assignment.experimentId)?.deletedFlag === 1 ||
        groupById.get(assignment.groupId)?.deletedFlag === 1
      ) {
        issues.push(
          issue(
            'relation-mismatch',
            'An active experiment assignment cannot reference a deleted record',
            {
              table: 'experimentAssignments',
              recordId: assignment.id
            }
          )
        )
      }
      for (const key of [
        assignment.activeGroupMouseKey,
        assignment.activeExclusionMouseKey
      ]) {
        if (!key) {
          continue
        }
        const previous = activeExperimentKeys.get(key)
        if (previous) {
          issues.push(
            issue(
              'duplicate-active-relation',
              `Experiment assignment duplicates active key ${key}`,
              {
                table: 'experimentAssignments',
                recordId: assignment.id,
                relatedIds: [previous.id, assignment.id]
              }
            )
          )
        } else {
          activeExperimentKeys.set(key, assignment)
        }
      }
    }
  }

  for (const event of data.mouseEvents) {
    checkReference(
      issues,
      mouseIds,
      'mouseEvents',
      event.id,
      'mouseId',
      event.mouseId,
      'mice'
    )
    checkReference(
      issues,
      cageIds,
      'mouseEvents',
      event.id,
      'cageId',
      event.cageId,
      'cages'
    )
    checkReference(
      issues,
      experimentIds,
      'mouseEvents',
      event.id,
      'experimentId',
      event.experimentId,
      'experiments'
    )
    if (event.normalizedTitle !== normalizeText(event.title)) {
      issues.push(
        issue(
          'relation-mismatch',
          'MouseEvent normalizedTitle does not match title',
          { table: 'mouseEvents', recordId: event.id }
        )
      )
    }
    try {
      const actualLocalTime = instantToLocalDateTime(
        event.occurredAt,
        event.timeZone
      )
      if (
        actualLocalTime.date !== event.occurredOn ||
        (event.occurredTime !== undefined &&
          actualLocalTime.time !== event.occurredTime)
      ) {
        issues.push(
          issue(
            'relation-mismatch',
            'MouseEvent date, time, timeZone, and occurredAt disagree',
            { table: 'mouseEvents', recordId: event.id }
          )
        )
      }
    } catch {
      issues.push(
        issue(
          'invalid-row',
          'MouseEvent has an invalid timeZone or wall-clock value',
          { table: 'mouseEvents', recordId: event.id }
        )
      )
    }
  }

  const weightByEventId = new Map<string, string>()
  for (const weight of data.weightRecords) {
    checkReference(
      issues,
      mouseIds,
      'weightRecords',
      weight.id,
      'mouseId',
      weight.mouseId,
      'mice'
    )
    checkReference(
      issues,
      eventIds,
      'weightRecords',
      weight.id,
      'eventId',
      weight.eventId,
      'mouseEvents'
    )
    const event = eventById.get(weight.eventId)
    try {
      const actualLocalTime = instantToLocalDateTime(
        weight.measuredAt,
        weight.timeZone
      )
      if (
        actualLocalTime.date !== weight.measuredOn ||
        (weight.measuredTime !== undefined &&
          actualLocalTime.time !== weight.measuredTime)
      ) {
        issues.push(
          issue(
            'relation-mismatch',
            'WeightRecord date, time, timeZone, and measuredAt disagree',
            { table: 'weightRecords', recordId: weight.id }
          )
        )
      }
    } catch {
      issues.push(
        issue(
          'invalid-row',
          'WeightRecord has an invalid timeZone or wall-clock value',
          { table: 'weightRecords', recordId: weight.id }
        )
      )
    }
    if (
      event &&
      (event.eventType !== 'weight' ||
        event.mouseId !== weight.mouseId ||
        event.sourceId !== weight.id)
    ) {
      issues.push(
        issue(
          'relation-mismatch',
          'WeightRecord and MouseEvent are not a one-to-one pair',
          {
            table: 'weightRecords',
            recordId: weight.id,
            relatedIds: [weight.eventId]
          }
        )
      )
    }
    const previous = weightByEventId.get(weight.eventId)
    if (previous) {
      issues.push(
        issue(
          'duplicate-active-relation',
          `Multiple weight records reference event ${weight.eventId}`,
          {
            table: 'weightRecords',
            recordId: weight.id,
            relatedIds: [previous, weight.id]
          }
        )
      )
    } else {
      weightByEventId.set(weight.eventId, weight.id)
    }
  }
  for (const event of data.mouseEvents) {
    if (event.eventType === 'weight' && !weightByEventId.has(event.id)) {
      issues.push(
        issue(
          'relation-mismatch',
          'Weight event has no matching WeightRecord',
          { table: 'mouseEvents', recordId: event.id }
        )
      )
    }
  }

  for (const task of data.tasks) {
    checkReference(
      issues,
      mouseIds,
      'tasks',
      task.id,
      'mouseId',
      task.mouseId,
      'mice',
      'warning'
    )
    checkReference(
      issues,
      cageIds,
      'tasks',
      task.id,
      'cageId',
      task.cageId,
      'cages',
      'warning'
    )
    checkReference(
      issues,
      experimentIds,
      'tasks',
      task.id,
      'experimentId',
      task.experimentId,
      'experiments',
      'warning'
    )
    const expectedDueSortKey = `${task.dueDate}T${
      task.dueTime ?? '23:59'
    }`
    if (task.dueSortKey !== expectedDueSortKey) {
      issues.push(
        issue(
          'relation-mismatch',
          'Task dueSortKey does not match dueDate and dueTime',
          { table: 'tasks', recordId: task.id }
        )
      )
    }
  }

  checkUniqueValues(
    issues,
    'mice',
    data.mice,
    'active ear tag',
    record => record.id,
    record => record.activeEarTagKey
  )
  checkUniqueValues(
    issues,
    'cages',
    data.cages,
    'active cage number',
    record => record.id,
    record => record.activeCageNumberKey
  )
  checkUniqueValues(
    issues,
    'breedingPairs',
    data.breedingPairs,
    'active breeding pair',
    record => record.id,
    record => record.activePairKey
  )
  checkUniqueValues(
    issues,
    'litters',
    data.litters,
    'active litter number',
    record => record.id,
    record => record.activeLitterKey
  )
  checkUniqueValues(
    issues,
    'experiments',
    data.experiments,
    'active experiment code',
    record => record.id,
    record => record.activeExperimentCodeKey
  )
  checkUniqueValues(
    issues,
    'experimentGroups',
    data.experimentGroups,
    'active experiment group name',
    record => record.id,
    record => record.activeGroupNameKey
  )
  checkUniqueValues(
    issues,
    'tags',
    data.tags,
    'active tag name',
    record => record.id,
    record => record.activeNameKey
  )
  checkUniqueValues(
    issues,
    'savedViews',
    data.savedViews,
    'active saved view name',
    record => record.id,
    record => record.activeScopeNameKey
  )
  checkUniqueValues(
    issues,
    'activityLogs',
    data.activityLogs,
    'operationId',
    record => record.id,
    record => record.operationId
  )

  if (data.appSettings.length > 1) {
    issues.push(
      issue('duplicate-active-relation', 'AppSettings must be a singleton', {
        table: 'appSettings'
      })
    )
  }

  const prepared = prepareRestoredData(data)
  issues.push(...checkDerivedFields(data, prepared))
  return issues
}

function countTables(data: BackupData): BackupTableCounts {
  return Object.fromEntries(
    BACKUP_TABLE_NAMES.map(table => [table, data[table].length])
  ) as BackupTableCounts
}

function hasErrors(issues: readonly BackupIssue[]): boolean {
  return issues.some(item => item.severity === 'error')
}

export async function parseAndValidateBackup(
  input: BackupInput,
  options: BackupValidationOptions = {}
): Promise<ValidatedBackup> {
  const maxBytes = Math.max(
    0,
    Math.min(
      options.maxBytes ?? DEFAULT_MAX_BACKUP_BYTES,
      DEFAULT_MAX_BACKUP_BYTES
    )
  )
  const currentSchemaVersion = APP_CONFIG.schemaVersion
  const { text, size } = await readBackupInput(input, maxBytes)

  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    throw new BackupValidationError([
      issue('invalid-json', 'Backup JSON is truncated or malformed')
    ])
  }
  assertSafeJson(raw)

  const earlyIssues: BackupIssue[] = []
  if (isRecord(raw)) {
    earlyIssues.push(...checkRequiredTables(raw.data, 'data'))
    earlyIssues.push(...checkRequiredTables(raw.tableCounts, 'tableCounts'))
  }
  if (hasErrors(earlyIssues)) {
    throw new BackupValidationError(earlyIssues)
  }

  const envelopeResult = envelopeSchema.safeParse(raw)
  if (!envelopeResult.success) {
    throw new BackupValidationError(
      envelopeResult.error.issues.map(zodIssue =>
        issue('invalid-envelope', zodIssue.message, {
          path: zodIssue.path.join('.')
        })
      )
    )
  }

  const candidate = envelopeResult.data
  const issues: BackupIssue[] = []
  if (candidate.format !== BACKUP_FORMAT) {
    issues.push(
      issue(
        'invalid-envelope',
        `Expected format "${BACKUP_FORMAT}", received "${candidate.format}"`,
        { path: 'format' }
      )
    )
  }
  if (candidate.backupFormatVersion > BACKUP_FORMAT_VERSION) {
    issues.push(
      issue(
        'future-backup-format',
        `Backup format ${candidate.backupFormatVersion} is newer than supported ${BACKUP_FORMAT_VERSION}`,
        { path: 'backupFormatVersion' }
      )
    )
  } else if (candidate.backupFormatVersion < BACKUP_FORMAT_VERSION) {
    issues.push(
      issue(
        'unsupported-backup-format',
        `Backup format ${candidate.backupFormatVersion} requires a migration`,
        { path: 'backupFormatVersion' }
      )
    )
  }
  if (candidate.schemaVersion > currentSchemaVersion) {
    issues.push(
      issue(
        'future-schema',
        `Backup schema ${candidate.schemaVersion} is newer than supported ${currentSchemaVersion}`,
        { path: 'schemaVersion' }
      )
    )
  } else if (candidate.schemaVersion < currentSchemaVersion) {
    issues.push(
      issue(
        'unsupported-schema',
        `Backup schema ${candidate.schemaVersion} requires a migration`,
        { path: 'schemaVersion' }
      )
    )
  }

  const rawData = candidate.data
  const rowResult = validateRows(rawData, candidate.schemaVersion)
  issues.push(...rowResult.issues)
  const actualCounts = countTables(rowResult.data)
  for (const table of BACKUP_TABLE_NAMES) {
    if (candidate.tableCounts[table] !== actualCounts[table]) {
      issues.push(
        issue(
          'count-mismatch',
          `${table} count is ${actualCounts[table]}, metadata says ${candidate.tableCounts[table]}`,
          { table, path: `tableCounts.${table}` }
        )
      )
    }
  }
  if (!hasErrors(rowResult.issues)) {
    issues.push(...validateReferences(rowResult.data))
  }

  const backup: BackupEnvelope = {
    format: BACKUP_FORMAT,
    backupFormatVersion: candidate.backupFormatVersion,
    schemaVersion: candidate.schemaVersion,
    appVersion: candidate.appVersion,
    exportedAt: candidate.exportedAt,
    backupId: candidate.backupId,
    databaseInstanceId: candidate.databaseInstanceId,
    tableCounts: candidate.tableCounts as BackupTableCounts,
    integrity: candidate.integrity,
    data: rowResult.data
  }
  const actualDigest = await calculateBackupChecksum(backup)
  if (actualDigest !== backup.integrity.canonicalPayloadDigest) {
    issues.push(
      issue('checksum-mismatch', 'Backup checksum does not match its contents', {
        path: 'integrity.canonicalPayloadDigest'
      })
    )
  }

  if (hasErrors(issues)) {
    throw new BackupValidationError(issues)
  }

  return {
    backup: {
      ...backup,
      data: prepareRestoredData(backup.data)
    },
    issues,
    fileSizeBytes: size
  }
}
