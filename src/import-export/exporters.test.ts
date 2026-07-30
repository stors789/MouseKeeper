import type {
  Cage,
  Experiment,
  Mouse,
  MouseEvent,
  StoredEntity,
  WeightRecord
} from '../domain/types'
import {
  exportCagesCsv,
  exportEventsCsv,
  exportExperimentsCsv,
  exportMiceCsv,
  exportWeightsCsv
} from './exporters'

const base: StoredEntity = {
  id: 'base',
  schemaVersion: 1,
  revision: 1,
  createdAt: '2026-07-30T10:00:00.000Z',
  updatedAt: '2026-07-30T10:00:00.000Z',
  deletedAt: null,
  deletedFlag: 0,
  origin: 'user'
}

describe('normalized CSV exporters', () => {
  it('exports mouse fields and neutralizes notes', () => {
    const mouse: Mouse = {
      ...base,
      id: 'mouse-1',
      earTag: 'A-01',
      normalizedEarTag: 'a-01',
      activeEarTagKey: 'ear:a-01',
      strain: 'C57BL/6',
      strainKey: 'c57bl/6',
      sex: 'female',
      status: 'alive',
      tagIds: ['tag-1'],
      searchTerms: ['a-01']
    }

    const csv = exportMiceCsv([
      { mouse: { ...mouse, notes: '=IMPORT("remote")' }, cageNumber: 'C-01' }
    ])

    expect(csv).toContain('id,earTag,experimentNumber')
    expect(csv).toContain('mouse-1,A-01')
    expect(csv).toContain("'=IMPORT")
    expect(csv).toContain('C-01')
  })

  it('exports cages, experiments, weights, and events', () => {
    const cage: Cage = {
      ...base,
      id: 'cage-1',
      cageNumber: 'C-01',
      normalizedCageNumber: 'c-01',
      maxCapacity: 5,
      status: 'active'
    }
    const experiment: Experiment = {
      ...base,
      id: 'experiment-1',
      name: 'Study A',
      normalizedName: 'study a',
      status: 'active',
      searchTerms: ['study', 'a']
    }
    const weight: WeightRecord = {
      ...base,
      id: 'weight-1',
      mouseId: 'mouse-1',
      eventId: 'event-1',
      measuredOn: '2026-07-30',
      timeZone: 'Asia/Shanghai',
      measuredAt: '2026-07-30T10:00:00.000Z',
      value: 23.8,
      unit: 'g',
      valueGrams: 23.8
    }
    const event: MouseEvent = {
      ...base,
      id: 'event-1',
      eventType: 'observation',
      occurredOn: '2026-07-30',
      timeZone: 'Asia/Shanghai',
      occurredAt: '2026-07-30T10:00:00.000Z',
      mouseId: 'mouse-1',
      title: 'Routine check',
      normalizedTitle: 'routine check',
      payloadVersion: 1,
      payload: {},
      searchTerms: ['routine', 'check']
    }

    expect(exportCagesCsv([{ cage, currentCount: 2 }])).toContain('C-01')
    expect(
      exportExperimentsCsv([{ experiment, groupCount: 2, activeMouseCount: 8 }])
    ).toContain('Study A')
    expect(exportWeightsCsv([{ weight, mouseLabel: 'A-01' }])).toContain('23.8')
    expect(exportEventsCsv([{ event, mouseLabel: 'A-01' }])).toContain(
      'Routine check'
    )
  })
})
