import { Search } from 'lucide-react'
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode
} from 'react'
import { useLocation } from 'wouter'
import { APP_CONFIG } from '../config/app'
import { CreateMenu } from './CreateMenu'
import { MobileNavigation } from './MobileNavigation'
import { Sidebar } from './Sidebar'
import { getPageTitle } from './navigation'

const GlobalSearchDialog = lazy(async () => ({
  default: (await import('./GlobalSearchDialog')).GlobalSearchDialog
}))

interface AppShellProps {
  children: ReactNode
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') || target.isContentEditable)
  )
}

export function AppShell({ children }: AppShellProps) {
  const [location] = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const pageTitle = getPageTitle(location)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return
      }

      const commandSearch =
        event.key.toLocaleLowerCase() === 'k' &&
        (event.metaKey || event.ctrlKey)
      const slashSearch =
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey

      if (commandSearch || slashSearch) {
        event.preventDefault()
        setSearchOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div
      className="app-shell"
      data-sidebar-collapsed={sidebarCollapsed || undefined}
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <h1 className="sr-only">{APP_CONFIG.name}</h1>
      <Sidebar
        collapsed={sidebarCollapsed}
        location={location}
        onToggle={() => setSidebarCollapsed((current) => !current)}
      />
      <header className="app-topbar">
        <div className="app-topbar__context">
          <span className="app-topbar__product">{APP_CONFIG.name}</span>
          <span aria-hidden="true" className="app-topbar__separator">
            /
          </span>
          <span className="app-topbar__title">{pageTitle}</span>
        </div>
        <div className="app-topbar__actions">
          <button
            aria-keyshortcuts="/ Meta+K Control+K"
            className="global-search-trigger"
            type="button"
            onClick={() => setSearchOpen(true)}
          >
            <Search aria-hidden="true" size={17} />
            <span>搜索记录或工作区</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="app-topbar__create">
            <CreateMenu />
          </div>
        </div>
      </header>
      <main className="app-main" id="main-content" tabIndex={-1}>
        {children}
      </main>
      <div className="mobile-context-action">
        <CreateMenu mobileContext />
      </div>
      <MobileNavigation location={location} />
      {searchOpen ? (
        <Suspense fallback={null}>
          <GlobalSearchDialog
            open={searchOpen}
            onOpenChange={setSearchOpen}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
