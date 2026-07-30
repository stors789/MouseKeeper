import {
  ArrowRight,
  Boxes,
  FileClock,
  FlaskConical,
  Rat,
  Search
} from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useDeferredValue, useState } from 'react'
import { useLocation } from 'wouter'
import { Dialog } from '../components/ui/Dialog'
import { Input } from '../components/ui/Input'
import { appDatabase } from '../app/runtime'
import { searchGlobalRecords } from '../queries/search'
import {
  ALL_NAVIGATION_ITEMS,
  type NavigationItem
} from './navigation'

interface GlobalSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function matchesQuery(item: NavigationItem, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase()

  if (!normalizedQuery) {
    return true
  }

  const searchableText = [
    item.label,
    item.description,
    ...item.keywords
  ]
    .join(' ')
    .toLocaleLowerCase()

  return searchableText.includes(normalizedQuery)
}

export function GlobalSearchDialog({
  onOpenChange,
  open
}: GlobalSearchDialogProps) {
  const [, navigate] = useLocation()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const results = ALL_NAVIGATION_ITEMS.filter((item) =>
    matchesQuery(item, deferredQuery)
  )
  const recordResults = useLiveQuery(
    () =>
      deferredQuery.trim()
        ? searchGlobalRecords(appDatabase, deferredQuery, 6)
        : Promise.resolve([]),
    [deferredQuery]
  )

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setQuery('')
    }
  }

  const navigateTo = (href: string) => {
    navigate(href)
    handleOpenChange(false)
  }

  return (
    <Dialog
      className="global-search"
      description="输入模块名称或记录类型，快速前往对应工作区。"
      onOpenChange={handleOpenChange}
      open={open}
      size="large"
      title="搜索与前往"
    >
      <div className="global-search__input-wrap">
        <Search aria-hidden="true" size={18} />
        <Input
          autoFocus
          aria-label="搜索 MouseKeeper"
          className="global-search__input"
          placeholder="例如：耳标、笼位、体重或备份"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <kbd>Esc</kbd>
      </div>
      <p className="global-search__scope">
        搜索耳标、编号、名称、标签、笼位、实验和事件；也可直达工作区。
      </p>
      <div className="global-search__results" aria-live="polite">
        {recordResults && recordResults.length > 0 ? (
          <>
            <p className="global-search__result-label">
              {recordResults.length} 条本地记录
            </p>
            {recordResults.map((item) => {
              const Icon =
                item.type === 'mouse'
                  ? Rat
                  : item.type === 'cage'
                    ? Boxes
                    : item.type === 'experiment'
                      ? FlaskConical
                      : FileClock
              return (
                <button
                  className="global-search__result"
                  key={`${item.type}:${item.id}`}
                  type="button"
                  onClick={() => navigateTo(item.href)}
                >
                  <span className="global-search__result-icon">
                    <Icon aria-hidden="true" size={19} />
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description || '无补充信息'}</small>
                  </span>
                  <ArrowRight aria-hidden="true" size={17} />
                </button>
              )
            })}
          </>
        ) : null}
        {results.length > 0 ? (
          <>
            <p className="global-search__result-label">
              {query ? `${results.length} 个匹配工作区` : '工作区'}
            </p>
            {results.map((item) => {
              const Icon = item.icon

              return (
                <button
                  className="global-search__result"
                  key={item.href}
                  type="button"
                  onClick={() => navigateTo(item.href)}
                >
                  <span className="global-search__result-icon">
                    <Icon aria-hidden="true" size={19} />
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  <ArrowRight aria-hidden="true" size={17} />
                </button>
              )
            })}
          </>
        ) : recordResults?.length ? null : (
          <div className="global-search__no-results">
            <p>没有匹配的工作区</p>
            <span>尝试“笼位”“称重”“任务”或“备份”。</span>
          </div>
        )}
      </div>
    </Dialog>
  )
}
