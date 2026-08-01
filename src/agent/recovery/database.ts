import Dexie, { type Table } from 'dexie'
import type { AgentCommandRun } from './types'

export const AGENT_DATABASE_NAME = 'mousekeeper-agent'

export class AgentDatabase extends Dexie {
  commandRuns!: Table<AgentCommandRun, string>

  constructor(name: string = AGENT_DATABASE_NAME) {
    super(name)
    this.version(1).stores({
      commandRuns: 'id,sessionId,createdAt,updatedAt,status,*capabilityIds'
    })
  }
}

export const agentDatabase = new AgentDatabase()
