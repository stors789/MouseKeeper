import { FileBroker } from '../files'
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

  it('prepares a browser file request and continues CSV import after selection', async () => {
    const request = await registry.execute('data.file.request', { kind: 'csv-import' }, context('request-file'))
    expect(request).toMatchObject({ status: 'needs-user-action' })
    const requestId = request.artifacts![0]!.id
    files.provide(
      requestId,
      new File(['耳标号,品系,性别\nAGENT-CSV,C57BL/6J,雌'], 'agent.csv', { type: 'text/csv' })
    )
    const imported = await registry.execute(
      'data.csv.import',
      { fileRequestId: requestId },
      context('import-file')
    )
    expect(imported.summary).toContain('成功 1')
    expect(await database.mice.where('normalizedEarTag').equals('agent-csv').count()).toBe(1)
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
      { workspace: 'mice', state: { sex: 'female', sort: 'age-oldest' } },
      context('view')
    )
    expect(JSON.parse(window.localStorage.getItem('mousekeeper:view-command:mice')!)).toEqual({
      sex: 'female',
      sort: 'age-oldest'
    })
    expect(listener).toHaveBeenCalled()
    globalThis.removeEventListener(APPLICATION_EVENT_NAMES.view, listener)
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
