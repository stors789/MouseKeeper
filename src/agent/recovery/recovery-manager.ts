import { BACKUP_TABLE_NAMES, type BackupData } from '../../backup'
import { canonicalJson } from '../../backup/canonical'
import type { MouseKeeperDatabase } from '../../db'
import type { AgentDatabase } from './database'
import type { AgentCommandRun, RecoveryFinishInput, RecoveryRowChange, RecoveryStartToken, UndoResult } from './types'

const FULL_BACKUP_ROW_THRESHOLD = 25
const FULL_BACKUP_TABLE_THRESHOLD = 4

function redactPrompt(prompt: string): string {
  return prompt
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏密钥]')
    .replace(/(authorization|api[-_ ]?key)\s*[:=]\s*\S+/gi, '$1: [已隐藏]')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

export async function snapshotBusinessData(database: MouseKeeperDatabase): Promise<BackupData> {
  const entries = await Promise.all(
    BACKUP_TABLE_NAMES.map(async (tableName) => [
      tableName,
      await database.table(tableName).toArray()
    ] as const)
  )
  return Object.fromEntries(entries) as unknown as BackupData
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
  constructor(
    private readonly businessDatabase: MouseKeeperDatabase,
    private readonly historyDatabase: AgentDatabase
  ) {}

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
      startedAt,
      before: await snapshotBusinessData(this.businessDatabase)
    }
    await this.historyDatabase.commandRuns.put({
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
      recoveryKind: 'full-backup',
      fullBefore: structuredClone(token.before)
    })
    return token
  }

  async finish(token: RecoveryStartToken, input: RecoveryFinishInput): Promise<AgentCommandRun> {
    const after = await snapshotBusinessData(this.businessDatabase)
    const changes = diffBusinessData(token.before, after)
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
      recoveryKind:
        changes.length === 0 ? 'none' : fullBackup ? 'full-backup' : 'row-diff',
      fullBefore: fullBackup ? structuredClone(token.before) : undefined
    }
    await this.historyDatabase.commandRuns.put(record)
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
    if (record.changes.length === 0) throw new Error('这条命令没有可撤回的数据变化')

    const conflicts: string[] = []
    for (const change of record.changes) {
      const current = await this.businessDatabase.table(change.table).get(change.id)
      if (!sameRow(current, change.after)) {
        conflicts.push(`${change.table}:${change.id}`)
      }
    }
    if (conflicts.length > 0) {
      const updated: AgentCommandRun = {
        ...record,
        status: 'undo-conflict',
        updatedAt: new Date().toISOString(),
        conflictDetails: conflicts
      }
      await this.historyDatabase.commandRuns.put(updated)
      throw new RecoveryConflictError(conflicts)
    }

    const tableNames = [...new Set(record.changes.map((change) => change.table))]
    const tables = tableNames.map((name) => this.businessDatabase.table(name))
    await this.businessDatabase.transaction('rw', tables, async () => {
      for (const change of [...record.changes].reverse()) {
        const table = this.businessDatabase.table(change.table)
        if (change.before) await table.put(structuredClone(change.before))
        else await table.delete(change.id)
      }
    })

    const updatedAt = new Date().toISOString()
    const updated: AgentCommandRun = {
      ...record,
      status: 'undone',
      updatedAt,
      undoneAt: updatedAt,
      summary: record.summary ? `已撤回：${record.summary}` : '命令已撤回'
    }
    await this.historyDatabase.commandRuns.put(updated)
    return { commandRun: updated, restoredRows: record.changes.length }
  }
}
