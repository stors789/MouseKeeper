# 第 4 轮实施后审查：恢复、数据一致性与性能

日期：2026-08-01
分支：`feat/llm-agent`
范围：Agent 命令恢复边界、撤回冲突保护、恢复历史保留和全库快照读放大。

## 实际读取范围

- 用户需求附件 `15d63492-f456-4491-9316-2a0874f6f798/pasted-text.txt`
- `agent-notes/llm-agent/10_performance_review.md`
- `src/agent/recovery/recovery-manager.ts`
- `src/agent/recovery/types.ts`
- `src/agent/recovery/database.ts`
- `src/agent/recovery/recovery-manager.test.ts`
- `src/agent/orchestrator/orchestrator.ts`
- `src/agent/orchestrator/orchestrator.test.ts`
- `src/application/capabilities/types.ts`
- `src/application/capabilities/catalog.ts`
- `src/application/capabilities/extended-handlers.ts`
- `src/agent/settings-capabilities.ts`
- `src/backup/backup.ts`
- `src/backup/types.ts`
- `src/db/integrity.ts`
- `package.json`

## 发现的问题

1. `snapshotBusinessData()` 通过事务外的 16 个 `toArray()` 组合数据；并发写入时可能形成跨表混合快照。
2. `RecoveryManager.begin()` 在第一次模型请求前无条件扫描 16 表并把 `fullBefore` 写入 Agent DB；纯查询、导航和文件预览也承担相同成本。
3. `finish()` 无条件再扫描 16 表。按此前 16,000 行基准，纯读取命令仅恢复框架就约消耗 70.9 ms，并产生完整对象分配与 IndexedDB 写入。
4. 写前恢复点虽存在，但没有“直到首个修改能力才准备”的明确边界。
5. `commandRuns` 只有读取上限，没有持久化保留上限，会持续增长。
6. 强制完整恢复策略只查看成功结果；高风险 handler 若先修改再抛错，可能丢失其 `full-backup` 策略信号。

## 修复

### 一致快照

- `snapshotBusinessData()` 现在将 `BACKUP_TABLE_NAMES` 对应的全部 16 张表纳入同一个 Dexie `r` transaction，并在该事务内并发读取。
- 测试逐表观察 `Dexie.currentTransaction`，确认每次读取均为 `readonly`，且同一事务可访问全部 16 张备份表。

### 惰性写前恢复点

- `begin()` 只创建经过秘密脱敏的轻量 `running` 记录；不读取业务表、不读取偏好、不写入 `fullBefore`。
- 新增 `prepareMutation(token)`。编排器解析到已注册且 `descriptor.modifiesData === true` 的能力后，必须先等待：
  1. 一致业务快照；
  2. 非秘密 `mousekeeper:` 偏好快照；
  3. 带 `fullBefore` 的崩溃恢复记录持久化；
  完成后才调用 Registry handler。
- 同一命令的并发准备由共享 Promise 合并，只执行一次；当前工具仍保持串行执行。
- 未准备写入的命令在 `finish()` 中不执行 after snapshot，也不构造偏好差分。
- 已准备写入的命令仍保留 before/after 差分、设置差分、失败但已修改的撤回和原有逐行冲突检查。
- `full-backup` 强制策略改为查看全部工具 trace，而非只查看成功 result，覆盖“高风险能力修改后失败”的策略选择。

### 有界历史

- 新增固定保留上限 `MAX_RETAINED_COMMAND_RUNS = 200`。
- 每次创建或更新命令记录都在 Agent DB 的单个读写事务中执行写入和裁剪。
- 只从最旧的非 `running` 记录开始删除，绝不删除正在执行的命令。若同时运行的记录自身超过 200，安全性优先，允许临时超限，之后的终态写入会继续收敛。

## 自动化证据

新增/更新的恢复测试覆盖：

- 轻量 `begin` 与写前崩溃恢复记录；
- 16 表同一 readonly transaction；
- 纯读取命令 0 次业务快照；
- 并发 `prepareMutation` 只捕获一次且返回前已持久化；
- 修改命令恰好 1 次 before + 1 次 after 快照；
- 精确 row diff 与整条命令撤回；
- 撤回前的后续修改冲突阻断；
- 大批量变更升级为 full backup；
- localStorage 偏好捕获、冲突检查与恢复；
- `failed-but-mutated` 命令仍可撤回；
- 200 条保留上限且 running 记录不被删除。

小规模、可重复的性能证据使用注入式快照计数而非易抖动的墙钟断言：

| 命令类型 | 修复前全表快照 | 修复后全表快照 | 16 表读取次数变化 |
|---|---:|---:|---:|
| 查询/导航/文件预览 | 2 | 0 | 32 → 0 |
| 至少一次修改 | 2 | 2 | 32 → 32 |
| 同命令重复/并发准备 | 可能重复实现风险 | 仍为 1 次 before | 由共享准备 Promise 保证 |

因此纯读取路径已从 O(全库行数) 恢复开销降为 O(1) 轻量命令记录；写路径没有削弱撤回所需的 before/after 证据。定向测试本轮为 18 个测试通过；全量为 23 个文件、181 个测试通过。

## 执行的验证

```text
npx vitest run src/agent/recovery/recovery-manager.test.ts src/agent/orchestrator/orchestrator.test.ts
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

结果：定向测试 18/18 通过；typecheck 通过；lint 零 warning；全量测试 23 文件/181 测试通过；生产构建成功。Vite 仍报告既有主入口 chunk 超过 500 KiB，和本轮恢复改动无直接关系。

## 剩余限制

- 单次 before/after 快照各自已是跨 16 表一致事务，但 UI 写、其他标签页写和 Agent handler 尚未共享同一个跨边界 Web Lock；写入可能发生在 before 与 handler 之间或 handler 与 after 之间。撤回时的逐行 after-state 冲突检查仍会阻止覆盖后续行级修改。
- full-backup 记录目前仍同时保留逐行 `changes` 和 `fullBefore`，以维持现有精确冲突检查与 row-level undo；尚未实现 digest-only 冲突索引或真正以全库替换执行撤回。
- 历史策略只有条数上限，尚无总字节、年龄、存储配额感知或用户手动清理入口。
- 若超过 200 条记录全部处于 `running`，系统按“不得删除正在执行记录”的原则允许暂时超过上限。
- 本轮没有在 Safari/iOS、低端 Android 或接近 IndexedDB 配额的真实设备上重复大数据基准。
