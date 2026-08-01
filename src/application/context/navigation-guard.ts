const dirtySources = new Set<symbol>()
const MESSAGE = '当前更改尚未保存，确定离开此页面吗？'

export const applicationNavigationGuard = {
  register(): symbol {
    const token = Symbol('unsaved-changes')
    dirtySources.add(token)
    return token
  },
  unregister(token: symbol): void {
    dirtySources.delete(token)
  },
  hasUnsavedChanges(): boolean {
    return dirtySources.size > 0
  },
  confirmNavigation(confirm: (message: string) => boolean = globalThis.confirm): boolean {
    return dirtySources.size === 0 || confirm(MESSAGE)
  }
}
