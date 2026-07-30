import type {
  ActivityLog,
  AppSettings,
  BackupMetadata,
  BreedingPair,
  Cage,
  CageAssignment,
  Experiment,
  ExperimentAssignment,
  ExperimentGroup,
  Litter,
  Mouse,
  MouseEvent,
  SavedView,
  Tag,
  Task,
  WeightRecord
} from '../domain'

export const BACKUP_FORMAT = 'mousekeeper-backup'
export const BACKUP_FORMAT_VERSION = 1
export const DEFAULT_MAX_BACKUP_BYTES = 100 * 1024 * 1024

export const BACKUP_TABLE_NAMES = [
  'mice',
  'cages',
  'cageAssignments',
  'breedingPairs',
  'litters',
  'experiments',
  'experimentGroups',
  'experimentAssignments',
  'mouseEvents',
  'weightRecords',
  'tasks',
  'tags',
  'activityLogs',
  'savedViews',
  'appSettings',
  'backupMetadata'
] as const

export type BackupTableName = (typeof BACKUP_TABLE_NAMES)[number]

export interface BackupTableRecordMap {
  mice: Mouse
  cages: Cage
  cageAssignments: CageAssignment
  breedingPairs: BreedingPair
  litters: Litter
  experiments: Experiment
  experimentGroups: ExperimentGroup
  experimentAssignments: ExperimentAssignment
  mouseEvents: MouseEvent
  weightRecords: WeightRecord
  tasks: Task
  tags: Tag
  activityLogs: ActivityLog
  savedViews: SavedView
  appSettings: AppSettings
  backupMetadata: BackupMetadata
}

export type BackupData = {
  [TableName in BackupTableName]: BackupTableRecordMap[TableName][]
}

export type BackupTableCounts = {
  [TableName in BackupTableName]: number
}

export interface BackupUnsignedEnvelope {
  format: typeof BACKUP_FORMAT
  backupFormatVersion: number
  schemaVersion: number
  appVersion: string
  exportedAt: string
  backupId: string
  databaseInstanceId: string
  tableCounts: BackupTableCounts
  data: BackupData
}

export interface BackupEnvelope extends BackupUnsignedEnvelope {
  integrity: {
    algorithm: 'SHA-256'
    canonicalPayloadDigest: string
  }
}

export type BackupInput = string | Blob | ArrayBuffer | Uint8Array

export type BackupIssueSeverity = 'error' | 'warning'

export type BackupIssueCode =
  | 'file-too-large'
  | 'invalid-utf8'
  | 'invalid-json'
  | 'unsafe-json'
  | 'invalid-envelope'
  | 'missing-table'
  | 'unexpected-table'
  | 'future-backup-format'
  | 'unsupported-backup-format'
  | 'future-schema'
  | 'unsupported-schema'
  | 'count-mismatch'
  | 'checksum-mismatch'
  | 'duplicate-primary-key'
  | 'invalid-row'
  | 'missing-reference'
  | 'relation-mismatch'
  | 'duplicate-active-relation'

export interface BackupIssue {
  severity: BackupIssueSeverity
  code: BackupIssueCode
  message: string
  path?: string
  table?: BackupTableName
  recordId?: string
  relatedIds?: string[]
}

export class BackupValidationError extends Error {
  readonly issues: readonly BackupIssue[]

  constructor(issues: readonly BackupIssue[]) {
    super(issues[0]?.message ?? 'Backup validation failed')
    this.name = 'BackupValidationError'
    this.issues = issues
  }
}

export interface ValidatedBackup {
  backup: BackupEnvelope
  issues: readonly BackupIssue[]
  fileSizeBytes: number
}

export interface RestorePreview {
  canRestore: boolean
  issues: readonly BackupIssue[]
  fileSizeBytes: number
  backup?: BackupEnvelope
  summary?: {
    backupId: string
    exportedAt: string
    appVersion: string
    schemaVersion: number
    databaseInstanceId: string
    totalRecords: number
    tableCounts: BackupTableCounts
  }
}

export interface ExportBackupOptions {
  backupId?: string
  databaseInstanceId?: string
  exportedAt?: string
}

export interface BackupValidationOptions {
  maxBytes?: number
}

export interface RestoreDatabaseOptions extends BackupValidationOptions {
  preRestoreBackupId?: string
  preRestoreExportedAt?: string
  /**
   * Fault-injection seam for transaction rollback tests. Production callers
   * must leave this undefined.
   */
  testOnlyFailBeforeTable?: BackupTableName
}

export interface RestoreResult {
  restoredBackupId: string
  restoredTableCounts: BackupTableCounts
  preRestoreBackup: BackupEnvelope
}
