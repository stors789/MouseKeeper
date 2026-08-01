import type { EntityReference } from '../capabilities'

export interface ApplicationPageContext {
  workspace: string
  route: string
  visibleFilters: Readonly<Record<string, unknown>>
  selected: readonly EntityReference[]
  page?: number
  sort?: string
  updatedAt: string
}

type PageContextInput = Omit<ApplicationPageContext, 'updatedAt'>

export class ApplicationContextStore {
  private snapshotValue: ApplicationPageContext | undefined
  private readonly listeners = new Set<() => void>()

  snapshot = (): ApplicationPageContext | undefined => this.snapshotValue

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(input: PageContextInput): void {
    this.snapshotValue = {
      ...input,
      visibleFilters: structuredClone(input.visibleFilters),
      selected: structuredClone([...input.selected]),
      updatedAt: new Date().toISOString()
    }
    this.listeners.forEach((listener) => listener())
  }

  clear(workspace: string): void {
    if (this.snapshotValue?.workspace !== workspace) return
    this.snapshotValue = undefined
    this.listeners.forEach((listener) => listener())
  }
}

export const applicationContextStore = new ApplicationContextStore()
