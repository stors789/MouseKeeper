# Agent UX 独立设计审查

审查日期：2026-08-01  
性质：只读设计审查；未修改业务源码、配置或测试，未提交。

## 范围

审查 MouseKeeper 现有信息架构、响应式布局和 UI 原语，提出 Agent 页面与全局入口、输入交互、上下文、预设切换、进度与结果、整命令撤回、详情和受影响记录、停止/重试/编辑重发，以及移动端、深色模式和无障碍方案。

## 实际读取文件

- LLM_CAPABILITY_AUDIT.md：106 项基线能力及 UI、导航、文件、恢复能力口径。
- src/App.tsx：全部路由、延迟加载与 Shell 边界。
- src/layout/AppShell.tsx、Sidebar.tsx、MobileNavigation.tsx、navigation.ts：顶栏、桌面/移动导航、快捷键、标题与焦点。
- src/layout/CreateMenu.tsx、GlobalSearchDialog.tsx、ThemeControl.tsx：全局入口、抽屉/菜单、焦点恢复与快速选择模式。
- src/features/settings/SettingsPage.tsx：现有卡片式设置、异步状态和错误反馈。
- src/features/data/DataPage.tsx：分段标签、文件选择/预检、导入报告、回收站、危险操作预览。
- src/components/ui/Alert.tsx、Button.tsx、Dialog.tsx、EmptyState.tsx、Field.tsx、Input.tsx、Select.tsx、Skeleton.tsx、StatusChip.tsx、Textarea.tsx、Toast.tsx、buttonStyles.ts。
- src/styles.css：主题 token、Shell、Dialog/Drawer、Toast、表单、数据页、320 px 起的响应式规则、触控高度、减少动画和强制色彩。
- e2e/app.spec.ts、playwright.config.ts、src/App.test.tsx：Desktop Chrome / Pixel 7、溢出、主题、焦点和离线基线。
- 用户附件 pasted-text.txt 中的 Agent UI、上下文、直接执行、文件接力、停止/重试/重发、恢复点和长对话要求。

## 证据

1. AppShell.tsx:98-123 已把页面上下文和全局动作放在固定顶栏；59-82 有排除可编辑元素的快捷键框架；51-57 管理路由后的标题与主内容焦点。这是全局 Agent 入口的稳定扩展点。
2. navigation.ts:109-146 由同一数据源派生桌面侧栏、移动主项和“更多”；Agent 必须进入这份集中导航，而非成为不可搜索的孤立入口。
3. MobileNavigation.tsx:23-58 是严格的 4 个主项 + 1 个“更多”，styles.css:2402-2458 固定为五列。新增第六列会损害触控宽度。
4. AppShell.tsx:127-130 与 styles.css:2458-2476 已用右下安全区承载“新建记录”FAB，不宜再叠 Agent FAB。
5. Dialog.tsx:35-79 使用 Radix Portal、Overlay、Title/Description 和 Close；styles.css:685-780 已有可滚动 body 与 drawer，适合详情和快速 Agent 抽屉，但不适合承载全部长期历史。
6. Alert、Button、StatusChip 已分别具备语义状态、loading/aria-busy、图标加文字。Toast.tsx:37-47 默认 5 秒且最多保留最近 3 条，因此 Toast 只能辅助提示，不能作为结果或撤回的唯一载体。
7. DataPage 已形成可复用的高风险语言：文件选择和预检分离、Alert 汇总、表格详情、按条恢复、不可逆操作影响预览。Agent 应沿用此语言，但明确的普通修改不应复制二次确认流程。
8. SettingsPage.tsx:110-226 只有短小双列卡片网格。Provider 和预设字段量远超当前三张卡，全部平铺会不可扫描。
9. styles.css:11-151 使用语义 token 驱动双主题；2288-2303 将移动按钮和输入最小高度提高到 44 px；2637-2668 已处理 reduced-motion 与 forced-colors。
10. E2E 已覆盖 Desktop Chrome 和 Pixel 7，以及无横向溢出、深色主题和搜索关闭后焦点恢复（e2e/app.spec.ts:55-91,116-153），Agent 测试可直接扩展现有矩阵。

## 发现与建议

### P0：采用“全局快速入口 + 独立工作区”

只做抽屉会挤压长历史、复合命令和差异详情；只做 /agent 会迫使用户离开当前页面，削弱“操作当前筛选/选择”的价值。建议三层入口共享同一个 Agent session store：

- 桌面侧栏增加“Agent”路由，用于完整历史、长结果、撤回与审计。
- 顶栏增加紧凑“Agent”按钮和 Cmd/Ctrl+J，从当前页面打开右侧抽屉并携带路由、选择和筛选；保留 Cmd/Ctrl+K 给搜索。
- 移动底栏仍保持五列，建议为“总览 / 小鼠 / Agent / 任务 / 更多”，把笼位移到“更多”首项。这是明确的信息架构取舍：自然语言成为首要操作面后，Agent 应比单一实体列表更易到达，笼位仍在两步内可达。
- 不再增加移动 Agent FAB。进入 /agent 时隐藏“新建记录”FAB，避免与底部输入器争夺空间。

### P0：结果必须是“执行记录”，不是聊天气泡

每条命令应是持久、可审计的 article，固定分为：

1. 指令头部：用户原文、时间、预设/模型、发起时上下文摘要和状态。
2. 进度区：精简时间线，仅显示当前阶段和已完成数；工具级详情默认折叠。
3. 结果摘要：第一行回答“做了什么”，再展示成功、失败、自动修正、恢复点、是否回滚。
4. 受影响记录：默认 3–5 条，实体图标、可读名称、变更类型和“查看全部 N 条”。
5. 持久操作栏：主操作“撤回”，次操作“查看详情”“打开记录”；菜单内放“重试”“编辑后重新发送”“复制摘要”。

工具名、JSON 参数、request ID 和 before/after diff 放入“查看详情”Drawer，并对 API Key、Authorization 和秘密自定义请求头做不可逆脱敏。

### P0：撤回必须持久、整命令并明示冲突

- 成功修改的结果卡持久显示恢复点 ID/时间和“撤回整条命令”。Toast 可有同一快捷动作，但不能取代结果卡。
- 一键撤回无需普通确认框；按下后立即 loading，成功后原卡标为“已撤回”，同时生成并链接一条新的撤回审计记录。
- revision 冲突时绝不覆盖后续修改；将按钮变为“检查冲突”，列出已变化和仍可恢复的记录。
- 恢复点失败或操作不可撤回时不得显示纯成功状态，应明确“已修改，但不能在应用内撤回”和备份状态。
- 部分成功必须分区显示已完成、失败、已回滚步骤，不能只给模糊自然语言。

### P0：输入器要显式展示上下文来源

建议输入器从上到下为：

- 来源芯片：“当前页：笼位 A01”“已选 8 只小鼠”“筛选：在笼·雌性”“时区：Asia/Shanghai”。每个芯片显示来源（当前页/当前选择/上一结果）并可移除。
- 3 行多行 Textarea，向上自动增长至约 8 行，之后内部滚动。使用可执行示例作占位文本。
- 底部左侧为预设选择和当前模型，右侧为“发送”；运行时同位置替换成“停止”，避免误点。
- Enter 发送、Shift+Enter 换行；compositionstart 至 compositionend 之间忽略 Enter，避免中文/日文输入法候选时误发送。显示简短键盘提示并给发送按钮 aria-keyshortcuts。

页面上下文不能只藏在 system prompt 中。大选择集显示“已选 138 只（仅发送 ID 摘要）”，让用户知道数据边界。指代解析的最终来源也要记录在命令详情中。

### P1：停止、重试、编辑重发必须区分

- 停止：取消当前模型请求和未开始步骤；已进入原子事务的工具不能伪装为“没发生”。停止卡需展示已执行、未执行、回滚和恢复点，可用“停止后续步骤”消除歧义。
- 重试：使用原指令和新的幂等 operation ID，并引用原 context snapshot；显示“重试自 #N”。成功修改不可提供模糊的“重试”，只能明确“再执行一次（将创建新修改）”。
- 编辑并重新发送：原文回填输入器，显示“正在基于 #N 编辑”，允许选“原上下文/当前上下文”；发送后创建新命令，不改写旧审计记录。
- Agent 自动纠正参数后，结果显示“自动修正 N 处”，详情记录原因和改动，不展示链式思考。

### P1：Provider 设置改为可深链的子导航

保留 /settings，但新增“常规 / Agent 服务 / 预设 / 隐私与安全”分段，并支持 /settings?section=agent 一类稳定入口。

- Agent 服务：Provider 类型、Base URL/path、API Key、organization/project、模型列表和测试连接；结果持久显示延迟、HTTP 状态、协议和模型数。
- 预设：预设列表 + 选中项编辑；按模型/推理、采样、超时/重试、工具轮次、历史/上下文分组；headers/provider params 放在默认折叠的“高级”。
- 隐私与安全：密钥保存策略、仅“已配置 + 尾号”的掩码、清除秘密、导入/导出非秘密配置。不存在“显示原文 Key”控件，错误详情同样脱敏。
- 表单显式保存，不逐字段即时持久化；离开未保存 Provider/预设时复用 useUnsavedChanges。

### P1：未配置、文件接力和失败是一级状态

- 无可用预设时用 EmptyState：“尚未配置 Agent”+“前往 Agent 设置”；原工作区必须完全可用。
- 需要用户选文件时，命令进入“等待文件”，内嵌复用 DataPage 的 file-drop，并说明类型、大小和“选择不会立即写入”。选择、预检后在同一命令继续。
- 区分未配置、401/403、429、超时、上下文过长、无效 tool call 和本地业务规则失败，并分别提供配置、换预设、稍后重试、缩小上下文、编辑重发、打开记录等动作。

### P1：控制长历史与流式更新

- 历史按 session 分组，支持新会话、搜索和状态筛选；首屏仅加载最近记录，展开详情后再加载 diff 和工具输出。
- 流式文字节流更新，不把每个 token 插入 aria-live；读屏只播报阶段切换、等待用户和最终摘要。
- 完成命令默认折叠工具时间线，只留结果和操作栏。大工具输出使用前 N 条 + 本地详情下载上限，防止单条记录锁死页面。

## 推荐布局

桌面 /agent 使用两列：主列为命令卡列表，辅列 280–320 px 展示当前上下文、预设/模型和最近影响对象；底部是共享的粘性输入器。主列至少约 620 px。小于 1024 px 时辅列收进“上下文”Drawer；小于 768 px 时单列、卡片操作换行全宽。

快速抽屉建议宽 min(520px, 100vw)，只显示最近 3–5 条命令，并提供“打开完整 Agent 工作区”。关闭抽屉不停止命令；关闭后恢复触发器焦点。抽屉关闭期间完成时用 Toast 辅助通知，真实结果仍写入持久历史。

布局沿用 feature-page、form-actions、data-tool-card 的边框、间距和断点，不引入另一套“AI 渐变”视觉。

## 状态契约

| 状态 | 表示 | 主操作 | 无障碍 |
|---|---|---|---|
| 等待 | 中性“等待执行” | 取消 | 不反复播报 |
| 模型处理 | “正在理解指令”+ spinner | 停止 | aria-busy，阶段切换才播报 |
| 工具执行 | “执行 2/4”+ 当前步骤 | 停止后续步骤 | 确知总数才用 progressbar |
| 等待用户 | Alert：选文件或解歧义 | 选择/补充 | 聚焦必需控件 |
| 成功 | 摘要、计数、恢复点 | 撤回 | polite 摘要，不抢焦点 |
| 部分成功 | warning + 三分区步骤 | 详情 | 图标文字并用 |
| 失败 | critical + 失败/回滚/恢复点 | 重试/编辑 | alert 只播报一次 |
| 已停止 | 已停止后续步骤 + 已执行摘要 | 继续/撤回 | 不声称取消了不可中断事务 |
| 已撤回 | 原卡保留并链接撤回记录 | 详情 | 保留审计顺序 |
| 撤回冲突 | 列出变化记录 | 检查冲突 | 说明不会覆盖后续修改 |

## 移动、深色和无障碍细节

- 命令列表用语义 ol + article，每条有稳定标题。详情 Drawer 复用 Radix 的 focus trap 与 Esc；Esc 关闭视图但绝不停止命令。
- 使用单一隐藏 polite region 通知阶段和最终摘要；不要把流式全文置于 aria-live。致命错误沿用 Alert 的 role=alert。
- 状态同时使用文字、图标和边框/轨道，不仅靠颜色；forced-colors 下为命令卡、进度轨和上下文芯片增加 CanvasText/Highlight。
- 新组件只用现有 bg/text/border/tone/focus token，避免仅适配浅色的固定白/灰。JSON/diff 使用现有等宽字体并 overflow-wrap:anywhere。
- 所有触控动作至少 44 px；芯片移除按钮有完整 aria-label。
- 移动输入器放在正常文档流的 sticky 容器，底距为 mobile nav + safe area + 8 px，使用 100dvh。软键盘可用 visualViewport 调整可见区，不因 window resize 重置会话滚动。
- 用户上滚时流式更新不强制拉到底部，只显示“有新进度 ↓”；仅在用户已靠近底部时自动跟随。
- 抽屉关闭后恢复 Agent 触发器焦点；路由跳转继续使用现有 main-content 焦点策略。

## 最小验收集

1. 任意实体页用 Cmd/Ctrl+J 打开 Agent，显示当前记录/筛选来源；Esc 后焦点回到触发器。
2. Enter、Shift+Enter、IME composition 行为正确，连续点击只生成一个命令。
3. Fake provider 多步命令显示阶段；停止后如实显示已执行/未执行/回滚。
4. 结果持久显示影响数、自动修正、恢复点和受影响记录；刷新后仍可整命令撤回。
5. 撤回生成新审计条目；revision 冲突不覆盖新数据并可查看冲突。
6. 重试与编辑重发都创建新命令，旧审计不改写，并可选原/当前 context snapshot。
7. 快速切换预设更新当前模型；历史保留命令实际使用的预设/模型。
8. 文件命令等待用户选择；选择/预检不写数据；同一命令随后继续并输出报告/恢复点。
9. 无 Provider 时原路由均可用，Agent 显示可直达设置的空状态。
10. Pixel 7 软键盘打开时输入、发送/停止、最新结果和底栏不遮挡，且无横向溢出。
11. 键盘可遍历预设、上下文芯片、命令动作、详情和记录；流式更新无读屏播报风暴。
12. 浅色、深色、reduced-motion 和 forced-colors 下状态均可识别。

## 未检查项

- 本次未启动浏览器或重复 LLM_CAPABILITY_AUDIT.md 已记录的真实 UI 遍历；依据为源码、现有 E2E 和审计中的浏览器证据。
- 尚无 Agent 页面原型，因此未测试流式渲染成本、真实移动软键盘或读屏器。
- 未评审 Provider adapter、Agent engine、recovery 或 capability registry 的内部正确性；这里只定义 UI 所需状态契约。
- 未执行颜色对比扫描、axe/WCAG、VoiceOver/NVDA 或真实触控设备测试，均应列为实现后的必要验收。
