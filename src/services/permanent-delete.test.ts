import { createMouseKeeperDatabase, type MouseKeeperDatabase } from '../db'
import { MouseKeeperService } from './mousekeeper-service'
import {
  createPurgePreview,
  purgeDeletedEntity
} from './permanent-delete'

describe('permanent deletion', () => {
  let database: MouseKeeperDatabase
  let service: MouseKeeperService

  beforeEach(async () => {
    database = createMouseKeeperDatabase(`purge-test-${crypto.randomUUID()}`)
    service = new MouseKeeperService(database)
    await database.open()
  })

  afterEach(async () => {
    database.close()
    await database.delete()
  })

  it('purges a deleted task and preserves an audit tombstone', async () => {
    const task = (
      await service.createTask({
        operationId: crypto.randomUUID(),
        title: 'Disposable task',
        dueDate: '2026-07-30'
      })
    ).value
    await service.softDeleteTask({
      operationId: crypto.randomUUID(),
      taskId: task.id,
      expectedRevision: task.revision
    })
    const preview = await createPurgePreview(database, 'task', task.id)

    expect(preview.canPurge).toBe(true)
    await purgeDeletedEntity(database, preview, 'purge-operation')

    expect(await database.tasks.get(task.id)).toBeUndefined()
    expect(
      await database.activityLogs
        .where('operationId')
        .equals('purge-operation')
        .count()
    ).toBe(1)
  })

  it('blocks purging a parent still referenced by offspring', async () => {
    const parent = (
      await service.createMouse({
        operationId: crypto.randomUUID(),
        earTag: 'PARENT',
        strain: 'C57BL/6J',
        sex: 'male'
      })
    ).value
    await service.createMouse({
      operationId: crypto.randomUUID(),
      earTag: 'CHILD',
      strain: 'C57BL/6J',
      sex: 'female',
      sireId: parent.id
    })
    const deleted = (
      await service.softDeleteMouse({
        operationId: crypto.randomUUID(),
        mouseId: parent.id,
        expectedRevision: parent.revision
      })
    ).value
    const preview = await createPurgePreview(database, 'mouse', deleted.id)

    expect(preview.canPurge).toBe(false)
    expect(preview.blockers.join(' ')).toContain('后代')
    await expect(
      purgeDeletedEntity(database, preview)
    ).rejects.toThrow('不能永久删除')
  })
})
