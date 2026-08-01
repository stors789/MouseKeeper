import type { AgentCommandRun } from '../../agent/recovery'

export function commandHasChanges(run: AgentCommandRun): boolean {
  return run.changes.length > 0 || run.preferenceChanges.length > 0
}

export function commandCanUndo(run: AgentCommandRun): boolean {
  return (run.status === 'succeeded' || run.status === 'failed') && commandHasChanges(run)
}

export function commandStatusLabel(run: AgentCommandRun): string {
  if (run.status === 'succeeded') return '已完成'
  if (run.status === 'undone') return '已撤回'
  if (run.status === 'running') return '运行中'
  if (run.status === 'failed' && commandHasChanges(run)) return '失败 · 已产生变化'
  if (run.status === 'undo-conflict') return '撤回冲突'
  return '失败'
}
