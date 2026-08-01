# 第 2 轮审查：复杂工作流与页面上下文

日期：2026-08-01
范围：应用页面上下文、Agent 指代输入、视图控制、新建菜单、程序化导航保护、失败但已变更命令的账本呈现。未提交 Git。

## 读取与复核

- `src/features/mice/MicePage.tsx`、`records/RecordsPage.tsx`、`tasks/TasksPage.tsx`、`data/DataPage.tsx`：实际筛选、排序、分页与选择状态。
- `src/features/agent/AgentPage.tsx`、`src/agent/orchestrator/system-prompt.ts`、`types.ts`：进入 Agent 后的上下文采集与提示注入。
- `src/hooks/useUnsavedChanges.ts`、`src/layout/AppShell.tsx`：链接、历史记录、快捷键及应用事件导航路径。
- `src/layout/CreateMenu.tsx`、`src/application/capabilities/extended-handlers.ts`：Radix 菜单和扩展能力事件适配。
- `src/agent/recovery/types.ts`、恢复管理器：确认失败命令可以包含变化且撤回器本身允许撤回。

## 发现与修复

1. Agent 原来只从最后路由猜测至多一个实体，页面的实际筛选、排序、页码和批量选择均丢失。新增共享 `ApplicationContextStore`；四个工作区持续发布实际页面状态，Mice 将全部已选小鼠转换成带标签、链接和 revision 的 `EntityReference`。Agent 读取该快照并把 `visibleFilters` 与全部 `selected` 注入模型上下文；离开这些工作区时清除陈旧快照。
2. `view.configure` 的 Mice 严格 schema 和页面实现都缺少分页、选择和清除操作。新增 1 基 `page`、`selectedIds` 及 `clear: none | filters | selection | all`；页面初始加载和实时应用均支持这些字段，且仍拒绝额外/嵌套属性。
3. “打开全局新建菜单”没有稳定能力。新增 `view.create-menu.open` 和应用事件；桌面/移动 `CreateMenu` 改为受控 Radix Root，并按当前媒体宽度只打开可见实例。
4. Agent 的程序化导航会绕过表单保护。新增共享 `applicationNavigationGuard`；`useUnsavedChanges` 注册脏表单，顶部 Agent 按钮、快捷键及 AppShell 应用导航统一经过门禁。导航事件可取消，能力被用户阻止后返回失败而不谎报已打开。
5. 失败的复合命令若前序工具已经写入数据，账本原来隐藏撤回。现在状态明确显示“失败 · 已产生变化”，说明存在可撤回变化，并为失败且有恢复差异的命令显示整条撤回按钮。

## 测试证据

- `npm run typecheck`：通过。
- `npm run lint`：通过，0 warnings。
- 专项 Vitest：4 个文件、14 项通过，覆盖上下文快照多选、导航门禁、能力取消、新建菜单实际打开、严格视图字段、失败变更撤回呈现。
- `npm test`：23 个测试文件、169 项全部通过。
- 目标 Playwright（Chromium）：未保存表单导航保护、Agent 页面上下文两项通过（2/2）；后者实际设置 `sex=female` 并在 Agent 上下文条断言可见。

## 未检查

- 未连接真实 LLM Provider，未执行远端工具调用；本轮只验证确定性的上下文与 UI/能力适配层。
- 未跑移动端目标 Playwright 或完整 Playwright 套件；主流程会统一执行全量浏览器回归。
- 未审查或修改 Provider、恢复实现、业务 Service、README 与产品文档。
