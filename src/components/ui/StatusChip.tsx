import { Circle, type LucideIcon } from 'lucide-react'
import { clsx } from 'clsx'

export type StatusTone =
  | 'positive'
  | 'informative'
  | 'warning'
  | 'critical'
  | 'neutral'

export interface StatusChipProps {
  label: string
  tone?: StatusTone
  icon?: LucideIcon
  className?: string
}

export function StatusChip({
  className,
  icon: Icon = Circle,
  label,
  tone = 'neutral'
}: StatusChipProps) {
  return (
    <span className={clsx('ui-status-chip', `is-${tone}`, className)}>
      <Icon aria-hidden="true" size={14} strokeWidth={2} />
      <span>{label}</span>
    </span>
  )
}
