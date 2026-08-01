import { Search } from 'lucide-react'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useLocation } from 'wouter'
import { APP_CONFIG } from '../config/app'
import { APPLICATION_EVENT_NAMES } from '../application'
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
  const [location, setLocation] = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchTriggerRef = useRef<HTMLButtonElement>(null)
  const pageTitle = getPageTitle(location)

  const setGlobalSearchOpen = useCallback((open: boolean) => {
    setSearchOpen(open)
    if (!open) {
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) {
          searchTriggerRef.current?.focus()
        }
      })
    }
  }, [])

  useEffect(() => {
    document.title = `${pageTitle} · ${APP_CONFIG.name}`
    const frame = requestAnimationFrame(() => {
      document.getElementById('main-content')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [location, pageTitle])

  useEffect(() => {
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<{ href?: unknown }>).detail
      if (typeof detail?.href === 'string' && detail.href.startsWith('/')) {
        setLocation(detail.href)
      }
    }
    const focusSearch = () => setGlobalSearchOpen(true)
    globalThis.addEventListener(APPLICATION_EVENT_NAMES.navigate, navigate)
    globalThis.addEventListener(APPLICATION_EVENT_NAMES.focusSearch, focusSearch)
    return () => {
      globalThis.removeEventListener(APPLICATION_EVENT_NAMES.navigate, navigate)
      globalThis.removeEventListener(APPLICATION_EVENT_NAMES.focusSearch, focusSearch)
    }
  }, [setGlobalSearchOpen, setLocation])

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

      const commandAgent =
        event.key.toLocaleLowerCase() === 'j' &&
        (event.metaKey || event.ctrlKey)

      if (commandAgent) {
        event.preventDefault()
        setLocation('/agent')
        return
      }

      if (commandSearch || slashSearch) {
        event.preventDefault()
        setGlobalSearchOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setGlobalSearchOpen, setLocation])

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
            aria-label="搜索记录或工作区"
            aria-keyshortcuts="/ Meta+K Control+K"
            className="global-search-trigger"
            ref={searchTriggerRef}
            type="button"
            onClick={() => setGlobalSearchOpen(true)}
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
            onOpenChange={setGlobalSearchOpen}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
