export type FileWorkflowKind = 'backup-restore' | 'csv-import'

export interface FileRequest {
  id: string
  kind: FileWorkflowKind
  accept: string
  createdAt: string
  status: 'waiting' | 'provided' | 'previewed' | 'consumed'
  fileName?: string
}

export interface FilePreviewAuthorization {
  id: string
  requestId: string
  kind: FileWorkflowKind
  createdAt: string
  status: 'ready' | 'consumed'
  metadata: Readonly<Record<string, unknown>>
}

export class FileBroker {
  readonly #requests = new Map<string, FileRequest>()
  readonly #files = new Map<string, File>()
  readonly #authorizations = new Map<string, FilePreviewAuthorization>()

  request(kind: FileWorkflowKind): FileRequest {
    const request: FileRequest = {
      id: crypto.randomUUID(),
      kind,
      accept: kind === 'backup-restore' ? '.json,application/json' : '.csv,text/csv',
      createdAt: new Date().toISOString(),
      status: 'waiting'
    }
    this.#requests.set(request.id, request)
    return structuredClone(request)
  }

  provide(requestId: string, file: File): FileRequest {
    const request = this.#requests.get(requestId)
    if (!request || request.status !== 'waiting') throw new Error('文件请求已失效')
    const expected = request.kind === 'backup-restore' ? '.json' : '.csv'
    if (!file.name.toLocaleLowerCase().endsWith(expected)) {
      throw new Error(`请选择 ${expected} 文件`)
    }
    const updated: FileRequest = {
      ...request,
      status: 'provided',
      fileName: file.name
    }
    this.#requests.set(requestId, updated)
    this.#files.set(requestId, file)
    return structuredClone(updated)
  }

  getRequest(requestId: string): FileRequest | undefined {
    const request = this.#requests.get(requestId)
    return request ? structuredClone(request) : undefined
  }

  preview(requestId: string, expectedKind: FileWorkflowKind): File {
    const request = this.#requests.get(requestId)
    const file = this.#files.get(requestId)
    if (!request || request.kind !== expectedKind || !['provided', 'previewed'].includes(request.status) || !file) {
      throw new Error('尚未选择所需文件')
    }
    return file
  }

  authorizePreview(
    requestId: string,
    expectedKind: FileWorkflowKind,
    metadata: Readonly<Record<string, unknown>> = {}
  ): FilePreviewAuthorization {
    const request = this.#requests.get(requestId)
    if (!request || request.kind !== expectedKind || !['provided', 'previewed'].includes(request.status) || !this.#files.has(requestId)) {
      throw new Error('尚未预览所需文件')
    }
    for (const authorization of this.#authorizations.values()) {
      if (authorization.requestId === requestId && authorization.status !== 'consumed') {
        this.#authorizations.set(authorization.id, { ...authorization, status: 'consumed' })
      }
    }
    const authorization: FilePreviewAuthorization = {
      id: crypto.randomUUID(),
      requestId,
      kind: expectedKind,
      createdAt: new Date().toISOString(),
      status: 'ready',
      metadata: structuredClone(metadata)
    }
    this.#requests.set(requestId, { ...request, status: 'previewed' })
    this.#authorizations.set(authorization.id, authorization)
    return structuredClone(authorization)
  }

  consumeAuthorized(id: string, expectedKind: FileWorkflowKind): {
    file: File
    metadata: Readonly<Record<string, unknown>>
  } {
    const authorization = this.#authorizations.get(id)
    const request = authorization ? this.#requests.get(authorization.requestId) : undefined
    const file = authorization ? this.#files.get(authorization.requestId) : undefined
    if (!authorization || authorization.kind !== expectedKind || authorization.status !== 'ready' || !request || request.status !== 'previewed' || !file) {
      throw new Error('必须先预览同一个用户选择的文件，并使用未消费的 previewToken 才能提交')
    }
    this.#authorizations.set(id, { ...authorization, status: 'consumed' })
    this.#requests.set(request.id, { ...request, status: 'consumed' })
    this.#files.delete(request.id)
    return { file, metadata: structuredClone(authorization.metadata) }
  }
}

export const fileBroker = new FileBroker()
