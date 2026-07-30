export type IsoInstant = string
export type LocalDate = string
export type LocalTime = string

export type JsonPrimitive = null | boolean | number | string
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

export type DataOrigin = 'user' | 'sample' | 'import' | 'system'
export type DeletedFlag = 0 | 1

export interface StoredEntity {
  id: string
  schemaVersion: number
  revision: number
  createdAt: IsoInstant
  updatedAt: IsoInstant
  deletedAt: IsoInstant | null
  deletedFlag: DeletedFlag
  origin: DataOrigin
  sampleBatchId?: string
  importBatchId?: string
  custom?: Record<string, JsonValue>
}

export const MOUSE_SEXES = [
  'male',
  'female',
  'unknown',
  'intersex',
  'other'
] as const
export type MouseSex = (typeof MOUSE_SEXES)[number]

export const MOUSE_STATUSES = [
  'alive',
  'experimental',
  'breeding',
  'reserved',
  'transferred',
  'dead',
  'euthanized',
  'other'
] as const
export type MouseStatus = (typeof MOUSE_STATUSES)[number]

export interface Mouse extends StoredEntity {
  earTag?: string
  normalizedEarTag?: string
  activeEarTagKey?: string
  experimentNumber?: string
  normalizedExperimentNumber?: string
  name?: string
  alias?: string
  normalizedAlias?: string
  strain: string
  strainKey: string
  genotype?: string
  genotypeKey?: string
  sex: MouseSex
  birthDate?: LocalDate
  sireId?: string
  damId?: string
  litterId?: string
  currentCageId?: string
  status: MouseStatus
  source?: string
  coatColor?: string
  notes?: string
  tagIds: string[]
  searchTerms: string[]
}

export const CAGE_STATUSES = [
  'active',
  'inactive',
  'cleaning',
  'retired',
  'other'
] as const
export type CageStatus = (typeof CAGE_STATUSES)[number]

export interface Cage extends StoredEntity {
  cageNumber: string
  normalizedCageNumber: string
  activeCageNumberKey?: string
  room?: string
  roomKey?: string
  rack?: string
  rackKey?: string
  maxCapacity: number
  primaryStrain?: string
  purpose?: string
  status: CageStatus
  notes?: string
}

export interface CageAssignment extends StoredEntity {
  mouseId: string
  cageId: string
  startedAt: IsoInstant
  endedAt?: IsoInstant
  activeFlag: DeletedFlag
  activeMouseKey?: string
  startReason?: string
  endReason?: string
  startedEventId?: string
  endedEventId?: string
  cageNumberSnapshot: string
  mouseLabelSnapshot: string
}

export const BREEDING_PAIR_STATUSES = [
  'planned',
  'active',
  'separated',
  'completed',
  'cancelled'
] as const
export type BreedingPairStatus = (typeof BREEDING_PAIR_STATUSES)[number]

export interface BreedingPair extends StoredEntity {
  sireId: string
  damId: string
  pairedOn: LocalDate
  separatedOn?: LocalDate
  expectedDeliveryDate?: LocalDate
  status: BreedingPairStatus
  activePairKey?: string
  notes?: string
  warningAcknowledgements?: string[]
}

export interface Litter extends StoredEntity {
  breedingPairId: string
  litterNumber: string
  normalizedLitterNumber: string
  activeLitterKey?: string
  sireId: string
  damId: string
  bornOn: LocalDate
  bornCount: number
  aliveCount: number
  weanedOn?: LocalDate
  notes?: string
}

export const EXPERIMENT_STATUSES = [
  'planned',
  'active',
  'completed',
  'cancelled',
  'archived'
] as const
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number]

export interface Experiment extends StoredEntity {
  code?: string
  normalizedCode?: string
  activeExperimentCodeKey?: string
  name: string
  normalizedName: string
  description?: string
  startDate?: LocalDate
  endDate?: LocalDate
  status: ExperimentStatus
  intervention?: string
  dose?: string
  frequency?: string
  principalInvestigator?: string
  notes?: string
  searchTerms: string[]
}

export const EXPERIMENT_GROUP_TYPES = [
  'control',
  'treatment',
  'custom'
] as const
export type ExperimentGroupType = (typeof EXPERIMENT_GROUP_TYPES)[number]

export interface ExperimentGroup extends StoredEntity {
  experimentId: string
  name: string
  normalizedName: string
  groupType: ExperimentGroupType
  activeGroupNameKey?: string
  exclusionSet?: string
  intervention?: string
  dose?: string
  frequency?: string
  notes?: string
}

export interface ExperimentAssignment extends StoredEntity {
  mouseId: string
  experimentId: string
  groupId: string
  joinedAt: IsoInstant
  exitedAt?: IsoInstant
  exitReason?: string
  activeFlag: DeletedFlag
  activeGroupMouseKey?: string
  activeExclusionMouseKey?: string
  joinedEventId?: string
  exitedEventId?: string
  experimentNameSnapshot: string
  groupNameSnapshot: string
  mouseLabelSnapshot: string
}

export const MOUSE_EVENT_TYPES = [
  'weight',
  'medication',
  'injection',
  'surgery',
  'behavior',
  'sampling',
  'cage-transfer',
  'status-change',
  'observation',
  'abnormality',
  'death',
  'euthanasia',
  'tag-change',
  'experiment-join',
  'experiment-exit',
  'custom'
] as const
export type MouseEventType = (typeof MOUSE_EVENT_TYPES)[number]

export interface EntitySnapshot {
  mouseLabel?: string
  cageNumber?: string
  experimentName?: string
}

export interface MouseEvent extends StoredEntity {
  eventType: MouseEventType
  occurredOn: LocalDate
  occurredTime?: LocalTime
  timeZone: string
  occurredAt: IsoInstant
  mouseId: string
  cageId?: string
  experimentId?: string
  title: string
  normalizedTitle: string
  description?: string
  payloadVersion: number
  payload: JsonValue
  sourceType?: EntityType
  sourceId?: string
  snapshot?: EntitySnapshot
  searchTerms: string[]
}

export const WEIGHT_UNITS = ['g', 'mg'] as const
export type WeightUnit = (typeof WEIGHT_UNITS)[number]

export interface WeightRecord extends StoredEntity {
  mouseId: string
  eventId: string
  measuredOn: LocalDate
  measuredTime?: LocalTime
  timeZone: string
  measuredAt: IsoInstant
  value: number
  unit: WeightUnit
  valueGrams: number
  notes?: string
  anomalyAcknowledged?: boolean
}

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const TASK_STATUSES = ['pending', 'completed', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export interface Task extends StoredEntity {
  title: string
  dueDate: LocalDate
  dueTime?: LocalTime
  dueSortKey: string
  mouseId?: string
  cageId?: string
  experimentId?: string
  priority: TaskPriority
  status: TaskStatus
  notes?: string
  completedAt?: IsoInstant
}

export interface Tag extends StoredEntity {
  name: string
  normalizedName: string
  activeNameKey?: string
  color?: string
  description?: string
}

export type EntityType =
  | 'mouse'
  | 'cage'
  | 'cageAssignment'
  | 'breedingPair'
  | 'litter'
  | 'experiment'
  | 'experimentGroup'
  | 'experimentAssignment'
  | 'mouseEvent'
  | 'weightRecord'
  | 'task'
  | 'tag'
  | 'activityLog'
  | 'savedView'
  | 'appSettings'
  | 'backupMetadata'

export interface ActivityLog extends StoredEntity {
  operationId: string
  occurredAt: IsoInstant
  action: string
  primaryEntityType: EntityType
  primaryEntityId: string
  primaryEntityKey: string
  entityRefKeys: string[]
  summary: string
  changedFields?: string[]
  warningAcknowledgements?: string[]
  resultEntityIds?: string[]
  metadata?: JsonValue
}

export const SAVED_VIEW_SCOPES = [
  'mice',
  'cages',
  'experiments',
  'events',
  'tasks'
] as const
export type SavedViewScope = (typeof SAVED_VIEW_SCOPES)[number]

export interface SavedView extends StoredEntity {
  scope: SavedViewScope
  name: string
  normalizedName: string
  activeScopeNameKey?: string
  queryVersion: number
  filters: JsonValue
  sort: JsonValue
  columns?: JsonValue
  lastUsedAt?: IsoInstant
}

export interface NotificationPreferences {
  enabled: boolean
  reminderMinutesBefore: number
}

export interface AppSettings extends StoredEntity {
  appName: string
  locale: string
  timeZone: string
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
  capacityWarningPercent: number
  weightAnomalyPercent: number
  notificationPreferences: NotificationPreferences
  lastIntegrityCheckAt?: IsoInstant
  databaseInstanceId: string
}

export const BACKUP_KINDS = [
  'export',
  'pre-restore',
  'restore',
  'salvage'
] as const
export type BackupKind = (typeof BACKUP_KINDS)[number]

export const BACKUP_STATUSES = ['started', 'succeeded', 'failed'] as const
export type BackupStatus = (typeof BACKUP_STATUSES)[number]

export interface BackupMetadata extends StoredEntity {
  backupId: string
  kind: BackupKind
  status: BackupStatus
  backupFormatVersion: number
  backupSchemaVersion: number
  appVersion: string
  exportedAt: IsoInstant
  fileName?: string
  checksum?: string
  tableCounts?: Record<string, number>
  sourceDatabaseInstanceId?: string
  errorCode?: string
  errorSummary?: string
}

export type MouseKeeperEntity =
  | Mouse
  | Cage
  | CageAssignment
  | BreedingPair
  | Litter
  | Experiment
  | ExperimentGroup
  | ExperimentAssignment
  | MouseEvent
  | WeightRecord
  | Task
  | Tag
  | ActivityLog
  | SavedView
  | AppSettings
  | BackupMetadata

