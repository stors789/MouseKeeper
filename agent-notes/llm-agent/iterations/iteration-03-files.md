# 第 3 轮实施后审查：文件预览、一次性提交与高风险撤回

日期：2026-08-01
分支：`feat/llm-agent`

## 审查发现

1. `data.backup.restore` 和 `data.csv.import` 原先都接受 `fileRequestId` 后立即“解析 + 写入”，没有稳定的只读 preview capability。
2. 文件在提交时立即从 broker 消费，Agent 没有可供模型检查的写入前预览，也不能区分“只预览”与“预览后执行”。
3. CSV `mapping` 使用允许任意属性的 schema，不能阻止模型杜撰字段；提交也没有固定使用预览时的映射。
4. 已有通用 RecoveryManager 测试，但没有备份替换、CSV 导入、永久删除的真实 Agent execution + undo 证据。

## 修复

### 两阶段文件能力

- 新增 `data.backup.preview { fileRequestId }`：读取用户手势选择的 JSON，完整校验后只返回备份摘要、问题和一次性令牌，不写 DB。
- `data.backup.restore { previewToken }` 只接受同一用户选择文件产生的未消费令牌；提交前再次完整验证，然后恢复并生成恢复前安全副本。
- 新增 `data.csv.preview { fileRequestId, mapping? }`：只读解析、建议/应用映射和校验，返回合法、非法、警告行数及前 20 行详情，不写 DB。
- `data.csv.import { previewToken }` 改为使用预览时固化的映射，并按提交时的当前数据重新校验。
- CSV mapping schema 仅允许 `MOUSE_IMPORT_FIELDS` 的 18 个稳定字段，禁止额外属性。

### 用户手势与自动继续

- `FileBroker` 保留浏览器手势边界：Agent 只能创建 file request，文件仍必须由 `<input type="file">` 的用户操作提供。
- preview 生成状态为 `ready` 的一次性 `FilePreviewAuthorization`。commit 只能消费同一 broker 内未使用的 token，不能靠伪造 `fileRequestId`、映射或 token 跳过 preview。
- Agent 选择文件后的续跑会带上原始指令：必须先 preview；原始指令明确要求恢复/导入时直接 commit，只要求检查/预览时则停止。不增加第二次 UI 确认。

## 真实测试证据

- JSON：实际生成签名备份文件，验证 preview 前后目标 DB 不变；一次性 token 提交后整库替换，重复使用被拒绝。
- CSV：实际 `File` 解析和映射，验证 preview 后小鼠数仍为 0；一次性 token 提交后实际导入，重复使用被拒绝。
- 高风险整命令撤回：
  - JSON 整库替换后 `RecoveryManager.undo` 恢复原数据库；
  - CSV 导入后撤回小鼠及导入副作用；
  - 代表性 task 永久删除后撤回为回收站记录；
  - 先创建笼位、后续工具失败时，命令状态为 failed 但变更仍可整体撤回。
- 288 条确定性契约评估已更新为 request → preview → commit 能力链和新参数契约。

## 执行结果

- `npm run typecheck`：通过。
- `npm run lint`：通过，0 warning。
- 相关定向测试（capability、execution eval、contract eval）：3 files / 26 tests 通过。
- 全量 `npm test`：23 files / 175 tests 通过。
- `npm run build`：通过；Agent 异步块 13.49 kB（5.51 kB gzip），主入口仍有项目已知的 500 kB chunk warning。
- `npm run test:e2e -- --grep "Agent workspace"`：desktop Chromium + mobile Chromium，2/2 通过。
- `git diff --check`：通过。

### 中途失败与修复

- 第一次全量 `npm test` 有 1 个失败：`src/agent/evals/contract.eval.test.ts` 的 `CAP-086` 仍为旧 `fileRequestId` 契约，而 commit capability 已要求 `previewToken`。已将 capability mirror 和 file-gesture 评估改为 request → preview → commit，随后全量复跑 175/175 通过。

## 剩余限制

1. File/preview/token 只存在当前页面内存中，刷新或关闭页面后会安全失效，用户需重新选文件。
2. CSV 预览 UI 当前通过执行摘要、警告和技术详情展示完整结果，没有单独的大型表格映射编辑器；仍可在 preview capability 输入中给出严格 mapping。
3. 浏览器安全限制下，Agent 不能代替用户打开文件选择器或自动选择本地文件；这是预期限制。
