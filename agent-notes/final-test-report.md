# MouseKeeper 最终测试报告

测试日期：2026-08-01（Asia/Shanghai）

## 1. 测试基线与环境

- 完整发布测试基线：`dbf55e675ed0c71519ff724761858475c812d700`
- 分支：`main`
- macOS 27.0（Build 26A5388g）
- Node.js v26.0.0、npm 11.12.1
- Playwright 1.62.0、headless Chromium（Desktop Chrome / Pixel 7 配置）

该基线已经包含全部业务修复、PWA 修复、操作文档、8 份最终独立审查报告、最终仲裁和 6 轮迭代记录。本报告提交后只新增交付 Markdown；发布流程要求在最终 HEAD 上再次执行门禁，最终终端结果与 Git hash由交付回复记录。若最终复跑与本报告不一致，本报告不得作为通过证据。

## 2. 自动化结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 差异格式 | `git diff --check` | 通过，无空白错误 |
| ESLint | `npm run lint` | 通过，0 warning / 0 error |
| TypeScript | `npm run typecheck` | 通过 |
| Vitest | `npm test -- --reporter=dot` | 11 files、67 passed、0 failed，1.34 s |
| Coverage | `npm run test:coverage` | 11 files、67 passed；Statements 66.61%、Branches 51.43%、Functions 70.69%、Lines 67.11% |
| Production build | `npm run build` | 2,053 modules，1.14 s，成功 |
| Playwright | `npm run test:e2e` | 默认 2 workers；14 passed、8 conditional skipped、0 failed，38.4 s |
| Production audit | `npm audit --omit=dev --json` | 73 production dependencies，0 vulnerabilities |
| Full audit | `npm audit --json` | 411 total dependencies，0 vulnerabilities |

Vitest 的 `localStorage is not available because --localstorage-file was not provided` 是 Node 26 在测试环境中的 ExperimentalWarning；测试使用 jsdom/fake-indexeddb，退出码和断言均正常，不是产品控制台错误。

## 3. Playwright 覆盖与跳过说明

11 个逻辑场景映射到两个项目，共 22 个项目实例：

1. 9 个一级工作区打开、运行时 console/page error 收集、横向溢出和深色主题；
2. 未保存小鼠表单站内离开保护；
3. 全局搜索初始焦点与关闭后焦点恢复；
4. Pixel 7 批量建档、示例数据、快速称重和笼位成员子路由；
5. 桌面与 Pixel 7 建笼→建鼠/初始分笼→体重→关联任务；
6. 编辑、搜索、筛选、批量状态/转笼、回收站和刷新保留；
7. 父母→繁育组合→窝→原子后代；
8. 体重趋势、一般事件、实验/组/成员、任务完成和跨模块历史；
9. JSON 下载、checksum 损坏文件 UI 拒绝、合法备份替换恢复和恢复后数据计数；
10. CSV 一好一坏预览、部分成功导入和五类下载；
11. Service Worker 控制后离线打开此前未访问的设置工作区。

8 个 skipped 全部由 `test.skip(isMobile)` / `test.skip(!isMobile)` 明确分工：移动项目不重复桌面文件下载、长繁育/实验、密集批量和离线场景，桌面项目不重复移动专属子路由检查。它们不是运行失败。

场景 1 收集到的 `console.error` 和 `pageerror` 数组为空。Playwright 还实际触发浏览器下载、上传、IndexedDB 刷新保留、Service Worker 控制和 offline 网络状态，而不是只检查静态 DOM。

## 4. 本轮发现并修复的测试回归

在收窄 Service Worker 运行时缓存后的第一次默认 E2E 中，结果为 13 passed / 1 failed / 8 skipped：离线 `/settings` 返回应用壳，但主 JS/CSS 未从 Cache Storage 命中。trace 显示 Vite preview 的静态响应带 `Vary: Origin`，而安装 fetch 与后续模块请求的 Origin header 不同。

处理：

- `0aed2a6` 将运行时缓存范围限制为 APP_SHELL 和同源 `/assets/`；
- `60b40da` 仅在该静态白名单内使用 `ignoreVary`；非静态同源 GET 不再由 Service Worker 缓存；
- targeted offline E2E：1 passed；
- 随后默认完整矩阵：14 passed / 8 skipped / 0 failed。

这次失败保留在报告中，不作为已通过历史抹去。

另一独立审查代理曾在多个代理并发运行 build/preview 时遇到 7 个 `ERR_CONNECTION_REFUSED`；同一代码另一 QA 默认执行通过，single-worker 也通过。最终独占默认 2-worker 运行未复现，裁决为共享 preview 进程竞争，而非产品断言失败。

## 5. 静态、安全与交付检查

| 检查 | 实际结果 |
|---|---|
| `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` / `document.write` | 0 |
| 常见 access key / private key / GitHub/OpenAI token 签名的 tracked file | 0 |
| tracked `dist/coverage/test-results/playwright-report` | 0 |
| tracked `.env`、私钥或实际 MouseKeeper 导出文件名 | 0 |
| source/e2e 中 TODO/FIXME | 0；两次全仓命中只是在文档中描述“搜索 TODO/FIXME” |
| 实际备份/五类 CSV 文件名的 `.gitignore` 匹配 | 7/7 命中 |
| README + docs Markdown 相对链接 | 8 files checked，0 broken |
| 构建资产与 `asset-manifest.json` | 46 built，0 missing |
| `dist` 大小 | 1.1 MiB |
| 浅色 muted/app 对比度 | 4.627:1（由最终 token 计算） |

生产构建主要体积：入口 JS 343.10 kB / gzip 110.80 kB；validation chunk 185.32 kB / gzip 56.71 kB；DataPage 76.47 kB / gzip 24.78 kB；CSS 78.02 kB / gzip 14.36 kB。构建未触发 Vite 大 chunk 警告。

## 6. 数据安全专项证据

- 备份：空库/非空 round-trip、canonical SHA-256、截断 JSON、缺表、计数错、checksum 错、未来 schema、重复主键、非法行、缺引用、派生键错和 100 MB 逻辑限制。
- 恢复：16 表单一 rw 事务、注入表写失败整体回滚、精确恢复前副本在任何替换写入前摘要、旧库不一致仍能保留 salvage 副本。
- 关系：父母/后代日期、合笼/父母日期、占用笼状态、谱系环、活动 assignment、实验互斥和 Weight/Event 一对一。
- CSV：BOM/引号/多行、枚举/日期/重复隔离、公式前缀中和、逐行事务、批次内较早父本引用和标签复用、默认仅导出活动记录。
- 幂等/并发：operationId、请求指纹、revision/expectedRevision、唯一 helper key、批量事务回滚。

## 7. 明确未运行或未验证

- 真正关闭 Chromium 进程/操作系统后重开同一 profile；已验证同 context 刷新，且核心事实存于 IndexedDB，但不声称进程重启已实测。
- Firefox、WebKit/Safari、Windows Edge、真实 Android/iOS、横屏和触摸辅助技术。
- PWA 从浏览器安装入口冷启动、版本升级提示、多标签 `blocked/versionchange` 和完整离线写入矩阵。
- VoiceOver/NVDA/TalkBack、语音控制、200%/400% zoom 和完整 WCAG 2.2 人工审计。
- 真实磁盘耗尽、配额拒绝、25/50/100 MiB 合法备份峰值、浏览器崩溃中断。
- 5k/1k/50k/20k 规模在多台真实设备上的 p50/p95 与可信 heap；独立性能代理只完成单机合成冷导航和静态复杂度审查。
- v1→v2 数据库迁移；当前只有 schemaVersion 1，没有旧生产 schema fixture。

这些项目不影响当前 Chromium 本地单用户交付，但属于 `docs/known-limitations.md` 中必须保留的发布边界。
