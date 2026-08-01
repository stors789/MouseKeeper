# MouseKeeper 笼位与繁育闭环审查（当前 HEAD）

> 审查日期：2026-08-01；基线：`a7f3f1d`。

## 1. 范围与实际读取文件

范围包括笼位创建/编辑、容量、分笼/转笼/移出、历史与删除恢复，以及繁育组合、状态推进、窝与后代的事务闭环。

实际读取：`src/domain/types.ts`、`src/domain/validation.ts`、`src/db/database.ts`、`src/db/integrity.ts`、`src/services/types.ts`、`src/services/mousekeeper-service.ts`、`src/features/cages/CagesPage.tsx`、`CageFormPage.tsx`、`CageDetailPage.tsx`、`src/features/breeding/BreedingPage.tsx`、`BreedingFormPage.tsx`、`BreedingDetailPage.tsx`、`src/features/mice/MouseDetailPage.tsx`、`src/features/settings/SettingsPage.tsx`、`src/services/mousekeeper-service.test.ts`、`e2e/app.spec.ts`，以及相关提交 `1903fac`、`9d72ce4`、`8d19434`、`b154d4f`、`a7f3f1d`。

## 2. 结论与问题

### [高] C-01 有在笼小鼠时仍可把笼位改成 `inactive` 或 `retired`

- 证据：编辑表单向所有 `CAGE_STATUSES` 开放（`src/features/cages/CageFormPage.tsx:227-242`），保存时直接提交状态（`91-112`）。`updateCage` 查询占用数后只对“容量降到当前占用以下”发警告（`src/services/mousekeeper-service.ts:1180-1188`），没有阻止有成员时改为不接收小鼠的状态；而 `moveMouse` 明确禁止向 `inactive/retired` 笼位移入（`1293-1302`）。
- 结果：同一业务规则对新移入与既有成员不一致；完整性扫描的笼位分配检查（`src/db/integrity.ts:437-492`）也不会报告“活动分配指向停用/退役笼位”。
- 静态复现（未另写测试执行）：创建笼位 C 和小鼠 M，`moveMouse(M,C)` 后在 `/cages/C/edit` 把状态改为“停用”或“退役”并保存；现有服务路径允许写入，C 仍显示活动占用。
- 建议：有活动 assignment 时禁止进入 `inactive/retired`，或提供一个原子“清空/转移全部成员后退役”命令；完整性与备份审计增加状态关系规则。

### [中] C-02 配置的容量预警比例没有进入服务规则，页面还硬编码 80%

- 证据：设置实体有 `capacityWarningPercent`（`src/domain/types.ts:382`），默认值 0.8（`mousekeeper-service.ts:4875`）；但转笼仅在 `occupancy >= maxCapacity` 才要求确认（`1315-1322`）。笼位详情和列表直接使用硬编码 `0.8`（`CageDetailPage.tsx:211,273`；`CagesPage.tsx:29`）。
- 影响：用户即使修改设置也不会改变任何提示阈值；接近上限只有展示警示，没有服务层可审计的确认。
- 复现：将设置比例改为 0.5，给容量 10 的笼位放入第 6 只鼠；服务不会产生容量 warning，页面仍按 0.8 判断。
- 建议：明确“软提示”和“强确认”两级语义；两者都从 AppSettings 读取，至少不要硬编码与设置脱节。

### [中] B-01 合笼日期可早于父本或母本出生日期，且扫描/备份不发现

- 证据：`createBreedingPair` 校验身份、重复组合、性别和终止状态（`mousekeeper-service.ts:1705-1754`），未比较 `pairedOn` 与父母 `birthDate`；`breedingPairSchema` 只比较分离/预计生产与合笼日期（`src/domain/validation.ts:226-281`）。表单的合笼日期仅校验格式（`BreedingFormPage.tsx:31-59`）。
- 静态复现（未另写测试执行）：创建出生于 2025-01-01 的父本/母本，提交 `pairedOn=2024-01-01`；若性别和状态正常，现有服务会创建组合。
- 建议：服务事务中比较父母出生日期；在扫描和备份引用审计复用同一规则，并增加创建/更新回归用例。

## 3. 已验证行为与已修复问题

- 单元/集成测试本次实际 63/63 通过。已验证超容前不写入、确认后仅保留一条活动分笼（`mousekeeper-service.test.ts:104-147`）；状态终止时原子关闭笼位、实验和繁育关系（`709-784`）；繁育警告、窝和后代原子创建（`394-440`）；分离释放活动组合键及状态/日期/数量/revision 规则（`442-565`）。
- 单 worker E2E 实际通过笼位→初始分笼→称重→关联任务，以及繁育组合→窝→关联后代闭环（`e2e/app.spec.ts:146-188,267-307`）。
- 初始分笼已从页面的两段写入改成 `createMouseWithCage` 单事务；异步编辑下拉值问题已在 `b154d4f` 修复。
- 后代创建会固定 `litterId/sireId/damId/birthDate`，任一后代耳标或计数失败会使整笔事务回滚（`mousekeeper-service.ts:1899-2144`）。

## 4. 未确定与未检查

- 未验证同一实体在两个标签页同时转笼/退役时的最终用户提示；唯一索引和 Dexie 事务能防一鼠多活动笼，但 UX 仍未测。
- 未检查动物伦理规则（最小繁育年龄、孕期合理范围、断奶业务阈值），因为仓库未定义这些产品规则。
- 未做大笼位/长历史性能测试，也未验证打印笼卡等非当前功能。
