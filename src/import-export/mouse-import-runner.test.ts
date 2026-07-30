import { createMouseKeeperDatabase, type MouseKeeperDatabase } from '../db'
import { MouseKeeperService } from '../services'
import { parseCsvPreview } from './csv'
import {
  suggestMouseFieldMapping,
  validateMouseImport
} from './mouse-import'
import { commitMouseImport } from './mouse-import-runner'

describe('commitMouseImport', () => {
  let database: MouseKeeperDatabase
  let service: MouseKeeperService

  beforeEach(async () => {
    database = createMouseKeeperDatabase(
      `mouse-import-runner-${crypto.randomUUID()}`
    )
    service = new MouseKeeperService(database)
    await database.open()
  })

  afterEach(async () => {
    database.close()
    await database.delete()
  })

  it('imports valid rows with provenance while isolating invalid rows', async () => {
    const cage = (
      await service.createCage({
        operationId: crypto.randomUUID(),
        cageNumber: 'C-1',
        maxCapacity: 5
      })
    ).value
    const csv = [
      '耳标号,品系,性别,笼位,标签',
      'M-1,C57BL/6J,雄性,C-1,队列A',
      ',BALB/c,雌性,C-1,队列B'
    ].join('\n')
    const parsed = parseCsvPreview(csv)
    const preview = validateMouseImport(
      parsed,
      suggestMouseFieldMapping(parsed.headers)
    )

    const report = await commitMouseImport(database, service, preview, 'batch-1')

    expect(report).toMatchObject({
      importedCount: 1,
      skippedCount: 1,
      failedCount: 0
    })
    const mouse = await database.mice.where('activeEarTagKey').equals('ear:m-1').first()
    expect(mouse).toMatchObject({
      origin: 'import',
      importBatchId: 'batch-1',
      currentCageId: cage.id
    })
    expect(mouse?.tagIds).toHaveLength(1)
    expect(await database.tags.where('importBatchId').equals('batch-1').count()).toBe(1)
  })
})
