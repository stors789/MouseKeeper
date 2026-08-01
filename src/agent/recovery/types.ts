import type { BackupData, BackupTableName } from '../../backup'

export interface RecoveryRowChange {
  table: BackupTableName
  id: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

export interface RecoveryPreferenceChange {
  key: string
  before?: string
  after?: string
}

export interface CommandToolTrace {
  capabilityId: string
  startedAt: string
  completedAt?: string
  status: 'running' | 'succeeded' | 'failed'
  summary?: string
  error?: string
}

export type CommandRunStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'undone'
  | 'undo-conflict'

export interface AgentCommandRun {
  id: string
  sessionId: string
  prompt: string
  presetId?: string
  model?: string
  createdAt: string
  updatedAt: string
  status: CommandRunStatus
  capabilityIds: string[]
  traces: CommandToolTrace[]
  summary?: string
  error?: string
  changes: RecoveryRowChange[]
  preferenceChanges: RecoveryPreferenceChange[]
  recoveryKind: 'none' | 'row-diff' | 'full-backup'
  fullBefore?: BackupData
  undoneAt?: string
  conflictDetails?: string[]
}

export interface RecoveryStartToken {
  id: string
  sessionId: string
  prompt: string
  presetId?: string
  model?: string
  startedAt: string
  before?: BackupData
  beforePreferences?: Record<string, string>
  preparedAt?: string
}

export interface RecoveryFinishInput {
  status: 'succeeded' | 'failed'
  capabilityIds: readonly string[]
  traces: readonly CommandToolTrace[]
  summary?: string
  error?: string
  forceFullBackup?: boolean
}

export interface UndoResult {
  commandRun: AgentCommandRun
  restoredRows: number
}
