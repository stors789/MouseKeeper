import type {
  BreedingPairStatus,
  Cage,
  CageAssignment,
  CageStatus,
  DataOrigin,
  Experiment,
  ExperimentAssignment,
  ExperimentGroup,
  ExperimentGroupType,
  ExperimentStatus,
  IsoInstant,
  JsonValue,
  Litter,
  LocalDate,
  LocalTime,
  Mouse,
  MouseEvent,
  MouseEventType,
  MouseSex,
  MouseStatus,
  Tag,
  TaskPriority,
  TaskStatus,
  WeightRecord,
  WeightUnit
} from '../domain'

export const WARNING_CODES = {
  cageCapacityExceeded: 'cage-capacity-exceeded',
  sireSexMismatch: 'sire-sex-mismatch',
  damSexMismatch: 'dam-sex-mismatch',
  unavailableBreedingMouse: 'unavailable-breeding-mouse',
  duplicateBreedingHistory: 'duplicate-breeding-history',
  unavailableExperimentMouse: 'unavailable-experiment-mouse',
  weightAnomaly: 'weight-anomaly'
} as const

export interface CommandContext {
  operationId: string
  now?: IsoInstant
  origin?: DataOrigin
  sampleBatchId?: string
  importBatchId?: string
  warningAcknowledgements?: readonly string[]
}

export interface CommandResult<T> {
  value: T
  replayed: boolean
  warnings: readonly string[]
}

export interface CreateMouseInput extends CommandContext {
  id?: string
  earTag?: string
  experimentNumber?: string
  name?: string
  alias?: string
  strain: string
  genotype?: string
  sex: MouseSex
  birthDate?: LocalDate
  sireId?: string
  damId?: string
  litterId?: string
  status?: MouseStatus
  source?: string
  coatColor?: string
  notes?: string
  tagIds?: readonly string[]
  custom?: Record<string, JsonValue>
}

export interface CreateMiceInput extends CommandContext {
  entries: ReadonlyArray<Omit<CreateMouseInput, keyof CommandContext>>
}

export interface MouseBatchCreationValue {
  mice: Mouse[]
}

export interface CreateMouseWithCageInput extends CreateMouseInput {
  initialCageId?: string
  initialCageReason?: string
}

export interface CreateMouseWithCageValue {
  mouse: Mouse
  assignment?: CageAssignment
  event?: MouseEvent
}

export interface UpdateMousePatch {
  earTag?: string | null
  experimentNumber?: string | null
  name?: string | null
  alias?: string | null
  strain?: string
  genotype?: string | null
  sex?: MouseSex
  birthDate?: LocalDate | null
  sireId?: string | null
  damId?: string | null
  source?: string | null
  coatColor?: string | null
  notes?: string | null
}

export interface UpdateMouseInput extends CommandContext {
  mouseId: string
  expectedRevision: number
  patch: UpdateMousePatch
}

export interface CreateCageInput extends CommandContext {
  id?: string
  cageNumber: string
  room?: string
  rack?: string
  maxCapacity: number
  primaryStrain?: string
  purpose?: string
  status?: CageStatus
  notes?: string
  custom?: Record<string, JsonValue>
}

export interface UpdateCageInput extends CommandContext {
  cageId: string
  expectedRevision: number
  patch: {
    cageNumber?: string
    room?: string | null
    rack?: string | null
    maxCapacity?: number
    primaryStrain?: string | null
    purpose?: string | null
    status?: CageStatus
    notes?: string | null
  }
}

export interface MoveMouseInput extends CommandContext {
  id?: string
  mouseId: string
  cageId: string
  reason?: string
}

export interface MoveMouseValue {
  mouse: Mouse
  assignment: CageAssignment
  event: MouseEvent
}

export interface LeaveCageInput extends CommandContext {
  mouseId: string
  reason?: string
}

export interface LeaveCageValue {
  mouse: Mouse
  assignment: CageAssignment
  event: MouseEvent
}

export interface ChangeMouseStatusInput extends CommandContext {
  mouseId: string
  expectedRevision?: number
  status: MouseStatus
  occurredOn: LocalDate
  occurredTime?: LocalTime
  reason?: string
}

export interface StatusChangeValue {
  mouse: Mouse
  event: MouseEvent
}

export interface TerminateMouseInput extends CommandContext {
  mouseId: string
  expectedRevision?: number
  status: Extract<MouseStatus, 'dead' | 'euthanized' | 'transferred'>
  occurredOn: LocalDate
  occurredTime?: LocalTime
  reason?: string
}

export interface CreateBreedingPairInput extends CommandContext {
  id?: string
  sireId: string
  damId: string
  pairedOn: LocalDate
  expectedDeliveryDate?: LocalDate
  status?: BreedingPairStatus
  notes?: string
}

export interface UpdateBreedingPairInput extends CommandContext {
  breedingPairId: string
  expectedRevision: number
  patch: {
    pairedOn?: LocalDate
    separatedOn?: LocalDate | null
    expectedDeliveryDate?: LocalDate | null
    status?: BreedingPairStatus
    notes?: string | null
  }
}

export interface OffspringInput {
  id?: string
  earTag?: string
  experimentNumber?: string
  name?: string
  alias?: string
  strain?: string
  genotype?: string
  sex: MouseSex
  coatColor?: string
  notes?: string
}

export interface CreateLitterInput extends CommandContext {
  id?: string
  breedingPairId: string
  litterNumber: string
  bornOn: LocalDate
  bornCount?: number
  aliveCount?: number
  weanedOn?: LocalDate
  notes?: string
  offspring: readonly OffspringInput[]
}

export interface LitterCreationValue {
  litter: Litter
  offspring: Mouse[]
}

export interface CreateExperimentInput extends CommandContext {
  id?: string
  code?: string
  name: string
  description?: string
  startDate?: LocalDate
  endDate?: LocalDate
  status?: ExperimentStatus
  intervention?: string
  dose?: string
  frequency?: string
  principalInvestigator?: string
  notes?: string
}

export interface CreateExperimentWithInitialGroupInput
  extends CreateExperimentInput {
  initialGroup: {
    name: string
    groupType: ExperimentGroupType
    exclusionSet?: string
    intervention?: string
    dose?: string
    frequency?: string
    notes?: string
  }
}

export interface ExperimentCreationValue {
  experiment: Experiment
  initialGroup: ExperimentGroup
}

export interface UpdateExperimentInput extends CommandContext {
  experimentId: string
  expectedRevision: number
  patch: {
    code?: string | null
    name?: string
    description?: string | null
    startDate?: LocalDate | null
    endDate?: LocalDate | null
    status?: ExperimentStatus
    intervention?: string | null
    dose?: string | null
    frequency?: string | null
    principalInvestigator?: string | null
    notes?: string | null
  }
}

export interface CreateExperimentGroupInput extends CommandContext {
  id?: string
  experimentId: string
  name: string
  groupType: ExperimentGroupType
  exclusionSet?: string
  intervention?: string
  dose?: string
  frequency?: string
  notes?: string
}

export interface AssignMouseToExperimentInput extends CommandContext {
  id?: string
  mouseId: string
  experimentId: string
  groupId: string
  joinedOn: LocalDate
  joinedTime?: LocalTime
}

export interface AssignMiceToExperimentInput extends CommandContext {
  mouseIds: readonly string[]
  experimentId: string
  groupId: string
  joinedOn: LocalDate
  joinedTime?: LocalTime
}

export interface ExperimentAssignmentValue {
  assignment: ExperimentAssignment
  event: MouseEvent
}

export interface ExperimentBatchAssignmentValue {
  entries: ExperimentAssignmentValue[]
}

export interface ExitExperimentAssignmentInput extends CommandContext {
  assignmentId: string
  exitedOn: LocalDate
  exitedTime?: LocalTime
  reason?: string
}

export interface CreateMouseEventInput extends CommandContext {
  id?: string
  mouseId: string
  eventType: Exclude<MouseEventType, 'weight'>
  occurredOn: LocalDate
  occurredTime?: LocalTime
  timeZone?: string
  cageId?: string
  experimentId?: string
  title: string
  description?: string
  payload?: JsonValue
}

export interface UpdateMouseEventInput extends CommandContext {
  eventId: string
  expectedRevision: number
  patch: {
    occurredOn?: LocalDate
    occurredTime?: LocalTime | null
    timeZone?: string
    cageId?: string | null
    experimentId?: string | null
    title?: string
    description?: string | null
    payload?: JsonValue
  }
}

export interface SoftDeleteMouseEventInput extends CommandContext {
  eventId: string
  expectedRevision?: number
}

export interface RecordWeightInput extends CommandContext {
  id?: string
  eventId?: string
  mouseId: string
  measuredOn: LocalDate
  measuredTime?: LocalTime
  timeZone?: string
  value: number
  unit: WeightUnit
  notes?: string
}

export interface RecordWeightsInput extends CommandContext {
  entries: ReadonlyArray<{
    mouseId: string
    measuredOn: LocalDate
    measuredTime?: LocalTime
    timeZone?: string
    value: number
    unit: WeightUnit
    notes?: string
  }>
}

export interface WeightEntryValue {
  weight: WeightRecord
  event: MouseEvent
}

export interface WeightBatchValue {
  entries: WeightEntryValue[]
}

export interface CreateTaskInput extends CommandContext {
  id?: string
  title: string
  dueDate: LocalDate
  dueTime?: LocalTime
  mouseId?: string
  cageId?: string
  experimentId?: string
  priority?: TaskPriority
  notes?: string
}

export interface UpdateTaskInput extends CommandContext {
  taskId: string
  expectedRevision: number
  patch: {
    title?: string
    dueDate?: LocalDate
    dueTime?: LocalTime | null
    mouseId?: string | null
    cageId?: string | null
    experimentId?: string | null
    priority?: TaskPriority
    notes?: string | null
  }
}

export interface SetTaskStatusInput extends CommandContext {
  taskId: string
  expectedRevision: number
  status: TaskStatus
}

export interface SoftDeleteTaskInput extends CommandContext {
  taskId: string
  expectedRevision?: number
}

export interface RestoreTaskInput extends CommandContext {
  taskId: string
  expectedRevision: number
}

export interface CreateTagInput extends CommandContext {
  id?: string
  name: string
  color?: string
  description?: string
}

export interface SetMouseTagsInput extends CommandContext {
  mouseId: string
  expectedRevision: number
  tagIds: readonly string[]
}

export interface SoftDeleteTagInput extends CommandContext {
  tagId: string
  expectedRevision?: number
}

export interface RestoreTagInput extends CommandContext {
  tagId: string
  expectedRevision: number
}

export interface SoftDeleteMouseInput extends CommandContext {
  mouseId: string
  expectedRevision?: number
  reason?: string
}

export interface RestoreMouseInput extends CommandContext {
  mouseId: string
  expectedRevision: number
}

export interface SoftDeleteCageInput extends CommandContext {
  cageId: string
  expectedRevision?: number
}

export interface RestoreCageInput extends CommandContext {
  cageId: string
  expectedRevision: number
}

export interface SoftDeleteExperimentInput extends CommandContext {
  experimentId: string
  expectedRevision?: number
}

export interface RestoreExperimentInput extends CommandContext {
  experimentId: string
  expectedRevision: number
}

export interface SampleDataResult {
  sampleBatchId: string
  cage: Cage
  mice: Mouse[]
  tag: Tag
}

export interface DeleteSampleBatchInput extends CommandContext {
  sampleBatchId: string
}

export interface DeleteSampleBatchResult {
  sampleBatchId: string
  deletedCount: number
}
