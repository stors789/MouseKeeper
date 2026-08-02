import { appCapabilities, appDatabase } from '../app/runtime'
import { providerSettingsStore } from './provider/settings-store'
import { secretStore } from './provider/secret-store'
import { ProviderClient } from './provider/client'
import { agentDatabase } from './recovery/database'
import { RecoveryManager } from './recovery/recovery-manager'
import { AgentOrchestrator } from './orchestrator/orchestrator'
import { registerAgentSettingsCapabilities } from './settings-capabilities'
import { platformFetch } from '../platform/network'

export const providerClient = new ProviderClient(secretStore, platformFetch)
export const recoveryManager = new RecoveryManager(appDatabase, agentDatabase)

registerAgentSettingsCapabilities(
  appCapabilities,
  providerSettingsStore,
  secretStore,
  providerClient
)

export const agentOrchestrator = new AgentOrchestrator(
  appCapabilities,
  providerClient,
  recoveryManager
)
