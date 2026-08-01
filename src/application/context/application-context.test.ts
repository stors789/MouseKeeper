import { ApplicationContextStore } from './application-context'
import { applicationNavigationGuard } from './navigation-guard'

describe('ApplicationContextStore', () => {
  it('publishes a stable page snapshot with every selected entity', () => {
    const store = new ApplicationContextStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const selected = [
      { type: 'mouse', id: 'm-1', label: 'M-001', revision: 2 },
      { type: 'mouse', id: 'm-2', label: 'M-002', revision: 3 }
    ]
    store.publish({
      workspace: 'mice', route: '/mice', visibleFilters: { sex: 'female' },
      sort: 'age-oldest', page: 3, selected
    })
    selected.pop()

    expect(store.snapshot()).toMatchObject({
      workspace: 'mice', route: '/mice', visibleFilters: { sex: 'female' },
      sort: 'age-oldest', page: 3,
      selected: [{ id: 'm-1' }, { id: 'm-2' }]
    })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('only clears the active workspace', () => {
    const store = new ApplicationContextStore()
    store.publish({ workspace: 'tasks', route: '/tasks', visibleFilters: {}, selected: [] })
    store.clear('mice')
    expect(store.snapshot()?.workspace).toBe('tasks')
    store.clear('tasks')
    expect(store.snapshot()).toBeUndefined()
  })
})

describe('applicationNavigationGuard', () => {
  it('blocks every programmatic navigation source while a form is dirty', () => {
    const token = applicationNavigationGuard.register()
    const confirm = vi.fn(() => false)
    expect(applicationNavigationGuard.confirmNavigation(confirm)).toBe(false)
    expect(confirm).toHaveBeenCalledWith('当前更改尚未保存，确定离开此页面吗？')
    applicationNavigationGuard.unregister(token)
    expect(applicationNavigationGuard.confirmNavigation(confirm)).toBe(true)
  })
})
