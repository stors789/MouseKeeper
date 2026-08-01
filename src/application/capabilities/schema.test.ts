import { validateJsonSchema } from './schema'
import type { JsonSchema } from './types'

describe('capability JSON Schema validation', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['safe', 'fast'] },
      version: { const: 1 },
      label: { type: 'string', minLength: 3 },
      score: { type: 'number', minimum: 0, maximum: 10 },
      values: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'integer' } },
      date: { type: 'string', format: 'date' },
      choice: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      metadata: {
        type: 'object',
        additionalProperties: { type: ['string', 'number'] }
      }
    },
    required: ['mode', 'version', 'label', 'score', 'values', 'date', 'choice'],
    additionalProperties: false
  }

  it('accepts the complete supported recursive schema subset', () => {
    expect(validateJsonSchema({
      mode: 'safe', version: 1, label: 'abc', score: 5,
      values: [1, 2], date: '2026-08-01', choice: null,
      metadata: { source: 'agent', rank: 1 }
    }, schema)).toEqual([])
  })

  it('reports deterministic JSON paths for every nested constraint', () => {
    const errors = validateJsonSchema({
      mode: 'unsafe', version: 2, label: 'x', score: 11,
      values: [1, 2.5, 3], date: '2026-02-30', choice: false,
      metadata: { invalid: false }, extra: true
    }, schema)
    expect(errors.map((error) => error.path)).toEqual(expect.arrayContaining([
      '$.mode', '$.version', '$.label', '$.score', '$.values', '$.values[1]',
      '$.date', '$.choice', '$.metadata.invalid', '$.extra'
    ]))
  })

  it('distinguishes a missing required property from a present null value', () => {
    const missing = validateJsonSchema({}, { type: 'object', properties: { value: { type: ['string', 'null'] } }, required: ['value'] })
    const present = validateJsonSchema({ value: null }, { type: 'object', properties: { value: { type: ['string', 'null'] } }, required: ['value'] })
    expect(missing).toEqual([{ path: '$.value', message: '缺少必要参数 value' }])
    expect(present).toEqual([])
  })
})
