import Papa, { type ParseError } from 'papaparse'

export interface CsvRow {
  rowNumber: number
  values: Record<string, string>
}

export interface CsvIssue {
  rowNumber: number | null
  code: string
  message: string
}

export interface CsvPreview {
  headers: string[]
  rows: CsvRow[]
  issues: CsvIssue[]
}

export interface CsvColumn<T> {
  key: string
  header: string
  value: (record: T) => string | number | null | undefined
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/

function toIssue(error: ParseError): CsvIssue {
  return {
    rowNumber: typeof error.row === 'number' ? error.row + 2 : null,
    code: error.code,
    message: error.message
  }
}

export function neutralizeCsvFormula(value: string): string {
  const trimmedStart = value.trimStart()

  if (FORMULA_PREFIX.test(trimmedStart)) {
    return `'${value}`
  }

  return value
}

export function parseCsvPreview(contents: string): CsvPreview {
  const normalizedContents = contents.replace(/^\uFEFF/, '')
  const parsed = Papa.parse<Record<string, string>>(normalizedContents, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    transformHeader: (header) => header.trim()
  })

  const headers = (parsed.meta.fields ?? []).filter(Boolean)
  const rows = parsed.data.map((record, index) => {
    const values = Object.fromEntries(
      headers.map((header) => [header, String(record[header] ?? '').trim()])
    )

    return {
      rowNumber: index + 2,
      values
    }
  })

  return {
    headers,
    rows,
    issues: parsed.errors.map(toIssue)
  }
}

export function createCsv<T>(
  records: readonly T[],
  columns: readonly CsvColumn<T>[]
): string {
  const fields = columns.map((column) => column.header)
  const data = records.map((record) =>
    Object.fromEntries(
      columns.map((column) => {
        const rawValue = column.value(record)
        const value = rawValue == null ? '' : String(rawValue)
        return [column.header, neutralizeCsvFormula(value)]
      })
    )
  )

  return Papa.unparse({ fields, data }, { newline: '\r\n' })
}

export function createCsvBlob(csv: string): Blob {
  return new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
}
