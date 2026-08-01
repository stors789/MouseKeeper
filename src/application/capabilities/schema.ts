import type { JsonSchema } from './types'

export interface JsonSchemaValidationError {
  path: string
  message: string
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

function valueType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer'
  return typeof value
}

function matchesType(value: unknown, expected: string): boolean {
  if (expected === 'null') return value === null
  if (expected === 'array') return Array.isArray(value)
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (expected === 'integer') return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === expected
}

function propertyPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`
}

function validFormat(value: string, format: string): boolean {
  if (format === 'date') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return false
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  }
  if (format === 'date-time') return !Number.isNaN(Date.parse(value)) && /T/.test(value)
  if (format === 'time') return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)
  if (format === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  return true
}

/** Validate the JSON Schema subset emitted by the capability registry. */
export function validateJsonSchema(
  value: unknown,
  schema: JsonSchema,
  path = '$'
): JsonSchemaValidationError[] {
  if (schema.oneOf) {
    const branchResults = schema.oneOf.map((branch) => validateJsonSchema(value, branch, path))
    const matching = branchResults.filter((errors) => errors.length === 0)
    if (matching.length !== 1) {
      const detail = matching.length === 0
        ? branchResults.map((errors, index) => `#${index + 1}: ${errors[0] ? `${errors[0].path}: ${errors[0].message}` : '不匹配'}`).join('；')
        : `匹配了 ${matching.length} 个分支`
      return [{ path, message: `必须匹配 oneOf 中恰好一个 schema（${detail}）` }]
    }
  }

  const errors: JsonSchemaValidationError[] = []
  const expectedTypes = typeof schema.type === 'string' ? [schema.type] : schema.type
  if (expectedTypes && !expectedTypes.some((expected) => matchesType(value, expected))) {
    return [{ path, message: `类型必须是 ${expectedTypes.join(' | ')}，实际为 ${valueType(value)}` }]
  }
  if (schema.const !== undefined && !jsonEqual(value, schema.const)) {
    errors.push({ path, message: `必须等于 ${JSON.stringify(schema.const)}` })
  }
  if (schema.enum && !schema.enum.some((item) => jsonEqual(value, item))) {
    errors.push({ path, message: `必须是枚举值 ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}` })
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, message: `长度不能小于 ${schema.minLength}` })
    }
    if (schema.format && !validFormat(value, schema.format)) {
      errors.push({ path, message: `必须符合 ${schema.format} 格式` })
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, message: `不能小于 ${schema.minimum}` })
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, message: `不能大于 ${schema.maximum}` })
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, message: `项目数不能小于 ${schema.minItems}` })
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path, message: `项目数不能大于 ${schema.maxItems}` })
    if (schema.items) value.forEach((item, index) => errors.push(...validateJsonSchema(item, schema.items!, `${path}[${index}]`)))
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) {
        errors.push({ path: propertyPath(path, key), message: `缺少必要参数 ${key}` })
      }
    }
    for (const [key, item] of Object.entries(record)) {
      const childPath = propertyPath(path, key)
      const propertySchema = schema.properties?.[key]
      if (propertySchema) {
        errors.push(...validateJsonSchema(item, propertySchema, childPath))
      } else if (schema.additionalProperties === false) {
        errors.push({ path: childPath, message: '不允许额外属性' })
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(...validateJsonSchema(item, schema.additionalProperties, childPath))
      }
    }
  }
  return errors
}

export function assertJsonSchema(value: unknown, schema: JsonSchema, path = '$'): void {
  const errors = validateJsonSchema(value, schema, path)
  if (errors.length > 0) {
    throw new Error(errors.map((error) => `${error.path}: ${error.message}`).join('；'))
  }
}

export const stringSchema = (description?: string): JsonSchema => ({
  type: 'string',
  ...(description ? { description } : {})
})

export const optionalStringSchema = (description?: string): JsonSchema => ({
  type: ['string', 'null'],
  ...(description ? { description } : {})
})

export const numberSchema = (description?: string): JsonSchema => ({
  type: 'number',
  ...(description ? { description } : {})
})

export const integerSchema = (description?: string): JsonSchema => ({
  type: 'integer',
  ...(description ? { description } : {})
})

export const booleanSchema = (description?: string): JsonSchema => ({
  type: 'boolean',
  ...(description ? { description } : {})
})

export const arraySchema = (
  items: JsonSchema,
  description?: string
): JsonSchema => ({
  type: 'array',
  items,
  ...(description ? { description } : {})
})

export function objectSchema(
  properties: Readonly<Record<string, JsonSchema>>,
  required: readonly string[] = [],
  description?: string,
  additionalProperties: boolean | JsonSchema = false
): JsonSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties,
    ...(description ? { description } : {})
  }
}

export function enumSchema(values: readonly string[], description?: string): JsonSchema {
  return {
    type: 'string',
    enum: values,
    ...(description ? { description } : {})
  }
}

export const emptyObjectSchema = objectSchema({})
