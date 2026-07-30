import {
  MOUSE_SEXES,
  MOUSE_STATUSES,
  type MouseSex,
  type MouseStatus
} from '../domain/types'
import { isValidLocalDate, todayLocalDate } from '../domain/dates'
import { normalizeOptionalText, normalizeText } from '../domain/normalization'
import type { CsvPreview, CsvRow } from './csv'

export const MOUSE_IMPORT_FIELDS = [
  'id',
  'earTag',
  'experimentNumber',
  'name',
  'alias',
  'strain',
  'genotype',
  'sex',
  'birthDate',
  'status',
  'source',
  'coatColor',
  'notes',
  'tags',
  'sireEarTag',
  'damEarTag',
  'cageNumber'
] as const

export type MouseImportField = (typeof MOUSE_IMPORT_FIELDS)[number]
export type MouseFieldMapping = Partial<Record<MouseImportField, string>>

export interface MouseImportCandidate {
  id?: string
  earTag?: string
  experimentNumber?: string
  name?: string
  alias?: string
  strain: string
  genotype?: string
  sex: MouseSex
  birthDate?: string
  status: MouseStatus
  source?: string
  coatColor?: string
  notes?: string
  tagNames: string[]
  sireEarTag?: string
  damEarTag?: string
  cageNumber?: string
}

export interface MouseImportRowResult {
  rowNumber: number
  source: Record<string, string>
  candidate?: MouseImportCandidate
  errors: string[]
  warnings: string[]
}

export interface MouseImportPreview {
  rows: MouseImportRowResult[]
  validCount: number
  invalidCount: number
  warningCount: number
}

export interface MouseImportContext {
  existingIds?: ReadonlySet<string>
  existingEarTags?: ReadonlySet<string>
  today?: string
}

const HEADER_ALIASES: Record<MouseImportField, readonly string[]> = {
  id: ['id', 'mouse id', '内部id'],
  earTag: ['ear tag', 'eartag', 'ear_tag', '耳标', '耳标号'],
  experimentNumber: [
    'experiment number',
    'experimentnumber',
    'experiment_number',
    '实验编号'
  ],
  name: ['name', '名称'],
  alias: ['alias', '别名'],
  strain: ['strain', '品系'],
  genotype: ['genotype', '基因型'],
  sex: ['sex', 'gender', '性别'],
  birthDate: ['birth date', 'birthdate', 'birth_date', '出生日期'],
  status: ['status', '状态'],
  source: ['source', '来源'],
  coatColor: ['coat color', 'coatcolor', 'coat_color', '毛色'],
  notes: ['notes', 'note', '备注'],
  tags: ['tags', 'tag', '标签'],
  sireEarTag: ['sire ear tag', 'sire', '父本耳标', '父本'],
  damEarTag: ['dam ear tag', 'dam', '母本耳标', '母本'],
  cageNumber: ['cage number', 'cage', '笼位编号', '笼位']
}

const SEX_ALIASES: Readonly<Record<string, MouseSex>> = {
  m: 'male',
  male: 'male',
  雄: 'male',
  雄性: 'male',
  f: 'female',
  female: 'female',
  雌: 'female',
  雌性: 'female',
  unknown: 'unknown',
  u: 'unknown',
  未知: 'unknown',
  intersex: 'intersex',
  间性: 'intersex',
  other: 'other',
  其他: 'other'
}

const STATUS_ALIASES: Readonly<Record<string, MouseStatus>> = {
  alive: 'alive',
  存活: 'alive',
  experimental: 'experimental',
  'in experiment': 'experimental',
  实验中: 'experimental',
  breeding: 'breeding',
  繁育中: 'breeding',
  reserved: 'reserved',
  预留: 'reserved',
  transferred: 'transferred',
  已转出: 'transferred',
  dead: 'dead',
  已死亡: 'dead',
  euthanized: 'euthanized',
  已安乐死: 'euthanized',
  other: 'other',
  其他: 'other'
}

function mappedValue(
  row: CsvRow,
  mapping: MouseFieldMapping,
  field: MouseImportField
): string | undefined {
  const header = mapping[field]
  if (!header) return undefined
  const value = row.values[header]?.trim()
  return value ? value : undefined
}

function parseEnum<T extends string>(
  raw: string | undefined,
  aliases: Readonly<Record<string, T>>,
  allowed: readonly T[],
  fallback: T
): T | undefined {
  if (!raw) return fallback
  const normalized = normalizeText(raw)
  const alias = aliases[normalized]
  if (alias) return alias
  return allowed.includes(normalized as T) ? (normalized as T) : undefined
}

function splitTags(raw: string | undefined): string[] {
  if (!raw) return []
  return [
    ...new Map(
      raw
        .split(/[;,，；]/u)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => [normalizeText(value), value])
    ).values()
  ]
}

export function suggestMouseFieldMapping(headers: readonly string[]): MouseFieldMapping {
  const normalizedHeaders = new Map(
    headers.map((header) => [normalizeText(header), header])
  )
  const mapping: MouseFieldMapping = {}

  for (const field of MOUSE_IMPORT_FIELDS) {
    for (const alias of HEADER_ALIASES[field]) {
      const header = normalizedHeaders.get(normalizeText(alias))
      if (header) {
        mapping[field] = header
        break
      }
    }
  }

  return mapping
}

export function validateMouseImport(
  preview: CsvPreview,
  mapping: MouseFieldMapping,
  context: MouseImportContext = {}
): MouseImportPreview {
  const seenIds = new Set<string>()
  const seenEarTags = new Set<string>()
  const existingIds = context.existingIds ?? new Set<string>()
  const existingEarTags = context.existingEarTags ?? new Set<string>()
  const today = context.today ?? todayLocalDate()

  const rows = preview.rows.map((row): MouseImportRowResult => {
    const errors: string[] = []
    const warnings: string[] = []
    const id = mappedValue(row, mapping, 'id')
    const earTag = mappedValue(row, mapping, 'earTag')
    const experimentNumber = mappedValue(row, mapping, 'experimentNumber')
    const strain = mappedValue(row, mapping, 'strain')
    const birthDate = mappedValue(row, mapping, 'birthDate')
    const rawSex = mappedValue(row, mapping, 'sex')
    const rawStatus = mappedValue(row, mapping, 'status')
    const sex = parseEnum(rawSex, SEX_ALIASES, MOUSE_SEXES, 'unknown')
    const status = parseEnum(rawStatus, STATUS_ALIASES, MOUSE_STATUSES, 'alive')

    if (!earTag && !experimentNumber) {
      errors.push('耳标号和实验编号至少填写一项')
    }
    if (!strain) {
      errors.push('品系不能为空')
    }
    if (!sex) {
      errors.push(`未知性别：${rawSex ?? ''}`)
    }
    if (!status) {
      errors.push(`未知状态：${rawStatus ?? ''}`)
    }
    if (birthDate && (!isValidLocalDate(birthDate) || birthDate > today)) {
      errors.push(`出生日期无效或晚于今天：${birthDate}`)
    }

    if (id) {
      const normalizedId = normalizeText(id)
      if (seenIds.has(normalizedId)) {
        errors.push(`文件内 ID 重复：${id}`)
      } else if (existingIds.has(normalizedId)) {
        errors.push(`数据库中已存在 ID：${id}`)
      }
      seenIds.add(normalizedId)
    }

    if (earTag) {
      const normalizedEarTag = normalizeText(earTag)
      if (seenEarTags.has(normalizedEarTag)) {
        errors.push(`文件内耳标重复：${earTag}`)
      } else if (existingEarTags.has(normalizedEarTag)) {
        errors.push(`数据库中已存在活动耳标：${earTag}`)
      }
      seenEarTags.add(normalizedEarTag)
    }

    const sireEarTag = mappedValue(row, mapping, 'sireEarTag')
    const damEarTag = mappedValue(row, mapping, 'damEarTag')
    const cageNumber = mappedValue(row, mapping, 'cageNumber')
    if (sireEarTag || damEarTag || cageNumber) {
      warnings.push('父母和笼位关联将在导入提交前再次解析')
    }

    const result: MouseImportRowResult = {
      rowNumber: row.rowNumber,
      source: row.values,
      errors,
      warnings
    }

    if (errors.length === 0 && strain && sex && status) {
      result.candidate = {
        id,
        earTag,
        experimentNumber,
        name: mappedValue(row, mapping, 'name'),
        alias: mappedValue(row, mapping, 'alias'),
        strain,
        genotype: mappedValue(row, mapping, 'genotype'),
        sex,
        birthDate,
        status,
        source: mappedValue(row, mapping, 'source'),
        coatColor: mappedValue(row, mapping, 'coatColor'),
        notes: mappedValue(row, mapping, 'notes'),
        tagNames: splitTags(mappedValue(row, mapping, 'tags')),
        sireEarTag: normalizeOptionalText(sireEarTag) ? sireEarTag : undefined,
        damEarTag: normalizeOptionalText(damEarTag) ? damEarTag : undefined,
        cageNumber: normalizeOptionalText(cageNumber) ? cageNumber : undefined
      }
    }

    return result
  })

  return {
    rows,
    validCount: rows.filter((row) => row.errors.length === 0).length,
    invalidCount: rows.filter((row) => row.errors.length > 0).length,
    warningCount: rows.filter((row) => row.warnings.length > 0).length
  }
}
