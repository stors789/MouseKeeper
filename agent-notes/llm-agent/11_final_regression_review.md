# LLM Agent 最终独立回归审查

审查日期：2026-08-01
审查对象：`feat/llm-agent` / `b30bc61b09cfde07517f3152d5393e549c2188ac`
审查性质：子任务 #9，独立、只读最终回归。除本报告外，没有修改产品源码、测试或既有文档，也没有创建提交。

## 1. 结论

最终 HEAD 的静态门禁、195 个 Vitest、coverage 命令、生产构建、Desktop Chrome + Pixel 7 完整 Playwright、依赖审计和敏感模式扫描全部通过。完整 Playwright 为 **16 passed / 8 按设备条件 skipped / 0 failed**；本轮没有中途基础设施失败或产品断言失败。

功能实现和注册口径支持 **69 个 application capability + 8 个 Agent 设置 capability = 77 个 runtime capability**。288 条确定性案例及 `CAP-001`～`CAP-106` 唯一映射均由测试硬断言，9 条 execution eval 确实使用生产 Registry、MouseKeeperService、Dexie 和 RecoveryManager 执行代表性流程。

有一个不阻断运行、但影响最终证据表述的问题：

1. `LLM_CAPABILITY_AUDIT.md` 的 106/106 是能力实现/契约映射口径，不是 106 条逐项真实 Agent 执行验证。`contract.eval.test.ts` 对 106 行验证 descriptor、策略和 schema；真实 execution eval 为 9 条。最终报告应保持这个限定，不能写成“106 条均做过端到端 Agent 状态执行”。

审查中曾发现 coverage 没有硬阈值并通知主代理；主代理随后新增 70/55/70/70 阈值和嵌套设置 schema 回归，并提交 `b30bc61 test: enforce global coverage thresholds`。本审查在该新 HEAD 独立复跑 coverage，195/195 与四项阈值均通过。因此这项发现已在最终判定前关闭。

主入口 755.30 kB 的 Vite 500 kB chunk 警告仍存在，已在项目已知限制中披露；Agent 页面异步 chunk 仅 13.27 kB，不构成本轮阻断。

## 2. 审查范围与实际读取文件

完整读取或核对：

- 原始需求：`/Users/eros/.codex/attachments/15d63492-f456-4491-9316-2a0874f6f798/pasted-text.txt`（1216 行）。
- 工程配置：`package.json`、`package-lock.json`、`vite.config.ts`、`vitest.config.ts`、`playwright.config.ts`、`eslint.config.js`、`index.html`。
- 总体与能力文档：`README.md`、`LLM_CAPABILITY_AUDIT.md`、`docs/agent.md`、`docs/llm-providers.md`、`docs/agent-privacy.md`、`docs/architecture.md`、`docs/backup-and-recovery.md`、`docs/csv-import-format.md`、`docs/data-model.md`、`docs/known-limitations.md`、`docs/migrations.md`、`docs/testing.md`。
- 五轮实施后审查：`agent-notes/llm-agent/iterations/iteration-01-schema.md` 至 `iteration-05-provider-ui.md`。
- 能力与评测证据：`src/application/capabilities/catalog.ts`、`extended-handlers.ts`、`registry.ts` 及其测试，`src/agent/settings-capabilities.ts` 及测试，`src/agent/evals/cases.ts`、`contract.eval.test.ts`、`execution.eval.test.ts`。
- 专项实现与浏览器证据：Provider、Orchestrator、Recovery、Agent/Settings、PWA `src/main.tsx`、`public/sw.js`、`public/manifest.webmanifest`、`e2e/app.spec.ts`。
- Git：分支、status、`main..HEAD` 全部提交、merge-base、remote 与远端分支引用。

同时交叉读取了 `agent-notes/llm-agent/01_capability_audit_review.md` 至 `10_performance_review.md` 中与最终计数、已知风险和历史基线有关的内容。

## 3. 实际命令与结果

运行环境：Node `v26.0.0`，npm `11.12.1`；满足项目 `node >=20.19`。

| 命令 | 退出码 | 最终结果 |
|---|---:|---|
| `git diff --check` | 0 | 无空白错误 |
| `npm run lint` | 0 | ESLint 0 warning（脚本启用 `--max-warnings=0`） |
| `npm run typecheck` | 0 | `tsc -b --pretty false` 通过 |
| `npm test` | 0 | 23 files / 195 passed / 0 failed |
| `npm run test:coverage` | 0 | 23 files / 195 passed；见下一节 |
| `npm run build` | 0 | 2,085 modules；生产构建成功；有一个大 chunk 警告 |
| `npm run test:e2e` | 0 | 24 instances；16 passed / 8 skipped / 0 failed，50.8 s |
| `npm audit --audit-level=low` | 0 | `found 0 vulnerabilities` |
| TODO/危险 API/密钥模式 `rg` 扫描 | 0 | 源码无 TODO/FIXME、动态 eval 或真实密钥；详见安全节 |

`npm test` 和 coverage 的 Node 26 运行日志出现 `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided`，以及 jsdom 的 `Not implemented: navigation to another Document`。两次命令均 195/195 通过；这些是测试环境提示，不是失败。构建和 Playwright webServer 还提示 `NO_COLOR` 被 `FORCE_COLOR` 覆盖，不影响结果。

### 中途失败与复跑

本次独立最终回归没有中途基础设施失败，无需复跑。第 5 轮历史报告记录过一次复用正在退出的 preview 导致 `ERR_CONNECTION_REFUSED`，随后已用独立持久 preview 得到 16/8/0；本次在最终 HEAD 又独立得到同样的 16/8/0，排除了该历史基础设施偶发对最终结论的影响。

## 4. Coverage

最终 V8 汇总：

| 指标 | 覆盖 | 命中/总数 | 配置阈值 |
|---|---:|---:|---|
| Statements | 70.67% | 3265 / 4620 | 70% |
| Branches | 57.16% | 2062 / 3607 | 55% |
| Functions | 72.70% | 722 / 993 | 70% |
| Lines | 72.78% | 3084 / 4237 | 70% |

`vitest.config.ts` 现在配置 V8 provider、text/html reporter、排除文件及 `thresholds`。本轮发现前的第一次采集为 70.19/56.66/71.62/72.34%；修复提交后的最终独立复跑为上表结果并超过全部阈值。

Agent 核心的细分结果较高：evals statements 98.11%、orchestrator 96.61%、recovery 92.15%；全局分支覆盖的 57.16% 仍说明存在大量未遍历 UI/业务分支。

## 5. E2E 与专项核对

Playwright 使用生产构建与 Vite preview，项目为 Desktop Chrome 和 Pixel 7。12 个逻辑场景展开为 24 个项目实例；按 `test.skip` 的设备分工，移动端跳过桌面密集文件/长业务流程，桌面跳过移动专属子路由，共 8 skipped。

最终实际覆盖：

- Agent/Settings：desktop 与 Pixel 7 均通过页面上下文、模型设置、JSONL 持久化、长无断点内容及无横向溢出。
- 移动端：所有工作区、核心建笼/建鼠/体重/任务和移动子路由通过。
- 深色：两个项目都断言 `html[data-theme=dark]`。
- 无模型/离线不阻塞：无凭据状态下全部普通工作区和 Agent/Settings 可打开；测试没有发起模型生成。非 Agent 核心流程继续通过。
- PWA：Service Worker 控制后切离线，成功打开此前未访问的 `/settings`。`sw.js` 只缓存同源应用壳和构建资产。
- JSON：桌面实际下载完整备份、拒绝篡改文件、修改数据、上传原备份并恢复计数。
- CSV：桌面实际预览一条合法/一条非法记录，只提交合法行并完成 CSV 下载。

`test-results/.last-run.json` 最终为 `{ "status": "passed", "failedTests": [] }`。

没有真实 Provider 凭据，因此本轮没有远程 OpenAI/兼容 Provider 的真实 CORS、厂商 SSE/JSONL、首 token 延迟或自然语言准确率测试；线级协议由确定性 `Response` / `ReadableStream` 测试覆盖。

## 6. 构建与依赖

生产构建成功，关键产物：

| 产物 | minified | gzip |
|---|---:|---:|
| `index-*.js` | 755.30 kB | 224.22 kB |
| `runtime-*.js`（Provider/Agent runtime） | 44.02 kB | 15.00 kB |
| `AgentPage-*.js` | 13.27 kB | 5.49 kB |
| `SettingsPage-*.js` | 23.92 kB | 7.97 kB |
| `index-*.css` | 88.80 kB | 15.99 kB |

Vite 对 `index-*.js` 发出大于 500 kB 的标准警告。Agent 和 Settings 均为独立异步块；主入口问题是已知的全应用拆包/性能债务，没有导致构建失败。

`npm audit --audit-level=low` 返回 0 漏洞。没有运行依赖升级，因为本任务为只读审查。

## 7. 安全与静态扫描

执行两层 `rg`：

1. TODO/FIXME/HACK/XXX、`dangerouslySetInnerHTML`、`eval(`、`new Function(`；
2. `sk-*`、AWS/Google/GitHub token、长 Bearer、私钥头等常见密钥模式，并辅助搜索 api-key/authorization/token/secret 使用点。

结果：

- 产品源码/E2E 没有 TODO/FIXME、`dangerouslySetInnerHTML`、动态 eval 或 `new Function`。
- 全仓相关字样只命中文档对这些扫描项的说明。
- 常见凭据模式只命中测试假值：`sk-this-should-never-be-stored`、`Bearer test-key-redacted`。它们用于验证脱敏/请求映射，不是真实凭据。
- 没有 tracked `.env`、私钥、证书、数据库或真实备份文件。
- Provider secret 只在 request builder 注入 header；设置能力测试验证不会把 secret/ref 写入模型可见结果或非秘密导出。

此扫描不能替代 SAST、浏览器扩展威胁建模或部署 CSP/响应头检查，但没有发现本次交付中的硬编码密钥或危险动态代码执行。

## 8. 能力、Eval 与测试口径

### 可复现计数

- `catalog.ts`：52 个核心 descriptor。
- `extended-handlers.ts`：17 个应用/视图/文件 descriptor。
- application 小计：69。
- `settings-capabilities.ts`：8 个 Agent 设置 descriptor。
- runtime 总计：77。
- `AGENT_EVAL_CASES`：288，测试断言 ID 与输入均唯一且分类数量精确。
- capability mirror：106，测试断言 auditRow 精确等于 1..106，ID 精确为 `CAP-001`..`CAP-106`。
- execution eval：9 个，覆盖创建与精确撤回、依赖复合工作流、视图偏好、只读查询、失败修正、CSV、JSON 全库替换、永久删除、failed-but-mutated 撤回。
- Vitest：23 files / 195 passed。

### 106/106 声称是否与证据一致

实现映射层面一致：106 个审计行全部映射到 production Registry 中存在的能力；77 个 runtime capability 有唯一注册、递归 JSON Schema、handler 和公共业务内核。修改型能力统一经过写前 recovery 边界，文件能力使用 request → preview → one-time commit。

但测试强度必须分层陈述：

- `contract.eval.test.ts:42-62` 对每个 CAP 行验证“映射、descriptor、风险、恢复策略、必填字段和 runtime schema”；它没有逐案调用模型或执行 handler。
- `execution.eval.test.ts` 有 9 条代表性真实执行，并非 106 条。
- 其余真实性证据来自 Registry/extended handler/Provider/Service/backup/CSV/permanent-delete 的分层单元与集成测试，以及 12 个浏览器逻辑场景。

因此 **106/106（100%）作为现有 UI 能力的实现/可发现/契约覆盖率有证据支持**；但不能把它扩写为“106/106 均完成独立 Agent 端到端状态 oracle”或“真实 LLM 语义准确率 100%”。需求中的 200+ eval 已满足确定性案例数量，真实模型语义评测仍未执行。

## 9. Git

- 当前分支：`feat/llm-agent`。
- merge-base / `main`：`4da3ac13eb4ec04d335c493d2c8b9531d9b9b1d2`。
- 最终审查 HEAD：`b30bc61b09cfde07517f3152d5393e549c2188ac`，`test: enforce global coverage thresholds`。
- `main..HEAD`：**23 个**非空 Conventional Commits。
- remote：`origin https://github.com/stors789/MouseKeeper.git`（fetch/push 未被修改）。
- 审查时 `git ls-remote --heads origin feat/llm-agent` 无输出：远端尚无该功能分支；主代理交付前仍需普通 push，不应 force push。
- 审查开始时工作区干净。报告创建后，预期唯一工作区差异为未跟踪的 `agent-notes/llm-agent/11_final_regression_review.md`；本审查不提交。

提交顺序从 `1497740 audit(agent): inventory user capabilities` 到 `b30bc61 test: enforce global coverage thresholds`，包含能力、恢复、Provider、复合工作流、设置、Agent UI、E2E、288 eval、五轮修复、文档与最终门禁，没有发现历史重写或空提交证据。

## 10. 发现、风险与建议

### F-01 中：能力覆盖证据需要保持分层口径

证据：`LLM_CAPABILITY_AUDIT.md:142-157`、`src/agent/evals/contract.eval.test.ts:42-62`、`src/agent/evals/execution.eval.test.ts:62-230`。106 行都有 production schema 契约，但只有 9 条代表性真实 execution eval。最终报告应沿用“106/106 实现/契约覆盖 + 9 条真实代表执行 + 分层 service/E2E”，不要声称逐行端到端执行。若未来要消除证据缺口，应为 106 行建立可运行状态 oracle，而不是增加静态 case 数。

### F-02 已修复：Coverage 原先没有硬阈值

原证据：审查开始时 `vitest.config.ts:17-20` 没有 `thresholds`。主代理收到即时反馈后以 `b30bc61` 新增 statements 70、branches 55、functions 70、lines 70，并补充 Agent settings 嵌套严格 schema 测试；最终独立复跑全部通过。本报告仍未修改产品配置或测试。

### F-03 低：主入口 bundle 超过 500 kB

证据：最终构建 `index-*.js` 755.30 kB / gzip 224.22 kB。Agent/Settings 已拆分，警告主要在主入口。建议后续用 bundle analyzer 确认 vendor 和同步导入边界，再决定 manualChunks；不要只抬高 warning limit。

### F-04 已知验证限制

没有真实远程 Provider、Safari/WebKit/Firefox/Windows Edge、真实手机、屏幕阅读器、真实多标签页并发、站点配额耗尽、100 MB 备份或最大目标规模 p95。这些已在 `docs/known-limitations.md` 披露，不应作为已验证能力对外陈述。

## 11. 未检查项

- 未使用真实 API Key，未向任何 Provider 发送请求。
- 未修改依赖或执行自动修复型审计。
- 未做浏览器之外的设备、辅助技术、网络代理或恶意扩展测试。
- 未做 5,000 小鼠 / 50,000 事件等最大规模的墙钟、内存与配额基准。
- 未人工逐点操作 106 个 UI 入口；使用能力矩阵、源码、分层测试和完整 Playwright 做交叉验证。
- 未 push、merge 或创建 PR；这些属于主代理交付动作。

## 12. 最终判定

最终 HEAD 可以进入功能分支推送：全部必跑命令在本轮独立通过，coverage 四项硬阈值已建立并通过，依赖审计为 0 漏洞，双项目 E2E 无失败。交付时必须保留两项真实限制：106/106 是实现/契约覆盖而非 106 次真实模型执行；远程模型和非 Chromium 平台未实测。
