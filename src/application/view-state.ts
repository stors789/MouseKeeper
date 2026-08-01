export interface ApplicationViewCommand {
  workspace: string
  state: Readonly<Record<string, unknown>>
}

export function readApplicationViewCommand(workspace: string): Readonly<Record<string, unknown>> {
  try {
    const raw = globalThis.window?.localStorage.getItem(`mousekeeper:view-command:${workspace}`)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Readonly<Record<string, unknown>>
      : {}
  } catch {
    return {}
  }
}

export function viewCommandFromEvent(event: Event, workspace: string): Readonly<Record<string, unknown>> | undefined {
  const detail = (event as CustomEvent<Partial<ApplicationViewCommand>>).detail
  return detail?.workspace === workspace && detail.state && typeof detail.state === 'object' && !Array.isArray(detail.state)
    ? detail.state
    : undefined
}
