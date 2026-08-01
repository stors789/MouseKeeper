# Capability / Application Registry 架构审查

审查日期：2026-08-01  
审查角色：独立服务与注册表架构审查  
约束：本次只读业务源码与测试；未修改业务源码、配置、依赖或 Git 历史。

## 1. 结论

最小侵入方案不是“把 `MouseKeeperService` 的每个方法直接变成 LLM tool”，而是在现有 domain / db / service 之上新增一层 **Application Capability Registry**。该层同时成为 React UI 与 LLM Agent 的应用操作入口，并统一承担：公开参数校验、实体解析、幂等请求指纹、风险与确认、影响记录、结果展示、恢复日志、导航和文件交付。

现有 `MouseKeeperService` 应继续作为业务写入内核，不应重写。它已经提供事务、结构化错误、warning acknowledgement、operationId 幂等和部分 revision 乐观锁。注册表补足的是“应用动作”而非复制业务规则：

```text
React UI ─┐
          ├─> CapabilityExecutor ─> MouseKeeperService / named queries
LLM Agent ┘            │             backup/import/purge application services
                       ├─> NavigationAdapter / ViewStateAdapter
                       ├─> FileBroker（用户提供的 FileToken、待下载 Artifact）
                       └─> CommandRun + RecoveryJournal
```

注册表必须拆成两部分：可序列化的 `CapabilityDescriptor` 与不可序列化的 `CapabilityHandler`。LLM 只能看到经过筛选的 descriptor 与公开 input schema，不能拿到 Dexie、`MouseKeeperService`、浏览器 DOM、文件对象、operationId、revision 或内部 warning acknowledgement 字段。

## 2. 审查范围

本次检查以下真实实现边界：

- 领域实体、状态枚举、revision / deletedFlag / origin 等存储协议；
- `MouseKeeperService` 的公开命令、命令输入、事务、幂等、warning、审计与复合命令；
- 永久删除、备份恢复、CSV 导入导出等未完全归入 `MouseKeeperService` 的应用动作；
- React 路由、导航、创建菜单、全局搜索、设置与主要业务页面的读写调用方式；
- 服务、备份、导入和永久删除测试所覆盖的约束；
- 当前架构文档所声明的依赖方向。

本次没有实现注册表，也没有运行浏览器交互、性能压测或完整测试套件；这些属于后续实施与验证。

## 3. 阅读文件

完整或针对性阅读了：

- `src/domain/types.ts`
- `src/services/types.ts`
- `src/services/errors.ts`
- `src/services/index.ts`
- `src/services/mousekeeper-service.ts`
- `src/services/permanent-delete.ts`
- `src/db/database.ts`
- `src/app/runtime.ts`
- `src/App.tsx`
- `src/layout/navigation.ts`
- `src/layout/CreateMenu.tsx`
- `src/layout/GlobalSearchDialog.tsx`
- `src/queries/search.ts`
- `src/queries/dashboard.ts`
- `src/features/mice/MicePage.tsx`
- `src/features/data/DataPage.tsx`
- `src/features/settings/SettingsPage.tsx`
- `src/backup/backup.ts`
- `src/services/mousekeeper-service.test.ts`
- `src/services/permanent-delete.test.ts`
- `src/import-export/mouse-import-runner.test.ts`
- `src/backup/backup.test.ts`
- `docs/architecture.md`
- `docs/data-model.md`
- `package.json`

此外使用 `rg` 检查了全部 feature / layout / query / import-export / backup 下的 `appService`、Dexie 读写和页面入口引用。

## 4. 当前代码证据

### 4.1 服务层适合作为写入内核

- `MouseKeeperService` 集中持有数据库依赖：`src/services/mousekeeper-service.ts:304-309`。
- `activeRecord` 统一处理不存在与已删除记录：同文件 `311-330`。
- `assertRevision` 返回稳定的 `revision-conflict`：同文件 `332-340`。
- `operationLog` 通过唯一 operationId 查重，并阻止同一个 ID 被不同 action 复用：同文件 `342-358`。
- `addActivity` 写入 action、实体引用、changedFields、warnings、resultEntityIds 与 metadata：同文件 `371-403`。
- `createMouse` 在一个 Dexie 写事务里完成校验、写实体与审计，重放返回原结果：同文件 `562-662`。
- `moveMouse` 同一事务更新旧分笼、创建新分笼与事件、更新 `Mouse.currentCageId`，并在超容量时要求结构化 warning acknowledgement：同文件 `1274-1425`。
- 复合命令已经存在：`createMouseWithCage`（`664-721`）、`createMice`（`723` 起）、`createLitterWithOffspring`（`1973` 起）、`createExperimentWithInitialGroup`（`2302` 起）、批量状态/分笼/标签/实验分配/退出/体重。
- 服务测试覆盖幂等、超容量 warning、复合事务、批处理、revision、繁育、互斥实验组、终结状态、体重/事件原子性、软删恢复和示例批次。

因此，注册表 handler 应调用现有服务方法；不能在 handler 或 agent prompt 中重写耳标唯一性、谱系、容量、繁育状态机、实验互斥或关系关闭规则。

### 4.2 “用户能力”不等于 `MouseKeeperService` 方法集合

当前应用能力还分散在下列边界：

- 只读检索在 `src/queries/search.ts:25-133`，页面详情和列表则直接组合 Dexie 查询；若 LLM 自己另写查询，会出现读取语义的影子实现。
- 路由、工作区关键词、创建入口、页面标题分别集中在 `src/layout/navigation.ts`，但路由模板本身仍在 `src/App.tsx`；两者尚未形成同一应用清单。
- 完整备份、恢复预检与覆盖恢复在 `src/backup/backup.ts`；`DataPage` 在 `238-309` 组合了确保设置、导出、浏览器下载、恢复和恢复前备份下载。
- CSV 选择、解析、字段映射、校验和提交由 `DataPage` 在 `312-348` 编排；CSV 导出数据投影与下载在 `350-468` 页面内实现。
- 回收站恢复在 `DataPage:470-515` 以 type switch 分派到六个服务方法；这个 switch 是应迁入 application capability 的现成重复逻辑。
- 永久删除是独立 application service。`createPurgePreview` 读取引用与阻塞条件（`src/services/permanent-delete.ts:37` 起），`purgeDeletedEntity` 在全表事务中直接写 Dexie 并留下审计（`256-327`）。它不属于 `MouseKeeperService`，但确实是 UI 能力。
- 设置页包含 localStorage 主题、浏览器 storage persistence API、完整性扫描与数据库统计，均不是 `MouseKeeperService` 命令。

所以，只枚举 public service methods 会漏掉查询、导航、视图状态、备份、恢复、导入、导出、完整性扫描、浏览器存储请求和永久删除；也无法达到 UI / LLM 共用。

### 4.3 当前 UI 写入大体守住服务边界，但应用编排仍在页面

业务页面的常规写入均调用 `appService`。例如：

- 小鼠批量状态/分笼/标签与保存视图在 `MicePage`；
- 小鼠详情的状态、分笼、事件、体重、标签与软删除在 `MouseDetailPage`；
- 实验详情的建组、批量加入/退出和软删除在 `ExperimentDetailPage`；
- 笼位、任务和表单页也调用服务。

页面中的 Dexie 使用主要是读取。例外是备份恢复基础设施和永久删除模块，它们是有意的集中式全库/物理删除实现，不应被 LLM 直接调用数据库取代。后续迁移应让 UI 和 LLM 都通过 registry handler 使用这些模块，而不是强行把所有逻辑塞入 `MouseKeeperService`。

### 4.4 现有幂等仍需应用层请求指纹

`operationLog` 只校验 operationId 对应的 `action`，没有存储或比较规范化输入摘要。也就是说，同一 operationId、同一 action、不同参数会重放首次结果，而不是明确报告输入不一致。注册表必须持久化：

- `commandRunId` / `operationId`；
- capability id + version；
- canonical resolved input digest；
- actor / source；
- 状态、warning acknowledgement；
- before / after 影响与恢复引用。

同一 commandRunId 再次执行时必须比较 capability version 与 input digest；不一致即拒绝。不要把这个缺口留给 provider 重试策略。

### 4.5 revision 覆盖并不一致

更新、软删、恢复和部分批量操作使用 expectedRevision；但 `MoveMouseInput` / `MoveMiceInput`、`LeaveCageInput` 等关系命令没有统一暴露 expectedRevision。注册表不能假设每个服务方法都已经提供完整 undo 冲突条件。恢复日志需要独立记录每个受影响记录的 before revision / after revision（必要时加 canonical digest），撤销前逐项核对当前状态。

## 5. 推荐的最小侵入目录与依赖

建议新增以下 application 层，不移动现有 domain / db / service：

```text
src/application/
  capabilities/
    types.ts              # descriptor、结果、影响、确认、恢复类型
    schemas.ts            # 对 UI/LLM 公开的输入 Zod schema
    catalog.ts            # 纯可序列化 descriptor 列表
    registry.ts           # descriptor/handler 一一配对与筛选
    executor.ts           # 解析、确认、幂等、执行、结果与恢复编排
    handlers/
      mice.ts cages.ts breeding.ts experiments.ts records.ts tasks.ts
      data.ts settings.ts navigation.ts views.ts
  queries/                # 页面与 agent 共用的命名查询；不返回 Dexie 对象
  entity-resolution/      # 唯一标识解析、歧义候选与引用快照
  recovery/               # CommandRun、RecoveryJournal、undo conflict check
  files/                  # FileToken / PreparedArtifact broker
  navigation/             # route descriptor + NavigationAdapter
  runtime.ts              # 注入 db/service/clock/id/navigation/files/viewState
```

依赖方向：

```text
domain <- db <- services <- application <- UI
                         ^ application <- agent
```

`application` 可以调用现有 `backup`、`import-export`、`permanent-delete` 模块；这些模块不能反向依赖 agent 或 React。React hooks 只能在 UI adapter 中，registry 核心保持无 React、无 provider 依赖，可在 fake-indexeddb 中测试。

## 6. 类型边界

### 6.1 Descriptor 与 Handler 必须分离

建议的核心形状（示意，不是要求逐字实现）：

```ts
type CapabilityKind = 'query' | 'command' | 'navigation' | 'view' | 'file'
type RiskLevel = 'read-only' | 'view-only' | 'reversible' | 'high-impact' | 'irreversible'

interface CapabilityDescriptor {
  id: string                    // 稳定，如 mouse.move.batch
  version: number
  kind: CapabilityKind
  title: string
  description: string
  inputSchemaId: string         // 对应受版本控制的 Zod schema
  exposure: { ui: boolean; llm: boolean }
  permission: {
    risk: RiskLevel
    confirmation: 'none' | 'warnings' | 'explicit' | 'typed-phrase'
    requiresUserGesture?: boolean
  }
  impact: {
    reads: readonly ResourcePattern[]
    writes: readonly ResourcePattern[]
    cardinality: 'one' | 'many' | 'database'
  }
  recovery: RecoveryPolicy
  navigation?: NavigationOutcomeTemplate
}

interface CapabilityHandler<I, O> {
  input: z.ZodType<I>
  execute(ctx: ExecutionContext, input: I): Promise<ExecutionOutcome<O>>
}
```

理由：descriptor 可以安全提供给 UI、LLM tool builder、能力审计和测试；handler closure 含有 db/service/file/navigation，不能序列化、更不能暴露给模型。registry 启动时应检查 ID 唯一、schema 存在、descriptor/handler 一一对应、LLM exposure 与风险策略合法。

### 6.2 公开输入不能直接复用 Service Input

`CommandContext` 含 operationId、now、origin、sampleBatchId、importBatchId、warningAcknowledgements。这些是可信执行上下文，不应成为模型参数。建议：

```ts
interface ExecutionEnvelope {
  commandRunId: string
  actor: 'ui' | 'llm' | 'system'
  sessionId?: string
  warningAcknowledgements?: readonly string[]
  explicitConfirmation?: ConfirmationToken
}
```

公开 schema 只描述用户意图。handler 通过注入的 clock / idFactory 生成 `now`、operationId 与 provenance，并在中央实体解析后读取最新 revision。UI 也提交同一个公开 schema，不再自己拼 service context。

公开实体引用应支持稳定 ID 和人类标识，但不能在每个 handler 重写查找：

```ts
type MouseRef =
  | { by: 'id'; id: string }
  | { by: 'earTag'; earTag: string }
  | { by: 'experimentNumber'; experimentNumber: string }
```

解析结果必须是 `resolved`、`not_found` 或 `ambiguous`。歧义时返回候选及详情链接，绝不猜测后写入。resolved input（ID + 当前 revision）只存在于 executor 内部，并进入 input digest 与 recovery journal。

### 6.3 统一结果模型

建议所有来源都消费同一种结果：

```ts
type ExecutionOutcome<T> =
  | { status: 'succeeded'; summary: string; data: T; affected: AffectedEntity[];
      artifacts?: PreparedArtifact[]; recovery?: RecoveryReceipt; open?: NavigationTarget }
  | { status: 'needs-confirmation'; warnings: CapabilityWarning[]; preview: ImpactPreview }
  | { status: 'needs-selection'; candidates: EntityCandidate[] }
  | { status: 'failed'; error: ApplicationError }
```

`AffectedEntity` 至少包含 type、id、label、href、beforeRevision、afterRevision 与 change kind。LLM 回答、Agent UI 的“打开受影响项 / 撤销 / 详情”和普通 UI toast 都由这个结果渲染，避免两套成功文案和影响计算。

`ApplicationError` 应保留 `ServiceError.code`，并映射为稳定、可本地化、可恢复的类型；不能让 Agent 依赖英文 error message 字符串。

## 7. 能力描述、权限、影响与恢复信息

### 7.1 能力粒度

注册表应以用户目标而非数据库表或服务方法机械分割。例如：

- `mouse.create`、`mouse.create.batch`、`mouse.create.with-cage`；
- `mouse.status.change`、`mouse.status.change.batch`；
- `mouse.cage.move`、`mouse.cage.move.batch`、`mouse.cage.leave`；
- `breeding.pair.create`、`breeding.litter.create-with-offspring`；
- `experiment.create-with-group`、`experiment.assign.batch`、`experiment.exit.batch`；
- `record.weight.batch`；
- `recycle.restore`（内部按 type 分派，不在 UI/LLM 复制 switch）；
- `data.backup.prepare-download`、`data.restore.preview`、`data.restore.commit`；
- `data.csv.import.preview`、`data.csv.import.commit`、`data.csv.export.prepare`；
- `navigation.open`、`view.mice.apply`、`saved-view.create`；
- `query.search.global`、实体详情、列表和统计查询。

底层 `terminateMouse` 只是 `changeMouseStatus` 的别名，不应额外生成重复 LLM tool；descriptor 可将“终结/死亡/安乐死”作为同一 capability 的语言提示。复合服务方法优先于让 Agent 多轮串行调用原子方法。

### 7.2 权限并非 RBAC

当前是单用户无账号 PWA，因此 `permission` 主要表达执行政策而不是虚构角色权限：

- read-only / view-only：可直接执行；
- reversible mutation：意图与实体唯一时可直接执行，返回撤销；
- warning-gated：先让服务真实预检并捕获 `WarningRequiredError`，确认后用同一 commandRunId 与 acknowledgement 重试；
- high-impact：需要影响预览、显式确认和恢复方案；
- irreversible（永久删除）：默认不向 LLM 自动执行开放，至少需要 typed phrase + 最新 purge preview + 全量备份；可以让 Agent 先准备预览。

descriptor 的 exposure 应支持按会话和当前任务动态筛选，避免一次把全部工具交给模型；但工具筛选只能减少上下文，不能改变执行器的权限检查。

### 7.3 影响必须由执行器产生，不能由模型声称

descriptor 的静态 `impact` 说明可能读写哪些资源；handler 执行时产生精确 `ImpactPreview` 和 `affected`。高影响阈值建议至少包括：

- 预计写入/删除记录数；
- 是否跨多个业务实体或全库；
- 是否物理删除；
- 是否覆盖整个数据库；
- 是否产生浏览器文件下载；
- 是否包含当前无法语义逆转的关系历史。

模型只负责选择 capability 和填写公开输入；“改了几条、能否撤销、是否需要备份”必须来自 executor 的可信结果。

## 8. 恢复与整条命令撤销

现有 ActivityLog 足以审计业务动作，但不足以可靠实现整条命令 undo：它主要保存结果 ID、changedFields 与少量 metadata，没有统一 before image；复合命令还会生成带 `:index` / `:mouse` / `:cage` 的子 operationId。

建议新增持久化 `CapabilityCommandRun` / `RecoveryJournal`（新 Dexie store，随 schema migration 与完整备份扩展），记录：

- commandRunId、capabilityId/version、canonical resolved input digest；
- parent operationId 与全部 child operationIds；
- 开始/完成时间、actor、确认记录；
- 受影响记录的 key、before image、after revision/digest；
- 新建记录 key 与被物理删除记录的 before image；
- 恢复模式和全备份引用；
- undo 状态与 undo activity id。

撤销必须由独立 `RecoveryService` 执行，而不是 LLM 直接写 Dexie。其流程：

1. 在事务内重新读取全部 affected keys；
2. 核对当前 revision/digest 等于命令完成后的状态；
3. 核对没有新增的外部引用会因恢复而悬空；
4. 有冲突则拒绝，并列出冲突记录；
5. 无冲突才原子恢复 before image、删除本命令新建记录并写 undo audit；
6. 运行必要的关系/派生字段检查；高风险操作后运行完整性扫描。

恢复策略按 capability 声明：

- `semantic-inverse`：优先调用现有服务的软删/恢复/状态或关系命令；
- `journal-restore`：更新、批处理和跨表复合命令由集中恢复服务精确回滚；
- `full-backup`：全库恢复、示例批次物理删除、永久删除或超过阈值的批量动作先产生完整备份；
- `none`：纯查询、导航、视图动作；
- `not-undoable`：只有在 UI 明确展示且完成额外确认后才能执行。

注意：全库备份并不等于可随时一键撤销。若命令后还有别的写入，整库恢复会覆盖新工作，必须以数据库级序列号/最后 commandRun 检查阻止自动恢复并转为人工恢复流程。

## 9. 导航与视图能力表示

### 9.1 路由清单统一

当前 `navigation.ts` 有工作区、创建动作和标题，而 `App.tsx` 另有实际 Route。建议建立无 React 的 route descriptor：

```ts
interface RouteDescriptor {
  id: string
  pathTemplate: string
  entityType?: EntityType
  allowedTabs?: readonly string[]
  title: string
  description: string
  keywords: readonly string[]
}
```

React 路由仍可手写 lazy component mapping，但导航项、创建菜单、全局搜索和 `navigation.open` 均从同一 descriptor 生成/校验。导航 handler 只能调用注入的 `NavigationAdapter.open(target)`；禁止 querySelector/click、禁止让模型拼任意 URL。实体 ID 必须 `encodeURIComponent`，tab/query 只能来自白名单。

### 9.2 临时视图状态与持久保存视图区分

- `view.*`：筛选、排序、tab、选中项、展开详情等临时 UI 状态，走 `ViewStateAdapter`，`recovery: none`，结果可提供“重置视图”；
- `saved-view.*`：业务持久数据，继续走 `MouseKeeperService`，有 revision、软删与恢复。

不要让 Agent 修改 localStorage key 或 React state 内部实现。Mice 页的 `VIEW_PREFERENCE_KEY` 等应由 view adapter 管理；页面订阅 adapter/store，Agent 和 UI 调同一 application action。

## 10. 文件能力表示

浏览器文件选择与下载存在用户手势和 File/Blob 边界，不能把它伪装成普通 JSON tool，也不能让模型访问任意本地路径。

建议：

- UI 文件选择或对话附件进入 `FileBroker`，生成不可猜测、短期有效、限定 MIME/size/purpose 的 `FileToken`；LLM tool 只接收 token。
- `data.restore.preview(fileToken)` 与 `data.csv.import.preview(fileToken)` 从 broker 获取 File，复用现有预检逻辑；token 不写入 prompt 日志中的文件内容。
- 导出能力返回 `PreparedArtifact { artifactId, filename, mime, size, checksum }`。Blob 留在 broker；Agent UI 展示真实“下载”按钮，由用户手势调用 adapter。
- 不能在只“准备了下载”时宣称文件已经落盘。成功结果区分 `prepared`、`download-started`、`saved`（浏览器通常只能可靠知道前两者）。
- `data.restore.commit` 必须引用先前 preview id 与 digest，再次校验 token 内容未变；现有 pre-restore backup 也作为 artifact 返回。
- CSV import 分 preview / mapping / commit；commit 使用 preview digest，禁止模型提交与预览不同的隐式文本。

这保留了当前 `backup.ts` / import-export 的安全校验，同时避免 DOM 点击和任意文件系统访问。

## 11. 如何避免 DOM 点击、直接 DB 与影子逻辑

应建立可自动检查的边界，而不只写约定：

1. Agent package 不允许 import `src/db`、Dexie、React、`window`、`document`、`localStorage` 或具体 feature 页面。
2. UI mutation 不再直接 import `appService`；逐步改为 `appCapabilities.execute(id, input, envelope)`。
3. application handler 可以 import service 和命名 query；只有 recovery / backup / purge 等被批准的基础设施模块允许直接写数据库。
4. 新增 ESLint `no-restricted-imports` 或架构测试，阻止 `src/agent/** -> db/services/features`，阻止 `src/features/**` 新增 Dexie 写 API。
5. 为每个 descriptor 写 handler contract test；同一 fixture 分别从 UI facade 与 Agent tool facade 调用，断言产生相同业务结果与 affected/recovery 信息。
6. 建立覆盖门禁：所有 `CREATE_ACTIONS`、页面 mutation handler、公开 service command和数据页动作必须映射到 capability 或有明确 `internalOnly` 理由。
7. 查询也命名化。LLM 不拼 Dexie filter；UI 与 Agent 共用 `query.search.global`、列表/详情/统计 projection。
8. LLM tool schema 从 registry 自动生成，不手写第二份 JSON Schema、工具描述或 handler switch。

UI 可以保留即时表单校验和展示状态，但最终 Zod public schema、实体解析、warning、影响和 mutation 必须由 executor 再执行一次；UI 校验不是业务真相。

## 12. 风险

### 高风险

1. **误把 service methods 等同完整能力。** 会直接遗漏导航、视图、查询、设置和文件流程，也会迫使 Agent 调 DOM 或 Dexie补洞。
2. **直接暴露 Service Input。** 模型可伪造 origin/now/importBatchId、复用 operationId 或自行填写过期 revision。
3. **无请求指纹的 provider 重试。** 现有幂等只核对 action；同 action 不同输入可能被错误重放。
4. **宣称通用 undo 但没有 before image / 冲突核对。** 尤其分笼、终结状态、窝后代、批量实验分配会修改多表。
5. **将 File/Blob 或任意 URL/路径作为 tool 参数。** 会扩大隐私和本地文件访问边界，也无法保证浏览器下载真实完成。
6. **永久删除直接开放给 Agent。** 现有 purge 是物理删除且只留下 tombstone；应 preview + typed confirmation + backup，默认不自动执行。

### 中风险

1. 全工具一次性注入会造成工具选择混淆；需按当前意图/页面动态选择，但执行权限仍由 registry 强制。
2. 逐页迁移期间 UI 可能同时存在 appService 与 registry 两条入口；需迁移清单与静态门禁防止回流。
3. 为恢复日志新增表会影响 schema、backup table list、完整性扫描与迁移测试，必须作为一个完整原子提交处理。
4. 现有 page-specific queries 语义并不统一（是否含 deleted、排序与 limit）；命名查询迁移时必须以 UI 实际行为为基准，不能顺手“优化”而改变产品语义。
5. `ActivityLog` 的 child operationId 没有显式 parent；复合能力需由 commandRun 关联，不能靠字符串拆分作为永久协议。

## 13. 建议迁移顺序

1. **冻结能力审计基线。** 从真实 UI 与代码建立 UI action -> current handler/service/query -> entity/tables -> confirmation/recovery 的清单；先不改行为。
2. **建立 registry 骨架与架构测试。** 实现 descriptor/handler 分离、Zod public schema、ExecutionContext、统一 outcome；先注册只读 `query.search.global` 和 `navigation.open` 验证边界。
3. **集中实体解析。** 为 mouse/cage/experiment/task/tag/event 建唯一解析器与 ambiguous outcome；UI 仍可传 ID，LLM 可传人类标识。
4. **迁移低风险 CRUD。** mouse/cage/task create/update、任务状态、saved view 等先接入 executor；UI 改用相同 facade，做服务结果等价测试。
5. **迁移 warning 与批量能力。** 分笼、繁育、实验分配、体重批量；验证同 commandRun 确认重试与原子性。
6. **加入 CommandRun / RecoveryJournal。** schema migration、backup/restore/完整性扫描同步升级；先支持创建/更新/软删，再覆盖跨表复合命令。
7. **迁移查询与视图。** 把页面内可复用 projection 变成命名查询；加入 ViewStateAdapter，清除 Agent 对 localStorage/React state 的需求。
8. **迁移文件与高影响动作。** FileBroker、artifact 下载、备份、CSV、恢复、sample batch、purge；落实 preview/digest/confirmation/backup。
9. **启用 LLM tool adapter。** 工具 schema 只从 registry 生成，按任务筛选；Agent 只能调用 executor。
10. **收紧门禁。** 禁止 feature 新增直接 service mutation、禁止 agent import db/DOM；完成 UI / LLM 同能力契约测试和覆盖审计。

每一步应保持原 UI 可用、可独立提交并跑现有测试；不要在同一提交中同时重写 service 规则和替换所有页面。

## 14. 具体建议摘要

- 保留 `MouseKeeperService`，在其上新增 application executor，不建立第二套业务规则。
- descriptor、public Zod schema、handler、执行上下文与 outcome 分层；descriptor 是 UI/LLM 唯一能力目录。
- service context 字段由可信 runtime 注入；模型与 UI 都只提交用户意图。
- 实体解析、歧义、warning、影响、确认和错误映射集中化。
- 为每个 mutation 返回真实 affected entities、详情路由和 recovery receipt。
- 新增持久 command run / recovery journal；撤销逐条 revision/digest 冲突校验。
- 导航走白名单 target + adapter；文件走 FileToken + PreparedArtifact，不碰 DOM、不接受任意路径。
- 高风险恢复、物理删除和大批量动作先预览并生成完整备份。
- 用架构测试与 restricted imports 防止 Agent 直连 db、页面出现新写入旁路或工具 schema 分叉。

## 15. 未检查项

- 未运行应用并逐按钮验证所有 UI 文案、隐藏/条件入口与移动端入口；应与独立 capability audit 合并校对。
- 未完整逐行阅读 5,280 行 service 的每个分支；已检查全部公开方法索引及关键事务/复合/删除恢复实现。
- 未验证 Wouter 对 query string、编码和 programmatic navigation 的全部运行行为。
- 未评估新增 recovery store 的实际存储膨胀、压缩、保留期限与大批量性能。
- 未设计最终 provider tool schema 格式或 OpenAI/兼容 API 映射；本报告只定义 provider 无关的 application boundary。
- 未验证浏览器 File System Access API；建议保留标准 File/Blob fallback，不把特定浏览器 API 当成必需条件。
- 未检查尚未实现的 Agent UI、provider settings 或后续新增代码。
- 未运行 typecheck、unit、E2E 或 build，因为本次没有修改业务代码，且任务范围是独立架构审查。
