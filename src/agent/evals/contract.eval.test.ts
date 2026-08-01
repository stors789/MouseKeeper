import { createApplicationCapabilityRegistry } from '../../application'
import type { JsonSchema } from '../../application'
import { createMouseKeeperDatabase } from '../../db'
import { MouseKeeperService } from '../../services'
import { validateJsonSchema } from '../../application/capabilities/schema'
import { AGENT_EVAL_CASES, AGENT_EVAL_CATEGORY_COUNTS } from './cases'
import type { AgentEvalCase, EvalExpectedCall } from './types'
import deterministicModelSource from './deterministic-model.ts?raw'

function missingRequired(schema: JsonSchema, value: Readonly<Record<string, unknown>>): string[] {
  return (schema.required ?? []).filter((key) => value[key] === undefined || value[key] === null || value[key] === '')
}

function traceMatches(expected: readonly EvalExpectedCall[], actual: readonly { capabilityId: string; input: Readonly<Record<string, unknown>> }[]): boolean {
  return expected.length === actual.length && expected.every((call, index) => {
    const candidate = actual[index]
    return candidate?.capabilityId === call.capabilityId && JSON.stringify(candidate.input) === JSON.stringify(call.input)
  })
}

describe('offline Agent eval contract matrix', () => {
  const database = createMouseKeeperDatabase(`eval-contract-${crypto.randomUUID()}`)
  const registry = createApplicationCapabilityRegistry(database, new MouseKeeperService(database))

  afterAll(async () => {
    database.close()
    await database.delete()
  })

  it('contains exactly 288 distinct, deterministic cases in the reviewed quotas', () => {
    expect(AGENT_EVAL_CASES).toHaveLength(288)
    expect(new Set(AGENT_EVAL_CASES.map((item) => item.id)).size).toBe(288)
    expect(new Set(AGENT_EVAL_CASES.map((item) => item.input)).size).toBe(288)
    const counts = Object.fromEntries(Object.keys(AGENT_EVAL_CATEGORY_COUNTS).map((category) => [
      category,
      AGENT_EVAL_CASES.filter((item) => item.category === category).length
    ]))
    expect(counts).toEqual(AGENT_EVAL_CATEGORY_COUNTS)
    expect(JSON.stringify(AGENT_EVAL_CASES)).toBe(JSON.stringify(AGENT_EVAL_CASES))
  })

  it('maps every audit row 1..106 once and only once', () => {
    const mirror = AGENT_EVAL_CASES.filter((item) => item.category === 'capability-mirror')
    expect(mirror.map((item) => item.auditRow)).toEqual(Array.from({ length: 106 }, (_, index) => index + 1))
    expect(mirror.every((item) => item.id === `CAP-${String(item.auditRow).padStart(3, '0')}`)).toBe(true)
  })

  it('checks every expected capability, policy and required input against the production registry', () => {
    for (const evalCase of AGENT_EVAL_CASES) {
      expect(evalCase.context.currentRoute).toMatch(/^\//)
      expect(evalCase.context.locale.length).toBeGreaterThan(0)
      expect(evalCase.context.timeZone.length).toBeGreaterThan(0)
      expect(evalCase.context.now).toContain('2026-08-01')
      expect(Number.isInteger(evalCase.context.selectedCount)).toBe(true)
      for (const call of evalCase.expected.calls) {
        const descriptor = registry.get(call.capabilityId)?.descriptor
        expect(descriptor, `${evalCase.id}: ${call.capabilityId}`).toBeDefined()
        expect(call.risk, `${evalCase.id}: risk`).toBe(descriptor?.risk)
        expect(call.recovery, `${evalCase.id}: recovery`).toBe(descriptor?.recovery)
        expect(missingRequired(descriptor!.inputSchema, call.input), `${evalCase.id}: required args`).toEqual([])
        expect(validateJsonSchema(call.input, descriptor!.inputSchema), `${evalCase.id}: runtime schema`).toEqual([])
      }
    }
  })

  it('exposes only the two strict orchestration tools and a schema-bearing execute call', () => {
    const tools = registry.agentTools()
    expect(tools.map((tool) => tool.name)).toEqual(['search_capabilities', 'execute_capability'])
    expect(tools.every((tool) => tool.strict && tool.parameters.additionalProperties === false)).toBe(true)
    expect(tools[1]?.parameters.required).toEqual(['capabilityId', 'input'])
    expect(registry.list().every((descriptor) => descriptor.inputSchema.type === 'object')).toBe(true)
  })

  it('keeps transcript playback independent from case expectations', () => {
    const imports = deterministicModelSource.match(/^import .*$/gm)?.join('\n') ?? ''
    expect(imports).not.toMatch(/cases|oracle/i)
  })

  it('kills wrong, missing, duplicate, reordered and argument-tampered trace mutations', () => {
    const sample = AGENT_EVAL_CASES.find((item) => item.id === 'FLOW-003') as AgentEvalCase
    const original = sample.expected.calls.map((call) => ({ capabilityId: call.capabilityId, input: call.input }))
    expect(traceMatches(sample.expected.calls, original)).toBe(true)
    const mutations = [
      original.map((item, index) => index === 0 ? { ...item, capabilityId: 'query.dashboard' } : item),
      original.slice(1),
      [...original, original[0]!],
      [original[1]!, original[0]!, ...original.slice(2)],
      original.map((item, index) => index === 0 ? { ...item, input: { ...item.input, tampered: true } } : item)
    ]
    expect(mutations.filter((mutation) => !traceMatches(sample.expected.calls, mutation))).toHaveLength(5)
  })

  it('classifies all protocol and failure cases without silent skips', () => {
    const protocol = AGENT_EVAL_CASES.filter((item) => item.category === 'protocol')
    const failures = AGENT_EVAL_CASES.filter((item) => item.category === 'failure')
    expect(new Set(protocol.map((item) => item.expected.protocolClass)).size).toBe(16)
    expect(new Set(failures.map((item) => item.expected.errorClass)).size).toBe(16)
    expect(AGENT_EVAL_CASES.some((item) => item.expected.requiresUserGesture)).toBe(true)
    expect(AGENT_EVAL_CASES.every((item) => !item.tags.includes('skip'))).toBe(true)
  })
})
