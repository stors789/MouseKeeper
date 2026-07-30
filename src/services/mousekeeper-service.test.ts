import {
  createMouseKeeperDatabase,
  scanIntegrity,
  type MouseKeeperDatabase
} from '../db'
import { WarningRequiredError } from './errors'
import { MouseKeeperService } from './mousekeeper-service'
import { WARNING_CODES } from './types'

const NOW = '2026-07-30T08:00:00.000Z'
const TODAY = '2026-07-30'

function operationId(label: string): string {
  return `${label}-${crypto.randomUUID()}`
}

describe('MouseKeeperService', () => {
  let database: MouseKeeperDatabase
  let service: MouseKeeperService

  beforeEach(async () => {
    database = createMouseKeeperDatabase(`mousekeeper-test-${crypto.randomUUID()}`)
    service = new MouseKeeperService(database)
    await database.open()
  })

  afterEach(async () => {
    database.close()
    await database.delete()
  })

  async function createMouse(
    earTag: string,
    overrides: Partial<{
      id: string
      sex: 'male' | 'female' | 'unknown'
      sireId: string
      damId: string
      birthDate: string
      status:
        | 'alive'
        | 'experimental'
        | 'breeding'
        | 'reserved'
        | 'transferred'
        | 'dead'
        | 'euthanized'
        | 'other'
    }> = {}
  ) {
    return (
      await service.createMouse({
        operationId: operationId('create-mouse'),
        now: NOW,
        earTag,
        strain: 'C57BL/6J',
        sex: overrides.sex ?? 'unknown',
        id: overrides.id,
        sireId: overrides.sireId,
        damId: overrides.damId,
        birthDate: overrides.birthDate ?? '2025-01-01',
        status: overrides.status
      })
    ).value
  }

  async function createCage(number: string, maxCapacity = 5) {
    return (
      await service.createCage({
        operationId: operationId('create-cage'),
        now: NOW,
        cageNumber: number,
        maxCapacity
      })
    ).value
  }

  it('enforces normalized active ear-tag uniqueness and idempotent replay', async () => {
    const input = {
      operationId: operationId('ear-tag'),
      now: NOW,
      earTag: ' A1 ',
      strain: 'C57BL/6J',
      sex: 'unknown' as const,
      birthDate: '2025-01-01'
    }
    const first = await service.createMouse(input)
    const replay = await service.createMouse(input)

    expect(replay.replayed).toBe(true)
    expect(replay.value.id).toBe(first.value.id)
    expect(await database.mice.count()).toBe(1)
    expect(await database.activityLogs.count()).toBe(1)

    await expect(
      service.createMouse({
        ...input,
        operationId: operationId('duplicate-ear'),
        earTag: 'Ａ１'
      })
    ).rejects.toMatchObject({ code: 'duplicate-ear-tag' })
  })

  it('warns before over-capacity placement and preserves one active cage', async () => {
    const firstCage = await createCage('C-1', 1)
    const secondCage = await createCage('C-2', 1)
    const firstMouse = await createMouse('M-1')
    const secondMouse = await createMouse('M-2')

    await service.moveMouse({
      operationId: operationId('move-first'),
      now: NOW,
      mouseId: firstMouse.id,
      cageId: firstCage.id
    })
    const overCapacityInput = {
      operationId: operationId('move-over'),
      now: NOW,
      mouseId: secondMouse.id,
      cageId: firstCage.id
    }
    await expect(service.moveMouse(overCapacityInput)).rejects.toBeInstanceOf(
      WarningRequiredError
    )
    expect(await database.cageAssignments.count()).toBe(1)

    await service.moveMouse({
      ...overCapacityInput,
      warningAcknowledgements: [WARNING_CODES.cageCapacityExceeded]
    })
    await service.moveMouse({
      operationId: operationId('transfer'),
      now: '2026-07-30T09:00:00.000Z',
      mouseId: secondMouse.id,
      cageId: secondCage.id
    })

    const activeAssignments = await database.cageAssignments
      .where('activeMouseKey')
      .equals(secondMouse.id)
      .toArray()
    expect(activeAssignments).toHaveLength(1)
    expect(activeAssignments[0]?.cageId).toBe(secondCage.id)
    expect((await database.mice.get(secondMouse.id))?.currentCageId).toBe(
      secondCage.id
    )
  })

  it('creates a mouse and initial cage assignment atomically', async () => {
    const cage = await createCage('ATOMIC-CAGE', 1)
    const resident = await createMouse('ATOMIC-RESIDENT')
    await service.moveMouse({
      operationId: operationId('atomic-resident'),
      now: NOW,
      mouseId: resident.id,
      cageId: cage.id
    })
    const input = {
      operationId: operationId('atomic-create'),
      now: NOW,
      id: 'atomic-new-mouse',
      earTag: 'ATOMIC-NEW',
      strain: 'C57BL/6J',
      sex: 'female' as const,
      initialCageId: cage.id
    }

    await expect(
      service.createMouseWithCage(input)
    ).rejects.toBeInstanceOf(WarningRequiredError)
    expect(await database.mice.get(input.id)).toBeUndefined()
    expect(await database.cageAssignments.count()).toBe(1)

    const created = await service.createMouseWithCage({
      ...input,
      warningAcknowledgements: [WARNING_CODES.cageCapacityExceeded]
    })
    expect(created.value.mouse).toMatchObject({
      id: input.id,
      currentCageId: cage.id
    })
    expect(created.value.assignment?.cageId).toBe(cage.id)
    expect(await database.cageAssignments.count()).toBe(2)

    await expect(
      service.createMouseWithCage({
        ...input,
        operationId: operationId('atomic-invalid-cage'),
        id: 'atomic-invalid-cage-mouse',
        earTag: 'ATOMIC-INVALID',
        initialCageId: 'missing-cage'
      })
    ).rejects.toMatchObject({ code: 'not-found' })
    expect(
      await database.mice.get('atomic-invalid-cage-mouse')
    ).toBeUndefined()
  })

  it('applies mouse status, cage, and tag batches atomically', async () => {
    const cage = await createCage('BATCH-CAGE', 1)
    const first = await createMouse('BATCH-MOUSE-1')
    const second = await createMouse('BATCH-MOUSE-2')
    const moveInput = {
      operationId: operationId('batch-move'),
      now: NOW,
      mouseIds: [first.id, second.id],
      cageId: cage.id
    }

    await expect(service.moveMice(moveInput)).rejects.toBeInstanceOf(
      WarningRequiredError
    )
    expect(await database.cageAssignments.count()).toBe(0)
    expect((await database.mice.get(first.id))?.currentCageId).toBeUndefined()

    const moved = await service.moveMice({
      ...moveInput,
      warningAcknowledgements: [WARNING_CODES.cageCapacityExceeded]
    })
    expect(moved.value.assignments).toHaveLength(2)
    expect(
      moved.value.mice.every(mouse => mouse.currentCageId === cage.id)
    ).toBe(true)

    const status = await service.changeMiceStatus({
      operationId: operationId('batch-status'),
      now: NOW,
      targets: moved.value.mice.map(mouse => ({
        mouseId: mouse.id,
        expectedRevision: mouse.revision
      })),
      status: 'reserved',
      occurredOn: TODAY,
      reason: 'batch review'
    })
    expect(status.value.mice.map(mouse => mouse.status)).toEqual([
      'reserved',
      'reserved'
    ])

    const tag = (
      await service.createTag({
        operationId: operationId('batch-tag-create'),
        now: NOW,
        name: 'Batch tag'
      })
    ).value
    const tagBatchInput = {
      operationId: operationId('batch-tags'),
      now: NOW,
      targets: status.value.mice.map(mouse => ({
        mouseId: mouse.id,
        expectedRevision: mouse.revision
      })),
      addTagIds: [tag.id]
    }
    const tagged = await service.setMiceTags(tagBatchInput)
    expect(tagged.value.updatedMouseIds).toHaveLength(2)
    expect(
      tagged.value.mice.every(mouse => mouse.tagIds.includes(tag.id))
    ).toBe(true)
    const tagReplay = await service.setMiceTags(tagBatchInput)
    expect(tagReplay.replayed).toBe(true)
    expect(tagReplay.value.updatedMouseIds).toEqual(
      tagged.value.updatedMouseIds
    )
  })

  it('rejects dangling litter references without partial writes', async () => {
    await expect(
      service.createMouse({
        operationId: operationId('missing-litter'),
        now: NOW,
        id: 'missing-litter-child',
        earTag: 'MISSING-LITTER',
        strain: 'C57BL/6J',
        sex: 'unknown',
        birthDate: '2025-01-01',
        litterId: 'missing-litter'
      })
    ).rejects.toMatchObject({ code: 'not-found' })

    expect(await database.mice.get('missing-litter-child')).toBeUndefined()
    expect(
      await database.activityLogs
        .where('operationId')
        .startsWith('missing-litter')
        .count()
    ).toBe(0)
  })

  it('blocks self-parenting and pedigree cycles', async () => {
    await expect(
      service.createMouse({
        operationId: operationId('self-parent'),
        now: NOW,
        id: 'self',
        earTag: 'SELF',
        strain: 'C57BL/6J',
        sex: 'male',
        birthDate: '2025-01-01',
        sireId: 'self'
      })
    ).rejects.toThrow('own parent')

    const ancestor = await createMouse('ANCESTOR', {
      id: 'ancestor',
      sex: 'male',
      birthDate: '2024-01-01'
    })
    const child = await createMouse('CHILD', {
      id: 'child',
      sireId: ancestor.id,
      birthDate: '2024-01-01'
    })
    await expect(
      service.updateMouse({
        operationId: operationId('cycle'),
        now: NOW,
        mouseId: ancestor.id,
        expectedRevision: ancestor.revision,
        patch: { sireId: child.id }
      })
    ).rejects.toMatchObject({ code: 'pedigree-cycle' })
  })

  it('requires breeding warnings and creates a litter with linked offspring', async () => {
    const sire = await createMouse('SIRE', {
      sex: 'female',
      birthDate: '2024-01-01'
    })
    const dam = await createMouse('DAM', {
      sex: 'male',
      birthDate: '2024-01-01'
    })
    const pairInput = {
      operationId: operationId('pair'),
      now: NOW,
      sireId: sire.id,
      damId: dam.id,
      pairedOn: '2026-05-01'
    }
    await expect(
      service.createBreedingPair(pairInput)
    ).rejects.toBeInstanceOf(WarningRequiredError)
    const pair = (
      await service.createBreedingPair({
        ...pairInput,
        warningAcknowledgements: [
          WARNING_CODES.sireSexMismatch,
          WARNING_CODES.damSexMismatch
        ]
      })
    ).value
    const created = await service.createLitterWithOffspring({
      operationId: operationId('litter'),
      now: NOW,
      breedingPairId: pair.id,
      litterNumber: 'L-1',
      bornOn: '2026-06-01',
      offspring: [
        { earTag: 'PUP-1', sex: 'male' },
        { earTag: 'PUP-2', sex: 'female' }
      ]
    })
    expect(created.value.offspring).toHaveLength(2)
    expect(created.value.offspring[0]).toMatchObject({
      sireId: sire.id,
      damId: dam.id,
      litterId: created.value.litter.id,
      birthDate: '2026-06-01'
    })
  })

  it('updates breeding dates and releases the active pair key on separation', async () => {
    const sire = await createMouse('UPDATE-SIRE', { sex: 'male' })
    const dam = await createMouse('UPDATE-DAM', { sex: 'female' })
    const pair = (
      await service.createBreedingPair({
        operationId: operationId('update-pair-create'),
        now: NOW,
        sireId: sire.id,
        damId: dam.id,
        pairedOn: '2026-07-01',
        expectedDeliveryDate: '2026-07-22'
      })
    ).value
    const input = {
      operationId: operationId('update-pair'),
      now: '2026-07-30T09:00:00.000Z',
      breedingPairId: pair.id,
      expectedRevision: pair.revision,
      patch: {
        status: 'separated' as const,
        separatedOn: TODAY,
        notes: 'Separated after litter'
      }
    }

    const updated = await service.updateBreedingPair(input)
    const replay = await service.updateBreedingPair(input)

    expect(updated.value).toMatchObject({
      status: 'separated',
      separatedOn: TODAY,
      notes: 'Separated after litter',
      activePairKey: undefined
    })
    expect(replay.replayed).toBe(true)
    expect(await database.activityLogs.where('action').equals('breeding-pair.update').count()).toBe(1)
  })

  it('enforces breeding date, count, transition, and revision invariants', async () => {
    const sire = await createMouse('RULE-SIRE', {
      sex: 'male',
      birthDate: '2025-01-01'
    })
    const dam = await createMouse('RULE-DAM', {
      sex: 'female',
      birthDate: '2025-01-01'
    })
    await expect(
      service.createBreedingPair({
        operationId: operationId('bad-delivery'),
        now: NOW,
        sireId: sire.id,
        damId: dam.id,
        pairedOn: '2026-07-10',
        expectedDeliveryDate: '2026-07-09'
      })
    ).rejects.toThrow('Expected delivery date')

    const pair = (
      await service.createBreedingPair({
        operationId: operationId('rule-pair'),
        now: NOW,
        sireId: sire.id,
        damId: dam.id,
        pairedOn: '2026-07-10'
      })
    ).value

    await expect(
      service.createLitterWithOffspring({
        operationId: operationId('bad-litter-date'),
        now: NOW,
        breedingPairId: pair.id,
        litterNumber: 'EARLY',
        bornOn: '2026-07-09',
        offspring: []
      })
    ).rejects.toMatchObject({ code: 'invalid-state' })

    await expect(
      service.createLitterWithOffspring({
        operationId: operationId('bad-litter-count'),
        now: NOW,
        breedingPairId: pair.id,
        litterNumber: 'COUNT',
        bornOn: '2026-07-20',
        bornCount: 1,
        aliveCount: 0,
        offspring: [{ earTag: 'IMPOSSIBLE-PUP', sex: 'female' }]
      })
    ).rejects.toMatchObject({ code: 'invalid-state' })

    const separated = (
      await service.updateBreedingPair({
        operationId: operationId('rule-separate'),
        now: NOW,
        breedingPairId: pair.id,
        expectedRevision: pair.revision,
        patch: {
          status: 'separated',
          separatedOn: TODAY
        }
      })
    ).value
    await expect(
      service.updateBreedingPair({
        operationId: operationId('rule-reopen'),
        now: NOW,
        breedingPairId: pair.id,
        expectedRevision: separated.revision,
        patch: { status: 'active' }
      })
    ).rejects.toMatchObject({ code: 'invalid-state' })
    await expect(
      service.updateBreedingPair({
        operationId: operationId('rule-stale'),
        now: NOW,
        breedingPairId: pair.id,
        expectedRevision: pair.revision,
        patch: { notes: 'stale write' }
      })
    ).rejects.toMatchObject({ code: 'revision-conflict' })
  })

  it('enforces mutually exclusive experiment groups', async () => {
    const mouse = await createMouse('EXP-MOUSE')
    const experiment = (
      await service.createExperiment({
        operationId: operationId('experiment'),
        now: NOW,
        name: 'Behavior',
        status: 'active'
      })
    ).value
    const control = (
      await service.createExperimentGroup({
        operationId: operationId('group-control'),
        now: NOW,
        experimentId: experiment.id,
        name: 'Control',
        groupType: 'control',
        exclusionSet: 'arm'
      })
    ).value
    const treatment = (
      await service.createExperimentGroup({
        operationId: operationId('group-treatment'),
        now: NOW,
        experimentId: experiment.id,
        name: 'Treatment',
        groupType: 'treatment',
        exclusionSet: 'arm'
      })
    ).value
    await service.assignMouseToExperiment({
      operationId: operationId('assign-control'),
      now: NOW,
      mouseId: mouse.id,
      experimentId: experiment.id,
      groupId: control.id,
      joinedOn: TODAY
    })
    await expect(
      service.assignMouseToExperiment({
        operationId: operationId('assign-treatment'),
        now: NOW,
        mouseId: mouse.id,
        experimentId: experiment.id,
        groupId: treatment.id,
        joinedOn: TODAY
      })
    ).rejects.toMatchObject({
      code: 'exclusive-group-conflict'
    })
  })

  it('creates an experiment and initial group atomically', async () => {
    const input = {
      operationId: operationId('experiment-with-group'),
      now: NOW,
      name: 'Atomic study',
      status: 'planned' as const,
      initialGroup: {
        name: 'Control',
        groupType: 'control' as const,
        exclusionSet: 'study-arm'
      }
    }
    const created = await service.createExperimentWithInitialGroup(input)
    const replay = await service.createExperimentWithInitialGroup(input)

    expect(created.value.initialGroup.experimentId).toBe(
      created.value.experiment.id
    )
    expect(replay.replayed).toBe(true)
    expect(await database.experiments.count()).toBe(1)
    expect(await database.experimentGroups.count()).toBe(1)

    await expect(
      service.createExperimentWithInitialGroup({
        ...input,
        operationId: operationId('experiment-rollback'),
        name: 'Must roll back',
        initialGroup: { name: '', groupType: 'custom' }
      })
    ).rejects.toThrow()
    expect(
      await database.experiments
        .filter((experiment) => experiment.name === 'Must roll back')
        .count()
    ).toBe(0)
  })

  it('atomically closes active relationships on terminal status', async () => {
    const cage = await createCage('TERMINAL-CAGE')
    const mouse = await createMouse('TERMINAL-MOUSE', { sex: 'male' })
    const dam = await createMouse('TERMINAL-DAM', { sex: 'female' })
    await service.moveMouse({
      operationId: operationId('terminal-move'),
      now: NOW,
      mouseId: mouse.id,
      cageId: cage.id
    })
    const pair = (
      await service.createBreedingPair({
        operationId: operationId('terminal-pair'),
        now: NOW,
        sireId: mouse.id,
        damId: dam.id,
        pairedOn: '2026-07-01'
      })
    ).value
    const experiment = (
      await service.createExperiment({
        operationId: operationId('terminal-experiment'),
        now: NOW,
        name: 'Terminal experiment',
        status: 'active'
      })
    ).value
    const group = (
      await service.createExperimentGroup({
        operationId: operationId('terminal-group'),
        now: NOW,
        experimentId: experiment.id,
        name: 'Only group',
        groupType: 'custom'
      })
    ).value
    const experimentAssignment = (
      await service.assignMouseToExperiment({
        operationId: operationId('terminal-assignment'),
        now: NOW,
        mouseId: mouse.id,
        experimentId: experiment.id,
        groupId: group.id,
        joinedOn: TODAY
      })
    ).value.assignment

    const result = await service.terminateMouse({
      operationId: operationId('terminate'),
      now: '2026-07-30T10:00:00.000Z',
      mouseId: mouse.id,
      status: 'euthanized',
      occurredOn: TODAY,
      reason: 'Study endpoint'
    })

    expect(result.value.mouse).toMatchObject({
      status: 'euthanized',
      currentCageId: undefined
    })
    expect(
      await database.cageAssignments
        .where('activeMouseKey')
        .equals(mouse.id)
        .count()
    ).toBe(0)
    expect(
      (await database.experimentAssignments.get(experimentAssignment.id))
        ?.activeFlag
    ).toBe(0)
    expect((await database.breedingPairs.get(pair.id))?.status).toBe(
      'completed'
    )
    expect(result.value.event.eventType).toBe('euthanasia')
  })

  it('writes and soft-deletes weight/event pairs atomically', async () => {
    const mouse = await createMouse('WEIGHT')
    const input = {
      operationId: operationId('weight'),
      now: NOW,
      mouseId: mouse.id,
      measuredOn: TODAY,
      measuredTime: '09:00' as const,
      timeZone: 'Asia/Shanghai',
      value: 25,
      unit: 'g' as const
    }
    const first = await service.recordWeight(input)
    const replay = await service.recordWeight(input)
    expect(replay.replayed).toBe(true)
    expect(await database.weightRecords.count()).toBe(1)
    expect(await database.mouseEvents.count()).toBe(1)
    expect(first.value.event.sourceId).toBe(first.value.weight.id)
    expect(first.value.weight.eventId).toBe(first.value.event.id)
    expect(first.value.weight).toMatchObject({
      timeZone: 'Asia/Shanghai',
      measuredAt: '2026-07-30T01:00:00.000Z'
    })
    expect(first.value.event).toMatchObject({
      timeZone: 'Asia/Shanghai',
      occurredAt: '2026-07-30T01:00:00.000Z'
    })

    await service.softDeleteMouseEvent({
      operationId: operationId('delete-weight-event'),
      now: '2026-07-30T09:00:00.000Z',
      eventId: first.value.event.id,
      expectedRevision: first.value.event.revision
    })
    expect(
      (await database.mouseEvents.get(first.value.event.id))?.deletedFlag
    ).toBe(1)
    expect(
      (await database.weightRecords.get(first.value.weight.id))?.deletedFlag
    ).toBe(1)
  })

  it('keeps operational events behind their domain commands', async () => {
    const mouse = await createMouse('EVENT-GUARD')
    await expect(
      service.createMouseEvent({
        operationId: operationId('forged-death-event'),
        now: NOW,
        mouseId: mouse.id,
        eventType: 'death',
        occurredOn: TODAY,
        title: 'Forged death'
      } as unknown as Parameters<typeof service.createMouseEvent>[0])
    ).rejects.toMatchObject({ code: 'invalid-state' })

    const cage = await createCage('EVENT-GUARD-CAGE')
    const moved = await service.moveMouse({
      operationId: operationId('event-guard-move'),
      now: NOW,
      mouseId: mouse.id,
      cageId: cage.id
    })
    await expect(
      service.updateMouseEvent({
        operationId: operationId('edit-operational-event'),
        now: NOW,
        eventId: moved.value.event.id,
        expectedRevision: moved.value.event.revision,
        patch: { title: 'Rewritten transfer' }
      })
    ).rejects.toMatchObject({ code: 'invalid-state' })
    await expect(
      service.softDeleteMouseEvent({
        operationId: operationId('delete-operational-event'),
        now: NOW,
        eventId: moved.value.event.id,
        expectedRevision: moved.value.event.revision
      })
    ).rejects.toMatchObject({ code: 'invalid-state' })
  })

  it('records quick-weight batches atomically', async () => {
    const firstMouse = await createMouse('BATCH-WEIGHT-1')
    const secondMouse = await createMouse('BATCH-WEIGHT-2')
    const input = {
      operationId: operationId('weight-batch'),
      now: NOW,
      entries: [
        {
          mouseId: firstMouse.id,
          measuredOn: TODAY,
          value: 21.4,
          unit: 'g' as const
        },
        {
          mouseId: secondMouse.id,
          measuredOn: TODAY,
          value: 20.8,
          unit: 'g' as const
        }
      ]
    }
    const created = await service.recordWeights(input)
    const replay = await service.recordWeights(input)
    expect(created.value.entries).toHaveLength(2)
    expect(replay.replayed).toBe(true)
    expect(await database.weightRecords.count()).toBe(2)
    expect(await database.mouseEvents.count()).toBe(2)

    const beforeWeights = await database.weightRecords.count()
    const beforeEvents = await database.mouseEvents.count()
    await expect(
      service.recordWeights({
        operationId: operationId('weight-batch-rollback'),
        now: NOW,
        entries: [
          {
            mouseId: firstMouse.id,
            measuredOn: '2026-07-31',
            value: 22,
            unit: 'g'
          },
          {
            mouseId: secondMouse.id,
            measuredOn: '2026-07-31',
            value: -1,
            unit: 'g'
          }
        ]
      })
    ).rejects.toThrow()
    expect(await database.weightRecords.count()).toBe(beforeWeights)
    expect(await database.mouseEvents.count()).toBe(beforeEvents)
  })

  it('frees active unique keys on soft delete and rejects conflicting restore', async () => {
    const first = await createMouse('RECYCLE')
    const deleted = (
      await service.softDeleteMouse({
        operationId: operationId('delete-mouse'),
        now: NOW,
        mouseId: first.id,
        expectedRevision: first.revision
      })
    ).value
    const replacement = await createMouse('recycle')
    await expect(
      service.restoreMouse({
        operationId: operationId('restore-conflict'),
        now: NOW,
        mouseId: deleted.id,
        expectedRevision: deleted.revision
      })
    ).rejects.toMatchObject({ code: 'duplicate-ear-tag' })

    await service.softDeleteMouse({
      operationId: operationId('delete-replacement'),
      now: NOW,
      mouseId: replacement.id,
      expectedRevision: replacement.revision
    })
    const restored = await service.restoreMouse({
      operationId: operationId('restore'),
      now: NOW,
      mouseId: deleted.id,
      expectedRevision: deleted.revision
    })
    expect(restored.value.deletedFlag).toBe(0)
    expect(restored.value.activeEarTagKey).toBe('ear:recycle')
  })

  it('generates and safely removes a closed sample batch', async () => {
    const generated = await service.generateSampleData({
      operationId: operationId('sample'),
      now: NOW
    })
    expect(generated.value.mice).toHaveLength(2)
    expect(
      generated.value.mice.every(
        mouse => mouse.sampleBatchId === generated.value.sampleBatchId
      )
    ).toBe(true)

    const removed = await service.deleteSampleBatch({
      operationId: operationId('delete-sample'),
      now: NOW,
      sampleBatchId: generated.value.sampleBatchId
    })
    expect(removed.value.deletedCount).toBeGreaterThan(0)
    expect(
      await database.mice
        .where('sampleBatchId')
        .equals(generated.value.sampleBatchId)
        .count()
    ).toBe(0)
  })

  it('reports a clean database after valid core operations', async () => {
    const cage = await createCage('INTEGRITY')
    const mouse = await createMouse('INTEGRITY-MOUSE')
    await service.moveMouse({
      operationId: operationId('integrity-move'),
      now: NOW,
      mouseId: mouse.id,
      cageId: cage.id
    })
    const report = await scanIntegrity(database)
    expect(report.ok).toBe(true)
    expect(report.issues).toEqual([])
  })

  it('reports dangling secondary relations during integrity scans', async () => {
    const tag = (
      await service.createTag({
        operationId: operationId('integrity-tag'),
        now: NOW,
        name: 'Integrity tag'
      })
    ).value
    const mouse = (
      await service.createMouse({
        operationId: operationId('integrity-tagged-mouse'),
        now: NOW,
        earTag: 'INTEGRITY-TAGGED',
        strain: 'C57BL/6J',
        sex: 'unknown',
        tagIds: [tag.id]
      })
    ).value

    await database.tags.delete(tag.id)
    const report = await scanIntegrity(database)

    expect(report.ok).toBe(false)
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'missing-tag',
        table: 'mice',
        recordId: mouse.id
      })
    )
  })
})
