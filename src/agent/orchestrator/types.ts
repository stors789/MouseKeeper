import type { CapabilityExecutionResult, EntityReference } from '../../application'
import type { AgentCommandRun, CommandToolTrace } from '../recovery'
import type { LLMPreset, NormalizedLLMRequest, NormalizedLLMResult, ProviderEventListener, ProviderProfile } from '../provider'

export interface AgentModelClient {
  generate(
    profile: ProviderProfile,
    preset: LLMPreset,
    input: NormalizedLLMRequest,
    signal?: AbortSignal,
    onEvent?: ProviderEventListener
  ): Promise<NormalizedLLMResult>
}

export interface AgentContext {
  currentRoute: string
  selected: EntityReference[]
  references?: AgentRunReference[]
  visibleFilters?: Record<string, unknown>
  locale: string
  timeZone: string
  now: string
}

export interface AgentRunReference {
  id: string
  createdAt: string
  prompt: string
  status: AgentCommandRun['status']
  summary?: string
  error?: string
  capabilityIds: string[]
}

export interface AgentRunInput {
  sessionId: string
  prompt: string
  profile: ProviderProfile
  preset: LLMPreset
  context: AgentContext
}

export type AgentProgress =
  | { type: 'started'; commandRunId: string }
  | { type: 'thinking'; round: number }
  | { type: 'text-delta'; delta: string; text: string }
  | { type: 'tool-started'; trace: CommandToolTrace }
  | { type: 'tool-completed'; trace: CommandToolTrace; result?: CapabilityExecutionResult }
  | { type: 'text'; text: string }
  | { type: 'completed'; commandRun: AgentCommandRun }
  | { type: 'failed'; message: string; commandRun?: AgentCommandRun }

export interface AgentRunResult {
  commandRunId: string
  status: 'succeeded' | 'failed'
  text: string
  results: CapabilityExecutionResult[]
  affected: EntityReference[]
  commandRun: AgentCommandRun
  rounds: number
  error?: string
}

export interface AgentOrchestratorOptions {
  onProgress?: (progress: AgentProgress) => void
}
