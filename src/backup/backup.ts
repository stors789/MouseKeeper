import { APP_CONFIG } from '../config/app'
import type { MouseKeeperDatabase } from '../db'
import { calculateBackupChecksum, canonicalJson } from './canonical'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLE_NAMES,
  BackupValidationError
} from './types'
import type {
  BackupData,
  BackupEnvelope,
  BackupInput,
  BackupTableCounts,
  BackupTableName,
  BackupUnsignedEnvelope,
  ExportBackupOptions,
  RestoreDatabaseOptions,
  RestorePreview,
  RestoreResult
} from './types'
import { parseAndValidateBackup } from './validation'

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random ID generation is unavailable')
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join('')
  ].join('-')
}

async function readAllTables(
  database: MouseKeeperDatabase
): Promise<BackupData> {
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

    return {
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
    }
  })
}

function tableCounts(data: BackupData): BackupTableCounts {
  return Object.fromEntries(
    BACKUP_TABLE_NAMES.map(table => [table, data[table].length])
  ) as BackupTableCounts
}

function resolveDatabaseInstanceId(
  data: BackupData,
  explicitId: string | undefined
): string {
  if (explicitId) {
    return explicitId
  }
  const activeSettings = data.appSettings.find(
    settings => settings.deletedFlag === 0
  )
  return activeSettings?.databaseInstanceId ?? randomId()
}

export async function exportDatabaseBackup(
  database: MouseKeeperDatabase,
  options: ExportBackupOptions = {}
): Promise<BackupEnvelope> {
  const data = await readAllTables(database)
  const unsigned: BackupUnsignedEnvelope = {
    format: BACKUP_FORMAT,
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: APP_CONFIG.schemaVersion,
    appVersion: APP_CONFIG.version,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    backupId: options.backupId ?? randomId(),
    databaseInstanceId: resolveDatabaseInstanceId(
      data,
      options.databaseInstanceId
    ),
    tableCounts: tableCounts(data),
    data
  }
  const backup: BackupEnvelope = {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      canonicalPayloadDigest: await calculateBackupChecksum(unsigned)
    }
  }

  // Validate exports with the same untrusted-input path used by restore.
  // This prevents producing a signed backup from an already inconsistent DB.
  const validated = await parseAndValidateBackup(canonicalJson(backup))
  return validated.backup
}

export function serializeBackup(backup: BackupEnvelope): string {
  return canonicalJson(backup)
}

export function backupBlob(backup: BackupEnvelope): Blob {
  return new Blob([serializeBackup(backup)], {
    type: 'application/json;charset=utf-8'
  })
}

export async function createRestorePreview(
  input: BackupInput,
  options: RestoreDatabaseOptions = {}
): Promise<RestorePreview> {
  try {
    const validated = await parseAndValidateBackup(input, options)
    const totalRecords = BACKUP_TABLE_NAMES.reduce(
      (total, table) => total + validated.backup.tableCounts[table],
      0
    )
    return {
      canRestore: true,
      issues: validated.issues,
      fileSizeBytes: validated.fileSizeBytes,
      backup: validated.backup,
      summary: {
        backupId: validated.backup.backupId,
        exportedAt: validated.backup.exportedAt,
        appVersion: validated.backup.appVersion,
        schemaVersion: validated.backup.schemaVersion,
        databaseInstanceId: validated.backup.databaseInstanceId,
        totalRecords,
        tableCounts: validated.backup.tableCounts
      }
    }
  } catch (error) {
    if (error instanceof BackupValidationError) {
      return {
        canRestore: false,
        issues: error.issues,
        fileSizeBytes: 0
      }
    }
    throw error
  }
}

function assertRequiredDatabaseTables(database: MouseKeeperDatabase): void {
  const available = new Set(database.tables.map(table => table.name))
  const missing = BACKUP_TABLE_NAMES.filter(table => !available.has(table))
  if (missing.length > 0) {
    throw new Error(`Database is missing backup tables: ${missing.join(', ')}`)
  }
}

async function replaceAllTables(
  database: MouseKeeperDatabase,
  data: BackupData,
  failBeforeTable: BackupTableName | undefined
): Promise<void> {
  assertRequiredDatabaseTables(database)

  const clearers: Record<BackupTableName, () => Promise<unknown>> = {
    mice: () => database.mice.clear(),
    cages: () => database.cages.clear(),
    cageAssignments: () => database.cageAssignments.clear(),
    breedingPairs: () => database.breedingPairs.clear(),
    litters: () => database.litters.clear(),
    experiments: () => database.experiments.clear(),
    experimentGroups: () => database.experimentGroups.clear(),
    experimentAssignments: () => database.experimentAssignments.clear(),
    mouseEvents: () => database.mouseEvents.clear(),
    weightRecords: () => database.weightRecords.clear(),
    tasks: () => database.tasks.clear(),
    tags: () => database.tags.clear(),
    activityLogs: () => database.activityLogs.clear(),
    savedViews: () => database.savedViews.clear(),
    appSettings: () => database.appSettings.clear(),
    backupMetadata: () => database.backupMetadata.clear()
  }
  const writers: Record<BackupTableName, () => Promise<unknown>> = {
    mice: () => database.mice.bulkAdd(data.mice),
    cages: () => database.cages.bulkAdd(data.cages),
    cageAssignments: () =>
      database.cageAssignments.bulkAdd(data.cageAssignments),
    breedingPairs: () => database.breedingPairs.bulkAdd(data.breedingPairs),
    litters: () => database.litters.bulkAdd(data.litters),
    experiments: () => database.experiments.bulkAdd(data.experiments),
    experimentGroups: () =>
      database.experimentGroups.bulkAdd(data.experimentGroups),
    experimentAssignments: () =>
      database.experimentAssignments.bulkAdd(data.experimentAssignments),
    mouseEvents: () => database.mouseEvents.bulkAdd(data.mouseEvents),
    weightRecords: () => database.weightRecords.bulkAdd(data.weightRecords),
    tasks: () => database.tasks.bulkAdd(data.tasks),
    tags: () => database.tags.bulkAdd(data.tags),
    activityLogs: () => database.activityLogs.bulkAdd(data.activityLogs),
    savedViews: () => database.savedViews.bulkAdd(data.savedViews),
    appSettings: () => database.appSettings.bulkAdd(data.appSettings),
    backupMetadata: () =>
      database.backupMetadata.bulkAdd(data.backupMetadata)
  }

  await database.transaction('rw', database.tables, async () => {
    for (const table of BACKUP_TABLE_NAMES) {
      await clearers[table]()
    }
    for (const table of BACKUP_TABLE_NAMES) {
      if (failBeforeTable === table) {
        throw new Error(`Injected restore failure before ${table}`)
      }
      await writers[table]()
    }
  })
}

export async function restoreDatabaseBackup(
  database: MouseKeeperDatabase,
  input: BackupInput,
  options: RestoreDatabaseOptions = {}
): Promise<RestoreResult> {
  const validated = await parseAndValidateBackup(input, options)

  // This complete safety copy remains in memory and is returned to the caller.
  // The UI can require the user to download it before invoking restore.
  const preRestoreBackup = await exportDatabaseBackup(database, {
    backupId: options.preRestoreBackupId,
    exportedAt: options.preRestoreExportedAt
  })

  await replaceAllTables(
    database,
    validated.backup.data,
    options.testOnlyFailBeforeTable
  )

  return {
    restoredBackupId: validated.backup.backupId,
    restoredTableCounts: validated.backup.tableCounts,
    preRestoreBackup
  }
}
