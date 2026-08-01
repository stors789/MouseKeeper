import { useEffect } from 'react'

export function useUnsavedChanges(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return undefined

    const message = '当前更改尚未保存，确定离开此页面吗？'
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[href]')
          : null
      if (
        !target ||
        target.download ||
        (target.target && target.target !== '_self')
      ) {
        return
      }
      const destination = new URL(target.href, window.location.href)
      if (
        destination.origin !== window.location.origin ||
        destination.href === window.location.href
      ) {
        return
      }
      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
      }
    }
    const protectedUrl = window.location.href
    let restoringHistory = false
    const handlePopState = () => {
      if (restoringHistory) return
      if (window.confirm(message)) return
      restoringHistory = true
      window.history.pushState(null, '', protectedUrl)
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
      queueMicrotask(() => {
        restoringHistory = false
      })
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleDocumentClick, true)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleDocumentClick, true)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [isDirty])
}
