import { backupBlob, createRestorePreview, exportDatabaseBackup, restoreDatabaseBackup } from '../../backup'
import { scanIntegrity, type MouseKeeperDatabase } from '../../db'
import { MOUSE_SEXES, MOUSE_STATUSES, normalizeText } from '../../domain'
import { createCsvBlob, parseCsvPreview } from '../../import-export/csv'
import { commitMouseImport } from '../../import-export/mouse-import-runner'
import { MOUSE_IMPORT_FIELDS, suggestMouseFieldMapping, validateMouseImport, type MouseFieldMapping } from '../../import-export/mouse-import'
import { downloadBlob } from '../../lib/download'
import { createPurgePreview, purgeDeletedEntity, type MouseKeeperService, type PurgeEntityType } from '../../services'
import { buildCsvExport, type CsvExportKind } from '../data'
import { fileBroker, type FileBroker, type FileWorkflowKind } from '../files'
import { arraySchema, integerSchema, objectSchema, stringSchema, enumSchema, emptyObjectSchema } from './schema'
import { createCoreCapabilityRegistry } from './core-handlers'
import type { CapabilityDescriptor, CapabilityExecutionResult } from './types'
import type { CapabilityRegistry } from './registry'

export const APPLICATION_EVENT_NAMES = {
  navigate: 'mousekeeper:application-navigate',
  focusSearch: 'mousekeeper:application-focus-search',
  openCreateMenu: 'mousekeeper:application-open-create-menu',
  setTheme: 'mousekeeper:application-set-theme',
  view: 'mousekeeper:application-view-command'
} as const

const dateOrEmpty = {
  oneOf: [
    { type: 'string', format: 'date' },
    { const: '' }
  ]
} as const

const miceViewState = objectSchema({
  query: stringSchema(),
  status: enumSchema(['all', ...MOUSE_STATUSES]),
  sex: enumSchema(['all', ...MOUSE_SEXES]),
  strain: stringSchema(), genotype: stringSchema(), cageId: stringSchema(), tagId: stringSchema(), experimentId: stringSchema(),
  birthFrom: dateOrEmpty,
  birthTo: dateOrEmpty,
  includeDeleted: { type: 'boolean' },
  sort: enumSchema(['updated-desc', 'updated-asc', 'label-asc', 'strain-asc', 'age-youngest', 'age-oldest']),
  viewMode: enumSchema(['table', 'cards']),
  page: { ...integerSchema('从 1 开始的页码'), minimum: 1 },
  selectedIds: arraySchema(stringSchema()),
  clear: enumSchema(['none', 'filters', 'selection', 'all'])
})
const recordsViewState = objectSchema({
  tab: enumSchema(['events', 'weights', 'activity']),
  query: stringSchema()
})
const tasksViewState = objectSchema({
  status: enumSchema(['all', 'pending', 'completed', 'cancelled']),
  dueScope: enumSchema(['all', 'today', 'upcoming', 'overdue']),
  relatedKey: stringSchema('all 或 mouse:<id>、cage:<id>、experiment:<id>')
})
const dataViewState = objectSchema({ tab: enumSchema(['backup', 'import', 'export', 'recycle', 'sample']) })
const mouseFieldMappingSchema = objectSchema(
  Object.fromEntries(MOUSE_IMPORT_FIELDS.map((field) => [field, stringSchema('必须精确匹配 CSV 表头')]))
)

const viewConfigureSchema = {
  type: 'object',
  oneOf: [
    objectSchema({ workspace: { const: 'mice' }, state: miceViewState }, ['workspace', 'state']),
    objectSchema({ workspace: { const: 'records' }, state: recordsViewState }, ['workspace', 'state']),
    objectSchema({ workspace: { const: 'tasks' }, state: tasksViewState }, ['workspace', 'state']),
    objectSchema({ workspace: { const: 'data' }, state: dataViewState }, ['workspace', 'state'])
  ]
} as const

function dispatch(name: string, detail: unknown): boolean {
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    return globalThis.dispatchEvent(new CustomEvent(name, { detail, cancelable: true }))
  }
  return true
}

function timestampFilename(prefix: string, extension: string): string {
  return `${prefix}-${new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')}.${extension}`
}

function descriptor(input: Partial<CapabilityDescriptor> & Pick<CapabilityDescriptor, 'id' | 'domain' | 'name' | 'description' | 'kind' | 'inputSchema' | 'outputDescription' | 'reads' | 'writes' | 'modifiesData' | 'supportsBatch' | 'risk' | 'recovery' | 'service'>): CapabilityDescriptor {
  return {
    version: 1,
    requiredContext: [],
    errorTypes: ['validation', 'not-found', 'browser', 'business-rule'],
    preconditions: [],
    testLocations: ['src/application/capabilities/extended-handlers.test.ts'],
    llmExposed: true,
    ...input
  }
}

export const EXTENDED_CAPABILITY_DESCRIPTORS: readonly CapabilityDescriptor[] = [
  descriptor({
    id: 'navigation.open', domain: 'navigation', name: '打开页面', description: '通过稳定应用路由打开任意工作区或已知子路由。',
    kind: 'navigation', inputSchema: objectSchema({ href: stringSchema('必须是以 / 开头的应用内路由') }, ['href']), outputDescription: '打开的路由', reads: [], writes: [], modifiesData: false, supportsBatch: false, risk: 'view-only', recovery: 'none', service: 'NavigationAdapter'
  }),
  descriptor({
    id: 'navigation.open.entity', domain: 'navigation', name: '打开实体详情', description: '打开小鼠、笼位、繁育组合或实验详情。',
    kind: 'navigation', inputSchema: objectSchema({ entityType: enumSchema(['mouse', 'cage', 'breedingPair', 'experiment']), entityId: stringSchema() }, ['entityType', 'entityId']), outputDescription: '详情路由', reads: [], writes: [], modifiesData: false, supportsBatch: false, risk: 'view-only', recovery: 'none', service: 'NavigationAdapter'
  }),
  descriptor({
    id: 'view.search.focus', domain: 'views', name: '聚焦全局搜索', description: '打开并聚焦全局搜索命令框。',
    kind: 'view', inputSchema: emptyObjectSchema, outputDescription: '搜索框已打开', reads: [], writes: [], modifiesData: false, supportsBatch: false, risk: 'view-only', recovery: 'none', service: 'ViewStateAdapter'
  }),
  descriptor({
    id: 'view.create-menu.open', domain: 'views', name: '打开全局新建菜单', description: '打开与顶部和移动端新建按钮相同的 Radix 菜单。',
    kind: 'view', inputSchema: emptyObjectSchema, outputDescription: '新建菜单已打开', reads: [], writes: [], modifiesData: false, supportsBatch: false, risk: 'view-only', recovery: 'none', service: 'CreateMenuAdapter'
  }),
  descriptor({
    id: 'view.configure', domain: 'views', name: '设置页面筛选排序和标签', description: '按工作区设置与页面组件完全一致的扁平视图状态；不接受嵌套 filters。',
    kind: 'view', inputSchema: viewConfigureSchema, outputDescription: '已应用的视图状态', reads: [], writes: ['local view state'], modifiesData: true, supportsBatch: true, risk: 'reversible', recovery: 'row-diff', service: 'ViewStateAdapter'
  }),
  descriptor({
    id: 'settings.theme.set', domain: 'settings', name: '切换主题', description: '切换浅色、深色或跟随系统。',
    kind: 'view', inputSchema: objectSchema({ theme: enumSchema(['light', 'dark', 'system']) }, ['theme']), outputDescription: '实际主题偏好', reads: [], writes: ['localStorage theme preference'], modifiesData: true, supportsBatch: false, risk: 'reversible', recovery: 'row-diff', service: 'ThemeAdapter'
  }),
  descriptor({
    id: 'settings.storage.persist', domain: 'settings', name: '请求持久存储', description: '请求浏览器尽量不要自动清理本地数据库。',
    kind: 'browser', inputSchema: emptyObjectSchema, outputDescription: '浏览器持久存储结果', reads: ['StorageManager'], writes: ['browser storage policy'], modifiesData: true, supportsBatch: false, risk: 'view-only', recovery: 'browser-managed', service: 'navigator.storage.persist'
  }),
  descriptor({
    id: 'settings.storage.status', domain: 'settings', name: '查看存储状态', description: '查看配额、用量、持久状态、业务记录数和数据库完整性摘要。',
    kind: 'query', inputSchema: emptyObjectSchema, outputDescription: '存储与数据库状态', reads: ['StorageManager', 'all business tables'], writes: [], modifiesData: false, supportsBatch: false, risk: 'read-only', recovery: 'none', service: 'StorageManager + scanIntegrity'
  }),
  descriptor({
    id: 'data.backup.export', domain: 'data', name: '下载完整备份', description: '验证并下载包含 16 张业务表的完整 JSON 备份；不包含 Agent 密钥。',
    kind: 'file', inputSchema: emptyObjectSchema, outputDescription: '备份下载产物', reads: ['all business tables'], writes: ['backupMetadata'], modifiesData: true, supportsBatch: false, risk: 'reversible', recovery: 'row-diff', service: 'exportDatabaseBackup'
  }),
  descriptor({
    id: 'data.csv.export', domain: 'data', name: '下载 CSV', description: '导出小鼠、笼位、实验、体重或事件 CSV。',
    kind: 'file', inputSchema: objectSchema({ kind: enumSchema(['mice', 'cages', 'experiments', 'weights', 'events']) }, ['kind']), outputDescription: 'CSV 下载产物', reads: ['selected business tables'], writes: [], modifiesData: false, supportsBatch: true, risk: 'read-only', recovery: 'none', service: 'buildCsvExport'
  }),
  descriptor({
    id: 'data.file.request', domain: 'data', name: '请求用户选择导入文件', description: '准备 JSON 恢复或 CSV 导入文件流程。浏览器要求用户手势，返回 fileRequestId 后由 Agent 界面显示选择按钮。',
    kind: 'file', inputSchema: objectSchema({ kind: enumSchema(['backup-restore', 'csv-import']) }, ['kind']), outputDescription: '文件请求及 accept 类型', reads: [], writes: ['ephemeral file broker'], modifiesData: false, supportsBatch: false, risk: 'view-only', recovery: 'none', requiresUserGesture: true, service: 'FileBroker'
  }),
  descriptor({
    id: 'data.backup.preview', domain: 'data', name: '预览完整备份恢复', description: '只读验证用户选择的 JSON 备份并显示替换影响。不写入数据库；如果原始指令明确要求恢复，可用返回的一次性 previewToken 继续提交。',
    kind: 'file', inputSchema: objectSchema({ fileRequestId: stringSchema() }, ['fileRequestId']), outputDescription: '备份摘要、问题和一次性 previewToken', reads: ['selected File'], writes: ['ephemeral file broker'], modifiesData: false, supportsBatch: true, risk: 'read-only', recovery: 'none', service: 'createRestorePreview'
  }),
  descriptor({
    id: 'data.backup.restore', domain: 'data', name: '提交完整备份恢复', description: '仅接受同一用户选择文件的已预览一次性 previewToken，重新验证后全库替换并下载恢复前安全副本。',
    kind: 'file', inputSchema: objectSchema({ previewToken: stringSchema() }, ['previewToken']), outputDescription: '恢复摘要和安全备份', reads: ['previewed selected File', 'all business tables'], writes: ['all business tables'], modifiesData: true, supportsBatch: true, risk: 'high-impact', recovery: 'full-backup', service: 'restoreDatabaseBackup'
  }),
  descriptor({
    id: 'data.csv.preview', domain: 'data', name: '预览小鼠 CSV 导入', description: '只读解析、映射并校验用户选择的 CSV。不写入数据库；映射会固化在一次性 previewToken 中，如果原始指令明确要求导入则可继续提交。',
    kind: 'file', inputSchema: objectSchema({ fileRequestId: stringSchema(), mapping: mouseFieldMappingSchema }, ['fileRequestId']), outputDescription: '表头、映射、合法/非法/警告行数与一次性 previewToken', reads: ['selected File', 'mice'], writes: ['ephemeral file broker'], modifiesData: false, supportsBatch: true, risk: 'read-only', recovery: 'none', service: 'parseCsvPreview + validateMouseImport'
  }),
  descriptor({
    id: 'data.csv.import', domain: 'data', name: '提交小鼠 CSV 导入', description: '仅接受同一用户选择文件的已预览一次性 previewToken；使用预览时固化的映射重新校验并提交合法记录。',
    kind: 'file', inputSchema: objectSchema({ previewToken: stringSchema() }, ['previewToken']), outputDescription: '逐行导入报告', reads: ['previewed selected File', 'mice', 'cages', 'tags'], writes: ['mice', 'tags', 'cageAssignments', 'mouseEvents', 'activityLogs'], modifiesData: true, supportsBatch: true, risk: 'high-impact', recovery: 'full-backup', service: 'commitMouseImport'
  }),
  descriptor({
    id: 'data.purge.preview', domain: 'data', name: '预览永久删除影响', description: '检查回收站实体的引用阻塞和将删除的记录数。',
    kind: 'query', inputSchema: objectSchema({ entityType: enumSchema(['mouse', 'cage', 'experiment', 'task', 'tag', 'mouseEvent']), entityId: stringSchema() }, ['entityType', 'entityId']), outputDescription: '永久删除预览', reads: ['recycle bin and relationships'], writes: [], modifiesData: false, supportsBatch: false, risk: 'read-only', recovery: 'none', service: 'createPurgePreview'
  }),
  descriptor({
    id: 'data.purge.execute', domain: 'data', name: '永久删除回收站实体', description: '重新预检后永久删除一个回收站实体。执行器会先创建完整恢复点。',
    kind: 'command', inputSchema: objectSchema({ entityType: enumSchema(['mouse', 'cage', 'experiment', 'task', 'tag', 'mouseEvent']), entityId: stringSchema() }, ['entityType', 'entityId']), outputDescription: '永久删除计数', reads: ['recycle bin and relationships'], writes: ['selected entity and dependencies', 'activityLogs'], modifiesData: true, supportsBatch: false, risk: 'irreversible', recovery: 'full-backup', service: 'purgeDeletedEntity'
  })
]

export interface ExtendedCapabilityDependencies {
  fileBroker?: FileBroker
}

export function registerExtendedCapabilities(
  registry: CapabilityRegistry,
  database: MouseKeeperDatabase,
  service: MouseKeeperService,
  dependencies: ExtendedCapabilityDependencies = {}
): CapabilityRegistry {
  const files = dependencies.fileBroker ?? fileBroker
  for (const item of EXTENDED_CAPABILITY_DESCRIPTORS) {
    registry.register(item, {
      async execute(input, context): Promise<CapabilityExecutionResult> {
        if (item.id === 'navigation.open') {
          const href = String(input.href)
          if (!href.startsWith('/') || href.startsWith('//')) throw new Error('只能打开应用内路由')
          if (!dispatch(APPLICATION_EVENT_NAMES.navigate, { href })) throw new Error('用户取消离开未保存表单')
          return { status: 'succeeded', capabilityId: item.id, summary: `已打开 ${href}`, data: { href }, affected: [], warnings: [], modifiesData: false, open: { href, label: '打开页面' } }
        }
        if (item.id === 'navigation.open.entity') {
          const prefixes: Record<string, string> = { mouse: '/mice', cage: '/cages', breedingPair: '/breeding', experiment: '/experiments' }
          const href = `${prefixes[String(input.entityType)]}/${encodeURIComponent(String(input.entityId))}`
          if (!dispatch(APPLICATION_EVENT_NAMES.navigate, { href })) throw new Error('用户取消离开未保存表单')
          return { status: 'succeeded', capabilityId: item.id, summary: '已打开记录详情', data: { href }, affected: [], warnings: [], modifiesData: false, open: { href, label: '打开记录' } }
        }
        if (item.id === 'view.search.focus') {
          dispatch(APPLICATION_EVENT_NAMES.focusSearch, {})
          return { status: 'succeeded', capabilityId: item.id, summary: '已打开全局搜索', affected: [], warnings: [], modifiesData: false }
        }
        if (item.id === 'view.create-menu.open') {
          dispatch(APPLICATION_EVENT_NAMES.openCreateMenu, {})
          return { status: 'succeeded', capabilityId: item.id, summary: '已打开全局新建菜单', affected: [], warnings: [], modifiesData: false }
        }
        if (item.id === 'view.configure') {
          const state = input.state && typeof input.state === 'object' && !Array.isArray(input.state) ? input.state : {}
          const workspace = String(input.workspace)
          globalThis.window?.localStorage.setItem(`mousekeeper:view-command:${workspace}`, JSON.stringify(state))
          dispatch(APPLICATION_EVENT_NAMES.view, { workspace, state })
          return { status: 'succeeded', capabilityId: item.id, summary: `已更新 ${workspace} 视图`, data: { workspace, state }, affected: [], warnings: [], modifiesData: true }
        }
        if (item.id === 'settings.theme.set') {
          const theme = String(input.theme)
          globalThis.window?.localStorage.setItem('mousekeeper:theme:v1', theme)
          dispatch(APPLICATION_EVENT_NAMES.setTheme, { theme })
          return { status: 'succeeded', capabilityId: item.id, summary: `主题已切换为 ${theme}`, data: { theme }, affected: [], warnings: [], modifiesData: true }
        }
        if (item.id === 'settings.storage.persist') {
          if (!navigator.storage?.persist) throw new Error('当前浏览器不支持持久存储请求')
          const persistent = await navigator.storage.persist()
          return { status: 'succeeded', capabilityId: item.id, summary: persistent ? '浏览器已授予持久存储' : '浏览器未授予持久存储', data: { persistent }, affected: [], warnings: [], modifiesData: true }
        }
        if (item.id === 'settings.storage.status') {
          const [estimate, persistent, integrity, counts] = await Promise.all([
            navigator.storage?.estimate?.(),
            navigator.storage?.persisted?.(),
            scanIntegrity(database),
            Promise.all(database.tables.map((table) => table.count()))
          ])
          const data = { estimate, persistent, integrity, tableCount: database.tables.length, recordCount: counts.reduce((sum, count) => sum + count, 0) }
          return { status: 'succeeded', capabilityId: item.id, summary: integrity.ok ? '存储与完整性状态正常' : `发现 ${integrity.issues.length} 个完整性问题`, data, affected: [], warnings: [], modifiesData: false }
        }
        if (item.id === 'data.backup.export') {
          await service.ensureAppSettings()
          const backup = await exportDatabaseBackup(database)
          const blob = backupBlob(backup)
          const name = timestampFilename('mousekeeper-backup', 'json')
          await downloadBlob(blob, name)
          return { status: 'succeeded', capabilityId: item.id, summary: `已下载完整备份，共 ${Object.values(backup.tableCounts).reduce((sum, count) => sum + count, 0)} 条记录`, data: { fileName: name, tableCounts: backup.tableCounts, checksum: backup.integrity.canonicalPayloadDigest }, affected: [], artifacts: [{ id: crypto.randomUUID(), name, mediaType: blob.type, size: blob.size, kind: 'download' }], warnings: [], modifiesData: true }
        }
        if (item.id === 'data.csv.export') {
          const kind = String(input.kind) as CsvExportKind
          const output = await buildCsvExport(database, kind)
          const blob = createCsvBlob(output.csv)
          const name = timestampFilename(`mousekeeper-${kind}`, 'csv')
          await downloadBlob(blob, name)
          return { status: 'succeeded', capabilityId: item.id, summary: `已导出 ${output.rowCount} 行 ${kind} CSV`, data: { kind, rowCount: output.rowCount, fileName: name }, affected: [], artifacts: [{ id: crypto.randomUUID(), name, mediaType: blob.type, size: blob.size, kind: 'download' }], warnings: [], modifiesData: false }
        }
        if (item.id === 'data.file.request') {
          const request = files.request(String(input.kind) as FileWorkflowKind)
          return { status: 'needs-user-action', capabilityId: item.id, summary: request.kind === 'backup-restore' ? '请选择 MouseKeeper JSON 备份文件' : '请选择小鼠 CSV 文件', data: request, affected: [], artifacts: [{ id: request.id, name: request.kind === 'backup-restore' ? '选择 JSON 备份' : '选择 CSV 文件', mediaType: request.accept, size: 0, kind: 'file-request' }], warnings: ['浏览器要求用户点击文件选择按钮'], modifiesData: false }
        }
        if (item.id === 'data.backup.preview') {
          const requestId = String(input.fileRequestId)
          const file = files.preview(requestId, 'backup-restore')
          const preview = await createRestorePreview(file)
          if (!preview.canRestore) throw new Error(`备份预检失败：${preview.issues.map((issue) => issue.message).join('；')}`)
          const authorization = files.authorizePreview(requestId, 'backup-restore')
          return {
            status: 'prepared', capabilityId: item.id,
            summary: `备份预览完成：将用 ${preview.summary?.totalRecords ?? 0} 条备份记录替换当前数据库，尚未写入`,
            data: { previewToken: authorization.id, summary: preview.summary, issues: preview.issues },
            affected: [],
            warnings: ['预览不会修改数据；仅原始指令明确要求恢复时才应继续提交'], modifiesData: false
          }
        }
        if (item.id === 'data.backup.restore') {
          const { file } = files.consumeAuthorized(String(input.previewToken), 'backup-restore')
          const preview = await createRestorePreview(file)
          if (!preview.canRestore) throw new Error(`备份重新验证失败：${preview.issues.map((issue) => issue.message).join('；')}`)
          const restored = await restoreDatabaseBackup(database, file)
          const safetyBlob = backupBlob(restored.preRestoreBackup)
          const name = timestampFilename('mousekeeper-exact-before-agent-restore', 'json')
          await downloadBlob(safetyBlob, name)
          return { status: 'succeeded', capabilityId: item.id, summary: `已恢复 ${preview.summary?.totalRecords ?? 0} 条记录，并下载恢复前安全副本`, data: { preview: preview.summary, safetyFileName: name }, affected: [], artifacts: [{ id: crypto.randomUUID(), name, mediaType: safetyBlob.type, size: safetyBlob.size, kind: 'download' }], warnings: [], modifiesData: true }
        }
        if (item.id === 'data.csv.preview') {
          const requestId = String(input.fileRequestId)
          const file = files.preview(requestId, 'csv-import')
          if (file.size > 20 * 1024 * 1024) throw new Error('CSV 文件超过 20 MB，请拆分后导入')
          const csv = parseCsvPreview(await file.text())
          const mapping = input.mapping && typeof input.mapping === 'object' && Object.keys(input.mapping).length > 0
            ? input.mapping as MouseFieldMapping
            : suggestMouseFieldMapping(csv.headers)
          const mice = await database.mice.toArray()
          const preview = validateMouseImport(csv, mapping, {
            existingIds: new Set(mice.map((mouse) => normalizeText(mouse.id))),
            existingEarTags: new Set(mice.flatMap((mouse) => mouse.deletedFlag === 0 && mouse.earTag ? [normalizeText(mouse.earTag)] : []))
          })
          if (preview.validCount === 0) throw new Error('CSV 没有可导入的合法行')
          const authorization = files.authorizePreview(requestId, 'csv-import', { mapping })
          return {
            status: 'prepared', capabilityId: item.id,
            summary: `CSV 预览完成：合法 ${preview.validCount}、非法 ${preview.invalidCount}、警告 ${preview.warningCount}，尚未写入`,
            data: { previewToken: authorization.id, headers: csv.headers, mapping, validCount: preview.validCount, invalidCount: preview.invalidCount, warningCount: preview.warningCount, rows: preview.rows.slice(0, 20) },
            affected: [],
            warnings: [...(preview.invalidCount > 0 ? [`${preview.invalidCount} 行不合法，提交时会跳过`] : []), '预览不会修改数据；仅原始指令明确要求导入时才应继续提交'],
            modifiesData: false
          }
        }
        if (item.id === 'data.csv.import') {
          const { file, metadata } = files.consumeAuthorized(String(input.previewToken), 'csv-import')
          if (file.size > 20 * 1024 * 1024) throw new Error('CSV 文件超过 20 MB，请拆分后导入')
          const csv = parseCsvPreview(await file.text())
          const mapping = metadata.mapping as MouseFieldMapping
          if (!mapping || typeof mapping !== 'object') throw new Error('CSV 预览映射已失效')
          const mice = await database.mice.toArray()
          const preview = validateMouseImport(csv, mapping, {
            existingIds: new Set(mice.map((mouse) => normalizeText(mouse.id))),
            existingEarTags: new Set(mice.flatMap((mouse) => mouse.deletedFlag === 0 && mouse.earTag ? [normalizeText(mouse.earTag)] : []))
          })
          if (preview.validCount === 0) throw new Error('CSV 在提交前重新校验后没有可导入的合法行')
          const report = await commitMouseImport(database, service, preview)
          return { status: 'succeeded', capabilityId: item.id, summary: `CSV 导入完成：成功 ${report.importedCount}、跳过 ${report.skippedCount}、失败 ${report.failedCount}`, data: report, affected: report.rows.flatMap((row) => row.mouseId ? [{ type: 'mouse', id: row.mouseId, href: `/mice/${row.mouseId}` }] : []), warnings: report.failedCount > 0 ? ['部分 CSV 行导入失败，详情见结果'] : [], modifiesData: true }
        }
        if (item.id === 'data.purge.preview') {
          const preview = await createPurgePreview(database, String(input.entityType) as PurgeEntityType, String(input.entityId))
          return { status: 'succeeded', capabilityId: item.id, summary: preview.canPurge ? `可永久删除，将删除 ${Object.values(preview.deleteCounts).reduce((sum, count) => sum + count, 0)} 条记录` : `不可永久删除：${preview.blockers.join('；')}`, data: preview, affected: [], warnings: preview.blockers, modifiesData: false }
        }
        if (item.id === 'data.purge.execute') {
          const preview = await createPurgePreview(database, String(input.entityType) as PurgeEntityType, String(input.entityId))
          if (!preview.canPurge) throw new Error(`仍有引用，不能永久删除：${preview.blockers.join('；')}`)
          const count = await purgeDeletedEntity(database, preview, context.operationId)
          return { status: 'succeeded', capabilityId: item.id, summary: `已永久删除 ${count} 条记录；完整恢复点已在执行前创建`, data: { count, preview }, affected: [{ type: preview.entityType, id: preview.entityId, label: preview.label }], warnings: [], modifiesData: true }
        }
        throw new Error(`扩展能力没有 handler：${item.id}`)
      }
    })
  }
  return registry
}

export function createApplicationCapabilityRegistry(
  database: MouseKeeperDatabase,
  service: MouseKeeperService,
  dependencies?: ExtendedCapabilityDependencies
): CapabilityRegistry {
  return registerExtendedCapabilities(
    createCoreCapabilityRegistry(database, service),
    database,
    service,
    dependencies
  )
}
