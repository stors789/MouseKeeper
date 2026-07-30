export type ServiceErrorCode =
  | 'not-found'
  | 'record-deleted'
  | 'duplicate-id'
  | 'duplicate-ear-tag'
  | 'duplicate-cage-number'
  | 'duplicate-tag-name'
  | 'duplicate-experiment-code'
  | 'duplicate-breeding-pair'
  | 'duplicate-litter'
  | 'duplicate-experiment-group'
  | 'already-in-cage'
  | 'already-assigned'
  | 'exclusive-group-conflict'
  | 'revision-conflict'
  | 'invalid-reference'
  | 'invalid-state'
  | 'pedigree-cycle'
  | 'warning-required'
  | 'mixed-sample-references'
  | 'integrity-error'

export class ServiceError extends Error {
  readonly code: ServiceErrorCode
  readonly details?: Readonly<Record<string, unknown>>

  constructor(
    code: ServiceErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>
  ) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
    this.details = details
  }
}

export class WarningRequiredError extends ServiceError {
  readonly warnings: readonly string[]

  constructor(warnings: readonly string[]) {
    super('warning-required', 'Explicit acknowledgement is required', {
      warnings
    })
    this.name = 'WarningRequiredError'
    this.warnings = warnings
  }
}

