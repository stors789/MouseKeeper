import type { NormalizedLLMRequest, NormalizedLLMResult, NormalizedToolCall } from '../provider'
import type { AgentModelClient, AgentRunInput } from '../orchestrator'

export type TranscriptStep =
  | { text: string; calls?: readonly NormalizedToolCall[] }
  | ((request: NormalizedLLMRequest, round: number) => { text: string; calls?: readonly NormalizedToolCall[] })

export function toolCall(
  id: string,
  capabilityId: string,
  input: Readonly<Record<string, unknown>>
): NormalizedToolCall {
  const args = { capabilityId, input }
  return {
    id,
    name: 'execute_capability',
    arguments: args,
    rawArguments: JSON.stringify(args)
  }
}

/**
 * Replays an independently-authored normalized transcript. It deliberately has
 * no dependency on cases.ts or any expected/oracle structure.
 */
export class DeterministicTranscriptModel implements AgentModelClient {
  readonly requests: NormalizedLLMRequest[] = []

  constructor(private readonly transcript: readonly TranscriptStep[]) {}

  generate(
    _profile: AgentRunInput['profile'],
    preset: AgentRunInput['preset'],
    request: NormalizedLLMRequest
  ): Promise<NormalizedLLMResult> {
    const round = this.requests.length
    this.requests.push(structuredClone(request))
    const rawStep = this.transcript[round]
    if (!rawStep) throw new Error(`确定性转录缺少第 ${round + 1} 轮`)
    const step = typeof rawStep === 'function' ? rawStep(request, round) : rawStep
    return Promise.resolve({
      id: `offline-transcript-${round + 1}`,
      text: step.text,
      toolCalls: [...(step.calls ?? [])],
      effective: { requested: preset, omitted: [] }
    })
  }
}
