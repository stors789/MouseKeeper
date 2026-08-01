import { FileBroker } from '../files'
import { exportDatabaseBackup, serializeBackup } from '../../backup'
import { createMouseKeeperDatabase, type MouseKeeperDatabase } from '../../db'
import { MouseKeeperService } from '../../services'
import { EXTENDED_CAPABILITY_DESCRIPTORS, APPLICATION_EVENT_NAMES, createApplicationCapabilityRegistry } from './extended-handlers'
import type { CapabilityExecutionContext } from './types'

describe('extended application capabilities', () => {
  let database: MouseKeeperDatabase
  let files: FileBroker
  let registry: ReturnType<typeof createApplicationCapabilityRegistry>

  beforeEach(async () => {
    window.localStorage.clear()
    database = createMouseKeeperDatabase(`extended-test-${crypto.randomUUID()}`)
    await database.open()
    files = new FileBroker()
    registry = createApplicationCapabilityRegistry(
      database,
      new MouseKeeperService(database),
      { fileBroker: files }
    )
  })

  afterEach(async () => {
    database.close()
    await database.delete()
  })

  function context(label: string): CapabilityExecutionContext {
    return {
      actor: 'llm',
      commandRunId: `run-${label}`,
      operationId: `operation-${label}-${crypto.randomUUID()}`
    }
  }

  it('registers every extended descriptor and drives stable navigation events', async () => {
    expect(registry.list({ limit: 250 }).map((item) => item.id)).toEqual(
      expect.arrayContaining(EXTENDED_CAPABILITY_DESCRIPTORS.map((item) => item.id))
    )
    const listener = vi.fn()
    globalThis.addEventListener(APPLICATION_EVENT_NAMES.navigate, listener)
    await registry.execute('navigation.open.entity', { entityType: 'mouse', entityId: 'mouse/1' }, context('navigate'))
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { href: '/mice/mouse%2F1' } })
    )
    globalThis.removeEventListener(APPLICATION_EVENT_NAMES.navigate, listener)
  })

  it('changes theme through shared persistent view state', async () => {
    const listener = vi.fn()
    globalThis.addEventListener(APPLICATION_EVENT_NAMES.setTheme, listener)
    const result = await registry.execute('settings.theme.set', { theme: 'dark' }, context('theme'))
    expect(result.modifiesData).toBe(true)
    expect(window.localStorage.getItem('mousekeeper:theme:v1')).toBe('dark')
    expect(listener).toHaveBeenCalled()
    globalThis.removeEventListener(APPLICATION_EVENT_NAMES.setTheme, listener)
  })

  it('keeps CSV preview read-only and commits only its one-time token', async () => {
    const request = await registry.execute('data.file.request', { kind: 'csv-import' }, context('request-file'))
    expect(request).toMatchObject({ status: 'needs-user-action' })
    const requestId = request.artifacts![0]!.id
    files.provide(
      requestId,
      new File(['耳标号,品系,性别\nAGENT-CSV,C57BL/6J,雌'], 'agent.csv', { type: 'text/csv' })
    )
    const preview = await registry.execute(
      'data.csv.preview',
      { fileRequestId: requestId },
      context('preview-file')
    )
    expect(preview).toMatchObject({ status: 'prepared', modifiesData: false })
    expect(preview.summary).toContain('尚未写入')
    expect(await database.mice.count()).toBe(0)
    const previewToken = (preview.data as { previewToken: string }).previewToken
    const imported = await registry.execute(
      'data.csv.import', { previewToken }, context('import-file')
    )
    expect(imported.summary).toContain('成功 1')
    expect(await database.mice.where('normalizedEarTag').equals('agent-csv').count()).toBe(1)
    await expect(registry.execute(
      'data.csv.import', { previewToken }, context('reused-import')
    )).rejects.toThrow('未消费')
  })

  it('keeps backup preview read-only and commits only the same previewed file', async () => {
    const source = createMouseKeeperDatabase(`extended-source-${crypto.randomUUID()}`)
    await source.open()
    try {
      const sourceService = new MouseKeeperService(source)
      await sourceService.createMouse({ operationId: crypto.randomUUID(), earTag: 'FROM-BACKUP', strain: 'BALB/c', sex: 'male' })
      await new MouseKeeperService(database).createMouse({ operationId: crypto.randomUUID(), earTag: 'BEFORE-RESTORE', strain: 'C57BL/6J', sex: 'female' })
      const serialized = serializeBackup(await exportDatabaseBackup(source))
      const request = await registry.execute('data.file.request', { kind: 'backup-restore' }, context('request-backup'))
      const requestId = request.artifacts![0]!.id
      files.provide(requestId, new File([serialized], 'backup.json', { type: 'application/json' }))

      const preview = await registry.execute('data.backup.preview', { fileRequestId: requestId }, context('preview-backup'))
      expect(preview).toMatchObject({ status: 'prepared', modifiesData: false })
      expect((await database.mice.toArray()).map((mouse) => mouse.earTag)).toContain('BEFORE-RESTORE')
      const previewToken = (preview.data as { previewToken: string }).previewToken

      const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
      await registry.execute('data.backup.restore', { previewToken }, context('commit-backup'))
      createObjectURL.mockRestore()
      revokeObjectURL.mockRestore()
      expect((await database.mice.toArray()).map((mouse) => mouse.earTag)).toEqual(['FROM-BACKUP'])
      await expect(registry.execute('data.backup.restore', { previewToken }, context('reused-backup'))).rejects.toThrow('未消费')
    } finally {
      source.close()
      await source.delete()
    }
  })

  it('rejects unknown CSV mapping keys before reading or writing the file', async () => {
    await expect(registry.execute(
      'data.csv.preview',
      { fileRequestId: 'missing', mapping: { inventedField: '表头' } },
      context('invalid-mapping')
    )).rejects.toThrow('$.mapping.inventedField')
  })

  it('previews and executes permanent deletion through the same registry', async () => {
    const created = await registry.execute(
      'task.create',
      { title: '误建任务', dueDate: '2026-08-02' },
      context('create-task')
    )
    const taskId = created.affected.find((item) => item.type === 'task')!.id
    await registry.execute('task.delete', { taskId }, context('delete-task'))
    const preview = await registry.execute(
      'data.purge.preview',
      { entityType: 'task', entityId: taskId },
      context('preview-purge')
    )
    expect(preview.summary).toContain('可永久删除')
    const purged = await registry.execute(
      'data.purge.execute',
      { entityType: 'task', entityId: taskId },
      context('execute-purge')
    )
    expect(purged.summary).toContain('永久删除 1')
    expect(await database.tasks.get(taskId)).toBeUndefined()
  })

  it('stores view commands without manipulating component DOM', async () => {
    const listener = vi.fn()
    globalThis.addEventListener(APPLICATION_EVENT_NAMES.view, listener)
    await registry.execute(
      'view.configure',
      { workspace: 'mice', state: { sex: 'female', sort: 'age-oldest', page: 3, selectedIds: ['m-1', 'm-2'], clear: 'selection' } },
      context('view')
    )
    expect(JSON.parse(window.localStorage.getItem('mousekeeper:view-command:mice')!)).toEqual({
      sex: 'female',
      sort: 'age-oldest',
      page: 3,
      selectedIds: ['m-1', 'm-2'],
      clear: 'selection'
    })
    expect(listener).toHaveBeenCalled()
    globalThis.removeEventListener(APPLICATION_EVENT_NAMES.view, listener)
  })

  it('opens the shared create menu through a stable capability', async () => {
    const listener = vi.fn()
    globalThis.addEventListener(APPLICATION_EVENT_NAMES.openCreateMenu, listener)
    const result = await registry.execute('view.create-menu.open', {}, context('create-menu'))
    expect(result).toMatchObject({ status: 'succeeded', modifiesData: false })
    expect(listener).toHaveBeenCalledTimes(1)
    globalThis.removeEventListener(APPLICATION_EVENT_NAMES.openCreateMenu, listener)
  })

  it('reports navigation cancellation when an unsaved-form listener prevents it', async () => {
    const prevent = (event: Event) => event.preventDefault()
    globalThis.addEventListener(APPLICATION_EVENT_NAMES.navigate, prevent)
    await expect(registry.execute(
      'navigation.open', { href: '/agent' }, context('blocked-navigation')
    )).rejects.toThrow('用户取消离开未保存表单')
    globalThis.removeEventListener(APPLICATION_EVENT_NAMES.navigate, prevent)
  })

  it('rejects view state fields that the target page cannot apply', async () => {
    await expect(registry.execute(
      'view.configure',
      { workspace: 'mice', state: { filters: { sex: 'female' } } },
      context('invalid-view')
    )).rejects.toThrow('$.state.filters')
    expect(window.localStorage.getItem('mousekeeper:view-command:mice')).toBeNull()
  })
})
