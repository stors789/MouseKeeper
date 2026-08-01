import type { CapabilityRisk, RecoveryStrategy } from '../../application'

export type EvalCategory =
  | 'capability-mirror'
  | 'language'
  | 'context-time'
  | 'workflow'
  | 'safety-recovery'
  | 'file-gesture'
  | 'failure'
  | 'protocol'

export interface EvalContextContract {
  currentRoute: string
  locale: string
  timeZone: string
  now: string
  selectedCount: number
  visibleFilters?: Readonly<Record<string, string>>
}

export interface EvalExpectedCall {
  capabilityId: string
  input: Readonly<Record<string, unknown>>
  risk: CapabilityRisk
  recovery: RecoveryStrategy
}

export interface AgentEvalCase {
  id: string
  category: EvalCategory
  input: string
  auditRow?: number
  tags: readonly string[]
  context: EvalContextContract
  expected: {
    outcome: 'succeeded' | 'failed' | 'needs-user-action'
    calls: readonly EvalExpectedCall[]
    commandRecovery: RecoveryStrategy
    requiresUserGesture: boolean
    protocolClass?: string
    errorClass?: string
  }
}

