import {
  createCsv,
  createCsvBlob,
  neutralizeCsvFormula,
  parseCsvPreview
} from './csv'

describe('CSV utilities', () => {
  it('parses a BOM, quoted commas, and multiline values', () => {
    const result = parseCsvPreview(
      '\uFEFFearTag,notes\r\nA-01,"calm, normal"\r\nA-02,"line 1\nline 2"'
    )

    expect(result.issues).toEqual([])
    expect(result.headers).toEqual(['earTag', 'notes'])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]?.values.notes).toBe('calm, normal')
    expect(result.rows[1]?.values.notes).toBe('line 1\nline 2')
    expect(result.rows[1]?.rowNumber).toBe(3)
  })

  it('keeps parse errors isolated from readable rows', () => {
    const result = parseCsvPreview('earTag,notes\nA-01,"unterminated')

    expect(result.rows).toHaveLength(1)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues[0]?.rowNumber).toBe(2)
    expect(result.issues[0]?.message).toMatch(/quote/i)
  })

  it.each(['=1+1', '+SUM(A1:A2)', '-2+3', '@cmd', '  =HYPERLINK("x")'])(
    'neutralizes spreadsheet formula input %s',
    (value) => {
      expect(neutralizeCsvFormula(value)).toBe(`'${value}`)
    }
  )

  it('exports selected columns and protects formula-like values', () => {
    const csv = createCsv(
      [
        { id: '1', earTag: '=CMD()', notes: 'safe' },
        { id: '2', earTag: 'A-02', notes: null }
      ],
      [
        { key: 'earTag', header: 'earTag', value: (row) => row.earTag },
        { key: 'notes', header: 'notes', value: (row) => row.notes }
      ]
    )

    expect(csv).toContain("'=CMD()")
    expect(csv).toContain('A-02')
    expect(csv).not.toContain('\n1,')
  })

  it('adds a UTF-8 BOM to exported blobs', async () => {
    const bytes = new Uint8Array(await createCsvBlob('earTag\r\nA-01').arrayBuffer())

    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })
})
