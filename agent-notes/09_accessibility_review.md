# MouseKeeper 可访问性审查

审查日期：2026-08-01（Asia/Shanghai）
被审 HEAD：`a7f3f1de7a7d986aa88eaf35513f7bac965cb29f`
范围：键盘、焦点、label/ARIA、dialog、对比度、非颜色状态、reduced motion
方法：代码审查 + production build 上的 headless Chromium 键盘/焦点抽查。未使用 axe、屏幕阅读器或真实浏览器人工朗读，因此不声明 WCAG 全面合规。

## 结论

整体基础较好：有跳转链接、路由焦点管理、全局 `:focus-visible`、语义化导航、Field 的 label/error 关联、Radix Dialog 焦点圈定、文字化状态、forced-colors 与 reduced-motion 规则。发现 1 个中等严重度的实际焦点缺陷：全局搜索关闭后焦点丢到 `body`；另有 1 个低严重度的浅色对比度临界失败。没有发现仅靠颜色表达关键状态的问题。

## 发现

### A11Y-01 全局搜索关闭后没有把焦点还给触发按钮

- 严重级别：中。
- 文件/行：`src/layout/AppShell.tsx:116-123` 仅在 `searchOpen` 为 true 时挂载 `GlobalSearchDialog`；`src/layout/GlobalSearchDialog.tsx:62-66` 关闭时立即令父组件卸载；Dialog 基于 Radix，见 `src/components/ui/Dialog.tsx:35-79`。
- 实际复现：production preview、desktop headless Chromium。聚焦“搜索记录或工作区”按钮并按 Enter；初始焦点正确落到 `aria-label="搜索 MouseKeeper"` 的输入。按 Escape 后 dialog count 为 0，但 `document.activeElement` 是 `BODY`；再次打开并点击“关闭对话框”结果相同。
- 预期：Escape 或关闭按钮关闭后，焦点回到原搜索触发按钮，符合可预测的 dialog 焦点恢复行为。
- 是否已修复：未修复（本代理只允许写报告）。
- 残余风险：键盘用户关闭搜索后会丢失位置，下一个 Tab 从文档起点重新计算；屏幕阅读器用户也缺少明确的上下文返回。建议让 Dialog 在关闭动画/焦点恢复完成前保持挂载，或保存 trigger ref 并在关闭后显式 `focus()`；增加 Playwright 断言。
- 验证步骤：`page.getByRole('button', {name:'搜索记录或工作区'}).focus()` → Enter → 断言搜索 input 获焦 → Escape → 断言同一触发按钮重新获焦。

### A11Y-02 浅色主题页头说明文字对比度略低于 4.5:1

- 严重级别：低。
- 文件/行：浅色 `--bg-app: #f3f6f7` 与 `--text-muted: #66737d` 定义于 `src/styles.css:14-31`；页面以 app 背景呈现，页头说明使用 14px muted 文本，见 `src/styles.css:1470-1472,1501-1506`。
- 验证证据：按 WCAG sRGB 相对亮度公式计算，`#66737d` / `#f3f6f7` 为约 4.48:1，略低于普通文本 4.5:1；同一 muted 色在白色 surface 上约 4.87:1，深色主题对应组合约 7.57:1。
- 是否已修复：未修复。
- 残余风险：差距很小，但页头说明是常见的 14px 正文，不应依赖字体抗锯齿“看起来够深”。建议略微加深浅色主题 muted token，并重新审计所有 token/背景组合。
- 验证步骤：在浅色主题取 `.page-header h2 + p` 的 computed `color` 和页面背景，使用可信对比度工具复算；本轮没有运行浏览器扩展或 axe，对比值来自代码色值计算。

## 分项审查

### 键盘

- 严重级别：信息（基础通过，存在 A11Y-01）。
- 证据：所有核心动作使用原生 button/link/input 或 Radix primitives；全局快捷键在可编辑元素内被忽略，见 `src/layout/AppShell.tsx:24-29,45-68`；全局 `:focus-visible` 为 2px 实线并有 offset，见 `src/styles.css:223-226`。
- 实际验证：全局搜索可用 Enter 打开、Escape 关闭；dialog 中 11 个可聚焦项，循环多次 Tab 后焦点仍在 dialog 内。没有验证 Shift+Tab 的每个边界、Select/Dropdown 全键盘矩阵或所有业务表单。
- 状态/残余风险：焦点圈定通过；关闭恢复未通过，见 A11Y-01。未做纯键盘完成全部核心业务流程。

### 焦点与路由

- 严重级别：信息；残余风险：低。
- 证据：路由变化后将焦点移到 `main#main-content`，见 `src/layout/AppShell.tsx:37-43,109-111`；跳到主要内容链接见 `:75-77`，样式见 `src/styles.css:240-261`。
- 实际验证：直接打开页面后 activeElement 为 `MAIN#main-content`；激活 skip link 后也聚焦该 main。因为初次加载主动聚焦 main，本轮第一次 Tab 实际落在 main 内的首个链接，而不是 skip link；这是当前焦点策略的结果，不应把“skip link 是第一个 Tab”记录为已验证。
- 状态/残余风险：路由后不会无提示留在旧导航链接，但 main 没有 `aria-labelledby`，实际屏幕阅读器播报内容未检查；建议人工测试 VoiceOver 后再决定是否将焦点放到页面 `h2`。

### label、错误与 ARIA

- 严重级别：信息（代码审查通过）；残余风险：低。
- 证据：`Field` 以 `htmlFor/id` 关联标签，错误/说明通过 `aria-describedby` 关联，并设置 `aria-invalid`/`aria-required`，见 `src/components/ui/Field.tsx:28-76`；Select trigger 透传 id 与 ARIA，见 `src/components/ui/Select.tsx:70-84`；图标普遍 `aria-hidden`；通知区域使用 polite live region，critical toast/alert 用 `role="alert"`，见 `src/components/ui/Toast.tsx:55-69,85-117` 和 `src/components/ui/Alert.tsx:39-53`。
- 实际验证：未来日期因原生 `max` 约束而无效，提交后浏览器将焦点留在日期 input；该路径的 `aria-invalid`/`aria-describedby` 为 null，因为原生 constraint validation 在 React/Zod 提交前拦截。它仍有浏览器错误提示，但文案/播报依赖平台。
- 状态/残余风险：未发现未命名的核心输入。没有用 VoiceOver/NVDA 验证 Radix Select、动态错误、CSV file input、live region 的实际播报，也没有自动 accessible-name 扫描。

### Dialog

- 严重级别：中（因 A11Y-01）；dialog 本体语义通过。
- 证据：`src/components/ui/Dialog.tsx:44-77` 使用 Radix Portal/Overlay/Content/Title/Description/Close；Content 有 `aria-label={title}` 和有效 `aria-describedby`，关闭按钮名为“关闭对话框”。
- 实际验证：全局搜索 DOM 为 `role="dialog"`、accessible label“搜索与前往”，初始焦点落在搜索输入，Tab 保持在 dialog 内，Escape 可关闭。关闭后的焦点恢复失败。
- 状态/残余风险：焦点 trap 和初始焦点通过，恢复未通过。`aria-label` 提供了名称，但显式 `aria-labelledby={undefined}` 使可见 `Dialog.Title` 不作为命名来源；当前不构成无名 dialog，但建议只保留一种清晰命名机制并用屏幕阅读器确认。其他业务 dialog 没有逐一实测。

### 对比度

- 严重级别：低（A11Y-02）。
- 证据：主要抽查结果：浅色 default/app 9.66:1、primary button 5.99:1、positive 6.28:1、informative 6.63:1、warning 6.66:1、critical 6.84:1；深色对应正文/主要状态组合均超过 5:1。唯一确认的普通文本临界失败是 muted/app 4.48:1。
- 状态/残余风险：未做全 DOM 自动取样，透明、hover、disabled、placeholder、focus indicator、图表和 `color-mix()` 组合可能仍有遗漏；disabled 文本不纳入同一对比要求，但仍需可辨认性人工检查。

### 非颜色状态

- 严重级别：信息（代码审查通过）。
- 证据：`StatusChip` 同时输出图标和文字 label，见 `src/components/ui/StatusChip.tsx:18-29`；Alert 同时有图标、标题和正文，见 `src/components/ui/Alert.tsx:42-53`；活动导航同时有 `aria-current="page"`，见 `src/layout/Sidebar.tsx:68-82` 与 `src/layout/MobileNavigation.tsx:28-38`；表单错误既有文字又有 `aria-invalid`。
- 状态/残余风险：没有发现关键状态只靠色条/颜色表达。尚未在 Windows High Contrast 实机验证；CSS 有 forced-colors 补偿，见 `src/styles.css:2648-2663`。

### Reduced motion

- 严重级别：信息（代码审查通过）。
- 证据：按钮/输入过渡与 spinner/skeleton/dialog/toast/search 动画存在，见 `src/styles.css:256,281-285,368,674,727-736,827,1345`；`prefers-reduced-motion: reduce` 全局把 transition/animation 缩至 0.01ms 且只运行一次，见 `src/styles.css:2637-2645`。
- 验证步骤：代码审查确认 media query 覆盖元素与伪元素。未在浏览器中 emulate `reducedMotion: 'reduce'` 测量 computed duration 或录屏观察。
- 状态/残余风险：实现存在，无本轮修复。spinner 在 reduce 下只转极短一次后静止，仍有文字 loading label，因此不依赖动画表达忙碌状态；需补自动化 computed-style 断言。

## 未检查项

- VoiceOver、NVDA、JAWS、TalkBack、Voice Control/语音输入。
- axe-core/WAVE/Accessibility Insights 自动扫描与浏览器 accessibility tree 全量审计。
- 200%/400% zoom、系统大字、文本间距覆盖、横屏与高对比实机。
- 所有 Radix Select/Dropdown/Tabs 的 Arrow/Home/End/Typeahead 行为。
- 每个 dialog 的初始焦点、Escape、遮罩关闭、焦点 trap、关闭恢复。
- 动态 toast/alert 的播报顺序、5 秒自动消失是否给不同辅助技术足够时间；当前 Toast timer `src/components/ui/Toast.tsx:121-133` 不会在 hover/focus 时暂停，但仓库当前没有使用 toast action 的业务调用，因此本轮未将其定为确认缺陷。
- 触控目标的全量尺寸审计和移动屏幕阅读器手势。
