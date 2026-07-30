import type { MouseKeeperDatabase } from '../db'
import { mouseDisplayLabel, normalizeText } from '../domain'
import type { MouseKeeperService } from '../services'
import { readableError } from '../lib/errors'
import type {
  MouseImportCandidate,
  MouseImportPreview,
  MouseImportRowResult
} from './mouse-import'

export interface MouseImportCommitRow {
  rowNumber: number
  status: 'imported' | 'skipped' | 'failed'
  mouseId?: string
  label?: string
  message: string
}

export interface MouseImportCommitReport {
  importBatchId: string
  importedCount: number
  skippedCount: number
  failedCount: number
  rows: MouseImportCommitRow[]
}

interface ResolvedCandidate {
  sireId?: string
  damId?: string
  cageId?: string
  tagIds: string[]
}

function operationId(batchId: string, rowNumber: number, step: string): string {
  return `${batchId}:${rowNumber}:${step}`
}

async function resolveCandidate(
  database: MouseKeeperDatabase,
  service: MouseKeeperService,
  candidate: MouseImportCandidate,
  importBatchId: string,
  rowNumber: number
): Promise<ResolvedCandidate> {
  const [mice, cages, tags] = await Promise.all([
    database.mice.filter((mouse) => mouse.deletedFlag === 0).toArray(),
    database.cages.filter((cage) => cage.deletedFlag === 0).toArray(),
    database.tags.filter((tag) => tag.deletedFlag === 0).toArray()
  ])
  const mouseByEarTag = new Map(
    mice.flatMap((mouse) =>
      mouse.earTag ? [[normalizeText(mouse.earTag), mouse.id] as const] : []
    )
  )
  const cageByNumber = new Map(
    cages.map((cage) => [normalizeText(cage.cageNumber), cage.id])
  )
  const tagByName = new Map(
    tags.map((tag) => [normalizeText(tag.name), tag.id])
  )

  const sireId = candidate.sireEarTag
    ? mouseByEarTag.get(normalizeText(candidate.sireEarTag))
    : undefined
  const damId = candidate.damEarTag
    ? mouseByEarTag.get(normalizeText(candidate.damEarTag))
    : undefined
  const cageId = candidate.cageNumber
    ? cageByNumber.get(normalizeText(candidate.cageNumber))
    : undefined
  if (candidate.sireEarTag && !sireId) {
    throw new Error(`找不到父本耳标：${candidate.sireEarTag}`)
  }
  if (candidate.damEarTag && !damId) {
    throw new Error(`找不到母本耳标：${candidate.damEarTag}`)
  }
  if (candidate.cageNumber && !cageId) {
    throw new Error(`找不到活动笼位：${candidate.cageNumber}`)
  }

  const tagIds: string[] = []
  for (const [index, name] of candidate.tagNames.entries()) {
    const key = normalizeText(name)
    let tagId = tagByName.get(key)
    if (!tagId) {
      const result = await service.createTag({
        operationId: operationId(importBatchId, rowNumber, `tag-${index}`),
        origin: 'import',
        importBatchId,
        name
      })
      tagId = result.value.id
      tagByName.set(key, tagId)
    }
    tagIds.push(tagId)
  }
  return { sireId, damId, cageId, tagIds }
}

async function commitCandidate(
  database: MouseKeeperDatabase,
  service: MouseKeeperService,
  row: MouseImportRowResult,
  candidate: MouseImportCandidate,
  importBatchId: string
): Promise<MouseImportCommitRow> {
  let label: string | undefined
  let mouseId: string | undefined
  await database.transaction('rw', database.tables, async () => {
    const resolved = await resolveCandidate(
      database,
      service,
      candidate,
      importBatchId,
      row.rowNumber
    )
    const created = await service.createMouse({
      operationId: operationId(importBatchId, row.rowNumber, 'mouse'),
      origin: 'import',
      importBatchId,
      id: candidate.id,
      earTag: candidate.earTag,
      experimentNumber: candidate.experimentNumber,
      name: candidate.name,
      alias: candidate.alias,
      strain: candidate.strain,
      genotype: candidate.genotype,
      sex: candidate.sex,
      birthDate: candidate.birthDate,
      sireId: resolved.sireId,
      damId: resolved.damId,
      status: candidate.status,
      source: candidate.source,
      coatColor: candidate.coatColor,
      notes: candidate.notes,
      tagIds: resolved.tagIds
    })
    mouseId = created.value.id
    label = mouseDisplayLabel(created.value)
    if (resolved.cageId) {
      await service.moveMouse({
        operationId: operationId(importBatchId, row.rowNumber, 'cage'),
        origin: 'import',
        importBatchId,
        mouseId: created.value.id,
        cageId: resolved.cageId,
        reason: 'CSV 导入'
      })
    }
  })
  return {
    rowNumber: row.rowNumber,
    status: 'imported',
    mouseId,
    label,
    message: '导入成功'
  }
}

export async function commitMouseImport(
  database: MouseKeeperDatabase,
  service: MouseKeeperService,
  preview: MouseImportPreview,
  importBatchId: string = crypto.randomUUID()
): Promise<MouseImportCommitReport> {
  const rows: MouseImportCommitRow[] = []
  for (const row of preview.rows) {
    if (!row.candidate || row.errors.length > 0) {
      rows.push({
        rowNumber: row.rowNumber,
        status: 'skipped',
        message: row.errors.join('；') || '该行未通过预检'
      })
      continue
    }
    try {
      rows.push(
        await commitCandidate(
          database,
          service,
          row,
          row.candidate,
          importBatchId
        )
      )
    } catch (error) {
      rows.push({
        rowNumber: row.rowNumber,
        status: 'failed',
        message: readableError(error)
      })
    }
  }
  return {
    importBatchId,
    importedCount: rows.filter((row) => row.status === 'imported').length,
    skippedCount: rows.filter((row) => row.status === 'skipped').length,
    failedCount: rows.filter((row) => row.status === 'failed').length,
    rows
  }
}
