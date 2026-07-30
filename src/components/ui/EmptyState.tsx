import { FileQuestion, type LucideIcon } from 'lucide-react'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  title: string
  description: ReactNode
  icon?: LucideIcon
  action?: ReactNode
  secondaryAction?: ReactNode
  compact?: boolean
  className?: string
}

export function EmptyState({
  action,
  className,
  compact = false,
  description,
  icon: Icon = FileQuestion,
  secondaryAction,
  title
}: EmptyStateProps) {
  return (
    <section
      className={clsx('ui-empty-state', compact && 'is-compact', className)}
    >
      <span className="ui-empty-state__mark" aria-hidden="true">
        <Icon size={24} strokeWidth={1.75} />
      </span>
      <div>
        <h3 className="ui-empty-state__title">{title}</h3>
        <div className="ui-empty-state__description">{description}</div>
      </div>
      {action || secondaryAction ? (
        <div className="ui-empty-state__actions">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </section>
  )
}
