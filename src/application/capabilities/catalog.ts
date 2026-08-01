import {
  BREEDING_PAIR_STATUSES,
  CAGE_STATUSES,
  EXPERIMENT_GROUP_TYPES,
  EXPERIMENT_STATUSES,
  MANUAL_MOUSE_EVENT_TYPES,
  MOUSE_SEXES,
  MOUSE_STATUSES,
  SAVED_VIEW_SCOPES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  WEIGHT_UNITS
} from '../../domain'
import {
  arraySchema,
  booleanSchema,
  emptyObjectSchema,
  enumSchema,
  integerSchema,
  numberSchema,
  objectSchema,
  optionalStringSchema,
  stringSchema
} from './schema'
import type { CapabilityDescriptor, JsonSchema } from './types'

const id = stringSchema('稳定内部 ID；不确定时先使用 query.search 或 query.entities')
const localDate = { type: 'string', format: 'date' } satisfies JsonSchema
const localTime = {
  type: ['string', 'null'],
  description: 'HH:mm 本地时间'
} satisfies JsonSchema
const revision = integerSchema('可选；省略时执行器读取最新 revision')
const stringArray = arraySchema(stringSchema())
const jsonObject = objectSchema({}, [], undefined, true)

const mouseFields = {
  earTag: optionalStringSchema(),
  experimentNumber: optionalStringSchema(),
  name: optionalStringSchema(),
  alias: optionalStringSchema(),
  strain: stringSchema(),
  genotype: optionalStringSchema(),
  sex: enumSchema(MOUSE_SEXES),
  birthDate: { ...localDate, type: ['string', 'null'] },
  sireId: optionalStringSchema(),
  damId: optionalStringSchema(),
  status: enumSchema(MOUSE_STATUSES),
  source: optionalStringSchema(),
  coatColor: optionalStringSchema(),
  notes: optionalStringSchema(),
  tagIds: stringArray,
  custom: jsonObject
} satisfies Record<string, JsonSchema>

const taskFields = {
  title: stringSchema(),
  dueDate: localDate,
  dueTime: localTime,
  mouseId: optionalStringSchema(),
  cageId: optionalStringSchema(),
  experimentId: optionalStringSchema(),
  priority: enumSchema(TASK_PRIORITIES),
  status: enumSchema(TASK_STATUSES),
  notes: optionalStringSchema()
} satisfies Record<string, JsonSchema>

interface DescriptorInput
  extends Omit<
    CapabilityDescriptor,
    | 'version'
    | 'requiredContext'
    | 'errorTypes'
    | 'preconditions'
    | 'testLocations'
    | 'llmExposed'
  > {
  requiredContext?: readonly string[]
  errorTypes?: readonly string[]
  preconditions?: readonly string[]
  testLocations?: readonly string[]
  llmExposed?: boolean
}

function descriptor(input: DescriptorInput): CapabilityDescriptor {
  return {
    version: 1,
    requiredContext: [],
    errorTypes: ['validation', 'not-found', 'revision-conflict', 'business-rule'],
    preconditions: [],
    testLocations: ['src/application/capabilities/registry.test.ts'],
    llmExposed: true,
    ...input
  }
}

function command(
  input: Omit<
    DescriptorInput,
    'kind' | 'modifiesData' | 'risk' | 'recovery' | 'supportsBatch'
  > & {
    supportsBatch?: boolean
    risk?: CapabilityDescriptor['risk']
    recovery?: CapabilityDescriptor['recovery']
  }
): CapabilityDescriptor {
  return descriptor({
    ...input,
    kind: 'command',
    modifiesData: true,
    supportsBatch: input.supportsBatch ?? false,
    risk: input.risk ?? 'reversible',
    recovery: input.recovery ?? 'row-diff'
  })
}

function query(
  input: Omit<
    DescriptorInput,
    'kind' | 'modifiesData' | 'risk' | 'recovery' | 'supportsBatch' | 'writes'
  >
): CapabilityDescriptor {
  return descriptor({
    ...input,
    kind: 'query',
    modifiesData: false,
    supportsBatch: true,
    risk: 'read-only',
    recovery: 'none',
    writes: []
  })
}

export const CORE_CAPABILITY_DESCRIPTORS: readonly CapabilityDescriptor[] = [
  query({
    id: 'query.dashboard',
    domain: 'query',
    name: '读取群体总览',
    description: '读取群体指标、分布、需要关注事项、最近小鼠、任务和活动。',
    inputSchema: emptyObjectSchema,
    outputDescription: 'DashboardSnapshot',
    reads: ['mice', 'cages', 'assignments', 'tasks', 'events', 'settings'],
    service: 'loadDashboardSnapshot'
  }),
  query({
    id: 'query.search',
    domain: 'query',
    name: '全局模糊搜索',
    description: '搜索工作区及小鼠、笼位、实验、任务和事件，返回稳定 ID 与详情链接。',
    inputSchema: objectSchema(
      { query: stringSchema(), limit: integerSchema() },
      ['query']
    ),
    outputDescription: '排序后的搜索结果',
    reads: ['mice', 'cages', 'experiments', 'tasks', 'events', 'tags'],
    service: 'searchGlobalRecords'
  }),
  query({
    id: 'query.entities',
    domain: 'query',
    name: '查询任意业务实体',
    description: '按表、字段条件、文本、删除状态、排序和数量查询实体；用于统计、分组和后续操作解析。',
    inputSchema: objectSchema(
      {
        entityType: enumSchema([
          'mouse', 'cage', 'cageAssignment', 'breedingPair', 'litter',
          'experiment', 'experimentGroup', 'experimentAssignment', 'mouseEvent',
          'weightRecord', 'task', 'tag', 'activityLog', 'savedView', 'backupMetadata'
        ]),
        filters: jsonObject,
        text: optionalStringSchema(),
        includeDeleted: booleanSchema(),
        sortBy: optionalStringSchema(),
        sortDirection: enumSchema(['asc', 'desc']),
        limit: integerSchema()
      },
      ['entityType']
    ),
    outputDescription: '实体数组、总数和截断信息',
    reads: ['selected entity table'],
    service: 'namedEntityQuery'
  }),
  query({
    id: 'query.integrity',
    domain: 'query',
    name: '运行完整性扫描',
    description: '只读扫描全部业务表，报告 schema、引用、投影和配对问题。',
    inputSchema: emptyObjectSchema,
    outputDescription: 'IntegrityReport',
    reads: ['all business tables'],
    service: 'scanIntegrity'
  }),
  command({
    id: 'mouse.create', domain: 'mice', name: '创建小鼠',
    description: '创建一只小鼠，可同时指定初始笼位和标签。',
    inputSchema: objectSchema({ ...mouseFields, initialCageId: optionalStringSchema(), initialCageReason: optionalStringSchema() }, ['strain', 'sex']),
    outputDescription: '小鼠及可选分笼关系', reads: ['mice', 'cages', 'tags'], writes: ['mice', 'cageAssignments', 'mouseEvents', 'activityLogs'],
    service: 'createMouseWithCage'
  }),
  command({
    id: 'mouse.create.batch', domain: 'mice', name: '批量创建小鼠',
    description: '在一个原子批次中创建多只小鼠。',
    inputSchema: objectSchema({ entries: arraySchema(objectSchema(mouseFields, ['strain', 'sex'])) }, ['entries']),
    outputDescription: '创建的小鼠数组', reads: ['mice'], writes: ['mice', 'activityLogs'], supportsBatch: true,
    service: 'createMice'
  }),
  command({
    id: 'mouse.update', domain: 'mice', name: '编辑小鼠',
    description: '修改小鼠 UI 支持的全部档案字段。',
    inputSchema: objectSchema({ mouseId: id, expectedRevision: revision, patch: objectSchema(mouseFields) }, ['mouseId', 'patch']),
    outputDescription: '更新后的小鼠', reads: ['mice'], writes: ['mice', 'activityLogs'], service: 'updateMouse'
  }),
  command({
    id: 'mouse.status.set', domain: 'mice', name: '更改单只小鼠状态',
    description: '更改单只状态并记录业务事件；终止状态会按现有规则关闭活动关系。',
    inputSchema: objectSchema({ mouseId: id, expectedRevision: revision, status: enumSchema(MOUSE_STATUSES), occurredOn: localDate, occurredTime: localTime, reason: optionalStringSchema() }, ['mouseId', 'status', 'occurredOn']),
    outputDescription: '小鼠和状态事件', reads: ['mice', 'active relationships'], writes: ['mice', 'mouseEvents', 'relationships', 'activityLogs'], service: 'changeMouseStatus'
  }),
  command({
    id: 'mouse.status.batch', domain: 'mice', name: '批量更改小鼠状态',
    description: '原子更改多只小鼠状态。',
    inputSchema: objectSchema({ mouseIds: arraySchema(id), status: enumSchema(MOUSE_STATUSES), occurredOn: localDate, occurredTime: localTime, reason: optionalStringSchema() }, ['mouseIds', 'status', 'occurredOn']),
    outputDescription: '更新的小鼠与事件', reads: ['mice', 'active relationships'], writes: ['mice', 'mouseEvents', 'relationships', 'activityLogs'], supportsBatch: true, service: 'changeMiceStatus'
  }),
  command({
    id: 'mouse.move', domain: 'mice', name: '单只转笼', description: '把一只小鼠移入或转入指定笼位。',
    inputSchema: objectSchema({ mouseId: id, cageId: id, reason: optionalStringSchema() }, ['mouseId', 'cageId']),
    outputDescription: '小鼠、分笼关系和事件', reads: ['mice', 'cages', 'cageAssignments'], writes: ['mice', 'cageAssignments', 'mouseEvents', 'activityLogs'], service: 'moveMouse'
  }),
  command({
    id: 'mouse.move.batch', domain: 'mice', name: '批量转笼', description: '原子把多只小鼠转入同一笼位。',
    inputSchema: objectSchema({ mouseIds: arraySchema(id), cageId: id, reason: optionalStringSchema() }, ['mouseIds', 'cageId']),
    outputDescription: '更新的小鼠、关系和事件', reads: ['mice', 'cages', 'cageAssignments'], writes: ['mice', 'cageAssignments', 'mouseEvents', 'activityLogs'], supportsBatch: true, service: 'moveMice'
  }),
  command({
    id: 'mouse.cage.leave', domain: 'mice', name: '移出笼位', description: '结束小鼠当前活动分笼关系。',
    inputSchema: objectSchema({ mouseId: id, reason: optionalStringSchema() }, ['mouseId']), outputDescription: '小鼠、结束的关系和事件',
    reads: ['mice', 'cageAssignments'], writes: ['mice', 'cageAssignments', 'mouseEvents', 'activityLogs'], service: 'leaveCage'
  }),
  command({
    id: 'mouse.tags.set', domain: 'mice', name: '设置小鼠标签', description: '替换一只小鼠的完整标签集合。',
    inputSchema: objectSchema({ mouseId: id, tagIds: stringArray }, ['mouseId', 'tagIds']), outputDescription: '更新后的小鼠', reads: ['mice', 'tags'], writes: ['mice', 'mouseEvents', 'activityLogs'], service: 'setMouseTags'
  }),
  command({
    id: 'mouse.tags.batch', domain: 'mice', name: '批量增删标签', description: '给多只小鼠添加或移除标签。',
    inputSchema: objectSchema({ mouseIds: arraySchema(id), addTagIds: stringArray, removeTagIds: stringArray }, ['mouseIds']), outputDescription: '更新与跳过的小鼠', reads: ['mice', 'tags'], writes: ['mice', 'mouseEvents', 'activityLogs'], supportsBatch: true, service: 'setMiceTags'
  }),
  command({
    id: 'mouse.delete', domain: 'mice', name: '软删除小鼠', description: '把小鼠移入回收站并按业务规则关闭关系。',
    inputSchema: objectSchema({ mouseId: id, expectedRevision: revision, reason: optionalStringSchema() }, ['mouseId']), outputDescription: '已删除小鼠', reads: ['mice', 'relationships'], writes: ['mice', 'relationships', 'mouseEvents', 'activityLogs'], service: 'softDeleteMouse'
  }),
  command({
    id: 'mouse.restore', domain: 'mice', name: '恢复小鼠', description: '从回收站恢复小鼠档案。',
    inputSchema: objectSchema({ mouseId: id, expectedRevision: revision }, ['mouseId']), outputDescription: '恢复后的小鼠', reads: ['mice'], writes: ['mice', 'activityLogs'], service: 'restoreMouse'
  }),
  command({
    id: 'cage.create', domain: 'cages', name: '创建笼位', description: '创建笼位及容量、位置和用途信息。',
    inputSchema: objectSchema({ cageNumber: stringSchema(), status: enumSchema(CAGE_STATUSES), room: optionalStringSchema(), rack: optionalStringSchema(), maxCapacity: integerSchema(), primaryStrain: optionalStringSchema(), purpose: optionalStringSchema(), notes: optionalStringSchema(), custom: jsonObject }, ['cageNumber', 'maxCapacity']),
    outputDescription: '创建的笼位', reads: ['cages'], writes: ['cages', 'activityLogs'], service: 'createCage'
  }),
  command({
    id: 'cage.update', domain: 'cages', name: '编辑笼位', description: '修改笼位 UI 支持的全部字段。',
    inputSchema: objectSchema({ cageId: id, expectedRevision: revision, patch: jsonObject }, ['cageId', 'patch']), outputDescription: '更新后的笼位', reads: ['cages', 'assignments'], writes: ['cages', 'activityLogs'], service: 'updateCage'
  }),
  command({
    id: 'cage.delete', domain: 'cages', name: '软删除笼位', description: '把没有活动成员的笼位移到回收站。',
    inputSchema: objectSchema({ cageId: id, expectedRevision: revision }, ['cageId']), outputDescription: '已删除笼位', reads: ['cages', 'cageAssignments'], writes: ['cages', 'activityLogs'], service: 'softDeleteCage'
  }),
  command({
    id: 'cage.restore', domain: 'cages', name: '恢复笼位', description: '从回收站恢复笼位。',
    inputSchema: objectSchema({ cageId: id, expectedRevision: revision }, ['cageId']), outputDescription: '恢复后的笼位', reads: ['cages'], writes: ['cages', 'activityLogs'], service: 'restoreCage'
  }),
  command({
    id: 'breeding.create', domain: 'breeding', name: '创建繁育组合', description: '选择父本母本并记录合笼、预计产期、状态和备注。',
    inputSchema: objectSchema({ sireId: id, damId: id, pairedOn: localDate, expectedDeliveryDate: { ...localDate, type: ['string', 'null'] }, status: enumSchema(BREEDING_PAIR_STATUSES), notes: optionalStringSchema() }, ['sireId', 'damId', 'pairedOn']), outputDescription: '繁育组合', reads: ['mice', 'breedingPairs'], writes: ['breedingPairs', 'activityLogs'], service: 'createBreedingPair'
  }),
  command({
    id: 'breeding.update', domain: 'breeding', name: '更新繁育组合', description: '更新繁育状态、日期和备注。',
    inputSchema: objectSchema({ breedingPairId: id, expectedRevision: revision, patch: jsonObject }, ['breedingPairId', 'patch']), outputDescription: '更新后的繁育组合', reads: ['breedingPairs'], writes: ['breedingPairs', 'activityLogs'], service: 'updateBreedingPair'
  }),
  command({
    id: 'breeding.litter.create', domain: 'breeding', name: '创建窝和后代', description: '原子记录一窝并批量创建后代。',
    inputSchema: objectSchema({ breedingPairId: id, litterNumber: stringSchema(), bornOn: localDate, bornCount: integerSchema(), aliveCount: integerSchema(), weanedOn: { ...localDate, type: ['string', 'null'] }, notes: optionalStringSchema(), offspring: arraySchema(objectSchema({ earTag: optionalStringSchema(), experimentNumber: optionalStringSchema(), name: optionalStringSchema(), alias: optionalStringSchema(), strain: optionalStringSchema(), genotype: optionalStringSchema(), sex: enumSchema(MOUSE_SEXES), coatColor: optionalStringSchema(), notes: optionalStringSchema() }, ['sex'])) }, ['breedingPairId', 'litterNumber', 'bornOn', 'offspring']), outputDescription: '窝记录和后代', reads: ['breedingPairs', 'mice', 'litters'], writes: ['litters', 'mice', 'mouseEvents', 'activityLogs'], supportsBatch: true, risk: 'high-impact', recovery: 'full-backup', service: 'createLitterWithOffspring'
  }),
  command({
    id: 'experiment.create', domain: 'experiments', name: '创建实验与初始组', description: '创建实验及一个初始组别。',
    inputSchema: objectSchema({ code: optionalStringSchema(), name: stringSchema(), description: optionalStringSchema(), startDate: { ...localDate, type: ['string', 'null'] }, endDate: { ...localDate, type: ['string', 'null'] }, status: enumSchema(EXPERIMENT_STATUSES), intervention: optionalStringSchema(), dose: optionalStringSchema(), frequency: optionalStringSchema(), principalInvestigator: optionalStringSchema(), notes: optionalStringSchema(), initialGroup: objectSchema({ name: stringSchema(), groupType: enumSchema(EXPERIMENT_GROUP_TYPES), exclusionSet: optionalStringSchema(), intervention: optionalStringSchema(), dose: optionalStringSchema(), frequency: optionalStringSchema(), notes: optionalStringSchema() }, ['name', 'groupType']) }, ['name', 'initialGroup']), outputDescription: '实验和初始组', reads: ['experiments'], writes: ['experiments', 'experimentGroups', 'activityLogs'], service: 'createExperimentWithInitialGroup'
  }),
  command({
    id: 'experiment.update', domain: 'experiments', name: '编辑实验', description: '修改实验 UI 支持的全部字段。',
    inputSchema: objectSchema({ experimentId: id, expectedRevision: revision, patch: jsonObject }, ['experimentId', 'patch']), outputDescription: '更新后的实验', reads: ['experiments'], writes: ['experiments', 'activityLogs'], service: 'updateExperiment'
  }),
  command({
    id: 'experiment.group.create', domain: 'experiments', name: '创建实验组', description: '在现有实验中创建组别。',
    inputSchema: objectSchema({ experimentId: id, name: stringSchema(), groupType: enumSchema(EXPERIMENT_GROUP_TYPES), exclusionSet: optionalStringSchema(), intervention: optionalStringSchema(), dose: optionalStringSchema(), frequency: optionalStringSchema(), notes: optionalStringSchema() }, ['experimentId', 'name', 'groupType']), outputDescription: '实验组', reads: ['experiments', 'experimentGroups'], writes: ['experimentGroups', 'activityLogs'], service: 'createExperimentGroup'
  }),
  command({
    id: 'experiment.assign', domain: 'experiments', name: '加入实验组', description: '把一只小鼠加入实验组。',
    inputSchema: objectSchema({ mouseId: id, experimentId: id, groupId: id, joinedOn: localDate, joinedTime: localTime }, ['mouseId', 'experimentId', 'groupId', 'joinedOn']), outputDescription: '实验分配和事件', reads: ['mice', 'experiments', 'experimentGroups', 'experimentAssignments'], writes: ['experimentAssignments', 'mouseEvents', 'activityLogs'], service: 'assignMouseToExperiment'
  }),
  command({
    id: 'experiment.assign.batch', domain: 'experiments', name: '批量加入实验组', description: '原子把多只小鼠加入同一实验组。',
    inputSchema: objectSchema({ mouseIds: arraySchema(id), experimentId: id, groupId: id, joinedOn: localDate, joinedTime: localTime }, ['mouseIds', 'experimentId', 'groupId', 'joinedOn']), outputDescription: '实验分配与事件数组', reads: ['mice', 'experiments', 'experimentGroups', 'experimentAssignments'], writes: ['experimentAssignments', 'mouseEvents', 'activityLogs'], supportsBatch: true, service: 'assignMiceToExperiment'
  }),
  command({
    id: 'experiment.exit', domain: 'experiments', name: '退出实验', description: '结束一条活动实验分配。',
    inputSchema: objectSchema({ assignmentId: id, exitedOn: localDate, exitedTime: localTime, reason: optionalStringSchema() }, ['assignmentId', 'exitedOn']), outputDescription: '结束的分配和事件', reads: ['experimentAssignments'], writes: ['experimentAssignments', 'mouseEvents', 'activityLogs'], service: 'exitExperimentAssignment'
  }),
  command({
    id: 'experiment.exit.batch', domain: 'experiments', name: '批量退出实验', description: '原子结束多条活动实验分配。',
    inputSchema: objectSchema({ assignmentIds: arraySchema(id), exitedOn: localDate, exitedTime: localTime, reason: optionalStringSchema() }, ['assignmentIds', 'exitedOn']), outputDescription: '结束的分配和事件', reads: ['experimentAssignments'], writes: ['experimentAssignments', 'mouseEvents', 'activityLogs'], supportsBatch: true, service: 'exitExperimentAssignments'
  }),
  command({
    id: 'experiment.delete', domain: 'experiments', name: '软删除实验', description: '把实验移入回收站。',
    inputSchema: objectSchema({ experimentId: id, expectedRevision: revision }, ['experimentId']), outputDescription: '已删除实验', reads: ['experiments', 'experimentAssignments'], writes: ['experiments', 'activityLogs'], service: 'softDeleteExperiment'
  }),
  command({
    id: 'experiment.restore', domain: 'experiments', name: '恢复实验', description: '从回收站恢复实验。',
    inputSchema: objectSchema({ experimentId: id, expectedRevision: revision }, ['experimentId']), outputDescription: '恢复后的实验', reads: ['experiments'], writes: ['experiments', 'activityLogs'], service: 'restoreExperiment'
  }),
  command({
    id: 'event.create', domain: 'records', name: '创建小鼠事件', description: '创建 UI 支持的人工事件。',
    inputSchema: objectSchema({ mouseId: id, eventType: enumSchema(MANUAL_MOUSE_EVENT_TYPES), occurredOn: localDate, occurredTime: localTime, title: stringSchema(), description: optionalStringSchema(), payload: jsonObject, cageId: optionalStringSchema(), experimentId: optionalStringSchema() }, ['mouseId', 'eventType', 'occurredOn', 'title']), outputDescription: '创建的事件', reads: ['mice'], writes: ['mouseEvents', 'activityLogs'], service: 'createMouseEvent'
  }),
  command({
    id: 'event.update', domain: 'records', name: '编辑小鼠事件', description: '编辑人工事件的类型、日期、标题、描述和关联。',
    inputSchema: objectSchema({ eventId: id, expectedRevision: revision, patch: jsonObject }, ['eventId', 'patch']), outputDescription: '更新后的事件', reads: ['mouseEvents'], writes: ['mouseEvents', 'activityLogs'], service: 'updateMouseEvent'
  }),
  command({
    id: 'event.delete', domain: 'records', name: '软删除事件', description: '软删除人工事件或成对的体重事件/记录。',
    inputSchema: objectSchema({ eventId: id, expectedRevision: revision }, ['eventId']), outputDescription: '已删除事件', reads: ['mouseEvents', 'weightRecords'], writes: ['mouseEvents', 'weightRecords', 'activityLogs'], service: 'softDeleteMouseEvent'
  }),
  command({
    id: 'event.restore', domain: 'records', name: '恢复事件', description: '从回收站恢复事件及配对体重。',
    inputSchema: objectSchema({ eventId: id, expectedRevision: revision }, ['eventId']), outputDescription: '恢复后的事件', reads: ['mouseEvents', 'weightRecords'], writes: ['mouseEvents', 'weightRecords', 'activityLogs'], service: 'restoreMouseEvent'
  }),
  command({
    id: 'weight.record', domain: 'records', name: '记录体重', description: '记录一次体重并创建配对事件。',
    inputSchema: objectSchema({ mouseId: id, value: numberSchema(), unit: enumSchema(WEIGHT_UNITS), measuredOn: localDate, measuredTime: localTime, notes: optionalStringSchema(), anomalyAcknowledged: booleanSchema() }, ['mouseId', 'value', 'unit', 'measuredOn']), outputDescription: '体重记录与事件', reads: ['mice', 'weightRecords'], writes: ['weightRecords', 'mouseEvents', 'activityLogs'], service: 'recordWeight'
  }),
  command({
    id: 'weight.record.batch', domain: 'records', name: '批量记录体重', description: '原子记录多只小鼠的体重。',
    inputSchema: objectSchema({ entries: arraySchema(objectSchema({ mouseId: id, value: numberSchema(), unit: enumSchema(WEIGHT_UNITS), measuredOn: localDate, measuredTime: localTime, notes: optionalStringSchema(), anomalyAcknowledged: booleanSchema() }, ['mouseId', 'value', 'unit', 'measuredOn'])) }, ['entries']), outputDescription: '体重与事件数组', reads: ['mice', 'weightRecords'], writes: ['weightRecords', 'mouseEvents', 'activityLogs'], supportsBatch: true, service: 'recordWeights'
  }),
  command({
    id: 'task.create', domain: 'tasks', name: '创建任务', description: '创建任务并可关联小鼠、笼位或实验。',
    inputSchema: objectSchema(taskFields, ['title', 'dueDate']), outputDescription: '创建的任务', reads: ['mice', 'cages', 'experiments'], writes: ['tasks', 'activityLogs'], service: 'createTask'
  }),
  command({
    id: 'task.update', domain: 'tasks', name: '编辑任务', description: '修改任务 UI 支持的全部字段。',
    inputSchema: objectSchema({ taskId: id, expectedRevision: revision, patch: objectSchema(taskFields) }, ['taskId', 'patch']), outputDescription: '更新后的任务', reads: ['tasks'], writes: ['tasks', 'activityLogs'], service: 'updateTask'
  }),
  command({
    id: 'task.status.set', domain: 'tasks', name: '更改任务状态', description: '完成、取消或恢复为待处理。',
    inputSchema: objectSchema({ taskId: id, expectedRevision: revision, status: enumSchema(TASK_STATUSES) }, ['taskId', 'status']), outputDescription: '更新后的任务', reads: ['tasks'], writes: ['tasks', 'activityLogs'], service: 'setTaskStatus'
  }),
  command({
    id: 'task.delete', domain: 'tasks', name: '软删除任务', description: '把任务移入回收站。',
    inputSchema: objectSchema({ taskId: id, expectedRevision: revision }, ['taskId']), outputDescription: '已删除任务', reads: ['tasks'], writes: ['tasks', 'activityLogs'], service: 'softDeleteTask'
  }),
  command({
    id: 'task.restore', domain: 'tasks', name: '恢复任务', description: '从回收站恢复任务。',
    inputSchema: objectSchema({ taskId: id, expectedRevision: revision }, ['taskId']), outputDescription: '恢复后的任务', reads: ['tasks'], writes: ['tasks', 'activityLogs'], service: 'restoreTask'
  }),
  command({
    id: 'tag.create', domain: 'tags', name: '创建标签', description: '创建标签。',
    inputSchema: objectSchema({ name: stringSchema(), color: optionalStringSchema(), description: optionalStringSchema() }, ['name']), outputDescription: '创建的标签', reads: ['tags'], writes: ['tags', 'activityLogs'], service: 'createTag'
  }),
  command({
    id: 'tag.delete', domain: 'tags', name: '软删除标签', description: '软删除未被活动小鼠使用的标签。',
    inputSchema: objectSchema({ tagId: id, expectedRevision: revision }, ['tagId']), outputDescription: '已删除标签', reads: ['tags', 'mice'], writes: ['tags', 'activityLogs'], service: 'softDeleteTag'
  }),
  command({
    id: 'tag.restore', domain: 'tags', name: '恢复标签', description: '从回收站恢复标签。',
    inputSchema: objectSchema({ tagId: id, expectedRevision: revision }, ['tagId']), outputDescription: '恢复后的标签', reads: ['tags'], writes: ['tags', 'activityLogs'], service: 'restoreTag'
  }),
  command({
    id: 'saved-view.create', domain: 'views', name: '创建保存视图', description: '保存筛选、排序和列配置。',
    inputSchema: objectSchema({ scope: enumSchema(SAVED_VIEW_SCOPES), name: stringSchema(), filters: jsonObject, sort: jsonObject, columns: jsonObject }, ['scope', 'name', 'filters', 'sort']), outputDescription: '保存视图', reads: ['savedViews'], writes: ['savedViews', 'activityLogs'], service: 'createSavedView'
  }),
  command({
    id: 'saved-view.update', domain: 'views', name: '更新保存视图', description: '更新保存视图名称或配置。',
    inputSchema: objectSchema({ savedViewId: id, expectedRevision: revision, patch: jsonObject }, ['savedViewId', 'patch']), outputDescription: '更新后的保存视图', reads: ['savedViews'], writes: ['savedViews', 'activityLogs'], service: 'updateSavedView'
  }),
  command({
    id: 'saved-view.delete', domain: 'views', name: '删除保存视图', description: '软删除保存视图。',
    inputSchema: objectSchema({ savedViewId: id, expectedRevision: revision }, ['savedViewId']), outputDescription: '已删除保存视图', reads: ['savedViews'], writes: ['savedViews', 'activityLogs'], service: 'softDeleteSavedView'
  }),
  command({
    id: 'saved-view.restore', domain: 'views', name: '恢复保存视图', description: '恢复已删除保存视图。',
    inputSchema: objectSchema({ savedViewId: id, expectedRevision: revision }, ['savedViewId']), outputDescription: '恢复后的保存视图', reads: ['savedViews'], writes: ['savedViews', 'activityLogs'], service: 'restoreSavedView'
  }),
  command({
    id: 'sample.create', domain: 'data', name: '生成示例数据', description: '创建一组明确标记的示例数据。',
    inputSchema: emptyObjectSchema, outputDescription: '示例批次', reads: ['all business tables'], writes: ['multiple business tables'], risk: 'high-impact', recovery: 'full-backup', service: 'generateSampleData'
  }),
  command({
    id: 'sample.delete', domain: 'data', name: '删除示例批次', description: '物理删除指定示例批次。',
    inputSchema: objectSchema({ sampleBatchId: id }, ['sampleBatchId']), outputDescription: '删除计数', reads: ['all business tables'], writes: ['multiple business tables'], risk: 'high-impact', recovery: 'full-backup', service: 'deleteSampleBatch'
  })
]
