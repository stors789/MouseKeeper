import type { Table } from 'dexie'

import { APP_CONFIG } from '../config/app'
import {
  activityLogSchema,
  appSettingsSchema,
  breedingPairSchema,
  buildSearchTerms,
  cageAssignmentSchema,
  cageSchema,
  compareLocalDates,
  experimentAssignmentSchema,
  experimentGroupSchema,
  experimentSchema,
  instantToLocalDateTime,
  litterSchema,
  localDateTimeToInstant,
  makeActiveKey,
  makeCompositeKey,
  mouseDisplayLabel,
  mouseEventSchema,
  mouseSchema,
  normalizeOptionalText,
  normalizeText,
  tagSchema,
  taskSchema,
  weightRecordSchema
} from '../domain'
import type {
  ActivityLog,
  AppSettings,
  BreedingPair,
  Cage,
  CageAssignment,
  DataOrigin,
  EntityType,
  Experiment,
  ExperimentAssignment,
  ExperimentGroup,
  IsoInstant,
  JsonValue,
  Litter,
  Mouse,
  MouseEvent,
  StoredEntity,
  Tag,
  Task,
  WeightRecord
} from '../domain'
import {
  createMouseKeeperDatabase,
  db as defaultDatabase,
  type MouseKeeperDatabase
} from '../db'
import { ServiceError, WarningRequiredError } from './errors'
import { WARNING_CODES } from './types'
import type {
  AssignMouseToExperimentInput,
  ChangeMouseStatusInput,
  CommandContext,
  CommandResult,
  CreateBreedingPairInput,
  CreateCageInput,
  CreateExperimentGroupInput,
  CreateExperimentInput,
  CreateLitterInput,
  CreateMouseEventInput,
  CreateMouseInput,
  CreateTagInput,
  CreateTaskInput,
  DeleteSampleBatchInput,
  DeleteSampleBatchResult,
  ExperimentAssignmentValue,
  ExitExperimentAssignmentInput,
  LeaveCageInput,
  LeaveCageValue,
  LitterCreationValue,
  MoveMouseInput,
  MoveMouseValue,
  RecordWeightInput,
  RestoreCageInput,
  RestoreExperimentInput,
  RestoreMouseInput,
  RestoreTagInput,
  RestoreTaskInput,
  SampleDataResult,
  SetMouseTagsInput,
  SetTaskStatusInput,
  SoftDeleteCageInput,
  SoftDeleteExperimentInput,
  SoftDeleteMouseEventInput,
  SoftDeleteMouseInput,
  SoftDeleteTagInput,
  SoftDeleteTaskInput,
  StatusChangeValue,
  TerminateMouseInput,
  UpdateCageInput,
  UpdateBreedingPairInput,
  UpdateExperimentInput,
  UpdateMouseInput,
  UpdateMouseEventInput,
  UpdateTaskInput,
  WeightEntryValue
} from './types'

const TERMINAL_MOUSE_STATUSES = new Set(['dead', 'euthanized', 'transferred'])
const CURRENT_BREEDING_STATUSES = new Set(['planned', 'active'])
const DEFAULT_TIME_ZONE = 'UTC'

interface ActivityInput {
  action: string
  primaryEntityType: EntityType
  primaryEntityId: string
  entityRefs?: readonly (readonly [EntityType, string])[]
  summary: string
  changedFields?: readonly string[]
  resultEntityIds?: readonly string[]
  warnings?: readonly string[]
  metadata?: JsonValue
}

interface EventInput {
  id?: string
  mouse: Mouse
  eventType: MouseEvent['eventType']
  occurredOn: string
  occurredTime?: string
  timeZone?: string
  occurredAt?: IsoInstant
  cage?: Cage
  experiment?: Experiment
  title: string
  description?: string
  payload?: JsonValue
  sourceType?: EntityType
  sourceId?: string
}

function newId(): string {
  return globalThis.crypto.randomUUID()
}

function resolveNow(context: CommandContext): IsoInstant {
  return context.now ?? new Date().toISOString()
}

function resolveOrigin(context: CommandContext): DataOrigin {
  if (context.origin) {
    return context.origin
  }
  return context.sampleBatchId ? 'sample' : 'user'
}

function baseFields(
  context: CommandContext,
  id: string,
  now: IsoInstant
): StoredEntity {
  return {
    id,
    schemaVersion: APP_CONFIG.schemaVersion,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedFlag: 0,
    origin: resolveOrigin(context),
    sampleBatchId: context.sampleBatchId,
    importBatchId: context.importBatchId
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function withoutEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function warningList(
  applicable: readonly (string | false | null | undefined)[]
): string[] {
  return uniqueStrings(
    applicable.filter((warning): warning is string => typeof warning === 'string')
  )
}

function requireWarnings(
  warnings: readonly string[],
  acknowledgements: readonly string[] | undefined
): void {
  const acknowledged = new Set(acknowledgements ?? [])
  const missing = warnings.filter(warning => !acknowledged.has(warning))
  if (missing.length > 0) {
    throw new WarningRequiredError(missing)
  }
}

function dueSortKey(date: string, time?: string): string {
  return `${date}T${time ?? '23:59'}`
}

function resolveOccurredAt(
  date: string,
  time: string | undefined,
  now: IsoInstant
): IsoInstant {
  if (time) {
    return localDateTimeToInstant(date, time)
  }
  const currentLocal = instantToLocalDateTime(now)
  return localDateTimeToInstant(
    date,
    date === currentLocal.date ? currentLocal.time : '00:00'
  )
}

function entityRefKey(type: EntityType, id: string): string {
  return `${type}:${id}`
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

function containsReference(
  value: unknown,
  targetIds: ReadonlySet<string>,
  visited = new Set<object>()
): boolean {
  if (typeof value === 'string') {
    if (targetIds.has(value)) {
      return true
    }
    const separator = value.indexOf(':')
    return separator >= 0 && targetIds.has(value.slice(separator + 1))
  }
  if (typeof value !== 'object' || value === null) {
    return false
  }
  if (visited.has(value)) {
    return false
  }
  visited.add(value)
  if (Array.isArray(value)) {
    return value.some(item => containsReference(item, targetIds, visited))
  }
  return Object.values(value).some(item =>
    containsReference(item, targetIds, visited)
  )
}

export class MouseKeeperService {
  readonly database: MouseKeeperDatabase

  constructor(database: MouseKeeperDatabase = defaultDatabase) {
    this.database = database
  }

  private async activeRecord<T extends StoredEntity>(
    table: Table<T, string>,
    id: string,
    label: string
  ): Promise<T> {
    const record = await table.get(id)
    if (!record) {
      throw new ServiceError('not-found', `${label} ${id} was not found`, {
        id,
        label
      })
    }
    if (record.deletedFlag === 1) {
      throw new ServiceError('record-deleted', `${label} ${id} is deleted`, {
        id,
        label
      })
    }
    return record
  }

  private assertRevision(record: StoredEntity, expected?: number): void {
    if (expected !== undefined && record.revision !== expected) {
      throw new ServiceError(
        'revision-conflict',
        `Expected revision ${expected}, found ${record.revision}`,
        { id: record.id, expected, actual: record.revision }
      )
    }
  }

  private async operationLog(
    operationId: string,
    action: string
  ): Promise<ActivityLog | undefined> {
    const log = await this.database.activityLogs
      .where('operationId')
      .equals(operationId)
      .first()
    if (log && log.action !== action) {
      throw new ServiceError(
        'invalid-state',
        `operationId ${operationId} was already used for ${log.action}`,
        { operationId, expectedAction: action, actualAction: log.action }
      )
    }
    return log
  }

  private resultId(log: ActivityLog, index = 0): string {
    const id = log.resultEntityIds?.[index]
    if (!id) {
      throw new ServiceError(
        'integrity-error',
        `Activity log ${log.id} has no replay result at index ${index}`
      )
    }
    return id
  }

  private async addActivity(
    context: CommandContext,
    now: IsoInstant,
    input: ActivityInput
  ): Promise<ActivityLog> {
    const log: ActivityLog = activityLogSchema.parse({
      ...baseFields(context, newId(), now),
      operationId: context.operationId,
      occurredAt: now,
      action: input.action,
      primaryEntityType: input.primaryEntityType,
      primaryEntityId: input.primaryEntityId,
      primaryEntityKey: entityRefKey(
        input.primaryEntityType,
        input.primaryEntityId
      ),
      entityRefKeys: uniqueStrings(
        (input.entityRefs ?? []).map(([type, id]) => entityRefKey(type, id))
      ),
      summary: input.summary,
      changedFields: input.changedFields
        ? [...input.changedFields]
        : undefined,
      warningAcknowledgements: input.warnings
        ? [...input.warnings]
        : undefined,
      resultEntityIds: input.resultEntityIds
        ? [...input.resultEntityIds]
        : undefined,
      metadata: input.metadata
    })
    await this.database.activityLogs.add(log)
    return log
  }

  private buildEvent(
    context: CommandContext,
    now: IsoInstant,
    input: EventInput
  ): MouseEvent {
    const occurredAt =
      input.occurredAt ??
      resolveOccurredAt(input.occurredOn, input.occurredTime, now)
    const event: MouseEvent = mouseEventSchema.parse({
      ...baseFields(context, input.id ?? newId(), now),
      eventType: input.eventType,
      occurredOn: input.occurredOn,
      occurredTime: input.occurredTime,
      timeZone: input.timeZone ?? DEFAULT_TIME_ZONE,
      occurredAt,
      mouseId: input.mouse.id,
      cageId: input.cage?.id,
      experimentId: input.experiment?.id,
      title: input.title,
      normalizedTitle: normalizeText(input.title),
      description: input.description,
      payloadVersion: 1,
      payload: input.payload ?? {},
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      snapshot: {
        mouseLabel: mouseDisplayLabel(input.mouse),
        cageNumber: input.cage?.cageNumber,
        experimentName: input.experiment?.name
      },
      searchTerms: buildSearchTerms([
        input.title,
        input.description,
        mouseDisplayLabel(input.mouse),
        input.cage?.cageNumber,
        input.experiment?.name
      ])
    })
    return event
  }

  private async validateMouseRelations(mouse: Mouse): Promise<void> {
    const parents: Mouse[] = []
    for (const parentId of [mouse.sireId, mouse.damId]) {
      if (!parentId) {
        continue
      }
      const parent = await this.database.mice.get(parentId)
      if (!parent) {
        throw new ServiceError(
          'invalid-reference',
          `Parent mouse ${parentId} was not found`,
          { mouseId: mouse.id, parentId }
        )
      }
      if (
        mouse.birthDate &&
        parent.birthDate &&
        compareLocalDates(mouse.birthDate, parent.birthDate) < 0
      ) {
        throw new ServiceError(
          'invalid-state',
          'Offspring birth date cannot precede a parent birth date',
          { mouseId: mouse.id, parentId }
        )
      }
      parents.push(parent)
    }

    const visited = new Set<string>()
    const stack = parents.map(parent => parent.id)
    while (stack.length > 0) {
      const candidateId = stack.pop()
      if (!candidateId || visited.has(candidateId)) {
        continue
      }
      if (candidateId === mouse.id) {
        throw new ServiceError(
          'pedigree-cycle',
          'The parent relationship would create a pedigree cycle',
          { mouseId: mouse.id }
        )
      }
      visited.add(candidateId)
      const candidate = await this.database.mice.get(candidateId)
      if (!candidate) {
        throw new ServiceError(
          'invalid-reference',
          `Ancestor mouse ${candidateId} was not found`
        )
      }
      if (candidate.sireId) {
        stack.push(candidate.sireId)
      }
      if (candidate.damId) {
        stack.push(candidate.damId)
      }
    }

    for (const tagId of mouse.tagIds) {
      await this.activeRecord(this.database.tags, tagId, 'Tag')
    }
  }

  async createMouse(
    input: CreateMouseInput
  ): Promise<CommandResult<Mouse>> {
    const action = 'mouse.create'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.tags,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const mouse = await this.database.mice.get(this.resultId(replay))
          if (!mouse) {
            throw new ServiceError(
              'integrity-error',
              'Created mouse referenced by activity log is missing'
            )
          }
          return {
            value: mouse,
            replayed: true,
            warnings: replay.warningAcknowledgements ?? []
          }
        }

        const now = resolveNow(input)
        const id = input.id ?? newId()
        if (await this.database.mice.get(id)) {
          throw new ServiceError('duplicate-id', `Mouse ${id} already exists`)
        }
        const earTag = withoutEmpty(input.earTag)
        const normalizedEarTag = normalizeOptionalText(earTag)
        const activeEarTagKey = makeActiveKey('ear', earTag)
        if (
          activeEarTagKey &&
          (await this.database.mice
            .where('activeEarTagKey')
            .equals(activeEarTagKey)
            .first())
        ) {
          throw new ServiceError(
            'duplicate-ear-tag',
            `Ear tag ${earTag} is already in use`
          )
        }

        const mouse: Mouse = mouseSchema.parse({
          ...baseFields(input, id, now),
          earTag,
          normalizedEarTag,
          activeEarTagKey,
          experimentNumber: withoutEmpty(input.experimentNumber),
          normalizedExperimentNumber: normalizeOptionalText(
            input.experimentNumber
          ),
          name: withoutEmpty(input.name),
          alias: withoutEmpty(input.alias),
          normalizedAlias: normalizeOptionalText(input.alias ?? input.name),
          strain: input.strain,
          strainKey: normalizeText(input.strain),
          genotype: withoutEmpty(input.genotype),
          genotypeKey: normalizeOptionalText(input.genotype),
          sex: input.sex,
          birthDate: input.birthDate,
          sireId: input.sireId,
          damId: input.damId,
          litterId: input.litterId,
          status: input.status ?? 'alive',
          source: withoutEmpty(input.source),
          coatColor: withoutEmpty(input.coatColor),
          notes: input.notes,
          tagIds: uniqueStrings(input.tagIds ?? []),
          searchTerms: buildSearchTerms([
            earTag,
            input.experimentNumber,
            input.name,
            input.alias,
            input.strain,
            input.genotype,
            input.notes
          ]),
          custom: input.custom
        })

        await this.validateMouseRelations(mouse)
        await this.database.mice.add(mouse)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'mouse',
          primaryEntityId: mouse.id,
          summary: `Created mouse ${mouseDisplayLabel(mouse)}`,
          resultEntityIds: [mouse.id]
        })
        return { value: mouse, replayed: false, warnings: [] }
      }
    )
  }

  async updateMouse(
    input: UpdateMouseInput
  ): Promise<CommandResult<Mouse>> {
    const action = 'mouse.update'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.tags,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const mouse = await this.database.mice.get(this.resultId(replay))
          if (!mouse) {
            throw new ServiceError(
              'integrity-error',
              'Updated mouse referenced by activity log is missing'
            )
          }
          return { value: mouse, replayed: true, warnings: [] }
        }

        const current = await this.activeRecord(
          this.database.mice,
          input.mouseId,
          'Mouse'
        )
        this.assertRevision(current, input.expectedRevision)
        const patch = input.patch
        const earTag =
          'earTag' in patch
            ? withoutEmpty(patch.earTag)
            : current.earTag
        const activeEarTagKey = makeActiveKey('ear', earTag)
        if (activeEarTagKey && activeEarTagKey !== current.activeEarTagKey) {
          const duplicate = await this.database.mice
            .where('activeEarTagKey')
            .equals(activeEarTagKey)
            .first()
          if (duplicate && duplicate.id !== current.id) {
            throw new ServiceError(
              'duplicate-ear-tag',
              `Ear tag ${earTag} is already in use`
            )
          }
        }

        const now = resolveNow(input)
        const next: Mouse = mouseSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          earTag,
          normalizedEarTag: normalizeOptionalText(earTag),
          activeEarTagKey,
          experimentNumber:
            'experimentNumber' in patch
              ? withoutEmpty(patch.experimentNumber)
              : current.experimentNumber,
          normalizedExperimentNumber:
            'experimentNumber' in patch
              ? normalizeOptionalText(patch.experimentNumber)
              : current.normalizedExperimentNumber,
          name:
            'name' in patch ? withoutEmpty(patch.name) : current.name,
          alias:
            'alias' in patch ? withoutEmpty(patch.alias) : current.alias,
          normalizedAlias: normalizeOptionalText(
            'alias' in patch
              ? patch.alias
              : 'name' in patch
                ? patch.name
                : current.alias ?? current.name
          ),
          strain: patch.strain ?? current.strain,
          strainKey: normalizeText(patch.strain ?? current.strain),
          genotype:
            'genotype' in patch
              ? withoutEmpty(patch.genotype)
              : current.genotype,
          genotypeKey:
            'genotype' in patch
              ? normalizeOptionalText(patch.genotype)
              : current.genotypeKey,
          sex: patch.sex ?? current.sex,
          birthDate:
            'birthDate' in patch
              ? patch.birthDate ?? undefined
              : current.birthDate,
          sireId:
            'sireId' in patch ? patch.sireId ?? undefined : current.sireId,
          damId:
            'damId' in patch ? patch.damId ?? undefined : current.damId,
          source:
            'source' in patch
              ? withoutEmpty(patch.source)
              : current.source,
          coatColor:
            'coatColor' in patch
              ? withoutEmpty(patch.coatColor)
              : current.coatColor,
          notes: 'notes' in patch ? patch.notes ?? undefined : current.notes,
          searchTerms: buildSearchTerms([
            earTag,
            'experimentNumber' in patch
              ? patch.experimentNumber
              : current.experimentNumber,
            'name' in patch ? patch.name : current.name,
            'alias' in patch ? patch.alias : current.alias,
            patch.strain ?? current.strain,
            'genotype' in patch ? patch.genotype : current.genotype,
            'notes' in patch ? patch.notes : current.notes
          ])
        })
        await this.validateMouseRelations(next)
        await this.database.mice.put(next)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'mouse',
          primaryEntityId: next.id,
          summary: `Updated mouse ${mouseDisplayLabel(next)}`,
          changedFields: Object.keys(input.patch),
          resultEntityIds: [next.id]
        })
        return { value: next, replayed: false, warnings: [] }
      }
    )
  }

  async createCage(input: CreateCageInput): Promise<CommandResult<Cage>> {
    const action = 'cage.create'
    return this.database.transaction(
      'rw',
      [this.database.cages, this.database.activityLogs],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const cage = await this.database.cages.get(this.resultId(replay))
          if (!cage) {
            throw new ServiceError(
              'integrity-error',
              'Created cage referenced by activity log is missing'
            )
          }
          return { value: cage, replayed: true, warnings: [] }
        }

        const now = resolveNow(input)
        const id = input.id ?? newId()
        if (await this.database.cages.get(id)) {
          throw new ServiceError('duplicate-id', `Cage ${id} already exists`)
        }
        const activeCageNumberKey = makeActiveKey('cage', input.cageNumber)
        if (
          activeCageNumberKey &&
          (await this.database.cages
            .where('activeCageNumberKey')
            .equals(activeCageNumberKey)
            .first())
        ) {
          throw new ServiceError(
            'duplicate-cage-number',
            `Cage number ${input.cageNumber} is already in use`
          )
        }
        const cage: Cage = cageSchema.parse({
          ...baseFields(input, id, now),
          cageNumber: input.cageNumber,
          normalizedCageNumber: normalizeText(input.cageNumber),
          activeCageNumberKey,
          room: withoutEmpty(input.room),
          roomKey: normalizeOptionalText(input.room),
          rack: withoutEmpty(input.rack),
          rackKey: normalizeOptionalText(input.rack),
          maxCapacity: input.maxCapacity,
          primaryStrain: withoutEmpty(input.primaryStrain),
          purpose: withoutEmpty(input.purpose),
          status: input.status ?? 'active',
          notes: input.notes,
          custom: input.custom
        })
        await this.database.cages.add(cage)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'cage',
          primaryEntityId: cage.id,
          summary: `Created cage ${cage.cageNumber}`,
          resultEntityIds: [cage.id]
        })
        return { value: cage, replayed: false, warnings: [] }
      }
    )
  }

  async updateCage(input: UpdateCageInput): Promise<CommandResult<Cage>> {
    const action = 'cage.update'
    return this.database.transaction(
      'rw',
      [
        this.database.cages,
        this.database.cageAssignments,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const cage = await this.database.cages.get(this.resultId(replay))
          if (!cage) {
            throw new ServiceError(
              'integrity-error',
              'Updated cage referenced by activity log is missing'
            )
          }
          return {
            value: cage,
            replayed: true,
            warnings: replay.warningAcknowledgements ?? []
          }
        }

        const current = await this.activeRecord(
          this.database.cages,
          input.cageId,
          'Cage'
        )
        this.assertRevision(current, input.expectedRevision)
        const cageNumber = input.patch.cageNumber ?? current.cageNumber
        const activeCageNumberKey = makeActiveKey('cage', cageNumber)
        if (
          activeCageNumberKey &&
          activeCageNumberKey !== current.activeCageNumberKey
        ) {
          const duplicate = await this.database.cages
            .where('activeCageNumberKey')
            .equals(activeCageNumberKey)
            .first()
          if (duplicate && duplicate.id !== current.id) {
            throw new ServiceError(
              'duplicate-cage-number',
              `Cage number ${cageNumber} is already in use`
            )
          }
        }
        const occupancy = await this.database.cageAssignments
          .where('[cageId+activeFlag]')
          .equals([current.id, 1])
          .count()
        const maxCapacity = input.patch.maxCapacity ?? current.maxCapacity
        const warnings = warningList([
          occupancy > maxCapacity && WARNING_CODES.cageCapacityExceeded
        ])
        requireWarnings(warnings, input.warningAcknowledgements)

        const now = resolveNow(input)
        const cage: Cage = cageSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          cageNumber,
          normalizedCageNumber: normalizeText(cageNumber),
          activeCageNumberKey,
          room:
            'room' in input.patch
              ? withoutEmpty(input.patch.room)
              : current.room,
          roomKey:
            'room' in input.patch
              ? normalizeOptionalText(input.patch.room)
              : current.roomKey,
          rack:
            'rack' in input.patch
              ? withoutEmpty(input.patch.rack)
              : current.rack,
          rackKey:
            'rack' in input.patch
              ? normalizeOptionalText(input.patch.rack)
              : current.rackKey,
          maxCapacity,
          primaryStrain:
            'primaryStrain' in input.patch
              ? withoutEmpty(input.patch.primaryStrain)
              : current.primaryStrain,
          purpose:
            'purpose' in input.patch
              ? withoutEmpty(input.patch.purpose)
              : current.purpose,
          status: input.patch.status ?? current.status,
          notes:
            'notes' in input.patch
              ? input.patch.notes ?? undefined
              : current.notes
        })
        await this.database.cages.put(cage)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'cage',
          primaryEntityId: cage.id,
          summary: `Updated cage ${cage.cageNumber}`,
          changedFields: Object.keys(input.patch),
          resultEntityIds: [cage.id],
          warnings
        })
        return { value: cage, replayed: false, warnings }
      }
    )
  }

  async moveMouse(
    input: MoveMouseInput
  ): Promise<CommandResult<MoveMouseValue>> {
    const action = 'cage.move-mouse'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.cages,
        this.database.cageAssignments,
        this.database.mouseEvents,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const assignment = await this.database.cageAssignments.get(
            this.resultId(replay)
          )
          const event = await this.database.mouseEvents.get(
            this.resultId(replay, 1)
          )
          const mouse = await this.database.mice.get(
            this.resultId(replay, 2)
          )
          if (!assignment || !event || !mouse) {
            throw new ServiceError(
              'integrity-error',
              'Move result referenced by activity log is incomplete'
            )
          }
          return {
            value: { assignment, event, mouse },
            replayed: true,
            warnings: replay.warningAcknowledgements ?? []
          }
        }

        const mouse = await this.activeRecord(
          this.database.mice,
          input.mouseId,
          'Mouse'
        )
        if (TERMINAL_MOUSE_STATUSES.has(mouse.status)) {
          throw new ServiceError(
            'invalid-state',
            `Mouse in ${mouse.status} status cannot be moved`
          )
        }
        const cage = await this.activeRecord(
          this.database.cages,
          input.cageId,
          'Cage'
        )
        if (cage.status === 'retired' || cage.status === 'inactive') {
          throw new ServiceError(
            'invalid-state',
            `Cage in ${cage.status} status cannot receive mice`
          )
        }
        const current = await this.database.cageAssignments
          .where('activeMouseKey')
          .equals(mouse.id)
          .first()
        if (current?.cageId === cage.id) {
          throw new ServiceError(
            'already-in-cage',
            `Mouse ${mouse.id} is already in cage ${cage.id}`
          )
        }

        const occupancy = await this.database.cageAssignments
          .where('[cageId+activeFlag]')
          .equals([cage.id, 1])
          .count()
        const warnings = warningList([
          occupancy >= cage.maxCapacity && WARNING_CODES.cageCapacityExceeded
        ])
        requireWarnings(warnings, input.warningAcknowledgements)

        const now = resolveNow(input)
        const { date, time } = instantToLocalDateTime(now)
        const event = this.buildEvent(input, now, {
          mouse,
          cage,
          eventType: 'cage-transfer',
          occurredOn: date,
          occurredTime: time,
          occurredAt: now,
          title: current ? 'Transferred cage' : 'Assigned to cage',
          description: input.reason,
          payload: {
            ...(current ? { fromCageId: current.cageId } : {}),
            toCageId: cage.id
          }
        })

        if (current) {
          const ended: CageAssignment = cageAssignmentSchema.parse({
            ...current,
            revision: current.revision + 1,
            updatedAt: now,
            endedAt: now,
            activeFlag: 0,
            activeMouseKey: undefined,
            endReason: input.reason ?? 'transfer',
            endedEventId: event.id
          })
          await this.database.cageAssignments.put(ended)
        }

        const assignment: CageAssignment = cageAssignmentSchema.parse({
          ...baseFields(input, input.id ?? newId(), now),
          mouseId: mouse.id,
          cageId: cage.id,
          startedAt: now,
          activeFlag: 1,
          activeMouseKey: mouse.id,
          startReason: input.reason ?? 'assignment',
          startedEventId: event.id,
          cageNumberSnapshot: cage.cageNumber,
          mouseLabelSnapshot: mouseDisplayLabel(mouse)
        })
        const updatedMouse: Mouse = mouseSchema.parse({
          ...mouse,
          revision: mouse.revision + 1,
          updatedAt: now,
          currentCageId: cage.id
        })

        await this.database.mouseEvents.add(event)
        await this.database.cageAssignments.add(assignment)
        await this.database.mice.put(updatedMouse)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'cageAssignment',
          primaryEntityId: assignment.id,
          entityRefs: [
            ['mouse', mouse.id],
            ['cage', cage.id]
          ],
          summary: `Moved ${mouseDisplayLabel(mouse)} to ${cage.cageNumber}`,
          resultEntityIds: [assignment.id, event.id, mouse.id],
          warnings
        })
        return {
          value: { assignment, event, mouse: updatedMouse },
          replayed: false,
          warnings
        }
      }
    )
  }

  async leaveCage(
    input: LeaveCageInput
  ): Promise<CommandResult<LeaveCageValue>> {
    const action = 'cage.leave'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.cages,
        this.database.cageAssignments,
        this.database.mouseEvents,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const assignment = await this.database.cageAssignments.get(
            this.resultId(replay)
          )
          const event = await this.database.mouseEvents.get(
            this.resultId(replay, 1)
          )
          const mouse = await this.database.mice.get(
            this.resultId(replay, 2)
          )
          if (!assignment || !event || !mouse) {
            throw new ServiceError(
              'integrity-error',
              'Leave-cage result referenced by activity log is incomplete'
            )
          }
          return {
            value: { assignment, event, mouse },
            replayed: true,
            warnings: []
          }
        }

        const mouse = await this.activeRecord(
          this.database.mice,
          input.mouseId,
          'Mouse'
        )
        const current = await this.database.cageAssignments
          .where('activeMouseKey')
          .equals(mouse.id)
          .first()
        if (!current) {
          throw new ServiceError(
            'invalid-state',
            `Mouse ${mouse.id} has no active cage assignment`
          )
        }
        const cage = await this.database.cages.get(current.cageId)
        if (!cage) {
          throw new ServiceError(
            'integrity-error',
            `Active assignment references missing cage ${current.cageId}`
          )
        }

        const now = resolveNow(input)
        const { date, time } = instantToLocalDateTime(now)
        const event = this.buildEvent(input, now, {
          mouse,
          cage,
          eventType: 'cage-transfer',
          occurredOn: date,
          occurredTime: time,
          occurredAt: now,
          title: 'Removed from cage',
          description: input.reason,
          payload: { fromCageId: cage.id }
        })
        const assignment: CageAssignment = cageAssignmentSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          endedAt: now,
          activeFlag: 0,
          activeMouseKey: undefined,
          endReason: input.reason ?? 'removed',
          endedEventId: event.id
        })
        const updatedMouse: Mouse = mouseSchema.parse({
          ...mouse,
          revision: mouse.revision + 1,
          updatedAt: now,
          currentCageId: undefined
        })
        await this.database.cageAssignments.put(assignment)
        await this.database.mouseEvents.add(event)
        await this.database.mice.put(updatedMouse)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'cageAssignment',
          primaryEntityId: assignment.id,
          entityRefs: [
            ['mouse', mouse.id],
            ['cage', cage.id]
          ],
          summary: `Removed ${mouseDisplayLabel(mouse)} from ${cage.cageNumber}`,
          resultEntityIds: [assignment.id, event.id, updatedMouse.id]
        })
        return {
          value: { assignment, event, mouse: updatedMouse },
          replayed: false,
          warnings: []
        }
      }
    )
  }

  async changeMouseStatus(
    input: ChangeMouseStatusInput
  ): Promise<CommandResult<StatusChangeValue>> {
    const action = 'mouse.change-status'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.cageAssignments,
        this.database.experimentAssignments,
        this.database.breedingPairs,
        this.database.mouseEvents,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const mouse = await this.database.mice.get(this.resultId(replay))
          const event = await this.database.mouseEvents.get(
            this.resultId(replay, 1)
          )
          if (!mouse || !event) {
            throw new ServiceError(
              'integrity-error',
              'Status change referenced by activity log is incomplete'
            )
          }
          return {
            value: { mouse, event },
            replayed: true,
            warnings: []
          }
        }

        const mouse = await this.activeRecord(
          this.database.mice,
          input.mouseId,
          'Mouse'
        )
        this.assertRevision(mouse, input.expectedRevision)
        if (mouse.status === input.status) {
          throw new ServiceError(
            'invalid-state',
            `Mouse is already in ${input.status} status`
          )
        }
        const now = resolveNow(input)
        const occurredAt = resolveOccurredAt(
          input.occurredOn,
          input.occurredTime,
          now
        )
        const terminal = TERMINAL_MOUSE_STATUSES.has(input.status)
        const currentCage = terminal
          ? await this.database.cageAssignments
              .where('activeMouseKey')
              .equals(mouse.id)
              .first()
          : undefined

        if (currentCage) {
          const ended: CageAssignment = cageAssignmentSchema.parse({
            ...currentCage,
            revision: currentCage.revision + 1,
            updatedAt: now,
            endedAt: occurredAt,
            activeFlag: 0,
            activeMouseKey: undefined,
            endReason: `status:${input.status}`
          })
          await this.database.cageAssignments.put(ended)
        }

        if (terminal) {
          const experimentAssignments =
            await this.database.experimentAssignments
              .where('[mouseId+joinedAt]')
              .between([mouse.id, ''], [mouse.id, '\uffff'])
              .filter(assignment => assignment.activeFlag === 1)
              .toArray()
          for (const assignment of experimentAssignments) {
            const ended: ExperimentAssignment =
              experimentAssignmentSchema.parse({
                ...assignment,
                revision: assignment.revision + 1,
                updatedAt: now,
                exitedAt: occurredAt,
                exitReason: `status:${input.status}`,
                activeFlag: 0,
                activeGroupMouseKey: undefined,
                activeExclusionMouseKey: undefined
              })
            await this.database.experimentAssignments.put(ended)
          }

          const pairs = await this.database.breedingPairs
            .filter(
              pair =>
                pair.deletedFlag === 0 &&
                CURRENT_BREEDING_STATUSES.has(pair.status) &&
                (pair.sireId === mouse.id || pair.damId === mouse.id)
            )
            .toArray()
          for (const pair of pairs) {
            const endedPair: BreedingPair = breedingPairSchema.parse({
              ...pair,
              revision: pair.revision + 1,
              updatedAt: now,
              status: 'completed',
              separatedOn: input.occurredOn,
              activePairKey: undefined
            })
            await this.database.breedingPairs.put(endedPair)
          }
        }

        const event = this.buildEvent(input, now, {
          mouse,
          eventType:
            input.status === 'dead'
              ? 'death'
              : input.status === 'euthanized'
                ? 'euthanasia'
                : 'status-change',
          occurredOn: input.occurredOn,
          occurredTime: input.occurredTime,
          occurredAt,
          title: `Status changed to ${input.status}`,
          description: input.reason,
          payload: { fromStatus: mouse.status, toStatus: input.status }
        })
        const updatedMouse: Mouse = mouseSchema.parse({
          ...mouse,
          revision: mouse.revision + 1,
          updatedAt: now,
          status: input.status,
          currentCageId: terminal ? undefined : mouse.currentCageId
        })
        await this.database.mice.put(updatedMouse)
        await this.database.mouseEvents.add(event)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'mouse',
          primaryEntityId: mouse.id,
          entityRefs: [['mouseEvent', event.id]],
          summary: `Changed ${mouseDisplayLabel(mouse)} status from ${mouse.status} to ${input.status}`,
          changedFields: ['status'],
          resultEntityIds: [updatedMouse.id, event.id]
        })
        return {
          value: { mouse: updatedMouse, event },
          replayed: false,
          warnings: []
        }
      }
    )
  }

  async terminateMouse(
    input: TerminateMouseInput
  ): Promise<CommandResult<StatusChangeValue>> {
    return this.changeMouseStatus(input)
  }

  async createBreedingPair(
    input: CreateBreedingPairInput
  ): Promise<CommandResult<BreedingPair>> {
    const action = 'breeding-pair.create'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.breedingPairs,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const pair = await this.database.breedingPairs.get(
            this.resultId(replay)
          )
          if (!pair) {
            throw new ServiceError(
              'integrity-error',
              'Breeding pair referenced by activity log is missing'
            )
          }
          return {
            value: pair,
            replayed: true,
            warnings: replay.warningAcknowledgements ?? []
          }
        }

        const sire = await this.activeRecord(
          this.database.mice,
          input.sireId,
          'Sire'
        )
        const dam = await this.activeRecord(
          this.database.mice,
          input.damId,
          'Dam'
        )
        if (sire.id === dam.id) {
          throw new ServiceError(
            'invalid-state',
            'Sire and dam must be different mice'
          )
        }
        const status = input.status ?? 'active'
        const current = CURRENT_BREEDING_STATUSES.has(status)
        const activePairKey = current
          ? makeCompositeKey('pair', sire.id, dam.id)
          : undefined
        if (
          activePairKey &&
          (await this.database.breedingPairs
            .where('activePairKey')
            .equals(activePairKey)
            .first())
        ) {
          throw new ServiceError(
            'duplicate-breeding-pair',
            'This breeding pair already has a current record'
          )
        }
        const historicalDuplicate = await this.database.breedingPairs
          .filter(
            pair =>
              pair.sireId === sire.id &&
              pair.damId === dam.id &&
              pair.deletedFlag === 0
          )
          .first()
        const warnings = warningList([
          sire.sex !== 'male' && WARNING_CODES.sireSexMismatch,
          dam.sex !== 'female' && WARNING_CODES.damSexMismatch,
          (TERMINAL_MOUSE_STATUSES.has(sire.status) ||
            TERMINAL_MOUSE_STATUSES.has(dam.status)) &&
            WARNING_CODES.unavailableBreedingMouse,
          historicalDuplicate && WARNING_CODES.duplicateBreedingHistory
        ])
        requireWarnings(warnings, input.warningAcknowledgements)

        const now = resolveNow(input)
        const pair: BreedingPair = breedingPairSchema.parse({
          ...baseFields(input, input.id ?? newId(), now),
          sireId: sire.id,
          damId: dam.id,
          pairedOn: input.pairedOn,
          expectedDeliveryDate: input.expectedDeliveryDate,
          status,
          activePairKey,
          notes: input.notes,
          warningAcknowledgements: warnings
        })
        await this.database.breedingPairs.add(pair)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'breedingPair',
          primaryEntityId: pair.id,
          entityRefs: [
            ['mouse', sire.id],
            ['mouse', dam.id]
          ],
          summary: `Created breeding pair ${mouseDisplayLabel(sire)} × ${mouseDisplayLabel(dam)}`,
          resultEntityIds: [pair.id],
          warnings
        })
        return { value: pair, replayed: false, warnings }
      }
    )
  }

  async updateBreedingPair(
    input: UpdateBreedingPairInput
  ): Promise<CommandResult<BreedingPair>> {
    const action = 'breeding-pair.update'
    return this.database.transaction(
      'rw',
      [this.database.breedingPairs, this.database.activityLogs],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const pair = await this.database.breedingPairs.get(
            this.resultId(replay)
          )
          if (!pair) {
            throw new ServiceError(
              'integrity-error',
              'Updated breeding pair referenced by activity log is missing'
            )
          }
          return { value: pair, replayed: true, warnings: [] }
        }

        const current = await this.activeRecord(
          this.database.breedingPairs,
          input.breedingPairId,
          'Breeding pair'
        )
        this.assertRevision(current, input.expectedRevision)
        const status = input.patch.status ?? current.status
        const activePairKey = CURRENT_BREEDING_STATUSES.has(status)
          ? makeCompositeKey('pair', current.sireId, current.damId)
          : undefined
        if (activePairKey) {
          const duplicate = await this.database.breedingPairs
            .where('activePairKey')
            .equals(activePairKey)
            .filter(pair => pair.id !== current.id)
            .first()
          if (duplicate) {
            throw new ServiceError(
              'duplicate-breeding-pair',
              'This breeding pair already has another current record'
            )
          }
        }

        const now = resolveNow(input)
        const next: BreedingPair = breedingPairSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          pairedOn: input.patch.pairedOn ?? current.pairedOn,
          separatedOn:
            input.patch.separatedOn === null
              ? undefined
              : (input.patch.separatedOn ?? current.separatedOn),
          expectedDeliveryDate:
            input.patch.expectedDeliveryDate === null
              ? undefined
              : (input.patch.expectedDeliveryDate ??
                current.expectedDeliveryDate),
          status,
          activePairKey,
          notes:
            input.patch.notes === null
              ? undefined
              : (input.patch.notes ?? current.notes)
        })
        await this.database.breedingPairs.put(next)
        const changedFields = Object.keys(input.patch)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'breedingPair',
          primaryEntityId: next.id,
          entityRefs: [
            ['mouse', next.sireId],
            ['mouse', next.damId]
          ],
          summary: `Updated breeding pair ${next.id}`,
          changedFields,
          resultEntityIds: [next.id]
        })
        return { value: next, replayed: false, warnings: [] }
      }
    )
  }

  async createLitterWithOffspring(
    input: CreateLitterInput
  ): Promise<CommandResult<LitterCreationValue>> {
    const action = 'litter.create-with-offspring'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.breedingPairs,
        this.database.litters,
        this.database.mouseEvents,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const litter = await this.database.litters.get(this.resultId(replay))
          if (!litter) {
            throw new ServiceError(
              'integrity-error',
              'Litter referenced by activity log is missing'
            )
          }
          const offspring = await this.database.mice
            .where('litterId')
            .equals(litter.id)
            .toArray()
          return {
            value: { litter, offspring },
            replayed: true,
            warnings: []
          }
        }

        const pair = await this.activeRecord(
          this.database.breedingPairs,
          input.breedingPairId,
          'Breeding pair'
        )
        if (!CURRENT_BREEDING_STATUSES.has(pair.status)) {
          throw new ServiceError(
            'invalid-state',
            `Cannot add a litter to breeding pair in ${pair.status} status`
          )
        }
        const sire = await this.activeRecord(
          this.database.mice,
          pair.sireId,
          'Sire'
        )
        const dam = await this.activeRecord(
          this.database.mice,
          pair.damId,
          'Dam'
        )
        for (const parent of [sire, dam]) {
          if (
            parent.birthDate &&
            compareLocalDates(input.bornOn, parent.birthDate) < 0
          ) {
            throw new ServiceError(
              'invalid-state',
              'Litter birth date cannot precede a parent birth date',
              { parentId: parent.id }
            )
          }
        }

        const activeLitterKey = makeCompositeKey(
          'litter',
          pair.id,
          input.litterNumber
        )
        if (
          activeLitterKey &&
          (await this.database.litters
            .where('activeLitterKey')
            .equals(activeLitterKey)
            .first())
        ) {
          throw new ServiceError(
            'duplicate-litter',
            `Litter ${input.litterNumber} already exists for this pair`
          )
        }

        const offspringIds = input.offspring.map(child => child.id ?? newId())
        if (new Set(offspringIds).size !== offspringIds.length) {
          throw new ServiceError(
            'duplicate-id',
            'Offspring IDs must be unique within a litter'
          )
        }
        for (const id of offspringIds) {
          if (await this.database.mice.get(id)) {
            throw new ServiceError('duplicate-id', `Mouse ${id} already exists`)
          }
        }
        const batchEarKeys = new Set<string>()
        for (const child of input.offspring) {
          const earKey = makeActiveKey('ear', child.earTag)
          if (!earKey) {
            continue
          }
          if (batchEarKeys.has(earKey)) {
            throw new ServiceError(
              'duplicate-ear-tag',
              `Ear tag ${child.earTag} is duplicated in this litter`
            )
          }
          batchEarKeys.add(earKey)
          if (
            await this.database.mice
              .where('activeEarTagKey')
              .equals(earKey)
              .first()
          ) {
            throw new ServiceError(
              'duplicate-ear-tag',
              `Ear tag ${child.earTag} is already in use`
            )
          }
        }

        const now = resolveNow(input)
        const litterId = input.id ?? newId()
        if (await this.database.litters.get(litterId)) {
          throw new ServiceError(
            'duplicate-id',
            `Litter ${litterId} already exists`
          )
        }
        const offspring: Mouse[] = input.offspring.map((child, index) => {
          const earTag = withoutEmpty(child.earTag)
          return mouseSchema.parse({
            ...baseFields(input, offspringIds[index] ?? newId(), now),
            earTag,
            normalizedEarTag: normalizeOptionalText(earTag),
            activeEarTagKey: makeActiveKey('ear', earTag),
            experimentNumber: withoutEmpty(child.experimentNumber),
            normalizedExperimentNumber: normalizeOptionalText(
              child.experimentNumber
            ),
            name: withoutEmpty(child.name),
            alias: withoutEmpty(child.alias),
            normalizedAlias: normalizeOptionalText(child.alias ?? child.name),
            strain: child.strain ?? sire.strain,
            strainKey: normalizeText(child.strain ?? sire.strain),
            genotype: withoutEmpty(child.genotype),
            genotypeKey: normalizeOptionalText(child.genotype),
            sex: child.sex,
            birthDate: input.bornOn,
            sireId: sire.id,
            damId: dam.id,
            litterId,
            status: 'alive',
            source: 'bred in colony',
            coatColor: withoutEmpty(child.coatColor),
            notes: child.notes,
            tagIds: [],
            searchTerms: buildSearchTerms([
              earTag,
              child.experimentNumber,
              child.name,
              child.alias,
              child.strain ?? sire.strain,
              child.genotype,
              child.notes
            ])
          })
        })
        const bornCount = input.bornCount ?? offspring.length
        const aliveCount = input.aliveCount ?? offspring.length
        const litter: Litter = litterSchema.parse({
          ...baseFields(input, litterId, now),
          breedingPairId: pair.id,
          litterNumber: input.litterNumber,
          normalizedLitterNumber: normalizeText(input.litterNumber),
          activeLitterKey,
          sireId: sire.id,
          damId: dam.id,
          bornOn: input.bornOn,
          bornCount,
          aliveCount,
          weanedOn: input.weanedOn,
          notes: input.notes
        })
        const events = offspring.map(mouse =>
          this.buildEvent(input, now, {
            mouse,
            eventType: 'custom',
            occurredOn: input.bornOn,
            title: `Born in litter ${litter.litterNumber}`,
            payload: {
              litterId: litter.id,
              sireId: sire.id,
              damId: dam.id
            },
            sourceType: 'litter',
            sourceId: litter.id
          })
        )

        await this.database.litters.add(litter)
        await this.database.mice.bulkAdd(offspring)
        await this.database.mouseEvents.bulkAdd(events)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'litter',
          primaryEntityId: litter.id,
          entityRefs: [
            ['breedingPair', pair.id],
            ['mouse', sire.id],
            ['mouse', dam.id],
            ...offspring.map(
              child => ['mouse', child.id] as const
            )
          ],
          summary: `Created litter ${litter.litterNumber} with ${offspring.length} offspring`,
          resultEntityIds: [
            litter.id,
            ...offspring.map(child => child.id),
            ...events.map(event => event.id)
          ]
        })
        return {
          value: { litter, offspring },
          replayed: false,
          warnings: []
        }
      }
    )
  }

  async createExperiment(
    input: CreateExperimentInput
  ): Promise<CommandResult<Experiment>> {
    const action = 'experiment.create'
    return this.database.transaction(
      'rw',
      [this.database.experiments, this.database.activityLogs],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const experiment = await this.database.experiments.get(
            this.resultId(replay)
          )
          if (!experiment) {
            throw new ServiceError(
              'integrity-error',
              'Experiment referenced by activity log is missing'
            )
          }
          return { value: experiment, replayed: true, warnings: [] }
        }

        const now = resolveNow(input)
        const id = input.id ?? newId()
        if (await this.database.experiments.get(id)) {
          throw new ServiceError(
            'duplicate-id',
            `Experiment ${id} already exists`
          )
        }
        const code = withoutEmpty(input.code)
        const activeExperimentCodeKey = makeActiveKey('experiment', code)
        if (
          activeExperimentCodeKey &&
          (await this.database.experiments
            .where('activeExperimentCodeKey')
            .equals(activeExperimentCodeKey)
            .first())
        ) {
          throw new ServiceError(
            'duplicate-experiment-code',
            `Experiment code ${code} is already in use`
          )
        }
        const experiment: Experiment = experimentSchema.parse({
          ...baseFields(input, id, now),
          code,
          normalizedCode: normalizeOptionalText(code),
          activeExperimentCodeKey,
          name: input.name,
          normalizedName: normalizeText(input.name),
          description: input.description,
          startDate: input.startDate,
          endDate: input.endDate,
          status: input.status ?? 'planned',
          intervention: withoutEmpty(input.intervention),
          dose: withoutEmpty(input.dose),
          frequency: withoutEmpty(input.frequency),
          principalInvestigator: withoutEmpty(input.principalInvestigator),
          notes: input.notes,
          searchTerms: buildSearchTerms([
            code,
            input.name,
            input.description,
            input.principalInvestigator,
            input.notes
          ])
        })
        await this.database.experiments.add(experiment)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'experiment',
          primaryEntityId: experiment.id,
          summary: `Created experiment ${experiment.name}`,
          resultEntityIds: [experiment.id]
        })
        return { value: experiment, replayed: false, warnings: [] }
      }
    )
  }

  async updateExperiment(
    input: UpdateExperimentInput
  ): Promise<CommandResult<Experiment>> {
    const action = 'experiment.update'
    return this.database.transaction(
      'rw',
      [this.database.experiments, this.database.activityLogs],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const experiment = await this.database.experiments.get(
            this.resultId(replay)
          )
          if (!experiment) {
            throw new ServiceError(
              'integrity-error',
              'Updated experiment referenced by activity log is missing'
            )
          }
          return { value: experiment, replayed: true, warnings: [] }
        }
        const current = await this.activeRecord(
          this.database.experiments,
          input.experimentId,
          'Experiment'
        )
        this.assertRevision(current, input.expectedRevision)
        const code =
          'code' in input.patch
            ? withoutEmpty(input.patch.code)
            : current.code
        const activeExperimentCodeKey = makeActiveKey('experiment', code)
        if (
          activeExperimentCodeKey &&
          activeExperimentCodeKey !== current.activeExperimentCodeKey
        ) {
          const duplicate = await this.database.experiments
            .where('activeExperimentCodeKey')
            .equals(activeExperimentCodeKey)
            .first()
          if (duplicate && duplicate.id !== current.id) {
            throw new ServiceError(
              'duplicate-experiment-code',
              `Experiment code ${code} is already in use`
            )
          }
        }
        const now = resolveNow(input)
        const name = input.patch.name ?? current.name
        const experiment: Experiment = experimentSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          code,
          normalizedCode: normalizeOptionalText(code),
          activeExperimentCodeKey,
          name,
          normalizedName: normalizeText(name),
          description:
            'description' in input.patch
              ? input.patch.description ?? undefined
              : current.description,
          startDate:
            'startDate' in input.patch
              ? input.patch.startDate ?? undefined
              : current.startDate,
          endDate:
            'endDate' in input.patch
              ? input.patch.endDate ?? undefined
              : current.endDate,
          status: input.patch.status ?? current.status,
          intervention:
            'intervention' in input.patch
              ? withoutEmpty(input.patch.intervention)
              : current.intervention,
          dose:
            'dose' in input.patch
              ? withoutEmpty(input.patch.dose)
              : current.dose,
          frequency:
            'frequency' in input.patch
              ? withoutEmpty(input.patch.frequency)
              : current.frequency,
          principalInvestigator:
            'principalInvestigator' in input.patch
              ? withoutEmpty(input.patch.principalInvestigator)
              : current.principalInvestigator,
          notes:
            'notes' in input.patch
              ? input.patch.notes ?? undefined
              : current.notes,
          searchTerms: buildSearchTerms([
            code,
            name,
            'description' in input.patch
              ? input.patch.description
              : current.description,
            'principalInvestigator' in input.patch
              ? input.patch.principalInvestigator
              : current.principalInvestigator,
            'notes' in input.patch ? input.patch.notes : current.notes
          ])
        })
        await this.database.experiments.put(experiment)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'experiment',
          primaryEntityId: experiment.id,
          summary: `Updated experiment ${experiment.name}`,
          changedFields: Object.keys(input.patch),
          resultEntityIds: [experiment.id]
        })
        return { value: experiment, replayed: false, warnings: [] }
      }
    )
  }

  async createExperimentGroup(
    input: CreateExperimentGroupInput
  ): Promise<CommandResult<ExperimentGroup>> {
    const action = 'experiment-group.create'
    return this.database.transaction(
      'rw',
      [
        this.database.experiments,
        this.database.experimentGroups,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const group = await this.database.experimentGroups.get(
            this.resultId(replay)
          )
          if (!group) {
            throw new ServiceError(
              'integrity-error',
              'Experiment group referenced by activity log is missing'
            )
          }
          return { value: group, replayed: true, warnings: [] }
        }
        const experiment = await this.activeRecord(
          this.database.experiments,
          input.experimentId,
          'Experiment'
        )
        const activeGroupNameKey = makeCompositeKey(
          'experiment-group',
          experiment.id,
          input.name
        )
        if (
          activeGroupNameKey &&
          (await this.database.experimentGroups
            .where('activeGroupNameKey')
            .equals(activeGroupNameKey)
            .first())
        ) {
          throw new ServiceError(
            'duplicate-experiment-group',
            `Group ${input.name} already exists in this experiment`
          )
        }
        const now = resolveNow(input)
        const group: ExperimentGroup = experimentGroupSchema.parse({
          ...baseFields(input, input.id ?? newId(), now),
          experimentId: experiment.id,
          name: input.name,
          normalizedName: normalizeText(input.name),
          groupType: input.groupType,
          activeGroupNameKey,
          exclusionSet: withoutEmpty(input.exclusionSet),
          intervention: withoutEmpty(input.intervention),
          dose: withoutEmpty(input.dose),
          frequency: withoutEmpty(input.frequency),
          notes: input.notes
        })
        await this.database.experimentGroups.add(group)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'experimentGroup',
          primaryEntityId: group.id,
          entityRefs: [['experiment', experiment.id]],
          summary: `Created group ${group.name} in ${experiment.name}`,
          resultEntityIds: [group.id]
        })
        return { value: group, replayed: false, warnings: [] }
      }
    )
  }

  async assignMouseToExperiment(
    input: AssignMouseToExperimentInput
  ): Promise<CommandResult<ExperimentAssignmentValue>> {
    const action = 'experiment.assign-mouse'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.experiments,
        this.database.experimentGroups,
        this.database.experimentAssignments,
        this.database.mouseEvents,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const assignment = await this.database.experimentAssignments.get(
            this.resultId(replay)
          )
          const event = await this.database.mouseEvents.get(
            this.resultId(replay, 1)
          )
          if (!assignment || !event) {
            throw new ServiceError(
              'integrity-error',
              'Experiment assignment replay is incomplete'
            )
          }
          return {
            value: { assignment, event },
            replayed: true,
            warnings: replay.warningAcknowledgements ?? []
          }
        }
        const mouse = await this.activeRecord(
          this.database.mice,
          input.mouseId,
          'Mouse'
        )
        const experiment = await this.activeRecord(
          this.database.experiments,
          input.experimentId,
          'Experiment'
        )
        if (!['planned', 'active'].includes(experiment.status)) {
          throw new ServiceError(
            'invalid-state',
            `Cannot assign mice to an experiment in ${experiment.status} status`
          )
        }
        const group = await this.activeRecord(
          this.database.experimentGroups,
          input.groupId,
          'Experiment group'
        )
        if (group.experimentId !== experiment.id) {
          throw new ServiceError(
            'invalid-reference',
            'Experiment group belongs to a different experiment'
          )
        }
        const activeGroupMouseKey = makeCompositeKey(
          'experiment-group-mouse',
          group.id,
          mouse.id
        )
        if (
          activeGroupMouseKey &&
          (await this.database.experimentAssignments
            .where('activeGroupMouseKey')
            .equals(activeGroupMouseKey)
            .first())
        ) {
          throw new ServiceError(
            'already-assigned',
            'Mouse is already assigned to this experiment group'
          )
        }
        const activeExclusionMouseKey = group.exclusionSet
          ? makeCompositeKey(
              'experiment-exclusion',
              experiment.id,
              group.exclusionSet,
              mouse.id
            )
          : undefined
        if (
          activeExclusionMouseKey &&
          (await this.database.experimentAssignments
            .where('activeExclusionMouseKey')
            .equals(activeExclusionMouseKey)
            .first())
        ) {
          throw new ServiceError(
            'exclusive-group-conflict',
            'Mouse is already in a mutually exclusive group'
          )
        }
        const warnings = warningList([
          TERMINAL_MOUSE_STATUSES.has(mouse.status) &&
            WARNING_CODES.unavailableExperimentMouse
        ])
        requireWarnings(warnings, input.warningAcknowledgements)

        const now = resolveNow(input)
        const joinedAt = resolveOccurredAt(
          input.joinedOn,
          input.joinedTime,
          now
        )
        const event = this.buildEvent(input, now, {
          mouse,
          experiment,
          eventType: 'experiment-join',
          occurredOn: input.joinedOn,
          occurredTime: input.joinedTime,
          occurredAt: joinedAt,
          title: `Joined experiment group ${group.name}`,
          payload: {
            experimentId: experiment.id,
            groupId: group.id
          }
        })
        const assignment: ExperimentAssignment =
          experimentAssignmentSchema.parse({
            ...baseFields(input, input.id ?? newId(), now),
            mouseId: mouse.id,
            experimentId: experiment.id,
            groupId: group.id,
            joinedAt,
            activeFlag: 1,
            activeGroupMouseKey,
            activeExclusionMouseKey,
            joinedEventId: event.id,
            experimentNameSnapshot: experiment.name,
            groupNameSnapshot: group.name,
            mouseLabelSnapshot: mouseDisplayLabel(mouse)
          })
        await this.database.experimentAssignments.add(assignment)
        await this.database.mouseEvents.add(event)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'experimentAssignment',
          primaryEntityId: assignment.id,
          entityRefs: [
            ['mouse', mouse.id],
            ['experiment', experiment.id],
            ['experimentGroup', group.id]
          ],
          summary: `Assigned ${mouseDisplayLabel(mouse)} to ${experiment.name}/${group.name}`,
          resultEntityIds: [assignment.id, event.id],
          warnings
        })
        return {
          value: { assignment, event },
          replayed: false,
          warnings
        }
      }
    )
  }

  async exitExperimentAssignment(
    input: ExitExperimentAssignmentInput
  ): Promise<CommandResult<ExperimentAssignmentValue>> {
    const action = 'experiment.exit-mouse'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.experiments,
        this.database.experimentGroups,
        this.database.experimentAssignments,
        this.database.mouseEvents,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const assignment = await this.database.experimentAssignments.get(
            this.resultId(replay)
          )
          const event = await this.database.mouseEvents.get(
            this.resultId(replay, 1)
          )
          if (!assignment || !event) {
            throw new ServiceError(
              'integrity-error',
              'Experiment exit replay is incomplete'
            )
          }
          return {
            value: { assignment, event },
            replayed: true,
            warnings: []
          }
        }
        const current = await this.activeRecord(
          this.database.experimentAssignments,
          input.assignmentId,
          'Experiment assignment'
        )
        if (current.activeFlag !== 1) {
          throw new ServiceError(
            'invalid-state',
            'Experiment assignment is already closed'
          )
        }
        const mouse = await this.activeRecord(
          this.database.mice,
          current.mouseId,
          'Mouse'
        )
        const experiment = await this.activeRecord(
          this.database.experiments,
          current.experimentId,
          'Experiment'
        )
        await this.activeRecord(
          this.database.experimentGroups,
          current.groupId,
          'Experiment group'
        )
        const now = resolveNow(input)
        const exitedAt = resolveOccurredAt(
          input.exitedOn,
          input.exitedTime,
          now
        )
        const event = this.buildEvent(input, now, {
          mouse,
          experiment,
          eventType: 'experiment-exit',
          occurredOn: input.exitedOn,
          occurredTime: input.exitedTime,
          occurredAt: exitedAt,
          title: `Exited experiment ${experiment.name}`,
          description: input.reason,
          payload: {
            assignmentId: current.id,
            groupId: current.groupId
          }
        })
        const assignment: ExperimentAssignment =
          experimentAssignmentSchema.parse({
            ...current,
            revision: current.revision + 1,
            updatedAt: now,
            exitedAt,
            exitReason: input.reason,
            activeFlag: 0,
            activeGroupMouseKey: undefined,
            activeExclusionMouseKey: undefined,
            exitedEventId: event.id
          })
        await this.database.experimentAssignments.put(assignment)
        await this.database.mouseEvents.add(event)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'experimentAssignment',
          primaryEntityId: assignment.id,
          entityRefs: [
            ['mouse', mouse.id],
            ['experiment', experiment.id]
          ],
          summary: `Removed ${mouseDisplayLabel(mouse)} from ${experiment.name}`,
          resultEntityIds: [assignment.id, event.id]
        })
        return {
          value: { assignment, event },
          replayed: false,
          warnings: []
        }
      }
    )
  }

  async createMouseEvent(
    input: CreateMouseEventInput
  ): Promise<CommandResult<MouseEvent>> {
    const action = 'mouse-event.create'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.cages,
        this.database.experiments,
        this.database.mouseEvents,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const event = await this.database.mouseEvents.get(
            this.resultId(replay)
          )
          if (!event) {
            throw new ServiceError(
              'integrity-error',
              'Mouse event referenced by activity log is missing'
            )
          }
          return { value: event, replayed: true, warnings: [] }
        }
        const mouse = await this.activeRecord(
          this.database.mice,
          input.mouseId,
          'Mouse'
        )
        const cage = input.cageId
          ? await this.activeRecord(this.database.cages, input.cageId, 'Cage')
          : undefined
        const experiment = input.experimentId
          ? await this.activeRecord(
              this.database.experiments,
              input.experimentId,
              'Experiment'
            )
          : undefined
        const now = resolveNow(input)
        const event = this.buildEvent(input, now, {
          id: input.id,
          mouse,
          cage,
          experiment,
          eventType: input.eventType,
          occurredOn: input.occurredOn,
          occurredTime: input.occurredTime,
          timeZone: input.timeZone,
          title: input.title,
          description: input.description,
          payload: input.payload
        })
        if (await this.database.mouseEvents.get(event.id)) {
          throw new ServiceError(
            'duplicate-id',
            `Mouse event ${event.id} already exists`
          )
        }
        await this.database.mouseEvents.add(event)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'mouseEvent',
          primaryEntityId: event.id,
          entityRefs: [
            ['mouse', mouse.id],
            ...(cage ? ([['cage', cage.id]] as const) : []),
            ...(experiment
              ? ([['experiment', experiment.id]] as const)
              : [])
          ],
          summary: `Created event ${event.title} for ${mouseDisplayLabel(mouse)}`,
          resultEntityIds: [event.id]
        })
        return { value: event, replayed: false, warnings: [] }
      }
    )
  }

  async updateMouseEvent(
    input: UpdateMouseEventInput
  ): Promise<CommandResult<MouseEvent>> {
    const action = 'mouse-event.update'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.cages,
        this.database.experiments,
        this.database.mouseEvents,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const event = await this.database.mouseEvents.get(
            this.resultId(replay)
          )
          if (!event) {
            throw new ServiceError(
              'integrity-error',
              'Updated event referenced by activity log is missing'
            )
          }
          return { value: event, replayed: true, warnings: [] }
        }
        const current = await this.activeRecord(
          this.database.mouseEvents,
          input.eventId,
          'Mouse event'
        )
        this.assertRevision(current, input.expectedRevision)
        if (current.eventType === 'weight') {
          throw new ServiceError(
            'invalid-state',
            'Weight events must be edited through the weight service'
          )
        }
        const mouse = await this.database.mice.get(current.mouseId)
        if (!mouse) {
          throw new ServiceError(
            'integrity-error',
            `Event references missing mouse ${current.mouseId}`
          )
        }
        const cageId =
          'cageId' in input.patch
            ? input.patch.cageId ?? undefined
            : current.cageId
        const experimentId =
          'experimentId' in input.patch
            ? input.patch.experimentId ?? undefined
            : current.experimentId
        const cage = cageId
          ? await this.activeRecord(this.database.cages, cageId, 'Cage')
          : undefined
        const experiment = experimentId
          ? await this.activeRecord(
              this.database.experiments,
              experimentId,
              'Experiment'
            )
          : undefined
        const occurredOn = input.patch.occurredOn ?? current.occurredOn
        const occurredTime =
          'occurredTime' in input.patch
            ? input.patch.occurredTime ?? undefined
            : current.occurredTime
        const title = input.patch.title ?? current.title
        const now = resolveNow(input)
        const event: MouseEvent = mouseEventSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          occurredOn,
          occurredTime,
          timeZone: input.patch.timeZone ?? current.timeZone,
          occurredAt: localDateTimeToInstant(
            occurredOn,
            occurredTime ?? '00:00'
          ),
          cageId,
          experimentId,
          title,
          normalizedTitle: normalizeText(title),
          description:
            'description' in input.patch
              ? input.patch.description ?? undefined
              : current.description,
          payload: input.patch.payload ?? current.payload,
          snapshot: {
            mouseLabel: mouseDisplayLabel(mouse),
            cageNumber: cage?.cageNumber,
            experimentName: experiment?.name
          },
          searchTerms: buildSearchTerms([
            title,
            'description' in input.patch
              ? input.patch.description
              : current.description,
            mouseDisplayLabel(mouse),
            cage?.cageNumber,
            experiment?.name
          ])
        })
        await this.database.mouseEvents.put(event)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'mouseEvent',
          primaryEntityId: event.id,
          entityRefs: [['mouse', mouse.id]],
          summary: `Updated event ${event.title}`,
          changedFields: Object.keys(input.patch),
          resultEntityIds: [event.id]
        })
        return { value: event, replayed: false, warnings: [] }
      }
    )
  }

  async softDeleteMouseEvent(
    input: SoftDeleteMouseEventInput
  ): Promise<CommandResult<MouseEvent>> {
    const action = 'mouse-event.soft-delete'
    return this.database.transaction(
      'rw',
      [
        this.database.mouseEvents,
        this.database.weightRecords,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const event = await this.database.mouseEvents.get(
            this.resultId(replay)
          )
          if (!event) {
            throw new ServiceError(
              'integrity-error',
              'Deleted event referenced by activity log is missing'
            )
          }
          return { value: event, replayed: true, warnings: [] }
        }
        const current = await this.activeRecord(
          this.database.mouseEvents,
          input.eventId,
          'Mouse event'
        )
        this.assertRevision(current, input.expectedRevision)
        const now = resolveNow(input)
        const event: MouseEvent = mouseEventSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          deletedAt: now,
          deletedFlag: 1
        })
        if (current.eventType === 'weight') {
          const weight = await this.database.weightRecords
            .where('eventId')
            .equals(current.id)
            .first()
          if (!weight) {
            throw new ServiceError(
              'integrity-error',
              'Weight event has no matching WeightRecord'
            )
          }
          const deletedWeight: WeightRecord = weightRecordSchema.parse({
            ...weight,
            revision: weight.revision + 1,
            updatedAt: now,
            deletedAt: now,
            deletedFlag: 1
          })
          await this.database.weightRecords.put(deletedWeight)
        }
        await this.database.mouseEvents.put(event)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'mouseEvent',
          primaryEntityId: event.id,
          summary: `Deleted event ${event.title}`,
          resultEntityIds: [event.id]
        })
        return { value: event, replayed: false, warnings: [] }
      }
    )
  }

  async recordWeight(
    input: RecordWeightInput
  ): Promise<CommandResult<WeightEntryValue>> {
    const action = 'weight.record'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.weightRecords,
        this.database.mouseEvents,
        this.database.appSettings,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const weight = await this.database.weightRecords.get(
            this.resultId(replay)
          )
          const event = await this.database.mouseEvents.get(
            this.resultId(replay, 1)
          )
          if (!weight || !event) {
            throw new ServiceError(
              'integrity-error',
              'Weight replay is incomplete'
            )
          }
          return {
            value: { weight, event },
            replayed: true,
            warnings: replay.warningAcknowledgements ?? []
          }
        }
        const mouse = await this.activeRecord(
          this.database.mice,
          input.mouseId,
          'Mouse'
        )
        const now = resolveNow(input)
        const measuredAt = resolveOccurredAt(
          input.measuredOn,
          input.measuredTime,
          now
        )
        const valueGrams = input.unit === 'g' ? input.value : input.value / 1000
        const previous = await this.database.weightRecords
          .where('[mouseId+measuredAt]')
          .between([mouse.id, ''], [mouse.id, measuredAt], true, false)
          .reverse()
          .filter(weight => weight.deletedFlag === 0)
          .first()
        const settings = await this.database.appSettings.get('app-settings')
        const anomalyThreshold = settings?.weightAnomalyPercent ?? 0.25
        const changeRatio = previous
          ? Math.abs(valueGrams - previous.valueGrams) / previous.valueGrams
          : 0
        const warnings = warningList([
          previous &&
            changeRatio >= anomalyThreshold &&
            WARNING_CODES.weightAnomaly
        ])
        requireWarnings(warnings, input.warningAcknowledgements)

        const weightId = input.id ?? newId()
        const eventId = input.eventId ?? newId()
        if (await this.database.weightRecords.get(weightId)) {
          throw new ServiceError(
            'duplicate-id',
            `Weight record ${weightId} already exists`
          )
        }
        if (await this.database.mouseEvents.get(eventId)) {
          throw new ServiceError(
            'duplicate-id',
            `Mouse event ${eventId} already exists`
          )
        }
        const weight: WeightRecord = weightRecordSchema.parse({
          ...baseFields(input, weightId, now),
          mouseId: mouse.id,
          eventId,
          measuredOn: input.measuredOn,
          measuredTime: input.measuredTime,
          timeZone: input.timeZone ?? DEFAULT_TIME_ZONE,
          measuredAt,
          value: input.value,
          unit: input.unit,
          valueGrams,
          notes: input.notes,
          anomalyAcknowledged: warnings.includes(WARNING_CODES.weightAnomaly)
        })
        const event = this.buildEvent(input, now, {
          id: eventId,
          mouse,
          eventType: 'weight',
          occurredOn: input.measuredOn,
          occurredTime: input.measuredTime,
          timeZone: input.timeZone,
          occurredAt: measuredAt,
          title: `Weight ${input.value} ${input.unit}`,
          description: input.notes,
          payload: {
            value: input.value,
            unit: input.unit,
            valueGrams
          },
          sourceType: 'weightRecord',
          sourceId: weight.id
        })
        await this.database.weightRecords.add(weight)
        await this.database.mouseEvents.add(event)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'weightRecord',
          primaryEntityId: weight.id,
          entityRefs: [
            ['mouse', mouse.id],
            ['mouseEvent', event.id]
          ],
          summary: `Recorded ${input.value} ${input.unit} for ${mouseDisplayLabel(mouse)}`,
          resultEntityIds: [weight.id, event.id],
          warnings,
          metadata: previous
            ? {
                previousWeightId: previous.id,
                changeRatio
              }
            : undefined
        })
        return {
          value: { weight, event },
          replayed: false,
          warnings
        }
      }
    )
  }

  async createTask(input: CreateTaskInput): Promise<CommandResult<Task>> {
    const action = 'task.create'
    return this.database.transaction(
      'rw',
      [
        this.database.tasks,
        this.database.mice,
        this.database.cages,
        this.database.experiments,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const task = await this.database.tasks.get(this.resultId(replay))
          if (!task) {
            throw new ServiceError(
              'integrity-error',
              'Task referenced by activity log is missing'
            )
          }
          return { value: task, replayed: true, warnings: [] }
        }
        if (input.mouseId) {
          await this.activeRecord(this.database.mice, input.mouseId, 'Mouse')
        }
        if (input.cageId) {
          await this.activeRecord(this.database.cages, input.cageId, 'Cage')
        }
        if (input.experimentId) {
          await this.activeRecord(
            this.database.experiments,
            input.experimentId,
            'Experiment'
          )
        }
        const now = resolveNow(input)
        const task: Task = taskSchema.parse({
          ...baseFields(input, input.id ?? newId(), now),
          title: input.title,
          dueDate: input.dueDate,
          dueTime: input.dueTime,
          dueSortKey: dueSortKey(input.dueDate, input.dueTime),
          mouseId: input.mouseId,
          cageId: input.cageId,
          experimentId: input.experimentId,
          priority: input.priority ?? 'normal',
          status: 'pending',
          notes: input.notes
        })
        if (await this.database.tasks.get(task.id)) {
          throw new ServiceError('duplicate-id', `Task ${task.id} already exists`)
        }
        await this.database.tasks.add(task)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'task',
          primaryEntityId: task.id,
          entityRefs: [
            ...(task.mouseId
              ? ([['mouse', task.mouseId]] as const)
              : []),
            ...(task.cageId ? ([['cage', task.cageId]] as const) : []),
            ...(task.experimentId
              ? ([['experiment', task.experimentId]] as const)
              : [])
          ],
          summary: `Created task ${task.title}`,
          resultEntityIds: [task.id]
        })
        return { value: task, replayed: false, warnings: [] }
      }
    )
  }

  async updateTask(input: UpdateTaskInput): Promise<CommandResult<Task>> {
    const action = 'task.update'
    return this.database.transaction(
      'rw',
      [
        this.database.tasks,
        this.database.mice,
        this.database.cages,
        this.database.experiments,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const task = await this.database.tasks.get(this.resultId(replay))
          if (!task) {
            throw new ServiceError(
              'integrity-error',
              'Updated task referenced by activity log is missing'
            )
          }
          return { value: task, replayed: true, warnings: [] }
        }
        const current = await this.activeRecord(
          this.database.tasks,
          input.taskId,
          'Task'
        )
        this.assertRevision(current, input.expectedRevision)
        const mouseId =
          'mouseId' in input.patch
            ? input.patch.mouseId ?? undefined
            : current.mouseId
        const cageId =
          'cageId' in input.patch
            ? input.patch.cageId ?? undefined
            : current.cageId
        const experimentId =
          'experimentId' in input.patch
            ? input.patch.experimentId ?? undefined
            : current.experimentId
        if (mouseId) {
          await this.activeRecord(this.database.mice, mouseId, 'Mouse')
        }
        if (cageId) {
          await this.activeRecord(this.database.cages, cageId, 'Cage')
        }
        if (experimentId) {
          await this.activeRecord(
            this.database.experiments,
            experimentId,
            'Experiment'
          )
        }
        const dueDate = input.patch.dueDate ?? current.dueDate
        const dueTime =
          'dueTime' in input.patch
            ? input.patch.dueTime ?? undefined
            : current.dueTime
        const now = resolveNow(input)
        const task: Task = taskSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          title: input.patch.title ?? current.title,
          dueDate,
          dueTime,
          dueSortKey: dueSortKey(dueDate, dueTime),
          mouseId,
          cageId,
          experimentId,
          priority: input.patch.priority ?? current.priority,
          notes:
            'notes' in input.patch
              ? input.patch.notes ?? undefined
              : current.notes
        })
        await this.database.tasks.put(task)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'task',
          primaryEntityId: task.id,
          summary: `Updated task ${task.title}`,
          changedFields: Object.keys(input.patch),
          resultEntityIds: [task.id]
        })
        return { value: task, replayed: false, warnings: [] }
      }
    )
  }

  async setTaskStatus(
    input: SetTaskStatusInput
  ): Promise<CommandResult<Task>> {
    const action = 'task.set-status'
    return this.database.transaction(
      'rw',
      [this.database.tasks, this.database.activityLogs],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const task = await this.database.tasks.get(this.resultId(replay))
          if (!task) {
            throw new ServiceError(
              'integrity-error',
              'Updated task referenced by activity log is missing'
            )
          }
          return { value: task, replayed: true, warnings: [] }
        }
        const current = await this.activeRecord(
          this.database.tasks,
          input.taskId,
          'Task'
        )
        this.assertRevision(current, input.expectedRevision)
        const now = resolveNow(input)
        const task: Task = taskSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          status: input.status,
          completedAt: input.status === 'completed' ? now : undefined
        })
        await this.database.tasks.put(task)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'task',
          primaryEntityId: task.id,
          summary: `Changed task ${task.title} to ${task.status}`,
          changedFields: ['status', 'completedAt'],
          resultEntityIds: [task.id]
        })
        return { value: task, replayed: false, warnings: [] }
      }
    )
  }

  async softDeleteTask(
    input: SoftDeleteTaskInput
  ): Promise<CommandResult<Task>> {
    const action = 'task.soft-delete'
    return this.database.transaction(
      'rw',
      [this.database.tasks, this.database.activityLogs],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const task = await this.database.tasks.get(this.resultId(replay))
          if (!task) {
            throw new ServiceError(
              'integrity-error',
              'Deleted task referenced by activity log is missing'
            )
          }
          return { value: task, replayed: true, warnings: [] }
        }
        const current = await this.activeRecord(
          this.database.tasks,
          input.taskId,
          'Task'
        )
        this.assertRevision(current, input.expectedRevision)
        const now = resolveNow(input)
        const task: Task = taskSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          deletedAt: now,
          deletedFlag: 1
        })
        await this.database.tasks.put(task)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'task',
          primaryEntityId: task.id,
          summary: `Deleted task ${task.title}`,
          resultEntityIds: [task.id]
        })
        return { value: task, replayed: false, warnings: [] }
      }
    )
  }

  async restoreTask(input: RestoreTaskInput): Promise<CommandResult<Task>> {
    const action = 'task.restore'
    return this.database.transaction(
      'rw',
      [this.database.tasks, this.database.activityLogs],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const task = await this.database.tasks.get(this.resultId(replay))
          if (!task) {
            throw new ServiceError(
              'integrity-error',
              'Restored task referenced by activity log is missing'
            )
          }
          return { value: task, replayed: true, warnings: [] }
        }
        const current = await this.database.tasks.get(input.taskId)
        if (!current) {
          throw new ServiceError('not-found', `Task ${input.taskId} not found`)
        }
        if (current.deletedFlag === 0) {
          throw new ServiceError('invalid-state', 'Task is not deleted')
        }
        this.assertRevision(current, input.expectedRevision)
        const now = resolveNow(input)
        const task: Task = taskSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          deletedAt: null,
          deletedFlag: 0
        })
        await this.database.tasks.put(task)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'task',
          primaryEntityId: task.id,
          summary: `Restored task ${task.title}`,
          resultEntityIds: [task.id]
        })
        return { value: task, replayed: false, warnings: [] }
      }
    )
  }

  async createTag(input: CreateTagInput): Promise<CommandResult<Tag>> {
    const action = 'tag.create'
    return this.database.transaction(
      'rw',
      [this.database.tags, this.database.activityLogs],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const tag = await this.database.tags.get(this.resultId(replay))
          if (!tag) {
            throw new ServiceError(
              'integrity-error',
              'Tag referenced by activity log is missing'
            )
          }
          return { value: tag, replayed: true, warnings: [] }
        }
        const activeNameKey = makeActiveKey('tag', input.name)
        if (
          activeNameKey &&
          (await this.database.tags
            .where('activeNameKey')
            .equals(activeNameKey)
            .first())
        ) {
          throw new ServiceError(
            'duplicate-tag-name',
            `Tag ${input.name} already exists`
          )
        }
        const now = resolveNow(input)
        const tag: Tag = tagSchema.parse({
          ...baseFields(input, input.id ?? newId(), now),
          name: input.name,
          normalizedName: normalizeText(input.name),
          activeNameKey,
          color: input.color,
          description: input.description
        })
        if (await this.database.tags.get(tag.id)) {
          throw new ServiceError('duplicate-id', `Tag ${tag.id} already exists`)
        }
        await this.database.tags.add(tag)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'tag',
          primaryEntityId: tag.id,
          summary: `Created tag ${tag.name}`,
          resultEntityIds: [tag.id]
        })
        return { value: tag, replayed: false, warnings: [] }
      }
    )
  }

  async setMouseTags(
    input: SetMouseTagsInput
  ): Promise<CommandResult<Mouse>> {
    const action = 'mouse.set-tags'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.tags,
        this.database.mouseEvents,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const mouse = await this.database.mice.get(this.resultId(replay))
          if (!mouse) {
            throw new ServiceError(
              'integrity-error',
              'Mouse tag result referenced by activity log is missing'
            )
          }
          return { value: mouse, replayed: true, warnings: [] }
        }
        const current = await this.activeRecord(
          this.database.mice,
          input.mouseId,
          'Mouse'
        )
        this.assertRevision(current, input.expectedRevision)
        const tagIds = uniqueStrings(input.tagIds)
        for (const tagId of tagIds) {
          await this.activeRecord(this.database.tags, tagId, 'Tag')
        }
        const oldIds = new Set(current.tagIds)
        const nextIds = new Set(tagIds)
        const added = tagIds.filter(tagId => !oldIds.has(tagId))
        const removed = current.tagIds.filter(tagId => !nextIds.has(tagId))
        if (added.length === 0 && removed.length === 0) {
          throw new ServiceError('invalid-state', 'Mouse tags are unchanged')
        }
        const now = resolveNow(input)
        const { date, time } = instantToLocalDateTime(now)
        const event = this.buildEvent(input, now, {
          mouse: current,
          eventType: 'tag-change',
          occurredOn: date,
          occurredTime: time,
          occurredAt: now,
          title: 'Tags changed',
          payload: { added, removed }
        })
        const mouse: Mouse = mouseSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          tagIds
        })
        await this.database.mice.put(mouse)
        await this.database.mouseEvents.add(event)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'mouse',
          primaryEntityId: mouse.id,
          entityRefs: [
            ...tagIds.map(tagId => ['tag', tagId] as const),
            ['mouseEvent', event.id]
          ],
          summary: `Changed tags for ${mouseDisplayLabel(mouse)}`,
          changedFields: ['tagIds'],
          resultEntityIds: [mouse.id, event.id]
        })
        return { value: mouse, replayed: false, warnings: [] }
      }
    )
  }

  async softDeleteTag(
    input: SoftDeleteTagInput
  ): Promise<CommandResult<Tag>> {
    const action = 'tag.soft-delete'
    return this.database.transaction(
      'rw',
      [
        this.database.tags,
        this.database.mice,
        this.database.mouseEvents,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const tag = await this.database.tags.get(this.resultId(replay))
          if (!tag) {
            throw new ServiceError(
              'integrity-error',
              'Deleted tag referenced by activity log is missing'
            )
          }
          return { value: tag, replayed: true, warnings: [] }
        }
        const current = await this.activeRecord(
          this.database.tags,
          input.tagId,
          'Tag'
        )
        this.assertRevision(current, input.expectedRevision)
        const mice = await this.database.mice
          .where('tagIds')
          .equals(current.id)
          .filter(mouse => mouse.deletedFlag === 0)
          .toArray()
        const now = resolveNow(input)
        const { date, time } = instantToLocalDateTime(now)
        const events: MouseEvent[] = []
        for (const currentMouse of mice) {
          const event = this.buildEvent(input, now, {
            mouse: currentMouse,
            eventType: 'tag-change',
            occurredOn: date,
            occurredTime: time,
            occurredAt: now,
            title: `Removed deleted tag ${current.name}`,
            payload: { added: [], removed: [current.id] },
            sourceType: 'tag',
            sourceId: current.id
          })
          const mouse: Mouse = mouseSchema.parse({
            ...currentMouse,
            revision: currentMouse.revision + 1,
            updatedAt: now,
            tagIds: currentMouse.tagIds.filter(tagId => tagId !== current.id)
          })
          await this.database.mice.put(mouse)
          events.push(event)
        }
        const tag: Tag = tagSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          deletedAt: now,
          deletedFlag: 1,
          activeNameKey: undefined
        })
        if (events.length > 0) {
          await this.database.mouseEvents.bulkAdd(events)
        }
        await this.database.tags.put(tag)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'tag',
          primaryEntityId: tag.id,
          entityRefs: mice.map(mouse => ['mouse', mouse.id] as const),
          summary: `Deleted tag ${tag.name} and detached it from ${mice.length} mice`,
          resultEntityIds: [tag.id, ...events.map(event => event.id)]
        })
        return { value: tag, replayed: false, warnings: [] }
      }
    )
  }

  async restoreTag(input: RestoreTagInput): Promise<CommandResult<Tag>> {
    const action = 'tag.restore'
    return this.database.transaction(
      'rw',
      [this.database.tags, this.database.activityLogs],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const tag = await this.database.tags.get(this.resultId(replay))
          if (!tag) {
            throw new ServiceError(
              'integrity-error',
              'Restored tag referenced by activity log is missing'
            )
          }
          return { value: tag, replayed: true, warnings: [] }
        }
        const current = await this.database.tags.get(input.tagId)
        if (!current) {
          throw new ServiceError('not-found', `Tag ${input.tagId} not found`)
        }
        if (current.deletedFlag === 0) {
          throw new ServiceError('invalid-state', 'Tag is not deleted')
        }
        this.assertRevision(current, input.expectedRevision)
        const activeNameKey = makeActiveKey('tag', current.name)
        if (
          activeNameKey &&
          (await this.database.tags
            .where('activeNameKey')
            .equals(activeNameKey)
            .first())
        ) {
          throw new ServiceError(
            'duplicate-tag-name',
            `Tag ${current.name} is already in use`
          )
        }
        const now = resolveNow(input)
        const tag: Tag = tagSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          deletedAt: null,
          deletedFlag: 0,
          activeNameKey
        })
        await this.database.tags.put(tag)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'tag',
          primaryEntityId: tag.id,
          summary: `Restored tag ${tag.name}`,
          resultEntityIds: [tag.id]
        })
        return { value: tag, replayed: false, warnings: [] }
      }
    )
  }

  async softDeleteMouse(
    input: SoftDeleteMouseInput
  ): Promise<CommandResult<Mouse>> {
    const action = 'mouse.soft-delete'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.cageAssignments,
        this.database.experimentAssignments,
        this.database.breedingPairs,
        this.database.mouseEvents,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const mouse = await this.database.mice.get(this.resultId(replay))
          if (!mouse) {
            throw new ServiceError(
              'integrity-error',
              'Deleted mouse referenced by activity log is missing'
            )
          }
          return { value: mouse, replayed: true, warnings: [] }
        }
        const current = await this.activeRecord(
          this.database.mice,
          input.mouseId,
          'Mouse'
        )
        this.assertRevision(current, input.expectedRevision)
        const now = resolveNow(input)
        const { date, time } = instantToLocalDateTime(now)
        const event = this.buildEvent(input, now, {
          mouse: current,
          eventType: 'custom',
          occurredOn: date,
          occurredTime: time,
          occurredAt: now,
          title: 'Mouse record deleted',
          description: input.reason,
          payload: { previousStatus: current.status }
        })
        const currentCage = await this.database.cageAssignments
          .where('activeMouseKey')
          .equals(current.id)
          .first()
        if (currentCage) {
          const ended: CageAssignment = cageAssignmentSchema.parse({
            ...currentCage,
            revision: currentCage.revision + 1,
            updatedAt: now,
            endedAt: now,
            activeFlag: 0,
            activeMouseKey: undefined,
            endReason: 'mouse-deleted',
            endedEventId: event.id
          })
          await this.database.cageAssignments.put(ended)
        }
        const experimentAssignments =
          await this.database.experimentAssignments
            .filter(
              assignment =>
                assignment.mouseId === current.id &&
                assignment.activeFlag === 1
            )
            .toArray()
        for (const assignment of experimentAssignments) {
          const ended: ExperimentAssignment =
            experimentAssignmentSchema.parse({
              ...assignment,
              revision: assignment.revision + 1,
              updatedAt: now,
              exitedAt: now,
              exitReason: 'mouse-deleted',
              activeFlag: 0,
              activeGroupMouseKey: undefined,
              activeExclusionMouseKey: undefined
            })
          await this.database.experimentAssignments.put(ended)
        }
        const pairs = await this.database.breedingPairs
          .filter(
            pair =>
              pair.deletedFlag === 0 &&
              CURRENT_BREEDING_STATUSES.has(pair.status) &&
              (pair.sireId === current.id || pair.damId === current.id)
          )
          .toArray()
        for (const pair of pairs) {
          const endedPair: BreedingPair = breedingPairSchema.parse({
            ...pair,
            revision: pair.revision + 1,
            updatedAt: now,
            status: 'completed',
            separatedOn: date,
            activePairKey: undefined
          })
          await this.database.breedingPairs.put(endedPair)
        }
        const mouse: Mouse = mouseSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          deletedAt: now,
          deletedFlag: 1,
          activeEarTagKey: undefined,
          currentCageId: undefined
        })
        await this.database.mouseEvents.add(event)
        await this.database.mice.put(mouse)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'mouse',
          primaryEntityId: mouse.id,
          entityRefs: [['mouseEvent', event.id]],
          summary: `Deleted mouse ${mouseDisplayLabel(mouse)}`,
          resultEntityIds: [mouse.id, event.id]
        })
        return { value: mouse, replayed: false, warnings: [] }
      }
    )
  }

  async restoreMouse(
    input: RestoreMouseInput
  ): Promise<CommandResult<Mouse>> {
    const action = 'mouse.restore'
    return this.database.transaction(
      'rw',
      [this.database.mice, this.database.tags, this.database.activityLogs],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const mouse = await this.database.mice.get(this.resultId(replay))
          if (!mouse) {
            throw new ServiceError(
              'integrity-error',
              'Restored mouse referenced by activity log is missing'
            )
          }
          return { value: mouse, replayed: true, warnings: [] }
        }
        const current = await this.database.mice.get(input.mouseId)
        if (!current) {
          throw new ServiceError(
            'not-found',
            `Mouse ${input.mouseId} not found`
          )
        }
        if (current.deletedFlag === 0) {
          throw new ServiceError('invalid-state', 'Mouse is not deleted')
        }
        this.assertRevision(current, input.expectedRevision)
        const activeEarTagKey = makeActiveKey('ear', current.earTag)
        if (
          activeEarTagKey &&
          (await this.database.mice
            .where('activeEarTagKey')
            .equals(activeEarTagKey)
            .first())
        ) {
          throw new ServiceError(
            'duplicate-ear-tag',
            `Ear tag ${current.earTag} is already in use`
          )
        }
        const now = resolveNow(input)
        const mouse: Mouse = mouseSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          deletedAt: null,
          deletedFlag: 0,
          activeEarTagKey,
          currentCageId: undefined
        })
        await this.validateMouseRelations(mouse)
        await this.database.mice.put(mouse)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'mouse',
          primaryEntityId: mouse.id,
          summary: `Restored mouse ${mouseDisplayLabel(mouse)}`,
          resultEntityIds: [mouse.id]
        })
        return { value: mouse, replayed: false, warnings: [] }
      }
    )
  }

  async softDeleteCage(
    input: SoftDeleteCageInput
  ): Promise<CommandResult<Cage>> {
    const action = 'cage.soft-delete'
    return this.database.transaction(
      'rw',
      [
        this.database.cages,
        this.database.cageAssignments,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const cage = await this.database.cages.get(this.resultId(replay))
          if (!cage) {
            throw new ServiceError(
              'integrity-error',
              'Deleted cage referenced by activity log is missing'
            )
          }
          return { value: cage, replayed: true, warnings: [] }
        }
        const current = await this.activeRecord(
          this.database.cages,
          input.cageId,
          'Cage'
        )
        this.assertRevision(current, input.expectedRevision)
        const occupancy = await this.database.cageAssignments
          .where('[cageId+activeFlag]')
          .equals([current.id, 1])
          .count()
        if (occupancy > 0) {
          throw new ServiceError(
            'invalid-state',
            'A cage with active mice cannot be deleted',
            { occupancy }
          )
        }
        const now = resolveNow(input)
        const cage: Cage = cageSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          deletedAt: now,
          deletedFlag: 1,
          activeCageNumberKey: undefined
        })
        await this.database.cages.put(cage)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'cage',
          primaryEntityId: cage.id,
          summary: `Deleted cage ${cage.cageNumber}`,
          resultEntityIds: [cage.id]
        })
        return { value: cage, replayed: false, warnings: [] }
      }
    )
  }

  async restoreCage(input: RestoreCageInput): Promise<CommandResult<Cage>> {
    const action = 'cage.restore'
    return this.database.transaction(
      'rw',
      [this.database.cages, this.database.activityLogs],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const cage = await this.database.cages.get(this.resultId(replay))
          if (!cage) {
            throw new ServiceError(
              'integrity-error',
              'Restored cage referenced by activity log is missing'
            )
          }
          return { value: cage, replayed: true, warnings: [] }
        }
        const current = await this.database.cages.get(input.cageId)
        if (!current) {
          throw new ServiceError('not-found', `Cage ${input.cageId} not found`)
        }
        if (current.deletedFlag === 0) {
          throw new ServiceError('invalid-state', 'Cage is not deleted')
        }
        this.assertRevision(current, input.expectedRevision)
        const activeCageNumberKey = makeActiveKey(
          'cage',
          current.cageNumber
        )
        if (
          activeCageNumberKey &&
          (await this.database.cages
            .where('activeCageNumberKey')
            .equals(activeCageNumberKey)
            .first())
        ) {
          throw new ServiceError(
            'duplicate-cage-number',
            `Cage number ${current.cageNumber} is already in use`
          )
        }
        const now = resolveNow(input)
        const cage: Cage = cageSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          deletedAt: null,
          deletedFlag: 0,
          activeCageNumberKey
        })
        await this.database.cages.put(cage)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'cage',
          primaryEntityId: cage.id,
          summary: `Restored cage ${cage.cageNumber}`,
          resultEntityIds: [cage.id]
        })
        return { value: cage, replayed: false, warnings: [] }
      }
    )
  }

  async softDeleteExperiment(
    input: SoftDeleteExperimentInput
  ): Promise<CommandResult<Experiment>> {
    const action = 'experiment.soft-delete'
    return this.database.transaction(
      'rw',
      [
        this.database.experiments,
        this.database.experimentAssignments,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const experiment = await this.database.experiments.get(
            this.resultId(replay)
          )
          if (!experiment) {
            throw new ServiceError(
              'integrity-error',
              'Deleted experiment referenced by activity log is missing'
            )
          }
          return { value: experiment, replayed: true, warnings: [] }
        }
        const current = await this.activeRecord(
          this.database.experiments,
          input.experimentId,
          'Experiment'
        )
        this.assertRevision(current, input.expectedRevision)
        const activeAssignments =
          await this.database.experimentAssignments
            .where('[experimentId+activeFlag]')
            .equals([current.id, 1])
            .count()
        if (activeAssignments > 0) {
          throw new ServiceError(
            'invalid-state',
            'An experiment with active assignments cannot be deleted',
            { activeAssignments }
          )
        }
        const now = resolveNow(input)
        const experiment: Experiment = experimentSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          deletedAt: now,
          deletedFlag: 1,
          activeExperimentCodeKey: undefined
        })
        await this.database.experiments.put(experiment)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'experiment',
          primaryEntityId: experiment.id,
          summary: `Deleted experiment ${experiment.name}`,
          resultEntityIds: [experiment.id]
        })
        return { value: experiment, replayed: false, warnings: [] }
      }
    )
  }

  async restoreExperiment(
    input: RestoreExperimentInput
  ): Promise<CommandResult<Experiment>> {
    const action = 'experiment.restore'
    return this.database.transaction(
      'rw',
      [this.database.experiments, this.database.activityLogs],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const experiment = await this.database.experiments.get(
            this.resultId(replay)
          )
          if (!experiment) {
            throw new ServiceError(
              'integrity-error',
              'Restored experiment referenced by activity log is missing'
            )
          }
          return { value: experiment, replayed: true, warnings: [] }
        }
        const current = await this.database.experiments.get(input.experimentId)
        if (!current) {
          throw new ServiceError(
            'not-found',
            `Experiment ${input.experimentId} not found`
          )
        }
        if (current.deletedFlag === 0) {
          throw new ServiceError('invalid-state', 'Experiment is not deleted')
        }
        this.assertRevision(current, input.expectedRevision)
        const activeExperimentCodeKey = makeActiveKey(
          'experiment',
          current.code
        )
        if (
          activeExperimentCodeKey &&
          (await this.database.experiments
            .where('activeExperimentCodeKey')
            .equals(activeExperimentCodeKey)
            .first())
        ) {
          throw new ServiceError(
            'duplicate-experiment-code',
            `Experiment code ${current.code} is already in use`
          )
        }
        const now = resolveNow(input)
        const experiment: Experiment = experimentSchema.parse({
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
          deletedAt: null,
          deletedFlag: 0,
          activeExperimentCodeKey
        })
        await this.database.experiments.put(experiment)
        await this.addActivity(input, now, {
          action,
          primaryEntityType: 'experiment',
          primaryEntityId: experiment.id,
          summary: `Restored experiment ${experiment.name}`,
          resultEntityIds: [experiment.id]
        })
        return { value: experiment, replayed: false, warnings: [] }
      }
    )
  }

  async ensureAppSettings(): Promise<AppSettings> {
    return this.database.transaction(
      'rw',
      this.database.appSettings,
      async () => {
        const existing = await this.database.appSettings.get('app-settings')
        if (existing) {
          return appSettingsSchema.parse(existing)
        }
        const now = new Date().toISOString()
        const timeZone =
          Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE
        const settings: AppSettings = appSettingsSchema.parse({
          ...baseFields(
            { operationId: 'settings.initialize', origin: 'system' },
            'app-settings',
            now
          ),
          appName: APP_CONFIG.name,
          locale:
            typeof navigator === 'undefined' ? 'en' : navigator.language,
          timeZone,
          weekStartsOn: 1,
          capacityWarningPercent: 0.8,
          weightAnomalyPercent: 0.25,
          notificationPreferences: {
            enabled: false,
            reminderMinutesBefore: 60
          },
          databaseInstanceId: newId()
        })
        await this.database.appSettings.add(settings)
        return settings
      }
    )
  }

  async generateSampleData(
    input: CommandContext
  ): Promise<CommandResult<SampleDataResult>> {
    const action = 'sample.generate'
    return this.database.transaction(
      'rw',
      [
        this.database.mice,
        this.database.cages,
        this.database.cageAssignments,
        this.database.tags,
        this.database.mouseEvents,
        this.database.activityLogs
      ],
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const cage = await this.database.cages.get(this.resultId(replay))
          const tag = await this.database.tags.get(this.resultId(replay, 1))
          const mice = await Promise.all(
            (replay.resultEntityIds ?? [])
              .slice(2)
              .map(id => this.database.mice.get(id))
          )
          if (!cage || !tag || mice.some(mouse => mouse === undefined)) {
            throw new ServiceError(
              'integrity-error',
              'Generated sample data replay is incomplete'
            )
          }
          return {
            value: {
              sampleBatchId:
                replay.sampleBatchId ?? input.sampleBatchId ?? 'unknown',
              cage,
              tag,
              mice: mice.filter((mouse): mouse is Mouse => mouse !== undefined)
            },
            replayed: true,
            warnings: []
          }
        }

        const sampleBatchId = input.sampleBatchId ?? newId()
        const context: CommandContext = {
          ...input,
          origin: 'sample',
          sampleBatchId
        }
        const now = resolveNow(context)
        const suffix = sampleBatchId.slice(0, 8)
        const cageNumber = `SAMPLE-${suffix}`
        const cageKey = makeActiveKey('cage', cageNumber)
        const tagName = `Sample ${suffix}`
        const tagKey = makeActiveKey('tag', tagName)
        if (
          (cageKey &&
            (await this.database.cages
              .where('activeCageNumberKey')
              .equals(cageKey)
              .first())) ||
          (tagKey &&
            (await this.database.tags
              .where('activeNameKey')
              .equals(tagKey)
              .first()))
        ) {
          throw new ServiceError(
            'invalid-state',
            'Sample batch identifiers collide with existing data'
          )
        }
        const cage: Cage = cageSchema.parse({
          ...baseFields(context, newId(), now),
          cageNumber,
          normalizedCageNumber: normalizeText(cageNumber),
          activeCageNumberKey: cageKey,
          room: 'Sample room',
          roomKey: normalizeText('Sample room'),
          rack: 'A1',
          rackKey: normalizeText('A1'),
          maxCapacity: 5,
          purpose: 'Demonstration',
          status: 'active',
          notes: 'Generated sample cage'
        })
        const tag: Tag = tagSchema.parse({
          ...baseFields(context, newId(), now),
          name: tagName,
          normalizedName: normalizeText(tagName),
          activeNameKey: tagKey,
          color: '#64748b',
          description: 'Generated sample tag'
        })
        const mouseInputs = [
          {
            earTag: `S-${suffix}-01`,
            name: 'Atlas',
            sex: 'male' as const,
            genotype: 'WT'
          },
          {
            earTag: `S-${suffix}-02`,
            name: 'Nova',
            sex: 'female' as const,
            genotype: 'Het'
          }
        ]
        const mice = mouseInputs.map(item =>
          mouseSchema.parse({
            ...baseFields(context, newId(), now),
            earTag: item.earTag,
            normalizedEarTag: normalizeText(item.earTag),
            activeEarTagKey: makeActiveKey('ear', item.earTag),
            name: item.name,
            normalizedAlias: normalizeText(item.name),
            strain: 'C57BL/6J',
            strainKey: normalizeText('C57BL/6J'),
            genotype: item.genotype,
            genotypeKey: normalizeText(item.genotype),
            sex: item.sex,
            birthDate: '2026-01-15',
            currentCageId: cage.id,
            status: 'alive',
            source: 'sample generator',
            notes: 'Generated sample mouse',
            tagIds: [tag.id],
            searchTerms: buildSearchTerms([
              item.earTag,
              item.name,
              'C57BL/6J',
              item.genotype
            ])
          })
        )
        const { date, time } = instantToLocalDateTime(now)
        const events = mice.map(mouse =>
          this.buildEvent(context, now, {
            mouse,
            cage,
            eventType: 'cage-transfer',
            occurredOn: date,
            occurredTime: time,
            occurredAt: now,
            title: 'Assigned to sample cage',
            payload: { toCageId: cage.id }
          })
        )
        const assignments = mice.map((mouse, index) =>
          cageAssignmentSchema.parse({
            ...baseFields(context, newId(), now),
            mouseId: mouse.id,
            cageId: cage.id,
            startedAt: now,
            activeFlag: 1,
            activeMouseKey: mouse.id,
            startReason: 'sample generator',
            startedEventId: events[index]?.id,
            cageNumberSnapshot: cage.cageNumber,
            mouseLabelSnapshot: mouseDisplayLabel(mouse)
          })
        )
        await this.database.cages.add(cage)
        await this.database.tags.add(tag)
        await this.database.mice.bulkAdd(mice)
        await this.database.mouseEvents.bulkAdd(events)
        await this.database.cageAssignments.bulkAdd(assignments)
        await this.addActivity(context, now, {
          action,
          primaryEntityType: 'cage',
          primaryEntityId: cage.id,
          entityRefs: [
            ['tag', tag.id],
            ...mice.map(mouse => ['mouse', mouse.id] as const)
          ],
          summary: `Generated sample batch ${sampleBatchId}`,
          resultEntityIds: [
            cage.id,
            tag.id,
            ...mice.map(mouse => mouse.id)
          ],
          metadata: { sampleBatchId }
        })
        return {
          value: { sampleBatchId, cage, tag, mice },
          replayed: false,
          warnings: []
        }
      }
    )
  }

  async deleteSampleBatch(
    input: DeleteSampleBatchInput
  ): Promise<CommandResult<DeleteSampleBatchResult>> {
    const action = 'sample.delete-batch'
    return this.database.transaction(
      'rw',
      this.database.tables,
      async () => {
        const replay = await this.operationLog(input.operationId, action)
        if (replay) {
          const metadata = replay.metadata
          const deletedCount =
            isRecord(metadata) && typeof metadata.deletedCount === 'number'
              ? metadata.deletedCount
              : 0
          return {
            value: { sampleBatchId: input.sampleBatchId, deletedCount },
            replayed: true,
            warnings: []
          }
        }

        const tableRecords = await Promise.all([
          this.database.mice.toArray(),
          this.database.cages.toArray(),
          this.database.cageAssignments.toArray(),
          this.database.breedingPairs.toArray(),
          this.database.litters.toArray(),
          this.database.experiments.toArray(),
          this.database.experimentGroups.toArray(),
          this.database.experimentAssignments.toArray(),
          this.database.mouseEvents.toArray(),
          this.database.weightRecords.toArray(),
          this.database.tasks.toArray(),
          this.database.tags.toArray(),
          this.database.activityLogs.toArray(),
          this.database.savedViews.toArray(),
          this.database.appSettings.toArray(),
          this.database.backupMetadata.toArray()
        ])
        const allRecords: StoredEntity[] = tableRecords.flat()
        const sampleRecords = allRecords.filter(
          record => record.sampleBatchId === input.sampleBatchId
        )
        if (sampleRecords.length === 0) {
          throw new ServiceError(
            'not-found',
            `Sample batch ${input.sampleBatchId} was not found`
          )
        }
        const sampleIds = new Set(sampleRecords.map(record => record.id))
        const externalReference = allRecords.find(
          record =>
            record.sampleBatchId !== input.sampleBatchId &&
            containsReference(record, sampleIds)
        )
        if (externalReference) {
          throw new ServiceError(
            'mixed-sample-references',
            'Sample data is referenced by data outside the batch',
            { referencingRecordId: externalReference.id }
          )
        }

        const keysFor = <T extends StoredEntity>(
          records: readonly T[]
        ): string[] =>
          records
            .filter(record => record.sampleBatchId === input.sampleBatchId)
            .map(record => record.id)
        await Promise.all([
          this.database.mice.bulkDelete(keysFor(tableRecords[0])),
          this.database.cages.bulkDelete(keysFor(tableRecords[1])),
          this.database.cageAssignments.bulkDelete(keysFor(tableRecords[2])),
          this.database.breedingPairs.bulkDelete(keysFor(tableRecords[3])),
          this.database.litters.bulkDelete(keysFor(tableRecords[4])),
          this.database.experiments.bulkDelete(keysFor(tableRecords[5])),
          this.database.experimentGroups.bulkDelete(keysFor(tableRecords[6])),
          this.database.experimentAssignments.bulkDelete(
            keysFor(tableRecords[7])
          ),
          this.database.mouseEvents.bulkDelete(keysFor(tableRecords[8])),
          this.database.weightRecords.bulkDelete(keysFor(tableRecords[9])),
          this.database.tasks.bulkDelete(keysFor(tableRecords[10])),
          this.database.tags.bulkDelete(keysFor(tableRecords[11])),
          this.database.activityLogs.bulkDelete(keysFor(tableRecords[12])),
          this.database.savedViews.bulkDelete(keysFor(tableRecords[13])),
          this.database.appSettings.bulkDelete(keysFor(tableRecords[14])),
          this.database.backupMetadata.bulkDelete(keysFor(tableRecords[15]))
        ])
        const now = resolveNow(input)
        const result: DeleteSampleBatchResult = {
          sampleBatchId: input.sampleBatchId,
          deletedCount: sampleRecords.length
        }
        await this.addActivity(
          { ...input, origin: 'system', sampleBatchId: undefined },
          now,
          {
            action,
            primaryEntityType: 'activityLog',
            primaryEntityId: input.sampleBatchId,
            summary: `Deleted sample batch ${input.sampleBatchId}`,
            metadata: {
              sampleBatchId: result.sampleBatchId,
              deletedCount: result.deletedCount
            }
          }
        )
        return { value: result, replayed: false, warnings: [] }
      }
    )
  }
}

export function createMouseKeeperService(
  database: MouseKeeperDatabase = defaultDatabase
): MouseKeeperService {
  return new MouseKeeperService(database)
}

export function createIsolatedMouseKeeperService(
  databaseName: string
): MouseKeeperService {
  return new MouseKeeperService(createMouseKeeperDatabase(databaseName))
}
