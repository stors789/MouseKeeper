import { useEffect } from 'react'

export function useUnsavedChanges(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return undefined

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])
}
