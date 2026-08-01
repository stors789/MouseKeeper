import { afterEach, describe, expect, it } from 'vitest'

import {
  createMouseKeeperDatabase,
  type MouseKeeperDatabase
} from '../db'
import type { Mouse } from '../domain'
import {
  BACKUP_FORMAT,
  BACKUP_TABLE_NAMES,
  calculateBackupChecksum,
  canonicalJson,
  createRestorePreview,
  exportDatabaseBackup,
  restoreDatabaseBackup,
  serializeBackup
} from './index'
import type { BackupEnvelope } from './index'

const NOW = '2026-07-30T12:00:00.000Z'
let databaseSequence = 0
const databases: MouseKeeperDatabase[] = []

function createDatabase(label: string): MouseKeeperDatabase {
  databaseSequence += 1
  const database = createMouseKeeperDatabase(
    `mousekeeper-backup-${label}-${databaseSequence}`
  )
  databases.push(database)
  return database
}

function mouse(id: string, earTag: string): Mouse {
  const normalizedEarTag = earTag.toLocaleLowerCase('und')
  return {
    id,
    schemaVersion: 1,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    deletedFlag: 0,
    origin: 'user',
    earTag,
    normalizedEarTag,
    activeEarTagKey: `ear:${normalizedEarTag}`,
    strain: 'C57BL/6J',
    strainKey: 'c57bl/6j',
    sex: 'unknown',
    status: 'alive',
    tagIds: [],
    searchTerms: [normalizedEarTag, 'c57bl/6j']
  }
}

function cloneBackup(backup: BackupEnvelope): BackupEnvelope {
  return JSON.parse(serializeBackup(backup)) as BackupEnvelope
}

async function resign(backup: BackupEnvelope): Promise<string> {
  backup.integrity.canonicalPayloadDigest =
    await calculateBackupChecksum(backup)
  return serializeBackup(backup)
}

function hasIssue(
  preview: Awaited<ReturnType<typeof createRestorePreview>>,
  code: string
): boolean {
  return preview.issues.some(item => item.code === code)
}

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async database => {
      database.close()
      await database.delete()
    })
  )
})

describe('versioned database backup', () => {
  it('round-trips an empty database and retains an in-memory safety backup', async () => {
    const source = createDatabase('empty-source')
    const target = createDatabase('empty-target')
    await target.mice.add(mouse('old-mouse', 'OLD-1'))

    const backup = await exportDatabaseBackup(source, {
      backupId: 'empty-backup',
      databaseInstanceId: 'empty-source-instance',
      exportedAt: NOW
    })

    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(Object.keys(backup.data).sort()).toEqual(
      [...BACKUP_TABLE_NAMES].sort()
    )
    expect(Object.values(backup.tableCounts).every(count => count === 0)).toBe(
      true
    )

    const result = await restoreDatabaseBackup(
      target,
      serializeBackup(backup),
      {
        preRestoreBackupId: 'safety-backup',
        preRestoreExportedAt: NOW
      }
    )

    expect(await target.mice.count()).toBe(0)
    expect(result.preRestoreBackup.data.mice.map(item => item.id)).toEqual([
      'old-mouse'
    ])
    expect(result.restoredBackupId).toBe('empty-backup')
  })

  it('uses canonical JSON and a valid SHA-256 digest', async () => {
    const database = createDatabase('checksum')
    const backup = await exportDatabaseBackup(database, {
      backupId: 'checksum-backup',
      databaseInstanceId: 'checksum-instance',
      exportedAt: NOW
    })

    expect(backup.integrity.canonicalPayloadDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe(
      '{"a":{"x":3,"y":2},"z":1}'
    )
    expect(serializeBackup(cloneBackup(backup))).toBe(serializeBackup(backup))
  })

  it('accepts a name-backed normalized alias in a signed backup', async () => {
    const database = createDatabase('named-mouse')
    await database.mice.add({
      ...mouse('named-mouse', 'NAMED-1'),
      name: 'Atlas',
      normalizedAlias: 'atlas',
      searchTerms: ['named-1', 'atlas', 'c57bl/6j']
    })

    const backup = await exportDatabaseBackup(database)

    expect(backup.data.mice[0]).toMatchObject({
      name: 'Atlas',
      normalizedAlias: 'atlas'
    })
  })

  it('replaces an existing database with a validated non-empty backup', async () => {
    const source = createDatabase('replace-source')
    const target = createDatabase('replace-target')
    await source.mice.add(mouse('new-mouse', 'NEW-1'))
    await target.mice.add(mouse('old-mouse', 'OLD-1'))
    const backup = await exportDatabaseBackup(source)

    const result = await restoreDatabaseBackup(target, serializeBackup(backup))

    expect((await target.mice.toArray()).map(item => item.id)).toEqual([
      'new-mouse'
    ])
    expect(result.preRestoreBackup.data.mice.map(item => item.id)).toEqual([
      'old-mouse'
    ])
  })

  it('captures an inconsistent prior database before committing replacement', async () => {
    const source = createDatabase('salvage-source')
    const target = createDatabase('salvage-target')
    await source.mice.add(mouse('new-mouse', 'NEW-1'))
    await target.mice.add({
      ...mouse('old-mouse', 'OLD-1'),
      strainKey: 'inconsistent-helper'
    })
    const sourceBackup = await exportDatabaseBackup(source)

    const result = await restoreDatabaseBackup(
      target,
      serializeBackup(sourceBackup)
    )

    expect((await target.mice.toArray()).map(item => item.id)).toEqual([
      'new-mouse'
    ])
    expect(result.preRestoreBackup.data.mice[0]).toMatchObject({
      id: 'old-mouse',
      strainKey: 'inconsistent-helper'
    })
    expect(result.preRestoreBackup.integrity.canonicalPayloadDigest).toMatch(
      /^[0-9a-f]{64}$/
    )
  })

  it('rejects truncated JSON', async () => {
    const database = createDatabase('truncated')
    const backup = await exportDatabaseBackup(database)
    const serialized = serializeBackup(backup)

    const preview = await createRestorePreview(serialized.slice(0, -12))

    expect(preview.canRestore).toBe(false)
    expect(hasIssue(preview, 'invalid-json')).toBe(true)
  })

  it('rejects a missing table key', async () => {
    const database = createDatabase('missing-table')
    const backup = await exportDatabaseBackup(database)
    const raw = JSON.parse(serializeBackup(backup)) as Record<string, unknown>
    const data = raw.data as Record<string, unknown>
    delete data.tasks

    const preview = await createRestorePreview(JSON.stringify(raw))

    expect(preview.canRestore).toBe(false)
    expect(hasIssue(preview, 'missing-table')).toBe(true)
  })

  it('rejects incorrect table counts even with a recomputed checksum', async () => {
    const database = createDatabase('count')
    const backup = cloneBackup(await exportDatabaseBackup(database))
    backup.tableCounts.mice += 1

    const preview = await createRestorePreview(await resign(backup))

    expect(preview.canRestore).toBe(false)
    expect(hasIssue(preview, 'count-mismatch')).toBe(true)
  })

  it('rejects a checksum mismatch', async () => {
    const database = createDatabase('bad-checksum')
    const backup = cloneBackup(await exportDatabaseBackup(database))
    backup.appVersion = 'tampered'

    const preview = await createRestorePreview(serializeBackup(backup))

    expect(preview.canRestore).toBe(false)
    expect(hasIssue(preview, 'checksum-mismatch')).toBe(true)
  })

  it('rejects a future schema', async () => {
    const database = createDatabase('future')
    const backup = cloneBackup(await exportDatabaseBackup(database))
    backup.schemaVersion = 2

    const preview = await createRestorePreview(await resign(backup))

    expect(preview.canRestore).toBe(false)
    expect(hasIssue(preview, 'future-schema')).toBe(true)
  })

  it('rejects duplicate primary keys before writing', async () => {
    const database = createDatabase('duplicate')
    await database.mice.add(mouse('mouse-1', 'M-1'))
    const backup = cloneBackup(await exportDatabaseBackup(database))
    backup.data.mice.push({ ...backup.data.mice[0]! })
    backup.tableCounts.mice = backup.data.mice.length

    const preview = await createRestorePreview(await resign(backup))

    expect(preview.canRestore).toBe(false)
    expect(hasIssue(preview, 'duplicate-primary-key')).toBe(true)
  })

  it('rejects invalid rows and missing required references', async () => {
    const database = createDatabase('row-reference')
    await database.mice.add(mouse('mouse-1', 'M-1'))

    const invalidRow = cloneBackup(await exportDatabaseBackup(database))
    invalidRow.data.mice[0]!.strain = ''
    const invalidPreview = await createRestorePreview(
      await resign(invalidRow)
    )
    expect(hasIssue(invalidPreview, 'invalid-row')).toBe(true)

    const missingReference = cloneBackup(
      await exportDatabaseBackup(database)
    )
    missingReference.data.mice[0]!.sireId = 'missing-parent'
    const referencePreview = await createRestorePreview(
      await resign(missingReference)
    )
    expect(hasIssue(referencePreview, 'missing-reference')).toBe(true)
  })

  it('rejects parent chronology corruption even with a valid checksum', async () => {
    const database = createDatabase('parent-chronology')
    await database.mice.bulkAdd([
      {
        ...mouse('parent', 'PARENT-1'),
        birthDate: '2024-01-01'
      },
      {
        ...mouse('offspring', 'OFFSPRING-1'),
        birthDate: '2025-01-01',
        sireId: 'parent'
      }
    ])
    const backup = cloneBackup(await exportDatabaseBackup(database))
    const parent = backup.data.mice.find(item => item.id === 'parent')!
    parent.birthDate = '2026-01-01'

    const preview = await createRestorePreview(await resign(backup))

    expect(preview.canRestore).toBe(false)
    expect(hasIssue(preview, 'relation-mismatch')).toBe(true)
  })

  it('rejects derived helper keys that disagree with authoritative fields', async () => {
    const database = createDatabase('derived-key')
    await database.mice.add(mouse('mouse-1', 'M-1'))
    const backup = cloneBackup(await exportDatabaseBackup(database))
    backup.data.mice[0]!.activeEarTagKey = 'ear:someone-else'

    const preview = await createRestorePreview(await resign(backup))

    expect(preview.canRestore).toBe(false)
    expect(hasIssue(preview, 'relation-mismatch')).toBe(true)
  })

  it('enforces the configured file-size limit before parsing', async () => {
    const preview = await createRestorePreview('{}', { maxBytes: 1 })

    expect(preview.canRestore).toBe(false)
    expect(hasIssue(preview, 'file-too-large')).toBe(true)
  })

  it('rolls back all clears and writes when a restore table write fails', async () => {
    const source = createDatabase('rollback-source')
    const target = createDatabase('rollback-target')
    await source.mice.add(mouse('new-mouse', 'NEW-1'))
    await target.mice.add(mouse('old-mouse', 'OLD-1'))
    const sourceBackup = await exportDatabaseBackup(source)

    await expect(
      restoreDatabaseBackup(target, serializeBackup(sourceBackup), {
        testOnlyFailBeforeTable: 'cages'
      })
    ).rejects.toThrow('Injected restore failure before cages')

    expect((await target.mice.toArray()).map(item => item.id)).toEqual([
      'old-mouse'
    ])
    expect(await target.cages.count()).toBe(0)
  })
})
