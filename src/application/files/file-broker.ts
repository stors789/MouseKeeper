export type FileWorkflowKind = 'backup-restore' | 'csv-import'

export interface FileRequest {
  id: string
  kind: FileWorkflowKind
  accept: string
  createdAt: string
  status: 'waiting' | 'provided' | 'consumed'
  fileName?: string
}

export class FileBroker {
  readonly #requests = new Map<string, FileRequest>()
  readonly #files = new Map<string, File>()

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

  consume(requestId: string, expectedKind: FileWorkflowKind): File {
    const request = this.#requests.get(requestId)
    const file = this.#files.get(requestId)
    if (!request || request.kind !== expectedKind || request.status !== 'provided' || !file) {
      throw new Error('尚未选择所需文件')
    }
    this.#requests.set(requestId, { ...request, status: 'consumed' })
    this.#files.delete(requestId)
    return file
  }
}

export const fileBroker = new FileBroker()
