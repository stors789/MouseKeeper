import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'

export type AlertTone =
  | 'positive'
  | 'informative'
  | 'warning'
  | 'critical'

const ALERT_ICONS: Record<AlertTone, LucideIcon> = {
  positive: CircleCheck,
  informative: Info,
  warning: TriangleAlert,
  critical: CircleAlert
}

export interface AlertProps {
  title: string
  children?: ReactNode
  action?: ReactNode
  tone?: AlertTone
  className?: string
}

export function Alert({
  action,
  children,
  className,
  title,
  tone = 'informative'
}: AlertProps) {
  const Icon = ALERT_ICONS[tone]
  const role = tone === 'critical' ? 'alert' : 'status'

  return (
    <div
      className={clsx('ui-alert', `is-${tone}`, className)}
      role={role}
    >
      <Icon aria-hidden="true" className="ui-alert__icon" size={18} />
      <div className="ui-alert__content">
        <p className="ui-alert__title">{title}</p>
        {children ? <div className="ui-alert__body">{children}</div> : null}
      </div>
      {action ? <div className="ui-alert__action">{action}</div> : null}
    </div>
  )
}
