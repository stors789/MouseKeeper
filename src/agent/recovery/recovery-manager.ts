import { BACKUP_TABLE_NAMES, type BackupData } from '../../backup'
import { canonicalJson } from '../../backup/canonical'
import type { MouseKeeperDatabase } from '../../db'
import type { AgentDatabase } from './database'
import type { AgentCommandRun, RecoveryFinishInput, RecoveryPreferenceChange, RecoveryRowChange, RecoveryStartToken, UndoResult } from './types'

const FULL_BACKUP_ROW_THRESHOLD = 25
const FULL_BACKUP_TABLE_THRESHOLD = 4
export const MAX_RETAINED_COMMAND_RUNS = 200

export interface RecoveryManagerOptions {
  snapshot?: (database: MouseKeeperDatabase) => Promise<BackupData>
}

function redactPrompt(prompt: string): string {
  return prompt
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏密钥]')
    .replace(/(authorization|api[-_ ]?key)\s*[:=]\s*\S+/gi, '$1: [已隐藏]')
}

function snapshotPreferences(): Record<string, string> {
  const storage = globalThis.window?.localStorage
  if (!storage) return {}
  const result: Record<string, string> = {}
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (!key?.startsWith('mousekeeper:')) continue
      if (key.startsWith('mousekeeper:llm-secret:')) continue
      const value = storage.getItem(key)
      if (value !== null) result[key] = value
    }
  } catch {
    return {}
  }
  return result
}

function diffPreferences(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>
): RecoveryPreferenceChange[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => before[key] !== after[key])
    .map((key) => ({ key, before: before[key], after: after[key] }))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

export async function snapshotBusinessData(database: MouseKeeperDatabase): Promise<BackupData> {
  const tables = BACKUP_TABLE_NAMES.map((tableName) => database.table(tableName))
  return database.transaction('r', tables, async () => {
    const entries = await Promise.all(
      BACKUP_TABLE_NAMES.map(async (tableName) => [
        tableName,
        await database.table(tableName).toArray()
      ] as const)
    )
    return Object.fromEntries(entries) as unknown as BackupData
  })
}

function rowsById(rows: readonly unknown[]): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>()
  for (const value of rows) {
    const row = asRecord(value)
    if (typeof row.id === 'string') result.set(row.id, row)
  }
  return result
}

export function diffBusinessData(before: BackupData, after: BackupData): RecoveryRowChange[] {
  const changes: RecoveryRowChange[] = []
  for (const table of BACKUP_TABLE_NAMES) {
    const beforeRows = rowsById(before[table])
    const afterRows = rowsById(after[table])
    const ids = new Set([...beforeRows.keys(), ...afterRows.keys()])
    for (const id of ids) {
      const beforeRow = beforeRows.get(id)
      const afterRow = afterRows.get(id)
      if (
        beforeRow &&
        afterRow &&
        canonicalJson(beforeRow) === canonicalJson(afterRow)
      ) {
        continue
      }
      changes.push({
        table,
        id,
        before: beforeRow ? structuredClone(beforeRow) : undefined,
        after: afterRow ? structuredClone(afterRow) : undefined
      })
    }
  }
  return changes
}

function sameRow(actual: unknown, expected: Record<string, unknown> | undefined): boolean {
  if (actual === undefined || actual === null) return expected === undefined
  if (!expected) return false
  return canonicalJson(actual) === canonicalJson(expected)
}

export class RecoveryConflictError extends Error {
  readonly details: string[]

  constructor(details: string[]) {
    super('受影响数据在命令后又发生变化，已阻止撤回')
    this.name = 'RecoveryConflictError'
    this.details = details
  }
}

export class RecoveryManager {
  readonly #snapshot: (database: MouseKeeperDatabase) => Promise<BackupData>
  readonly #preparations = new Map<string, Promise<void>>()

  constructor(
    private readonly businessDatabase: MouseKeeperDatabase,
    private readonly historyDatabase: AgentDatabase,
    options: RecoveryManagerOptions = {}
  ) {
    this.#snapshot = options.snapshot ?? snapshotBusinessData
  }

  private async persistAndPrune(record: AgentCommandRun): Promise<void> {
    await this.historyDatabase.transaction('rw', this.historyDatabase.commandRuns, async () => {
      await this.historyDatabase.commandRuns.put(record)
      const records = await this.historyDatabase.commandRuns.orderBy('createdAt').toArray()
      const excess = records.length - MAX_RETAINED_COMMAND_RUNS
      if (excess <= 0) return
      const removableIds = records
        .filter((candidate) => candidate.status !== 'running')
        .slice(0, excess)
        .map((candidate) => candidate.id)
      if (removableIds.length > 0) {
        await this.historyDatabase.commandRuns.bulkDelete(removableIds)
      }
    })
  }

  async begin(input: {
    id?: string
    sessionId: string
    prompt: string
    presetId?: string
    model?: string
  }): Promise<RecoveryStartToken> {
    const startedAt = new Date().toISOString()
    const token: RecoveryStartToken = {
      id: input.id ?? crypto.randomUUID(),
      sessionId: input.sessionId,
      prompt: redactPrompt(input.prompt),
      presetId: input.presetId,
      model: input.model,
      startedAt
    }
    await this.persistAndPrune({
      id: token.id,
      sessionId: token.sessionId,
      prompt: token.prompt,
      presetId: token.presetId,
      model: token.model,
      createdAt: token.startedAt,
      updatedAt: token.startedAt,
      status: 'running',
      capabilityIds: [],
      traces: [],
      changes: [],
      preferenceChanges: [],
      recoveryKind: 'none'
    })
    return token
  }

  async prepareMutation(token: RecoveryStartToken): Promise<void> {
    if (token.before) return
    const existing = this.#preparations.get(token.id)
    if (existing) return existing

    const preparation = (async () => {
      const before = await this.#snapshot(this.businessDatabase)
      const beforePreferences = snapshotPreferences()
      const preparedAt = new Date().toISOString()
      const running = await this.historyDatabase.commandRuns.get(token.id)
      if (!running || running.status !== 'running') {
        throw new Error('Agent 命令已结束，无法再建立恢复点')
      }
      await this.persistAndPrune({
        ...running,
        updatedAt: preparedAt,
        recoveryKind: 'full-backup',
        fullBefore: structuredClone(before)
      })
      token.before = before
      token.beforePreferences = beforePreferences
      token.preparedAt = preparedAt
    })()
    this.#preparations.set(token.id, preparation)
    try {
      await preparation
    } finally {
      this.#preparations.delete(token.id)
    }
  }

  async finish(token: RecoveryStartToken, input: RecoveryFinishInput): Promise<AgentCommandRun> {
    const changes = token.before
      ? diffBusinessData(token.before, await this.#snapshot(this.businessDatabase))
      : []
    const preferenceChanges = token.beforePreferences
      ? diffPreferences(token.beforePreferences, snapshotPreferences())
      : []
    const changedTables = new Set(changes.map((change) => change.table)).size
    const fullBackup =
      changes.length > 0 &&
      (input.forceFullBackup === true ||
        changes.length >= FULL_BACKUP_ROW_THRESHOLD ||
        changedTables >= FULL_BACKUP_TABLE_THRESHOLD ||
        JSON.stringify(changes).length >= 512 * 1024)
    const updatedAt = new Date().toISOString()
    const record: AgentCommandRun = {
      id: token.id,
      sessionId: token.sessionId,
      prompt: token.prompt,
      presetId: token.presetId,
      model: token.model,
      createdAt: token.startedAt,
      updatedAt,
      status: input.status,
      capabilityIds: [...input.capabilityIds],
      traces: structuredClone([...input.traces]),
      summary: input.summary,
      error: input.error,
      changes,
      preferenceChanges,
      recoveryKind:
        changes.length === 0 && preferenceChanges.length === 0
          ? 'none'
          : fullBackup
            ? 'full-backup'
            : 'row-diff',
      fullBefore: fullBackup && token.before ? structuredClone(token.before) : undefined
    }
    await this.persistAndPrune(record)
    return record
  }

  async get(commandRunId: string): Promise<AgentCommandRun | undefined> {
    return this.historyDatabase.commandRuns.get(commandRunId)
  }

  async recent(limit = 50): Promise<AgentCommandRun[]> {
    return this.historyDatabase.commandRuns
      .orderBy('createdAt')
      .reverse()
      .limit(Math.max(1, Math.min(limit, 200)))
      .toArray()
  }

  async undo(commandRunId: string): Promise<UndoResult> {
    const record = await this.historyDatabase.commandRuns.get(commandRunId)
    if (!record) throw new Error('找不到要撤回的 Agent 命令')
    if (record.status === 'undone') throw new Error('这条命令已经撤回')
    if (record.changes.length === 0 && record.preferenceChanges.length === 0) {
      throw new Error('这条命令没有可撤回的数据变化')
    }

    const conflicts: string[] = []
    for (const change of record.changes) {
      const current: unknown = await this.businessDatabase.table(change.table).get(change.id)
      if (!sameRow(current, change.after)) {
        conflicts.push(`${change.table}:${change.id}`)
      }
    }
    const storage = globalThis.window?.localStorage
    if (storage) {
      for (const change of record.preferenceChanges) {
        if (storage.getItem(change.key) !== (change.after ?? null)) {
          conflicts.push(`preference:${change.key}`)
        }
      }
    }
    if (conflicts.length > 0) {
      const updated: AgentCommandRun = {
        ...record,
        status: 'undo-conflict',
        updatedAt: new Date().toISOString(),
        conflictDetails: conflicts
      }
      await this.persistAndPrune(updated)
      throw new RecoveryConflictError(conflicts)
    }

    const tableNames = [...new Set(record.changes.map((change) => change.table))]
    const tables = tableNames.map((name) => this.businessDatabase.table(name))
    if (tables.length > 0) {
      await this.businessDatabase.transaction('rw', tables, async () => {
        for (const change of [...record.changes].reverse()) {
          const table = this.businessDatabase.table(change.table)
          if (change.before) await table.put(structuredClone(change.before))
          else await table.delete(change.id)
        }
      })
    }
    if (storage) {
      for (const change of record.preferenceChanges) {
        if (change.before === undefined) storage.removeItem(change.key)
        else storage.setItem(change.key, change.before)
      }
      globalThis.dispatchEvent?.(new CustomEvent('mousekeeper:preferences-restored'))
    }

    const updatedAt = new Date().toISOString()
    const updated: AgentCommandRun = {
      ...record,
      status: 'undone',
      updatedAt,
      undoneAt: updatedAt,
      summary: record.summary ? `已撤回：${record.summary}` : '命令已撤回'
    }
    await this.persistAndPrune(updated)
    return {
      commandRun: updated,
      restoredRows: record.changes.length + record.preferenceChanges.length
    }
  }
}
