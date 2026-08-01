import type { AgentCommandRun } from '../../agent/recovery'
import { commandCanUndo, commandStatusLabel } from './run-presentation'

function run(input: Partial<AgentCommandRun>): AgentCommandRun {
  return {
    id: 'run-1', sessionId: 'session-1', prompt: 'compound command',
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:01.000Z',
    status: 'failed', capabilityIds: [], traces: [], changes: [], preferenceChanges: [], recoveryKind: 'none',
    ...input
  }
}

describe('Agent failed command presentation', () => {
  it('keeps undo visible and names the partial mutation explicitly', () => {
    const failedButMutated = run({
      changes: [{ table: 'tasks', id: 'task-1', after: { id: 'task-1' } }],
      recoveryKind: 'row-diff'
    })
    expect(commandCanUndo(failedButMutated)).toBe(true)
    expect(commandStatusLabel(failedButMutated)).toBe('失败 · 已产生变化')
  })

  it('does not offer undo for a failed read-only command', () => {
    const failedRead = run({})
    expect(commandCanUndo(failedRead)).toBe(false)
    expect(commandStatusLabel(failedRead)).toBe('失败')
  })
})
