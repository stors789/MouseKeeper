# Iteration 02 — 核心群体与研究闭环

> 范围：commit de31e9e 至 d4cadb4，共 10 个原子提交。
> 独立复核：产品架构子代理的日常闭环与数据模型子代理的事务边界；最终阶段由 workflow_review_sol 对当前实现回溯复核。
> 记录性质：交付时按真实 commit 回溯，未伪造当轮终端日志。

## 检查范围

- 小鼠创建/编辑/详情和未保存保护；
- 笼位表单、容量、成员与转笼；
- 繁育组合、窝和后代；
- 实验、组别和成员。

## 发现与处理（10 / 10）

1. 普通链接离开表单会丢草稿：增加 beforeunload、站内链接和 history 确认。
2. 小鼠表单可能只写 Mouse 不写初始笼位：定义创建后分配闭环，后续轮次进一步合并为单事务。
3. 详情缺少父母/后代/历史：加入谱系、笼位、实验、体重、事件和活动分区。
4. 笼位只显示编号：加入容量 meter、性别/年龄/品系组成和成员操作。
5. 有成员仍可删笼：删除前阻止并要求先移出或转移。
6. 父母性别异常会静默接受：返回 warning 并要求明确确认。
7. 自我父母或谱系环：事务内祖先遍历阻止。
8. 窝与后代分开保存会留下孤儿：createLitterWithOffspring 单事务。
9. 实验与初始组分开创建：createExperimentWithGroup 单事务。
10. 同鼠加入互斥组：activeExclusionMouseKey 与服务检查共同阻止。

## 复现与根因

- 新建小鼠选择笼位后在第二步失败；根因是关系跨命令。此轮建立服务边界，1903fac 在后续轮完成最终原子修复。
- 将父本设为当前小鼠；根因是表单选项过滤不能防导入/并发。服务层必须重查。
- 后代第三行耳标重复；根因是逐行提交会留下前两行。整窝单事务回滚。
- 向同一 exclusionSet 第二组加入相同 mouse；根因是 group 唯一不足以表达互斥集合。

## 提交

- de31e9e mouse form
- 7b1987e mouse detail
- d50f9bf cage form
- c39c93f cage occupancy workflow
- 9222009 breeding updates
- 216eaed research invariants
- b3db66b guarded breeding creation
- 2fd7056 litter/offspring
- 4ff0f22 atomic experiment form
- d4cadb4 group membership

## 回归证据

- 静态 it/test 声明由上一轮 26 增至 43，净增 17。
- 最终 Vitest 覆盖谱系环、日期、繁育状态、整窝回滚、实验互斥和活动关系。
- 最终 Playwright 覆盖实际父母→组合→窝→后代，以及实验→组→加入小鼠。

## 未解决 / 下一轮

- 创建小鼠与初始笼位仍需最终合并为一个原子命令。
- 任务、快速称重、导入、回收站和完整数据中心未闭环。
- 下一轮重点：记录/任务/文件交换与真实生产构建纵向 E2E。
