import { parseCsvPreview } from './csv'
import {
  suggestMouseFieldMapping,
  validateMouseImport
} from './mouse-import'

describe('mouse CSV import preview', () => {
  it('suggests mappings for Chinese and English headers', () => {
    expect(
      suggestMouseFieldMapping(['耳标号', 'experiment_number', '品系', '性别'])
    ).toEqual({
      earTag: '耳标号',
      experimentNumber: 'experiment_number',
      strain: '品系',
      sex: '性别'
    })
  })

  it('validates rows independently and keeps valid candidates', () => {
    const csv = [
      'earTag,strain,sex,birthDate,status,tags',
      'A-01,C57BL/6,雄,2026-02-01,存活,"cohort-a;control"',
      'A-02,C57BL/6,unknown,not-a-date,alive,',
      ',BALB/c,female,2026-03-01,alive,'
    ].join('\n')
    const parsed = parseCsvPreview(csv)
    const mapping = suggestMouseFieldMapping(parsed.headers)
    const result = validateMouseImport(parsed, mapping, {
      today: '2026-07-30'
    })

    expect(result.validCount).toBe(1)
    expect(result.invalidCount).toBe(2)
    expect(result.rows[0]?.candidate).toMatchObject({
      earTag: 'A-01',
      sex: 'male',
      status: 'alive',
      tagNames: ['cohort-a', 'control']
    })
    expect(result.rows[1]?.errors).toContain(
      '出生日期无效或晚于今天：not-a-date'
    )
    expect(result.rows[2]?.errors).toContain('耳标号和实验编号至少填写一项')
  })

  it('isolates duplicate IDs and ear tags without rejecting other rows', () => {
    const parsed = parseCsvPreview(
      [
        'id,earTag,strain',
        'mouse-1,A-01,C57BL/6',
        'mouse-1,A-02,C57BL/6',
        'mouse-3,A-01,C57BL/6',
        'mouse-4,A-04,C57BL/6'
      ].join('\n')
    )
    const result = validateMouseImport(
      parsed,
      suggestMouseFieldMapping(parsed.headers),
      {
        existingIds: new Set(['mouse-existing']),
        existingEarTags: new Set(['a-existing']),
        today: '2026-07-30'
      }
    )

    expect(result.validCount).toBe(2)
    expect(result.invalidCount).toBe(2)
    expect(result.rows[1]?.errors).toContain('文件内 ID 重复：mouse-1')
    expect(result.rows[2]?.errors).toContain('文件内耳标重复：A-01')
    expect(result.rows[3]?.candidate?.earTag).toBe('A-04')
  })

  it('flags unknown enum values but defaults omitted values', () => {
    const parsed = parseCsvPreview(
      ['earTag,strain,sex,status', 'A-01,C57BL/6,robot,paused', 'A-02,BALB/c,,'].join(
        '\n'
      )
    )
    const result = validateMouseImport(
      parsed,
      suggestMouseFieldMapping(parsed.headers),
      { today: '2026-07-30' }
    )

    expect(result.rows[0]?.errors).toEqual([
      '未知性别：robot',
      '未知状态：paused'
    ])
    expect(result.rows[1]?.candidate).toMatchObject({
      sex: 'unknown',
      status: 'alive'
    })
  })

  it('blocks rows affected by CSV parser errors', () => {
    const parsed = parseCsvPreview(
      'earTag,strain,notes\nA-01,C57BL/6J,"unterminated'
    )
    const result = validateMouseImport(
      parsed,
      suggestMouseFieldMapping(parsed.headers),
      { today: '2026-07-30' }
    )

    expect(parsed.issues.length).toBeGreaterThan(0)
    expect(result.validCount).toBe(0)
    expect(result.rows[0]?.errors.join(' ')).toContain('CSV 解析错误')
  })
})
