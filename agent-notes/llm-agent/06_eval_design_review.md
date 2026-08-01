# LLM Agent 确定性评测设计独立审查

审查日期：2026-08-01  
审查角色：Agent Eval 设计独立审查  
结论：当前实现已有可进行真实状态评测的基础，但现有 Agent 编排测试仅 6 条，不能据此证明 106 项用户能力或自然语言鲁棒性。建议建立 **288 条默认离线、确定性、无需外部 LLM 的 Eval**，同时把“回放模型验证执行链”与“真实模型语义质量”明确分开，避免用 scripted provider 冒充自然语言理解评测。

## 审查范围

- 原始需求中成功定义、能力镜像、上下文、文件用户手势、恢复/撤回、Provider 兼容、200+ Eval 和判定要求。
- `LLM_CAPABILITY_AUDIT.md` 中 106 个独立用户能力及覆盖率口径。
- `src/agent` 中编排器、系统提示、Provider 请求/解析/错误、设置能力、恢复点与撤回实现和现有测试。
- `src/application/capabilities` 中描述符、schema、能力搜索、真实执行 handler、扩展导航/视图/文件能力和现有测试。
- 本审查只设计评测，不评判尚未完成的 Agent 页面视觉质量，也没有修改业务代码或执行真实远程模型。

## 实际读取文件

- `/Users/eros/.codex/attachments/15d63492-f456-4491-9316-2a0874f6f798/pasted-text.txt`（完整 1216 行）
- `LLM_CAPABILITY_AUDIT.md`（完整能力矩阵，106 项）
- `src/agent/index.ts`
- `src/agent/runtime.ts`
- `src/agent/settings-capabilities.ts`
- `src/agent/orchestrator/index.ts`
- `src/agent/orchestrator/orchestrator.ts`
- `src/agent/orchestrator/system-prompt.ts`
- `src/agent/orchestrator/types.ts`
- `src/agent/orchestrator/orchestrator.test.ts`
- `src/agent/provider/client.ts`
- `src/agent/provider/defaults.ts`
- `src/agent/provider/index.ts`
- `src/agent/provider/parsers.ts`
- `src/agent/provider/provider.test.ts`
- `src/agent/provider/request-builders.ts`
- `src/agent/provider/secret-store.ts`
- `src/agent/provider/settings-store.ts`
- `src/agent/provider/types.ts`
- `src/agent/recovery/database.ts`
- `src/agent/recovery/index.ts`
- `src/agent/recovery/recovery-manager.ts`
- `src/agent/recovery/recovery-manager.test.ts`
- `src/agent/recovery/types.ts`
- `src/application/capabilities/catalog.ts`
- `src/application/capabilities/core-handlers.ts`
- `src/application/capabilities/extended-handlers.ts`
- `src/application/capabilities/extended-handlers.test.ts`
- `src/application/capabilities/index.ts`
- `src/application/capabilities/registry.ts`
- `src/application/capabilities/registry.test.ts`
- `src/application/capabilities/schema.ts`
- `src/application/capabilities/types.ts`

## 发现与证据

### 1. 评测可以走真实生产执行链

`AgentOrchestrator` 只向模型提供 `search_capabilities` 和 `execute_capability`，后者调用真实 `CapabilityRegistry.execute`；核心写入再进入 `MouseKeeperService`，导航、视图、设置和文件进入扩展 handler。评测无需 mock 业务 Service，应该使用独立 Dexie 数据库和生产 registry，仅替换 `AgentModelClient` 与浏览器边界。

### 2. 已有恢复模型适合做强判定

每次 `run` 在模型请求前执行 `RecoveryManager.begin`，结束后记录 `capabilityIds`、逐工具 trace、业务表 row diff、偏好 diff 和必要时的 full backup。撤回会逐行检查当前值是否仍等于命令后的值，存在后续修改时转为 `undo-conflict`。因此每个写入 Eval 都可同时验证最终数据库、恢复点与撤回，而非只看聊天文本。

### 3. 当前测试覆盖的是机制样例，不是 Agent Eval

现有编排测试覆盖直接创建、依赖步骤、工具错误修正、上下文注入、工具轮次和取消，共 6 条；Provider 测试较完整地验证请求映射和协议错误；registry 测试验证若干真实写入。它们没有系统覆盖 106 项 UI 能力、语言变体、相对日期、指代、文件两阶段流程或整个复合命令的状态结果。

### 4. 单纯 scripted provider 会产生“假测试”风险

若每条 case 的 fake provider 直接读取同一条 case 中的 `expectedCalls` 并原样返回，则“期望什么就伪造什么”，即使 prompt 完全无关也会通过。这样的测试能验证执行器，却不能验证任何意图路由。必须拆开语义契约、Provider 转录和结果 oracle，并对错误/缺失/重复转录做负向突变。

### 5. 协议差异应放在 Eval 的 transport 层而非复制编排用例

`request-builders.ts` 已按 Responses、兼容 Responses、Chat Completions 映射工具与生成参数；`parsers.ts` 归一化 JSON/SSE；`client.ts` 负责超时、重试和错误分类。协议 Eval 应让同一条规范化 tool-call transcript 分别经过三种 wire fixture 后进入编排器，确认最终轨迹和状态等价。

## 建议的 Eval 工程结构

```text
src/agent/evals/
  cases.ts                 # 只声明 prompt、fixture、context 和 oracle
  fixtures.ts              # 固定数据库种子与固定时钟
  transcripts.ts           # 独立的三协议响应转录，不导入 case oracle
  deterministic-model.ts   # 按 transcript key 回放；不得读取 expected
  harness.ts               # 创建真实 registry/orchestrator/recovery
  oracles.ts               # 查询最终数据库、事件、恢复点和 UI 事件
  mutations.test.ts        # 证明错/漏/重复调用会失败
  capability.eval.test.ts
  language.eval.test.ts
  workflow.eval.test.ts
  recovery.eval.test.ts
  provider.eval.test.ts
```

每个 case 至少包含：

```ts
interface AgentEvalCase {
  id: string
  prompt: string
  fixtureId: string
  transcriptId: string
  context: AgentContext
  expected: {
    status: 'succeeded' | 'failed' | 'needs-user-action'
    capabilityIds: string[]
    args: Array<Record<string, unknown>>
    rounds: number | { min: number; max: number }
    db: StateOracle[]
    events?: EventOracle[]
    recovery: RecoveryOracle
    artifacts?: ArtifactOracle[]
  }
}
```

测试固定 `now = 2026-08-01T12:00:00+08:00`、`timeZone = Asia/Shanghai`、locale 和 UUID/operation-id 生成器；日期 oracle 比较规范化 ISO 日期，生成 ID 通过真实工具结果捕获，不能把随机 ID 写死。

## 288 条确定性案例构成

以下分组均默认离线执行，总数为 **288**。同一 case 可以带多个标签，但只在一个主分组计数，避免重复凑数。

| 编号范围 | 数量 | 主分组 | 明确覆盖内容 |
|---|---:|---|---|
| CAP-001～CAP-106 | 106 | 能力镜像基线 | 对 `LLM_CAPABILITY_AUDIT.md` 每一行一一对应；验证发现、精确能力 ID、参数、实际 UI 事件或数据库结果；写操作必须有恢复记录 |
| LANG-001～LANG-048 | 48 | 语言鲁棒性 | 中文 12、英文 10、中英混合 8、口语/简写 6、错别字 6、大小写/空格/全半角/模糊编号 6；同义 prompt 应得到相同规范化能力和参数 |
| CTX-001～CTX-030 | 30 | 上下文与时间 | 当前页面 6、当前选择 6、最近操作 6、单数/复数代词 4、相对日期 6、真实歧义必须询问 2 |
| FLOW-001～FLOW-036 | 36 | 多步与批量 | 依赖创建 10、查询后写入 8、批量 8、跨领域复合 6、长指令 4；严格检查步骤顺序、无遗漏、无重复和一个命令恢复边界 |
| SAFE-001～SAFE-024 | 24 | 删除、恢复与撤回 | 软删/恢复 6、永久删除预检与执行 4、单项撤回 4、批量撤回 4、复合撤回 3、后续修改冲突 3 |
| FILE-001～FILE-012 | 12 | 文件用户手势 | JSON 选择/预检/恢复 4、CSV 选择/映射/导入 4、CSV/JSON 导出 2、错误类型/超大文件/重复消费 2 |
| FAIL-001～FAIL-016 | 16 | 业务与编排失败 | 缺参数、对象不存在、对象不唯一、业务规则冲突、非法 revision、工具错误修正、部分完成披露、取消、工具轮次上限、重复调用/幂等风险等 |
| PROTO-001～PROTO-016 | 16 | Provider/协议故障 | 三协议等价 tool call 6，401/404/400 context/429/5xx/CORS/超时/断流/坏 JSON/模型列表缺失 10 |
| **合计** | **288** |  | 超过最低 200 条，且所有类别有固定预期 |

### CAP-001～CAP-106 的具体要求

- 编号与能力审计行号保持稳定映射，不能合并分母。例如审计 33“批量更改状态”和 34“单只更改状态”必须是不同 case。
- 导航/视图能力监听 `APPLICATION_EVENT_NAMES` 并断言 event detail，同时断言 localStorage（如有）；只断言工具返回“已打开”不合格。
- 查询能力用 fixture 数据断言集合成员、排序、总数、includeDeleted 和截断；不能只断言 `status: succeeded`。
- Service 写入能力断言主表、关系表、配对事件及 activity log。例如转笼必须验证旧 assignment 结束、新 assignment 活动和事件存在。
- 文件下载用 fake `downloadBlob` 边界捕获 Blob，解析内容并断言行数/checksum；不能只断言 artifact 名称。
- 浏览器持久存储以 fake `StorageManager` 的真实调用次数与返回值为 oracle。
- 对当前 registry 还未显式表达、但审计中属于 UI 复合入口的能力，case 必须列出实际组合调用；若无法真实完成，测试应失败并阻止覆盖率宣称，而不能 skip。

### LANG-001～LANG-048 示例配额

| 子类 | 示例 | 规范化判定 |
|---|---|---|
| 中文 | `M001 今天 22.4 克` | `query.search` 解析对象后 `weight.record`，日期 `2026-08-01`，值 22.4 g |
| 英文 | `Move every mouse in cage A01 to B03` | 查询 A01/B03 后 `mouse.move.batch`，mouseIds 集合精确 |
| 中英混合 | `把 A01 females 标成 reserved` | 查询性别/笼位交集后 `mouse.status.batch` |
| 口语/简写 | `M1 22.4g 今儿` | 与规范中文称重结果等价 |
| 错别字 | `把 A01 的小鼠转到 B03 笼为` | 轻微“笼位”错字不改变目标能力 |
| 模糊编号 | `m 001` / `Ａ０１` | 在 fixture 唯一可归一时直执；多个候选时不写入并询问 |

语言组不能让 fake provider读取 `expected.capabilityIds`。建议 transcript 由独立文件按 `transcriptId` 回放，并增加人工审查清单：prompt 与转录语义必须匹配。默认离线测试可证明整个执行链在模型给出预期工具调用时正确，**不能单独证明任意真实模型都能理解这些语言变体**；真实模型 Eval 必须作为单独、可选且不阻塞 CI 的报告。

### CTX-001～CTX-030 的固定语义

- 当前路由：`/mice`、`/records`、`/tasks` 各有读取与视图设置，不把无关整库数据塞入请求。
- 当前选择：唯一选中时“给它加备注”直执；两只选中但用单数“它”时必须停止写入并询问。
- 最近实体：上一命令创建笼位后“往里面放刚才那只”必须使用 session 的真实 affected ID。
- 最近集合：“把刚才那些都转过去”使用上次查询/写入得到的稳定 ID 集合，不重新猜编号。
- 相对日期以固定时钟判定：今天 `2026-08-01`、明天 `2026-08-02`、昨天 `2026-07-31`、下周一 `2026-08-03`、两周前 `2026-07-18`、明早九点为 `2026-08-02` + `09:00`。
- 时区各加一个 `Asia/Shanghai` 与 `America/Los_Angeles` 边界 case，确保相同 UTC 瞬间的“今天”不同。

### FLOW-001～FLOW-036 的状态 oracle

至少包含这些端到端复合工作流：

1. 创建笼位 → 创建小鼠 → 初始分笼。
2. 创建标签 → 给当前筛选的小鼠批量关联。
3. 创建实验及初始组 → 创建第二组 → 将笼内小鼠分配进组 → 创建明日任务。
4. 创建繁育组合 → 记录一窝 → 创建多只后代。
5. 查询超过 12 周且两周未称重的小鼠 → 排除已有实验 assignment → 按笼位创建任务。
6. 查昨天误建的称重事件 → 软删除匹配三条 → 整体撤回。
7. 查询回收站记录 → 恢复目标 → 打开详情。
8. 批量转笼、批量状态、批量标签、批量实验加入与批量退出分别覆盖空集合、单元素和多元素。

每条必须断言：`capabilityIds` 有序相等；每个 tool call ID 唯一；依赖参数来自上一步真实 result；最终表计数与关系状态正确；`commandRun.changes` 覆盖所有变化；整条命令只产生一个可撤回 command run；最终文字不能声称未完成步骤成功。

### SAFE-001～SAFE-024 的撤回判定

- 小变化必须为 `row-diff`，跨 4 表、25 行以上、512 KiB 以上或 descriptor 强制时必须为 `full-backup`。
- 创建撤回后新 ID 不存在；更新撤回后字段和 revision 精确恢复；软删撤回后实体与关系恢复；批量/复合撤回按逆序恢复全部变化。
- 撤回后再次撤回应失败，不得二次修改数据。
- 命令后外部修改一条相关记录，再撤回应得到 `undo-conflict`，列出精确 `table:id`，且不得覆盖后续修改。
- API Key local/session key 不得出现在 preference diff、prompt、trace、错误或 full backup。
- 失败命令若前序步骤已落库，必须在 `changes` 中如实记录，结果必须披露部分完成；另设 case 检验业务提供事务时的原子回滚。

### FILE-001～FILE-012 的用户手势判定

- 第一步只能调用 `data.file.request`，结果必须是 `needs-user-action`，含正确 accept 与 `fileRequestId`；在用户未 provide 文件前不得调用 restore/import。
- 测试通过 `FileBroker.provide` 模拟真实 `<input type=file>` 用户手势后的文件，不把 File 内容直接塞入模型上下文。
- 第二步消费同一 request ID，断言 JSON preview/checksum/16 表恢复，或 CSV 自动映射、合法/跳过/失败逐行报告。
- 同一 request ID 二次消费必须失败，避免重复导入。
- 超过 20 MiB CSV、错误 MIME/格式、校验失败备份都不得修改业务数据，并保留明确错误。

### PROTO-001～PROTO-016 的线级 fixture

- 对同一规范命令，构造 OpenAI Responses JSON、OpenAI Responses SSE、compatible Responses JSON、compatible Responses SSE、Chat Completions JSON、Chat SSE 六条转录；通过真实 parser 后应得到完全相同 `NormalizedToolCall` 并产生相同数据库结果。
- 401→`auth`、404→`model-not-found`、400 context code→`context-length`、429→`rate-limit`、503→按 retries 精确重试、fetch TypeError→`network-or-cors`、AbortSignal→`timeout/aborted`、未完成 SSE→`stream-interrupted`、坏 tool JSON→`protocol`、无 modelsPath→连接测试 generation fallback。
- 超时和重试 case 使用 fake clock，断言请求次数、operation ID 唯一、未产生重复创建；禁止真实 sleep。

## 每条 Eval 的统一判定标准

一条 case 只有同时满足以下条件才通过：

1. `search_capabilities`（若 transcript 需要发现）返回包含目标 descriptor，且没有暴露 handler 或秘密。
2. 实际 `execute_capability` 的 ID、顺序、调用次数与 oracle 一致；参数做结构深比较，集合字段排序后比较。
3. 真实生产 handler 被调用，最终业务数据库、关系、事件、日志、偏好或应用事件与 oracle 一致。
4. 没有目标外变化：比较 16 张表的 canonical diff，额外行即失败。
5. 用户命令成功/失败状态与真实数据一致；不能只匹配自然语言字符串。
6. 写操作的 `commandRun`、trace、recovery kind、changes 和模型/预设元数据正确；只读操作 recovery 为 none。
7. 可撤回 case 执行 `undo` 后，全库 canonical snapshot 和非秘密偏好必须等于执行前快照。
8. 文件 case 正确停在用户手势边界，提供文件后才继续；下载内容本身被解析验证。
9. 故障 case 的 error kind、重试次数、部分完成披露和是否修改数据均精确匹配。
10. 运行两次得到相同规范结果；除受控 UUID/时间字段外，不允许快照漂移。

## 防止“假测试”的强制措施

1. **禁止 oracle 驱动 fake**：`deterministic-model.ts` 不得 import `cases.ts` 或 `oracles.ts`，只可读取独立 transcript fixture。
2. **双作者/双文件原则**：prompt+expected 与 provider transcript 分离；CI 用依赖检查阻止 transcript 模块访问 expected。
3. **真实内核**：不得 mock `CapabilityRegistry`、`MouseKeeperService`、Dexie、`RecoveryManager`；仅 mock 网络、下载、Storage API、固定时钟和浏览器文件用户手势。
4. **负向突变**：自动把每类代表 case 的能力 ID 改错、删掉一步、重复一步、交换依赖顺序、篡改一个参数；至少 95% 的突变必须被 oracle 杀死，否则评测不可信。
5. **全库差分**：不仅断言目标行存在，还断言不存在额外副作用；可发现重复执行与错表写入。
6. **反事实 prompt**：相同 fixture 下仅改变数字、日期、性别、源/目标笼、单复数，oracle 必须随之改变；避免硬编码固定结果。
7. **语义声明诚实**：scripted transcript 证明的是“模型给出该工具调用后系统能正确执行”，不能宣称证明外部 LLM 自然语言准确率。真实 Provider Eval 单列模型版本、日期、seed（若支持）和通过率。
8. **覆盖门禁**：106 个 audit row 必须各有至少一条通过 case，并通过 `auditRow -> caseId -> capabilityIds -> test file` 机器可读映射；skip、todo、只导航或只回显不计覆盖。
9. **重复执行探针**：写 case 记录 operation ID 和业务唯一键；模拟 503/断流后重试，断言最终仅创建一次，若生产层不具幂等保护则 case 应红灯暴露缺陷。
10. **结果文本校验只作辅助**：只检查不虚报、错误脱敏和关键计数；不以逐字文本相等替代真实状态判定。

## 覆盖报告与 CI 门禁

- 默认命令建议：`npm run test:agent-eval`，使用单 worker 或隔离数据库名并行，禁止网络。
- 输出 `agent-eval-results.json`：总数、通过数、失败数、每个 audit row、能力 ID、语言/风险/协议标签、耗时和 mutation score。
- 硬门禁：288/288 默认 Eval 通过；106/106 audit row 有真实状态 oracle；mutation score ≥95%；无 `.only`；无非文件用户手势类 skip；任何密钥模式扫描为 0。
- 性能预算建议：单 case 独立数据库但按 suite 复用初始化模板；288 条在 CI 单 worker ≤90 秒，p95 单条 ≤750 ms。性能超标只能优化 fixture/snapshot，不能把状态 oracle 删除。
- 可选真实模型命令：`AGENT_LIVE_EVAL=1 npm run test:agent-live -- --provider <preset>`；只运行不修改长期用户数据的临时数据库，报告模型/Provider/协议/时间/通过率，不进入默认 CI。

## 优先级建议

1. 先实现 106 条 CAP 基线及机器可读 audit 映射，任何未能落到真实能力的行立刻暴露覆盖缺口。
2. 再实现 SAFE、FILE 和 FAIL；这些最容易发现数据安全与重复执行问题。
3. 加入 FLOW 与 CTX，验证单命令恢复边界和真实 result ID 依赖。
4. 加入 LANG 语料与反事实变体，并明确其 scripted-provider 解释边界。
5. 最后把已有 Provider 单元 fixture接到端到端 PROTO 组，验证 parser→orchestrator→registry 全链。

## 未检查内容

- 没有运行当前尚在开发中的 Agent 页面，因此未验证停止、重试、编辑重发、文件按钮和移动端交互是否已接线。
- 没有读取全部业务 Service 与 16 表 schema 的每个字段；状态 oracle 的具体 fixture 字段仍需由主实现者按现有 service 测试补全。
- 没有执行真实远程模型，因此不对任何模型在 48 条语言变体上的真实选择准确率作结论。
- 没有检查最终能力矩阵是否已从实现前的 0/106 更新；本报告提供的是评测门禁设计，不是覆盖率认证。
- 没有修改源码、测试或 Git 历史，也没有提交。

