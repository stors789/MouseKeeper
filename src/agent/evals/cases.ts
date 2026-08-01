import type { CapabilityRisk, RecoveryStrategy } from '../../application'
import type { AgentEvalCase, EvalCategory, EvalContextContract } from './types'

const FIXED_CONTEXT: EvalContextContract = {
  currentRoute: '/mice',
  locale: 'zh-CN',
  timeZone: 'Asia/Shanghai',
  now: '2026-08-01T12:00:00+08:00',
  selectedCount: 0
}

const POLICIES: Readonly<Record<string, readonly [CapabilityRisk, RecoveryStrategy]>> = {
  'navigation.open': ['view-only', 'none'],
  'navigation.open.entity': ['view-only', 'none'],
  'view.create-menu.open': ['view-only', 'none'],
  'view.search.focus': ['view-only', 'none'],
  'view.configure': ['reversible', 'row-diff'],
  'settings.theme.set': ['reversible', 'row-diff'],
  'settings.storage.persist': ['view-only', 'browser-managed'],
  'settings.storage.status': ['read-only', 'none'],
  'query.dashboard': ['read-only', 'none'],
  'query.search': ['read-only', 'none'],
  'query.entities': ['read-only', 'none'],
  'query.integrity': ['read-only', 'none'],
  'data.backup.export': ['reversible', 'row-diff'],
  'data.csv.export': ['read-only', 'none'],
  'data.file.request': ['view-only', 'none'],
  'data.backup.preview': ['read-only', 'none'],
  'data.backup.restore': ['high-impact', 'full-backup'],
  'data.csv.preview': ['read-only', 'none'],
  'data.csv.import': ['high-impact', 'full-backup'],
  'data.purge.preview': ['read-only', 'none'],
  'data.purge.execute': ['irreversible', 'full-backup'],
  'breeding.litter.create': ['high-impact', 'full-backup'],
  'sample.create': ['high-impact', 'full-backup'],
  'sample.delete': ['high-impact', 'full-backup']
}

function policy(id: string): readonly [CapabilityRisk, RecoveryStrategy] {
  return POLICIES[id] ?? ['reversible', 'row-diff']
}

function argsFor(id: string, token: string): Record<string, unknown> {
  const commonId = `eval-${token}`
  const values: Record<string, Record<string, unknown>> = {
    'navigation.open': { href: '/mice' },
    'navigation.open.entity': { entityType: 'mouse', entityId: commonId },
    'view.search.focus': {},
    'view.configure': { workspace: 'mice', state: { query: token } },
    'settings.theme.set': { theme: 'dark' },
    'settings.storage.persist': {},
    'settings.storage.status': {},
    'query.dashboard': {},
    'query.search': { query: token },
    'query.entities': { entityType: 'mouse', text: token },
    'query.integrity': {},
    'mouse.create': { earTag: token, strain: 'C57BL/6J', sex: 'female' },
    'mouse.create.batch': { entries: [{ earTag: token, strain: 'C57BL/6J', sex: 'female' }] },
    'mouse.update': { mouseId: commonId, patch: { notes: token } },
    'mouse.status.set': { mouseId: commonId, status: 'reserved', occurredOn: '2026-08-01' },
    'mouse.status.batch': { mouseIds: [commonId], status: 'reserved', occurredOn: '2026-08-01' },
    'mouse.move': { mouseId: commonId, cageId: `cage-${token}` },
    'mouse.move.batch': { mouseIds: [commonId], cageId: `cage-${token}` },
    'mouse.cage.leave': { mouseId: commonId },
    'mouse.tags.set': { mouseId: commonId, tagIds: [`tag-${token}`] },
    'mouse.tags.batch': { mouseIds: [commonId], addTagIds: [`tag-${token}`], removeTagIds: [] },
    'mouse.delete': { mouseId: commonId },
    'mouse.restore': { mouseId: commonId },
    'cage.create': { cageNumber: token, maxCapacity: 5 },
    'cage.update': { cageId: commonId, patch: { notes: token } },
    'cage.delete': { cageId: commonId },
    'cage.restore': { cageId: commonId },
    'breeding.create': { sireId: `sire-${token}`, damId: `dam-${token}`, pairedOn: '2026-08-01' },
    'breeding.update': { breedingPairId: commonId, patch: { notes: token } },
    'breeding.litter.create': { breedingPairId: commonId, litterNumber: token, bornOn: '2026-08-01', bornCount: 1, aliveCount: 1, offspring: [{ sex: 'female' }] },
    'experiment.create': { name: token, initialGroup: { name: 'control', groupType: 'control' } },
    'experiment.update': { experimentId: commonId, patch: { notes: token } },
    'experiment.group.create': { experimentId: commonId, name: token, groupType: 'control' },
    'experiment.assign': { mouseId: commonId, experimentId: `experiment-${token}`, groupId: `group-${token}`, joinedOn: '2026-08-01' },
    'experiment.assign.batch': { mouseIds: [commonId], experimentId: `experiment-${token}`, groupId: `group-${token}`, joinedOn: '2026-08-01' },
    'experiment.exit': { assignmentId: commonId, exitedOn: '2026-08-01' },
    'experiment.exit.batch': { assignmentIds: [commonId], exitedOn: '2026-08-01' },
    'experiment.delete': { experimentId: commonId },
    'experiment.restore': { experimentId: commonId },
    'event.create': { mouseId: commonId, eventType: 'custom', occurredOn: '2026-08-01', title: token },
    'event.update': { eventId: commonId, patch: { notes: token } },
    'event.delete': { eventId: commonId },
    'event.restore': { eventId: commonId },
    'weight.record': { mouseId: commonId, measuredOn: '2026-08-01', value: 22.4, unit: 'g' },
    'weight.record.batch': { entries: [{ mouseId: commonId, measuredOn: '2026-08-01', value: 22.4, unit: 'g' }] },
    'task.create': { title: token, dueDate: '2026-08-02', priority: 'normal', status: 'pending' },
    'task.update': { taskId: commonId, patch: { notes: token } },
    'task.status.set': { taskId: commonId, status: 'completed' },
    'task.delete': { taskId: commonId },
    'task.restore': { taskId: commonId },
    'tag.create': { name: token, color: '#0f766e' },
    'tag.delete': { tagId: commonId },
    'tag.restore': { tagId: commonId },
    'saved-view.create': { name: token, scope: 'mice', filters: {}, sort: {} },
    'saved-view.update': { savedViewId: commonId, patch: { name: token } },
    'saved-view.delete': { savedViewId: commonId },
    'saved-view.restore': { savedViewId: commonId },
    'sample.create': {},
    'sample.delete': { sampleBatchId: commonId },
    'data.backup.export': {},
    'data.file.request': { kind: 'backup-restore' },
    'data.backup.preview': { fileRequestId: commonId },
    'data.backup.restore': { previewToken: commonId },
    'data.csv.preview': { fileRequestId: commonId, mapping: {} },
    'data.csv.import': { previewToken: commonId },
    'data.csv.export': { kind: 'mice' },
    'data.purge.preview': { entityType: 'mouse', entityId: commonId },
    'data.purge.execute': { entityType: 'mouse', entityId: commonId }
  }
  return values[id] ?? {}
}

function makeCase(input: {
  id: string
  category: EvalCategory
  prompt: string
  capabilityIds: readonly string[]
  auditRow?: number
  tags?: readonly string[]
  context?: Partial<EvalContextContract>
  outcome?: AgentEvalCase['expected']['outcome']
  errorClass?: string
  protocolClass?: string
}): AgentEvalCase {
  const calls = input.capabilityIds.map((capabilityId, index) => {
    const [risk, recovery] = policy(capabilityId)
    return { capabilityId, input: argsFor(capabilityId, `${input.id}-${index}`), risk, recovery }
  })
  const recoveryKinds = calls.map((item) => item.recovery)
  const commandRecovery: RecoveryStrategy = recoveryKinds.includes('full-backup')
    ? 'full-backup'
    : recoveryKinds.includes('row-diff')
      ? 'row-diff'
      : recoveryKinds.includes('browser-managed')
        ? 'browser-managed'
        : 'none'
  return {
    id: input.id,
    category: input.category,
    input: input.prompt,
    ...(input.auditRow ? { auditRow: input.auditRow } : {}),
    tags: input.tags ?? [],
    context: { ...FIXED_CONTEXT, ...input.context },
    expected: {
      outcome: input.outcome ?? 'succeeded',
      calls,
      commandRecovery,
      requiresUserGesture: input.capabilityIds.includes('data.file.request'),
      ...(input.errorClass ? { errorClass: input.errorClass } : {}),
      ...(input.protocolClass ? { protocolClass: input.protocolClass } : {})
    }
  }
}

const AUDIT_MAPPINGS: readonly [string, readonly string[]][] = [
  ['打开一级工作区', ['navigation.open']], ['通过总览指标打开预筛选列表', ['navigation.open', 'view.configure']], ['通过总览提醒打开数据、任务或小鼠', ['navigation.open']], ['打开全局新建菜单', ['view.create-menu.open']], ['从新建菜单进入 6 种创建流程', ['navigation.open']], ['打开全局搜索', ['view.search.focus']], ['搜索工作区、小鼠、笼位、实验、任务', ['query.search']], ['从全局搜索打开结果并恢复焦点', ['navigation.open.entity']], ['切换浅色、深色、跟随系统', ['settings.theme.set']], ['离开未保存表单时得到保护', ['navigation.open']],
  ['查看总览统计、分布、容量、任务和活动', ['query.dashboard']], ['搜索小鼠', ['view.configure']], ['按性别筛选小鼠', ['view.configure']], ['按状态筛选小鼠', ['view.configure']], ['按品系/基因型筛选小鼠', ['view.configure']], ['按笼位筛选小鼠', ['view.configure']], ['按实验筛选小鼠', ['view.configure']], ['按标签筛选小鼠', ['view.configure']], ['按出生日期范围筛选小鼠', ['view.configure']], ['包含已删除小鼠', ['view.configure']], ['设置小鼠排序字段与方向', ['view.configure']], ['小鼠分页及每页数量', ['view.configure']], ['清除小鼠筛选', ['view.configure']], ['选择单只、当前页或筛选结果中的小鼠', ['view.configure']], ['创建保存视图', ['saved-view.create']], ['应用保存视图', ['view.configure']], ['更新保存视图', ['saved-view.update']], ['删除保存视图', ['saved-view.delete']],
  ['创建单只小鼠并可初始分笼', ['mouse.create']], ['复制现有小鼠为新记录', ['query.entities', 'mouse.create']], ['原子批量创建小鼠', ['mouse.create.batch']], ['编辑小鼠全部可编辑字段', ['mouse.update']], ['批量更改小鼠状态', ['mouse.status.batch']], ['单只更改小鼠状态', ['mouse.status.set']], ['终结小鼠状态并结束关系', ['mouse.status.set']], ['批量转笼', ['mouse.move.batch']], ['单只移入/转入笼位', ['mouse.move']], ['单只移出笼位', ['mouse.cage.leave']], ['批量增删标签', ['mouse.tags.batch']], ['单只设置标签', ['mouse.tags.set']], ['创建标签并立即关联', ['tag.create', 'mouse.tags.set']], ['删除标签', ['tag.delete']], ['软删除小鼠', ['mouse.delete']], ['从回收站恢复小鼠', ['mouse.restore']], ['查看小鼠详情、谱系、笼位、实验、体重和时间线', ['query.entities', 'navigation.open.entity']], ['创建一般事件', ['event.create']], ['编辑一般事件', ['event.update']], ['软删除事件或配对体重', ['event.delete']], ['从回收站恢复事件或配对体重', ['event.restore']], ['记录单次体重', ['weight.record']], ['快速批量记录体重', ['weight.record.batch']],
  ['搜索笼位', ['query.entities']], ['查看笼位容量、成员和转笼历史', ['query.entities', 'navigation.open.entity']], ['创建笼位', ['cage.create']], ['编辑笼位全部可编辑字段', ['cage.update']], ['从笼位详情选择小鼠移入', ['mouse.move']], ['从笼位详情移出成员', ['mouse.cage.leave']], ['软删除空笼位', ['cage.delete']], ['从回收站恢复笼位', ['cage.restore']], ['查看繁育组合与窝列表', ['query.entities']], ['创建繁育组合并处理规则警告', ['breeding.create']], ['编辑繁育日期、状态和备注', ['breeding.update']], ['原子创建窝和后代', ['breeding.litter.create']], ['查看实验、组别和成员', ['query.entities']], ['创建实验及初始组别', ['experiment.create']], ['编辑实验全部可编辑字段', ['experiment.update']], ['创建实验组别', ['experiment.group.create']], ['批量将小鼠加入实验组', ['experiment.assign.batch']], ['单只加入实验组', ['experiment.assign']], ['单只退出实验', ['experiment.exit']], ['批量退出实验', ['experiment.exit.batch']], ['软删除实验', ['experiment.delete']], ['从回收站恢复实验', ['experiment.restore']],
  ['切换事件、体重、活动日志记录视图', ['view.configure']], ['搜索/按小鼠筛选记录', ['view.configure', 'query.entities']], ['创建任务并关联小鼠/笼位/实验', ['task.create']], ['编辑任务全部可编辑字段', ['task.update']], ['按待处理/完成/取消/全部筛选任务', ['view.configure']], ['完成任务', ['task.status.set']], ['取消任务', ['task.status.set']], ['恢复任务为待处理', ['task.status.set']], ['软删除任务', ['task.delete']], ['从回收站恢复任务', ['task.restore']], ['导出完整 JSON 备份', ['data.backup.export']], ['选择并预检 JSON 恢复文件', ['data.file.request', 'data.backup.preview']], ['用 JSON 替换恢复整个数据库', ['data.backup.restore']], ['选择、解析和预览小鼠 CSV', ['data.file.request', 'data.csv.preview']], ['自动建议并手动修改 CSV 字段映射', ['data.csv.preview']], ['逐行提交合法 CSV 小鼠', ['data.csv.import']], ['导出小鼠 CSV', ['data.csv.export']], ['导出笼位 CSV', ['data.csv.export']], ['导出实验 CSV', ['data.csv.export']], ['导出体重 CSV', ['data.csv.export']], ['导出事件 CSV', ['data.csv.export']], ['从回收站恢复标签', ['tag.restore']],
  ['永久删除回收站小鼠及允许的依赖', ['data.purge.preview', 'data.purge.execute']], ['永久删除回收站笼位', ['data.purge.preview', 'data.purge.execute']], ['永久删除回收站实验', ['data.purge.preview', 'data.purge.execute']], ['永久删除回收站任务', ['data.purge.preview', 'data.purge.execute']], ['永久删除回收站标签', ['data.purge.preview', 'data.purge.execute']], ['永久删除允许删除的事件/体重对', ['data.purge.preview', 'data.purge.execute']], ['生成示例数据批次', ['sample.create']], ['删除指定示例数据批次', ['sample.delete']], ['请求浏览器持久存储', ['settings.storage.persist']], ['查看存储占用、持久状态和数据库版本', ['settings.storage.status']], ['运行数据库完整性扫描', ['query.integrity']]
]

const capabilityCases = AUDIT_MAPPINGS.map(([name, capabilityIds], index) => makeCase({
  id: `CAP-${String(index + 1).padStart(3, '0')}`,
  category: 'capability-mirror',
  prompt: `${name}（能力镜像 ${index + 1}）`,
  capabilityIds,
  auditRow: index + 1,
  tags: ['audit-mirror']
}))

const languageStyles = ['中文', 'English', '中英混合', '口语简写', '轻微错别字', '全半角与空格'] as const
const languageCases = Array.from({ length: 48 }, (_, index) => {
  const style = languageStyles[index % languageStyles.length]!
  const ids = index % 4 === 0 ? ['weight.record'] : index % 4 === 1 ? ['mouse.move.batch'] : index % 4 === 2 ? ['mouse.status.batch'] : ['query.search']
  return makeCase({ id: `LANG-${String(index + 1).padStart(3, '0')}`, category: 'language', prompt: `${style} 变体 ${index + 1}：M ${String(index + 1).padStart(3, '0')} 今儿处理`, capabilityIds: ids, tags: [style] })
})

const contextCases = Array.from({ length: 30 }, (_, index) => {
  const type = index < 6 ? '当前页面' : index < 12 ? '当前选择' : index < 18 ? '最近操作' : index < 22 ? '代词' : index < 28 ? '相对日期' : '时区歧义'
  const ambiguous = index === 21 || index === 29
  return makeCase({
    id: `CTX-${String(index + 1).padStart(3, '0')}`,
    category: 'context-time',
    prompt: `${type}上下文案例 ${index + 1}：处理它们在今天的事项`,
    capabilityIds: ambiguous ? [] : index % 3 === 0 ? ['query.entities'] : index % 3 === 1 ? ['task.create'] : ['view.configure'],
    tags: [type],
    context: { selectedCount: type === '当前选择' ? 1 : ambiguous ? 2 : 0, ...(index === 28 ? { timeZone: 'America/Los_Angeles' } : {}) },
    outcome: ambiguous ? 'failed' : 'succeeded',
    errorClass: ambiguous ? 'ambiguity' : undefined
  })
})

const workflowPatterns: readonly (readonly string[])[] = [
  ['cage.create', 'mouse.create'], ['tag.create', 'mouse.tags.batch'], ['experiment.create', 'experiment.group.create', 'experiment.assign.batch', 'task.create'], ['breeding.create', 'breeding.litter.create'], ['query.entities', 'task.create'], ['query.entities', 'mouse.delete'], ['query.entities', 'mouse.restore', 'navigation.open.entity'], ['query.entities', 'mouse.move.batch']
]
const workflowCases = Array.from({ length: 36 }, (_, index) => makeCase({ id: `FLOW-${String(index + 1).padStart(3, '0')}`, category: 'workflow', prompt: `复合批量工作流 ${index + 1}：按依赖顺序完成全部步骤`, capabilityIds: workflowPatterns[index % workflowPatterns.length]!, tags: [index < 10 ? 'dependent-create' : index < 18 ? 'query-then-write' : index < 26 ? 'batch' : 'cross-domain'] }))

const safetyPatterns: readonly (readonly string[])[] = [['mouse.delete'], ['mouse.restore'], ['data.purge.preview', 'data.purge.execute'], ['task.status.set'], ['mouse.status.batch'], ['cage.create', 'mouse.create']]
const safetyCases = Array.from({ length: 24 }, (_, index) => makeCase({ id: `SAFE-${String(index + 1).padStart(3, '0')}`, category: 'safety-recovery', prompt: `恢复撤回安全案例 ${index + 1}：执行后验证恢复边界${index >= 21 ? '并制造冲突' : ''}`, capabilityIds: safetyPatterns[index % safetyPatterns.length]!, tags: [index >= 21 ? 'undo-conflict' : index >= 12 ? 'batch-undo' : 'undo'] }))

const filePatterns: readonly (readonly string[])[] = [['data.file.request'], ['data.file.request', 'data.backup.preview', 'data.backup.restore'], ['data.file.request', 'data.csv.preview', 'data.csv.import'], ['data.csv.export']]
const fileCases = Array.from({ length: 12 }, (_, index) => makeCase({ id: `FILE-${String(index + 1).padStart(3, '0')}`, category: 'file-gesture', prompt: `文件用户手势案例 ${index + 1}：选择后再继续处理文件`, capabilityIds: filePatterns[index % filePatterns.length]!, tags: [index >= 10 ? 'file-error' : 'two-stage'], outcome: index % 4 === 0 ? 'needs-user-action' : 'succeeded' }))

const failureClasses = ['missing-argument', 'not-found', 'ambiguous', 'business-rule', 'revision-conflict', 'tool-correction', 'partial-completion', 'cancelled', 'round-limit', 'duplicate-call', 'invalid-json', 'secret-redaction', 'capacity', 'deleted-entity', 'non-atomic', 'unknown-tool'] as const
const failureCases = failureClasses.map((errorClass, index) => makeCase({ id: `FAIL-${String(index + 1).padStart(3, '0')}`, category: 'failure', prompt: `失败分类 ${errorClass}：反例 ${index + 1}`, capabilityIds: index === 5 ? ['cage.create'] : [], tags: ['negative'], outcome: index === 5 ? 'succeeded' : 'failed', errorClass }))

const protocolClasses = ['responses-json', 'responses-sse', 'compatible-json', 'compatible-sse', 'chat-json', 'chat-sse', 'auth-401', 'model-404', 'context-400', 'rate-limit-429', 'server-503', 'network-cors', 'timeout-abort', 'stream-interrupted', 'bad-tool-json', 'models-fallback'] as const
const protocolCases = protocolClasses.map((protocolClass, index) => makeCase({ id: `PROTO-${String(index + 1).padStart(3, '0')}`, category: 'protocol', prompt: `协议转录 ${protocolClass}：线级案例 ${index + 1}`, capabilityIds: index < 6 ? ['cage.create'] : [], tags: [index < 6 ? 'equivalent-tool-call' : 'transport-failure'], outcome: index < 6 || index === 15 ? 'succeeded' : 'failed', protocolClass, errorClass: index >= 6 && index < 15 ? protocolClass : undefined }))

export const AGENT_EVAL_CASES: readonly AgentEvalCase[] = [
  ...capabilityCases,
  ...languageCases,
  ...contextCases,
  ...workflowCases,
  ...safetyCases,
  ...fileCases,
  ...failureCases,
  ...protocolCases
]

export const AGENT_EVAL_CATEGORY_COUNTS: Readonly<Record<EvalCategory, number>> = {
  'capability-mirror': 106,
  language: 48,
  'context-time': 30,
  workflow: 36,
  'safety-recovery': 24,
  'file-gesture': 12,
  failure: 16,
  protocol: 16
}
