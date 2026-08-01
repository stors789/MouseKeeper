import { db } from '../db'
import { createMouseKeeperService } from '../services'
import { createApplicationCapabilityRegistry } from '../application'

export const appDatabase = db
export const appService = createMouseKeeperService(appDatabase)
export const appCapabilities = createApplicationCapabilityRegistry(
  appDatabase,
  appService
)

export function executeUiCapability(
  id: string,
  input: Readonly<Record<string, unknown>>
) {
  const commandRunId = crypto.randomUUID()
  return appCapabilities.execute(id, input, {
    actor: 'ui',
    commandRunId,
    operationId: `${commandRunId}:ui`
  })
}
