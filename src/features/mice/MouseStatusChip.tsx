import {
  Activity,
  ArrowUpRight,
  Bookmark,
  CircleOff,
  Dna,
  Ellipsis,
  FlaskConical,
  ShieldMinus
} from 'lucide-react'
import {
  StatusChip,
  type StatusTone
} from '../../components/ui/StatusChip'
import type { MouseStatus } from '../../domain/types'
import { MOUSE_STATUS_LABELS } from '../../lib/labels'

const STATUS_META: Record<
  MouseStatus,
  {
    tone: StatusTone
    icon: typeof Activity
  }
> = {
  alive: { tone: 'positive', icon: Activity },
  experimental: { tone: 'informative', icon: FlaskConical },
  breeding: { tone: 'warning', icon: Dna },
  reserved: { tone: 'neutral', icon: Bookmark },
  transferred: { tone: 'neutral', icon: ArrowUpRight },
  dead: { tone: 'critical', icon: CircleOff },
  euthanized: { tone: 'critical', icon: ShieldMinus },
  other: { tone: 'neutral', icon: Ellipsis }
}

export function MouseStatusChip({ status }: { status: MouseStatus }) {
  const meta = STATUS_META[status]
  return (
    <StatusChip
      icon={meta.icon}
      label={MOUSE_STATUS_LABELS[status]}
      tone={meta.tone}
    />
  )
}
