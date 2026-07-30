import Dexie, { type Table } from 'dexie'

import { APP_CONFIG } from '../config/app'
import type {
  ActivityLog,
  AppSettings,
  BackupMetadata,
  BreedingPair,
  Cage,
  CageAssignment,
  Experiment,
  ExperimentAssignment,
  ExperimentGroup,
  Litter,
  Mouse,
  MouseEvent,
  SavedView,
  Tag,
  Task,
  WeightRecord
} from '../domain'

export const DATABASE_EVENT_NAMES = {
  blocked: 'mousekeeper:database-blocked',
  versionChange: 'mousekeeper:database-versionchange'
} as const

export const DEXIE_STORES = {
  mice:
    'id,&activeEarTagKey,normalizedEarTag,normalizedExperimentNumber,' +
    'normalizedAlias,strainKey,genotypeKey,sex,status,birthDate,sireId,damId,' +
    'litterId,currentCageId,*tagIds,updatedAt,[deletedFlag+status],' +
    '[deletedFlag+currentCageId],[deletedFlag+updatedAt],origin,sampleBatchId,' +
    'importBatchId,*searchTerms',
  cages:
    'id,&activeCageNumberKey,normalizedCageNumber,roomKey,rackKey,status,updatedAt,' +
    '[deletedFlag+status],[deletedFlag+updatedAt],origin,sampleBatchId,importBatchId',
  cageAssignments:
    'id,&activeMouseKey,mouseId,cageId,startedAt,endedAt,activeFlag,' +
    '[mouseId+startedAt],[cageId+activeFlag],[cageId+startedAt],' +
    '[deletedFlag+updatedAt],origin,sampleBatchId,importBatchId',
  breedingPairs:
    'id,&activePairKey,sireId,damId,status,pairedOn,separatedOn,' +
    '[sireId+status],[damId+status],[deletedFlag+status],origin,sampleBatchId,importBatchId',
  litters:
    'id,&activeLitterKey,breedingPairId,sireId,damId,bornOn,weanedOn,' +
    '[breedingPairId+bornOn],[deletedFlag+bornOn],origin,sampleBatchId,importBatchId',
  experiments:
    'id,&activeExperimentCodeKey,normalizedCode,normalizedName,status,startDate,endDate,' +
    'updatedAt,[deletedFlag+status],[deletedFlag+updatedAt],origin,sampleBatchId,' +
    'importBatchId,*searchTerms',
  experimentGroups:
    'id,&activeGroupNameKey,experimentId,groupType,exclusionSet,' +
    '[experimentId+deletedFlag],origin,sampleBatchId,importBatchId',
  experimentAssignments:
    'id,&activeGroupMouseKey,&activeExclusionMouseKey,mouseId,experimentId,groupId,' +
    'joinedAt,exitedAt,activeFlag,[mouseId+joinedAt],[experimentId+activeFlag],' +
    '[groupId+activeFlag],origin,sampleBatchId,importBatchId',
  mouseEvents:
    'id,mouseId,cageId,experimentId,eventType,occurredAt,occurredOn,updatedAt,' +
    '[mouseId+occurredAt],[cageId+occurredAt],[experimentId+occurredAt],' +
    '[deletedFlag+occurredAt],origin,sampleBatchId,importBatchId,*searchTerms',
  weightRecords:
    'id,&eventId,mouseId,measuredAt,[mouseId+measuredAt],' +
    '[deletedFlag+measuredAt],origin,sampleBatchId,importBatchId',
  tasks:
    'id,status,priority,dueSortKey,mouseId,cageId,experimentId,updatedAt,' +
    '[deletedFlag+status+dueSortKey],[mouseId+status],[cageId+status],' +
    '[experimentId+status],origin,sampleBatchId,importBatchId',
  tags:
    'id,&activeNameKey,normalizedName,updatedAt,[deletedFlag+normalizedName],' +
    'origin,sampleBatchId,importBatchId',
  activityLogs:
    'id,&operationId,occurredAt,action,primaryEntityKey,*entityRefKeys,' +
    '[deletedFlag+occurredAt],origin,sampleBatchId,importBatchId',
  savedViews:
    'id,&activeScopeNameKey,scope,lastUsedAt,updatedAt,[deletedFlag+scope],origin',
  appSettings: 'id,updatedAt,schemaVersion',
  backupMetadata:
    'id,backupId,kind,status,exportedAt,backupSchemaVersion,checksum,createdAt,origin'
} as const

export interface DatabaseLifecycleHandlers {
  onBlocked?: (event: IDBVersionChangeEvent) => void
  onVersionChange?: (event: IDBVersionChangeEvent) => void
}

function dispatchDatabaseEvent(
  name: string,
  event: IDBVersionChangeEvent
): void {
  if (
    typeof globalThis.dispatchEvent === 'function' &&
    typeof globalThis.CustomEvent === 'function'
  ) {
    globalThis.dispatchEvent(new CustomEvent(name, { detail: event }))
  }
}

export class MouseKeeperDatabase extends Dexie {
  mice!: Table<Mouse, string>
  cages!: Table<Cage, string>
  cageAssignments!: Table<CageAssignment, string>
  breedingPairs!: Table<BreedingPair, string>
  litters!: Table<Litter, string>
  experiments!: Table<Experiment, string>
  experimentGroups!: Table<ExperimentGroup, string>
  experimentAssignments!: Table<ExperimentAssignment, string>
  mouseEvents!: Table<MouseEvent, string>
  weightRecords!: Table<WeightRecord, string>
  tasks!: Table<Task, string>
  tags!: Table<Tag, string>
  activityLogs!: Table<ActivityLog, string>
  savedViews!: Table<SavedView, string>
  appSettings!: Table<AppSettings, string>
  backupMetadata!: Table<BackupMetadata, string>

  constructor(
    name: string = APP_CONFIG.databaseName,
    handlers: DatabaseLifecycleHandlers = {}
  ) {
    super(name)

    this.version(APP_CONFIG.schemaVersion).stores(DEXIE_STORES)

    this.on('blocked', event => {
      dispatchDatabaseEvent(DATABASE_EVENT_NAMES.blocked, event)
      handlers.onBlocked?.(event)
    })

    this.on('versionchange', event => {
      dispatchDatabaseEvent(DATABASE_EVENT_NAMES.versionChange, event)
      handlers.onVersionChange?.(event)
      this.close()
    })
  }
}

export function createMouseKeeperDatabase(
  name: string = APP_CONFIG.databaseName,
  handlers?: DatabaseLifecycleHandlers
): MouseKeeperDatabase {
  return new MouseKeeperDatabase(name, handlers)
}

export const db = createMouseKeeperDatabase()
