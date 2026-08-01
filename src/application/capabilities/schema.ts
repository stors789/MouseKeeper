import type { JsonSchema } from './types'

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
