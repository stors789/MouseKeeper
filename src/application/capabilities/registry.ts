import type { CapabilityDescriptor, CapabilityExecutionContext, CapabilityExecutionResult, CapabilityHandler, CapabilitySearchOptions, CapabilityToolDefinition, RegisteredCapability } from './types'

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function assertObjectInput(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('能力参数必须是 JSON 对象')
  }
}

function validateRequired(descriptor: CapabilityDescriptor, input: Record<string, unknown>): void {
  for (const key of descriptor.inputSchema.required ?? []) {
    if (input[key] === undefined || input[key] === null || input[key] === '') {
      throw new Error(`${descriptor.id} 缺少必要参数 ${key}`)
    }
  }
}

export class CapabilityRegistry {
  readonly #entries = new Map<string, RegisteredCapability>()

  register(descriptor: CapabilityDescriptor, handler: CapabilityHandler): this {
    if (this.#entries.has(descriptor.id)) {
      throw new Error(`能力 ID 重复：${descriptor.id}`)
    }
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(descriptor.id)) {
      throw new Error(`能力 ID 格式无效：${descriptor.id}`)
    }
    this.#entries.set(descriptor.id, { descriptor, handler })
    return this
  }

  get(id: string): RegisteredCapability | undefined {
    return this.#entries.get(id)
  }

  list(options: CapabilitySearchOptions = {}): CapabilityDescriptor[] {
    const query = normalize(options.query ?? '')
    const queryTokens = query.split(/\s+/).filter(Boolean)
    const limit = Math.max(1, Math.min(options.limit ?? 100, 250))
    return [...this.#entries.values()]
      .map((entry) => entry.descriptor)
      .filter((item) => item.llmExposed)
      .filter((item) => !options.domain || item.domain === options.domain)
      .filter((item) => !options.kind || item.kind === options.kind)
      .filter(
        (item) =>
          options.modifiesData === undefined ||
          item.modifiesData === options.modifiesData
      )
      .filter((item) => {
        if (!query) return true
        const haystack = normalize(
          `${item.id} ${item.domain} ${item.name} ${item.description} ${item.reads.join(' ')} ${item.writes.join(' ')}`
        )
        return queryTokens.every((token) => haystack.includes(token))
      })
      .slice(0, limit)
  }

  async execute(
    id: string,
    input: unknown,
    context: CapabilityExecutionContext
  ): Promise<CapabilityExecutionResult> {
    const entry = this.#entries.get(id)
    if (!entry || !entry.descriptor.llmExposed) {
      throw new Error(`未知或不可用的能力：${id}`)
    }
    assertObjectInput(input)
    validateRequired(entry.descriptor, input)
    context.signal?.throwIfAborted()
    const result = await entry.handler.execute(input, context)
    context.signal?.throwIfAborted()
    if (result.capabilityId !== id) {
      throw new Error(`能力 ${id} 返回了不匹配的 capabilityId`)
    }
    return result
  }

  agentTools(): CapabilityToolDefinition[] {
    return [
      {
        type: 'function',
        name: 'search_capabilities',
        description: '按自然语言、领域或类型搜索 MouseKeeper 的可执行能力。先搜索不熟悉的领域，再调用 execute_capability。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            domain: { type: ['string', 'null'] },
            kind: { type: ['string', 'null'], enum: ['query', 'command', 'navigation', 'view', 'file', 'browser', null] },
            modifiesData: { type: ['boolean', 'null'] },
            limit: { type: 'integer', minimum: 1, maximum: 50 }
          },
          required: ['query'],
          additionalProperties: false
        },
        strict: true
      },
      {
        type: 'function',
        name: 'execute_capability',
        description: '按稳定 capabilityId 执行能力。参数必须符合搜索结果返回的 inputSchema。明确且可执行时直接调用。',
        parameters: {
          type: 'object',
          properties: {
            capabilityId: { type: 'string' },
            input: { type: 'object', additionalProperties: true }
          },
          required: ['capabilityId', 'input'],
          additionalProperties: false
        },
        strict: true
      }
    ]
  }
}
