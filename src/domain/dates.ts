import type { IsoInstant, LocalDate, LocalTime } from './types'

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

function parseLocalDateParts(value: string): [number, number, number] | null {
  const match = LOCAL_DATE_PATTERN.exec(value)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return [year, month, day]
}

export function isValidLocalDate(value: string): value is LocalDate {
  return parseLocalDateParts(value) !== null
}

export function isValidLocalTime(value: string): value is LocalTime {
  return LOCAL_TIME_PATTERN.test(value)
}

export function assertLocalDate(value: string, label = 'date'): LocalDate {
  if (!isValidLocalDate(value)) {
    throw new RangeError(`${label} must be a valid YYYY-MM-DD calendar date`)
  }
  return value
}

export function assertLocalTime(value: string, label = 'time'): LocalTime {
  if (!isValidLocalTime(value)) {
    throw new RangeError(`${label} must be a valid HH:mm time`)
  }
  return value
}

export function compareLocalDates(left: LocalDate, right: LocalDate): number {
  return left.localeCompare(right)
}

export function localDateToEpochDay(value: LocalDate): number {
  const parts = parseLocalDateParts(value)
  if (!parts) {
    throw new RangeError('date must be a valid YYYY-MM-DD calendar date')
  }
  const [year, month, day] = parts
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

export function calculateAge(
  birthDate: LocalDate,
  asOfDate: LocalDate
): number {
  const birth = parseLocalDateParts(birthDate)
  const asOf = parseLocalDateParts(asOfDate)
  if (!birth || !asOf) {
    throw new RangeError('birthDate and asOfDate must be valid local dates')
  }
  if (compareLocalDates(birthDate, asOfDate) > 0) {
    throw new RangeError('birthDate cannot be after asOfDate')
  }

  const [birthYear, birthMonth, birthDay] = birth
  const [asOfYear, asOfMonth, asOfDay] = asOf
  let age = asOfYear - birthYear
  if (
    asOfMonth < birthMonth ||
    (asOfMonth === birthMonth && asOfDay < birthDay)
  ) {
    age -= 1
  }
  return age
}

export function calculateAgeWeeks(
  birthDate: LocalDate,
  asOfDate: LocalDate
): number {
  const days = localDateToEpochDay(asOfDate) - localDateToEpochDay(birthDate)
  if (days < 0) {
    throw new RangeError('birthDate cannot be after asOfDate')
  }
  return Math.floor(days / 7)
}

export function todayLocalDate(now = new Date()): LocalDate {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

interface ZonedDateTimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function zonedDateTimeParts(
  instant: number,
  timeZone: string
): ZonedDateTimeParts {
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    throw new RangeError(`timeZone must be a valid IANA time zone: ${timeZone}`)
  }
  const values = new Map(
    formatter
      .formatToParts(new Date(instant))
      .map(part => [part.type, Number(part.value)])
  )
  const year = values.get('year')
  const month = values.get('month')
  const day = values.get('day')
  const hour = values.get('hour')
  const minute = values.get('minute')
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    throw new RangeError('time zone date parts could not be resolved')
  }
  return { year, month, day, hour, minute }
}

export function localDateTimeToInstant(
  date: LocalDate,
  time: LocalTime = '00:00',
  timeZone: string = localTimeZone()
): IsoInstant {
  assertLocalDate(date)
  assertLocalTime(time)
  const [year, month, day] = parseLocalDateParts(date) as [
    number,
    number,
    number
  ]
  const [hour, minute] = time.split(':').map(Number) as [number, number]
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute)
  let candidate = wallClockUtc

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const projected = zonedDateTimeParts(candidate, timeZone)
    const projectedUtc = Date.UTC(
      projected.year,
      projected.month - 1,
      projected.day,
      projected.hour,
      projected.minute
    )
    const next = wallClockUtc - (projectedUtc - candidate)
    if (next === candidate) {
      break
    }
    candidate = next
  }

  const projected = zonedDateTimeParts(candidate, timeZone)
  if (
    projected.year !== year ||
    projected.month !== month ||
    projected.day !== day ||
    projected.hour !== hour ||
    projected.minute !== minute
  ) {
    throw new RangeError(
      `date and time do not exist in time zone ${timeZone}`
    )
  }
  return new Date(candidate).toISOString()
}

export function instantToLocalDateTime(
  instant: IsoInstant,
  timeZone: string = localTimeZone()
): {
  date: LocalDate
  time: LocalTime
} {
  const date = new Date(instant)
  if (Number.isNaN(date.valueOf())) {
    throw new RangeError('instant must be a valid ISO date-time')
  }
  const parts = zonedDateTimeParts(date.valueOf(), timeZone)
  return {
    date: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(
      parts.day
    ).padStart(2, '0')}`,
    time: `${String(parts.hour).padStart(2, '0')}:${String(
      parts.minute
    ).padStart(2, '0')}`
  }
}

export function isIsoInstant(value: string): value is IsoInstant {
  const parsed = new Date(value)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value
}
