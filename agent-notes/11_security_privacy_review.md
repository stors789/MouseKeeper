# MouseKeeper 安全与隐私审查（当前 HEAD `a7f3f1d`）

审查日期：2026-08-01（Asia/Shanghai）

## 结论摘要

未发现可直接利用的存储型/反射型 XSS、CSV 公式注入或危险反序列化路径。React 文本插值、统一 CSV 公式中和、严格备份 schema/引用/深度/大小/校验和验证均是有效防线；`npm audit` 在审查时对生产与全依赖均报告 0 漏洞。

主要实际隐私问题是：应用生成的备份/CSV 文件名与 `.gitignore` 中的保护模式不匹配，真实研究数据被复制到仓库后可被误提交。其次是本地数据库和下载备份均为明文、页面没有仓库内可见的 CSP/安全响应头，以及 service worker 对未来同源 GET 响应的缓存范围过宽。当前应用无账号、无后端请求、无遥测，远程攻击面较小；但一旦同源脚本被攻陷，它可以读取全部 IndexedDB。

严重级别定义：高＝可在合理条件下执行代码、远程泄露或不可逆破坏；中＝真实的数据泄露/完整性风险，需要用户动作或部署条件；低＝纵深防御或未来演进风险。此次未发现高危项。

## 已执行检查

- `npm audit --omit=dev --json`：73 个 production dependencies，0 vulnerabilities。
- `npm audit --json`：411 个总依赖，0 vulnerabilities（info/low/moderate/high/critical 均为 0）。
- `npm run build` 与 63 个 Vitest 测试均通过。
- 静态搜索 `dangerouslySetInnerHTML`、`innerHTML`、`eval`、`new Function`、`document.write`、外部 URL/fetch、console、storage、service worker 注册；未发现危险 HTML 注入或业务数据网络发送。
- `git ls-files` 搜索 env、密钥、证书、credential/secret 及构建测试产物；未发现已跟踪敏感文件。

## 发现

### S1 中：真实下载文件名未被 `.gitignore` 的敏感数据模式覆盖

- 实际读取：`.gitignore`、`src/features/data/DataPage.tsx`、`src/lib/download.ts`。
- 证据：`.gitignore:27-33` 只忽略目录 `backups/`、`exports/`、`local-data/`、`user-data/` 和 `*.mousekeeper-backup.json`、`*.mousekeeper-export.csv`。应用在 `DataPage.tsx:117-119,238-245` 生成 `mousekeeper-backup-<timestamp>.json`，在 `:423-425` 生成 `mousekeeper-<kind>-<timestamp>.csv`；两种都不匹配上述后缀模式。`download.ts:1-8` 直接按这些名称下载。
- 实际风险：完整 JSON 包括全部 16 表；CSV 包含耳标、实验编号、品系、基因型、事件描述、PI 等字段。用户将浏览器下载文件移动到仓库根目录后，`git status` 会显示它为可提交文件。
- 复现/验证（请使用虚构内容）：在仓库根目录创建空的 `mousekeeper-backup-2026-08-01T00-00-00Z.json` 和 `mousekeeper-mice-2026-08-01T00-00-00Z.csv`，运行 `git check-ignore -v <file>`；当前应不命中。不要用真实数据做测试。
- 建议：增加与真实输出一致的模式，例如 `mousekeeper-backup-*.json`、`mousekeeper-before-restore-*.json`、`mousekeeper-exact-before-restore-*.json`、`mousekeeper-{mice,cages,experiments,weights,events}-*.csv`，也可更保守地忽略 `mousekeeper-*.json`/`mousekeeper-*.csv`；CI 加 secret scan 和研究数据文件名检查。
- 残余风险：忽略规则不能阻止 `git add -f`、改名、压缩包、截图或粘贴内容；仍需贡献指南和提交前扫描。

### S2 中：业务数据与导出备份均为明文，保护依赖设备/浏览器边界

- 实际读取：`src/db/database.ts`、`src/backup/backup.ts`、`src/import-export/exporters.ts`、`src/features/settings/SettingsPage.tsx`、`src/features/data/DataPage.tsx`。
- 证据：`database.ts` 使用普通 Dexie/IndexedDB；`SettingsPage.tsx:89-100` 明确业务事实保存在 IndexedDB 且无需账号；`backup.ts:170-177` 将完整 canonical JSON 直接构造 `application/json` Blob；CSV exporters 输出可读明文字段。未见加密、密钥管理、认证或自动清除机制。
- 实际风险：共享操作系统账号、未加密设备、浏览器 profile 复制、恶意扩展、备份同步盘/邮件和遗失下载文件都可能暴露研究记录。local-first 表示“不主动上传”，不等于“静态加密”。
- 复现/验证：DevTools Application → IndexedDB 可直接查看记录；下载虚构备份后可用文本编辑器读取。不要对真实数据做共享演示。
- 建议：UI 明确本地明文与备份敏感性；部署文档要求设备全盘加密、独立 OS/browser profile、屏幕锁和受控备份位置。若威胁模型要求，优先提供用户口令加密的备份（成熟 AEAD/KDF、版本化 envelope），再评估数据库层加密；避免自行设计密码学。
- 残余风险：前端运行时必须解密才能使用，XSS/恶意扩展/已解锁设备仍可读取；遗忘口令也会造成不可恢复。

### S3 中：仓库内没有 CSP 或可验证的部署安全响应头

- 实际读取：`index.html`、`vite.config.ts`、`src/main.tsx`、全部 `src/**/*.tsx` 的危险 sink 搜索。
- 证据：`index.html:3-15` 只有 charset、viewport、description、theme 和资源链接，没有 CSP；`vite.config.ts` 未定义托管响应头。未发现 `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function`，因此当前 React 渲染本身较安全，但缺少脚本来源纵深限制。
- 实际风险：若未来依赖供应链、托管同源内容或新 HTML sink 被攻陷，同源脚本可枚举并外传整个 IndexedDB。当前代码没有外部业务 fetch，故不是已证实的泄露路径。
- 复现/验证：对实际部署运行 `curl -I` 并检查 `Content-Security-Policy`、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`、HSTS；本审查没有部署 URL，不能断言服务器一定缺失这些头。
- 建议：在托管层配置严格 CSP，至少从 `default-src 'self'`、`script-src 'self'`、`object-src 'none'`、`base-uri 'none'`、`frame-ancestors 'none'` 起步，并按 Vite/样式实际需求测试；同时配置 nosniff、referrer/permissions policy 和 HTTPS/HSTS。优先响应头而非仅 meta。
- 残余风险：CSP 不能阻止被允许的同源脚本合法读取数据；必须继续避免危险 sink 并管理依赖。

### S4 中：备份 SHA-256 校验只能检测意外损坏，不能证明来源

- 实际读取：`src/backup/canonical.ts`、`src/backup/validation.ts`、`src/backup/backup.ts`。
- 证据：`canonical.ts:74-93` 对 envelope 的公开内容计算普通 SHA-256；`validation.ts:1269-1275` 比对同一摘要。没有密钥、签名或受信来源。攻击者修改数据后可以重新计算 digest，只要同时满足严格 schema/引用约束即可通过。
- 实际风险：用户从邮件、共享盘或不可信同事处导入“校验通过”的文件时，界面文案可能被理解为真实性验证；恶意但 schema-valid 的数据可替换本地数据库。由于文本由 React 转义，这不等同于代码执行。
- 复现/验证：用虚构合法备份修改一条备注，按 `canonical.ts` 算法重算 digest，预览会通过 checksum；随后仍需用户输入确认文本并点击恢复。
- 建议：将 UI/文档措辞明确为“完整性/损坏检测，不验证来源”。若确需来源认证，设计带签名或基于用户密钥的 MAC 方案，并定义密钥备份/轮换；不要把裸 SHA-256 称为签名。
- 残余风险：签名只认证签发者，不保证数据在业务上正确；受信签发者也可能生成错误备份。

### S5 低：service worker 运行时缓存所有同源 basic GET，未来可能缓存敏感响应

- 实际读取：`public/sw.js`、`src/main.tsx`、`vite.config.ts`。
- 证据：`sw.js:70-104` 拦截全部 GET；非导航请求用 `caches.match(..., {ignoreVary:true})`，网络成功且 `response.type === 'basic'` 就存入固定 shell cache。当前代码静态搜索只看到 service worker 自身 fetch，没有业务 API，因此目前缓存内容是静态同源资源。`sw.js:19-31` 还预缓存 manifest 中全部构建资产。
- 未来风险：若同源新增包含研究数据、用户身份或按 header 区分的 GET API，`ignoreVary:true` 与无路径 allowlist 的策略可能跨会话返回旧/错误内容并把响应持久化到 Cache Storage。
- 复现/验证：在测试部署增加一个同源、随 header 改变的虚构 GET endpoint，访问后离线检查 Cache Storage；当前产品没有此 endpoint，故未作动态利用。
- 建议：只缓存明确的静态 asset 路径/hashed assets；删除 `ignoreVary:true`，对 `/api/`、下载、备份、用户数据路径明确 network-only；cache name 与发布版本联动，并建立升级/清除测试。
- 残余风险：Cache Storage 清除不影响 IndexedDB；反之亦然，应在未来“清除本地数据/退出”流程中分别处理。

### S6 低：顶层错误会写入浏览器 console，可能带记录标识或用户输入

- 实际读取：`src/components/ErrorBoundary.tsx`、`src/lib/errors.ts`、服务与导入错误消息静态搜索。
- 证据：`ErrorBoundary.tsx:23-25` 将完整 `Error` 与 React component stack 传给 `console.error`；`:34-38` 还向页面显示 `error.message`。部分业务错误包含实体 ID、耳标或导入值（例如 `mouse-import-runner.ts:71-79`）。未发现远程日志/telemetry 发送。
- 风险：共享设备调试截图、远程支持会话或未来接入自动 console 收集器时可能泄露标识。当前仅本地 console，故为低。
- 复现/验证：用虚构非法关联触发错误并检查 DevTools console；确认不使用真实耳标。
- 建议：生产 console 记录采用最小化错误码/已清洗上下文；若未来接入 Sentry 等遥测，默认关闭业务字段和 IndexedDB breadcrumbs，并做显式同意、保留期与数据处理说明。用户界面保留可操作但不过度详细的消息。
- 残余风险：完全去除上下文会降低现场诊断能力，应建立可由用户主动导出的脱敏诊断包。

## 已验证的防线与无发现项

### XSS：未发现可利用 sink

- 实际读取：全部 `src/**/*.tsx`、`index.html`、`src/layout/GlobalSearchDialog.tsx`、列表/详情/记录页面。
- 证据：业务文本通过 JSX `{value}`/属性渲染，React 默认转义；静态搜索未发现 `dangerouslySetInnerHTML`、`innerHTML`、`eval`、`new Function` 或 `document.write`。动态路由 ID 普遍经 `encodeURIComponent`（例如 `queries/search.ts:99-135`、`CagesPage.tsx:160-166`）。
- 验证建议：新增自动测试，将名称/备注设为 `<img src=x onerror=...>`、`</script>` 和引号组合，断言仅显示文本且无事件执行；未来引入 Markdown/富文本时重新审查。
- 残余：第三方组件内部实现和浏览器扩展不由本次静态搜索完全覆盖；CSP 仍值得加入。

### CSV 公式注入：导出路径已统一中和

- 实际读取：`src/import-export/csv.ts`、`src/import-export/exporters.ts`、`src/import-export/csv.test.ts`。
- 证据：`csv.ts:26-44` 在 `trimStart()` 后检测 `= + - @ tab CR` 并在原值前加单引号；`:74-89` 每一列都经过该函数；所有 exporter 都调用 `createCsv`。这也覆盖前导普通/Unicode 空白后公式前缀。
- 验证建议：保留/扩展公式前缀、前导空白、逗号、引号、换行的测试，并在 Excel/LibreOffice/Google Sheets 实测。
- 残余：不同表格软件可能新增解释规则；单引号会改变极少数合法文本的展示，这是安全取舍。

### CSV 输入信任边界：有大小/类型提示、解析和业务校验，但不是安全隔离

- 实际读取：`DataPage.tsx:298-325`、`csv.ts:46-71`、`mouse-import.ts:194-303`、`mouse-import-runner.ts:160-200`。
- 证据：UI 限制 20 MiB 后才 `file.text()`；Papa Parse 固定 header、关闭 dynamic typing；字段映射后校验必填、枚举、日期、重复 ID/耳标；逐行提交失败被隔离。`accept` 仅是文件选择提示，不作为安全判据，但内容解析不依赖扩展名。
- 验证建议：加入畸形引号、重复/空 header、超长单元格、NUL、数十万窄行、编码错误与 20 MiB 边界 fuzz。
- 残余：20 MiB CSV 仍会完整 materialize 为 text、Papa data、preview、validated rows，属于客户端可用性/内存 DoS，详见性能报告；没有远程攻击者自动触发路径。

### JSON/反序列化/恢复：边界较严格

- 实际读取：`src/backup/validation.ts`、`src/backup/normalize.ts`、`src/backup/canonical.ts`、`src/backup/backup.ts`、相关测试。
- 证据：最大 100 MiB、fatal UTF-8 解码（`validation.ts:101-143`）；JSON parse 错误处理和最大深度 100；递归拒绝 `__proto__`/`prototype`/`constructor`（`:36-99`）；envelope `.strict()`、行级 Zod schema、表集合/计数/重复键/引用/派生字段/时区/一对一关系检查（`:146-1135`）；schema/format 版本检查和 checksum（`:1148-1275`）。恢复以全表单事务替换，并在同一事务读取精确 pre-restore 数据（`backup.ts:225-305`）。未发现对象合并到原型、动态代码执行或类实例反序列化。
- 验证建议：继续保留 prototype pollution、深度、超限、future version、重复主键、引用错乱、checksum、故障注入回滚测试；另测 100 MiB 可用性。
- 残余：100 MiB 完整解析的内存峰值可能导致拒绝服务；SHA-256 不提供来源认证（S4）；业务上合法但恶意的数据仍可在用户确认后恢复。

### 依赖与敏感文件：本次无已知漏洞/已提交秘密

- 实际读取：`package.json`、`package-lock.json`、`.gitignore`、Git tracked file list。
- 证据：两次 npm audit 均为 0；tracked file 搜索未发现 `.env`、PEM/key/p12/token、credential/secret 或报告产物；`.gitignore:18-25` 覆盖常见本地秘密扩展。
- 建议：CI 固定 `npm ci` + audit/OSV/Dependabot 类更新机制，启用通用 secret scanner；审阅 lockfile 变更。审计数据库是时间点快照，不代表未来仍安全。
- 残余：npm audit 不覆盖恶意包、尚未披露漏洞、浏览器/PWA 平台漏洞或运行时 CDN/托管配置；本审查未做软件成分签名/SBOM 验证。

## 建议实施顺序

1. 立即修正 `.gitignore` 以覆盖真实备份/CSV 文件名，并在 CI/提交前加入敏感数据检查。
2. 在 UI/文档明确“本地明文”“备份敏感”“checksum 不认证来源”。
3. 为真实部署增加并验证 CSP 与基础安全响应头。
4. 收窄 service worker 缓存 allowlist，给未来 API/下载路径预设 network-only。
5. 制定可选加密备份与遥测/诊断的威胁模型，再实现密码学或远程日志。

## 未检查与限制

- 没有实际部署 URL，因此未验证 TLS、HSTS、CSP/其他响应头、托管平台访问控制、源映射暴露或 DNS/CDN 配置。
- 未做渗透测试、浏览器扩展攻击、物理设备取证、恶意 service worker 持久化或跨浏览器 fuzz。
- 未审计 Node/npm 包的全部源代码；依赖结论仅来自 lockfile、构建行为和 2026-08-01 的 npm advisory 数据。
- 未检查组织层面的实验数据分类、伦理审批、法定保留期、跨境/共享要求；这些决定是否必须实现静态加密和访问审计。
- 未用真实研究数据复现任何问题；所有建议验证都应使用虚构数据。
