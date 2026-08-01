import type { JsonValue } from '../../domain'

export type CapabilityKind =
  | 'query'
  | 'command'
  | 'navigation'
  | 'view'
  | 'file'
  | 'browser'

export type CapabilityRisk =
  | 'read-only'
  | 'view-only'
  | 'reversible'
  | 'high-impact'
  | 'irreversible'

export type RecoveryStrategy =
  | 'none'
  | 'row-diff'
  | 'full-backup'
  | 'browser-managed'

export interface JsonSchema {
  type?: string | readonly string[]
  title?: string
  description?: string
  enum?: readonly JsonValue[]
  const?: JsonValue
  properties?: Readonly<Record<string, JsonSchema>>
  required?: readonly string[]
  items?: JsonSchema
  additionalProperties?: boolean | JsonSchema
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  minLength?: number
  format?: string
  oneOf?: readonly JsonSchema[]
}

export interface CapabilityDescriptor {
  id: string
  version: number
  domain: string
  name: string
  description: string
  kind: CapabilityKind
  inputSchema: JsonSchema
  outputDescription: string
  requiredContext: readonly string[]
  reads: readonly string[]
  writes: readonly string[]
  modifiesData: boolean
  supportsBatch: boolean
  risk: CapabilityRisk
  recovery: RecoveryStrategy
  requiresUserGesture?: boolean
  service: string
  errorTypes: readonly string[]
  preconditions: readonly string[]
  testLocations: readonly string[]
  llmExposed: boolean
}

export interface EntityReference {
  type: string
  id: string
  label?: string
  href?: string
  revision?: number
}

export interface PreparedArtifact {
  id: string
  name: string
  mediaType: string
  size: number
  kind: 'download' | 'file-request'
}

export interface CapabilityExecutionResult<T = unknown> {
  status: 'succeeded' | 'prepared' | 'needs-user-action'
  capabilityId: string
  summary: string
  data?: T
  affected: EntityReference[]
  artifacts?: PreparedArtifact[]
  open?: { href: string; label: string }
  warnings: string[]
  modifiesData: boolean
}

export interface CapabilityExecutionContext {
  actor: 'ui' | 'llm' | 'system'
  commandRunId: string
  operationId: string
  signal?: AbortSignal
  currentRoute?: string
  selected?: readonly EntityReference[]
  recent?: readonly EntityReference[]
}

export interface CapabilityHandler {
  execute(
    input: Readonly<Record<string, unknown>>,
    context: CapabilityExecutionContext
  ): Promise<CapabilityExecutionResult>
}

export interface RegisteredCapability {
  descriptor: CapabilityDescriptor
  handler: CapabilityHandler
}

export interface CapabilitySearchOptions {
  query?: string
  domain?: string
  kind?: CapabilityKind
  modifiesData?: boolean
  limit?: number
}

export interface CapabilityToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: JsonSchema
  strict: boolean
}
