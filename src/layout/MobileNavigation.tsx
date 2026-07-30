import { HardDrive, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'wouter'
import { Dialog } from '../components/ui/Dialog'
import { ThemeControl } from './ThemeControl'
import {
  MOBILE_MORE_ITEMS,
  MOBILE_PRIMARY_ITEMS,
  isNavigationItemActive
} from './navigation'

interface MobileNavigationProps {
  location: string
}

export function MobileNavigation({ location }: MobileNavigationProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = MOBILE_MORE_ITEMS.some((item) =>
    isNavigationItemActive(item, location)
  )

  return (
    <nav className="mobile-nav" aria-label="移动端主要导航">
      {MOBILE_PRIMARY_ITEMS.map((item) => {
        const Icon = item.icon
        const active = isNavigationItemActive(item, location)

        return (
          <Link
            aria-current={active ? 'page' : undefined}
            className="mobile-nav__item"
            data-active={active || undefined}
            href={item.href}
            key={item.href}
          >
            <Icon aria-hidden="true" size={20} />
            <span>{item.shortLabel ?? item.label}</span>
          </Link>
        )
      })}

      <Dialog
        description="前往繁育、实验、记录、数据与安全或设置。"
        onOpenChange={setMoreOpen}
        open={moreOpen}
        size="drawer"
        title="更多工作区"
        trigger={
          <button
            aria-current={moreActive ? 'page' : undefined}
            className="mobile-nav__item"
            data-active={moreActive || undefined}
            type="button"
          >
            <MoreHorizontal aria-hidden="true" size={20} />
            <span>更多</span>
          </button>
        }
      >
        <nav className="mobile-more" aria-label="更多导航">
          {MOBILE_MORE_ITEMS.map((item) => {
            const Icon = item.icon
            const active = isNavigationItemActive(item, location)

            return (
              <Link
                aria-current={active ? 'page' : undefined}
                className="mobile-more__link"
                data-active={active || undefined}
                href={item.href}
                key={item.href}
                onClick={() => setMoreOpen(false)}
              >
                <span className="mobile-more__icon">
                  <Icon aria-hidden="true" size={19} />
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </Link>
            )
          })}
        </nav>
        <div className="mobile-more__utility">
          <div className="mobile-more__local">
            <HardDrive aria-hidden="true" size={17} />
            <span>本地模式 · 数据留在此设备</span>
          </div>
          <ThemeControl />
        </div>
      </Dialog>
    </nav>
  )
}
