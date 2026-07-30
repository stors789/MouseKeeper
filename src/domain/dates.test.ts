import {
  assertLocalDate,
  calculateAge,
  calculateAgeWeeks,
  instantToLocalDateTime,
  isValidLocalDate,
  isValidLocalTime,
  localDateTimeToInstant
} from './dates'

describe('local date helpers', () => {
  it('strictly validates calendar dates and local times', () => {
    expect(isValidLocalDate('2024-02-29')).toBe(true)
    expect(isValidLocalDate('2023-02-29')).toBe(false)
    expect(isValidLocalDate('2024-13-01')).toBe(false)
    expect(isValidLocalDate('2024-1-01')).toBe(false)
    expect(isValidLocalTime('00:00')).toBe(true)
    expect(isValidLocalTime('23:59')).toBe(true)
    expect(isValidLocalTime('24:00')).toBe(false)
    expect(() => assertLocalDate('2024-02-30')).toThrow(RangeError)
  })

  it('calculates full years and full weeks without timezone drift', () => {
    expect(calculateAge('2020-07-30', '2026-07-29')).toBe(5)
    expect(calculateAge('2020-07-30', '2026-07-30')).toBe(6)
    expect(calculateAgeWeeks('2026-01-01', '2026-01-14')).toBe(1)
    expect(calculateAgeWeeks('2026-01-01', '2026-01-15')).toBe(2)
  })

  it('rejects a future birth date', () => {
    expect(() => calculateAge('2026-08-01', '2026-07-30')).toThrow(
      'birthDate cannot be after asOfDate'
    )
    expect(() => calculateAgeWeeks('2026-08-01', '2026-07-30')).toThrow(
      'birthDate cannot be after asOfDate'
    )
  })

  it('converts wall-clock values with their declared IANA time zone', () => {
    expect(
      localDateTimeToInstant(
        '2026-07-31',
        '09:00',
        'Asia/Shanghai'
      )
    ).toBe('2026-07-31T01:00:00.000Z')
    expect(
      instantToLocalDateTime(
        '2026-07-31T01:00:00.000Z',
        'Asia/Shanghai'
      )
    ).toEqual({ date: '2026-07-31', time: '09:00' })
    expect(() =>
      localDateTimeToInstant(
        '2026-03-08',
        '02:30',
        'America/New_York'
      )
    ).toThrow('do not exist')
  })
})
