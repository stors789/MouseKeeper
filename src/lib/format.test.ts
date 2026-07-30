import { formatAgeWeeks, formatInstant, formatLocalDate, formatWeight } from './format'
import { isTerminalMouseStatus } from './labels'

describe('presentation formatters', () => {
  it('formats known and missing dates without throwing', () => {
    expect(formatLocalDate('2026-07-30')).toMatch(/2026/)
    expect(formatLocalDate(undefined)).toBe('未记录')
    expect(formatLocalDate('2026-02-30')).toBe('未记录')
  })

  it('formats week age and invalid ranges', () => {
    expect(formatAgeWeeks('2026-07-16', '2026-07-30')).toBe('2 周')
    expect(formatAgeWeeks(undefined, '2026-07-30')).toBe('周龄未知')
    expect(formatAgeWeeks('2026-08-01', '2026-07-30')).toBe('出生日期无效')
  })

  it('formats instants and weights', () => {
    expect(formatInstant('2026-07-30T10:00:00.000Z')).not.toBe('时间无效')
    expect(formatInstant('invalid')).toBe('时间无效')
    expect(formatWeight(23.85)).toBe('23.85 g')
  })

  it('identifies terminal mouse states', () => {
    expect(isTerminalMouseStatus('dead')).toBe(true)
    expect(isTerminalMouseStatus('euthanized')).toBe(true)
    expect(isTerminalMouseStatus('transferred')).toBe(true)
    expect(isTerminalMouseStatus('experimental')).toBe(false)
  })
})
