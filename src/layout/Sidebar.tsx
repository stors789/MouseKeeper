import {
  HardDrive,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react'
import { Link } from 'wouter'
import { APP_CONFIG } from '../config/app'
import { ThemeControl } from './ThemeControl'
import {
  NAVIGATION_GROUPS,
  isNavigationItemActive
} from './navigation'

interface SidebarProps {
  collapsed: boolean
  location: string
  onToggle: () => void
}

export function Sidebar({
  collapsed,
  location,
  onToggle
}: SidebarProps) {
  return (
    <aside
      className="app-sidebar"
      aria-label="应用侧栏"
      data-collapsed={collapsed || undefined}
    >
      <div className="app-sidebar__brand-row">
        <Link
          aria-label={`${APP_CONFIG.name} 总览`}
          className="app-brand"
          href="/dashboard"
        >
          <span className="app-brand__mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="app-brand__name">{APP_CONFIG.name}</span>
        </Link>
        <button
          aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
          aria-pressed={collapsed}
          className="app-sidebar__toggle"
          type="button"
          onClick={onToggle}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" size={18} />
          ) : (
            <PanelLeftClose aria-hidden="true" size={18} />
          )}
        </button>
      </div>

      <nav className="app-sidebar__navigation" aria-label="主要导航">
        {NAVIGATION_GROUPS.map((group) => (
          <div className="app-nav-group" key={group.label}>
            <p className="app-nav-group__label">{group.label}</p>
            <ul>
              {group.items.map((item) => {
                const Icon = item.icon
                const active = isNavigationItemActive(item, location)

                return (
                  <li key={item.href}>
                    <Link
                      aria-current={active ? 'page' : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      className="app-nav-link"
                      data-active={active || undefined}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon aria-hidden="true" size={19} />
                      <span className="app-nav-link__label">
                        {item.label}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="app-sidebar__footer">
        <div className="local-mode">
          <HardDrive aria-hidden="true" size={17} />
          <span>
            <strong>本地模式</strong>
            <small>业务数据保存在此设备</small>
          </span>
        </div>
        <ThemeControl compact={collapsed} />
        <span className="app-version">v{APP_CONFIG.version}</span>
      </div>
    </aside>
  )
}
