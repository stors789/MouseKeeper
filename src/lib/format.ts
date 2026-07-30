import type { LocalDate } from '../domain/types'
import { calculateAgeWeeks, isValidLocalDate, todayLocalDate } from '../domain/dates'

const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})

export function formatLocalDate(value: string | null | undefined): string {
  if (!value || !isValidLocalDate(value)) return '未记录'
  const [year, month, day] = value.split('-').map(Number)
  return DATE_FORMATTER.format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1))
}

export function formatInstant(value: string | null | undefined): string {
  if (!value) return '未记录'
  const instant = new Date(value)
  if (Number.isNaN(instant.valueOf())) return '时间无效'
  return DATE_TIME_FORMATTER.format(instant)
}

export function formatAgeWeeks(
  birthDate: LocalDate | undefined,
  asOf = todayLocalDate()
): string {
  if (!birthDate) return '周龄未知'

  try {
    return `${calculateAgeWeeks(birthDate, asOf)} 周`
  } catch {
    return '出生日期无效'
  }
}

export function formatWeight(valueGrams: number): string {
  return `${new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2
  }).format(valueGrams)} g`
}
