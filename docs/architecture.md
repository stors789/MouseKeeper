# MouseKeeper 架构说明

## 1. 当前状态

本文描述 MouseKeeper v0.1.0 的实际实现，更新于 2026-08-01。最终运行证据记录在 agent-notes/final-test-report.md；已知未验证项记录在 known-limitations.md。

MouseKeeper 是单用户、无后端、本地优先的 React PWA。核心业务事实保存在 IndexedDB，localStorage 只保存主题与非关键列表偏好。完整 JSON 是恢复格式，CSV 是交换格式。

## 2. 技术栈

| 层 | 实现 |
|---|---|
| UI | React 19、TypeScript 5.9、Tailwind CSS 4、自定义组件原语与 Radix UI、Lucide |
| 路由 | Wouter；业务页面按路由懒加载 |
| 表单 | React Hook Form、Zod、受控 Radix Select |
| 数据 | Dexie 4 / IndexedDB；dexie-react-hooks 响应式读取 |
| 文件 | Papa Parse CSV、浏览器 Blob 下载、Web Crypto SHA-256 |
| 测试 | Vitest、Testing Library、fake-indexeddb、Playwright |
| PWA | Web App Manifest、原生 Service Worker、构建资产清单 |

产品名、版本、数据库名和 schemaVersion 集中在 src/config/app.ts。

## 3. 系统边界

    用户
      │
      ▼
    React / PWA ─────► IndexedDB（16 张业务表）
      │                    ▲
      ├────► localStorage（主题、视图偏好）
      ├────► JSON/CSV 本地文件
      └────► Service Worker（仅静态应用壳）

运行时没有登录、远程 API、云数据库、分析 SDK、远程字体或第三方数据上传。浏览器仍可能按自身策略访问应用部署地址、检查 Service Worker 资源或清理站点存储。

## 4. 目录与依赖方向

    src/config/          稳定产品配置
    src/domain/          实体、枚举、Zod、日期、规范化与纯规则
    src/db/              Dexie stores、生命周期与完整性扫描
    src/services/        事务性命令、幂等与引用完整性
    src/backup/          规范 JSON、SHA-256、预检和全表恢复
    src/import-export/   CSV 解析、映射、逐行提交和导出
    src/features/        按业务工作区组织的 UI
    src/components/      通用 UI 与错误边界
    src/layout/          应用壳、导航、搜索与主题入口
    src/app/             单例数据库和服务组合

依赖规则：

1. domain 不依赖 React、Dexie 或页面。
2. db 和 services 依赖 domain；services 是业务写入入口。
3. features 可通过命名查询或 Dexie useLiveQuery 读取，但写入调用 appService，不能散落 table.put/update/delete。
4. backup 与 import-export 复用 domain schema 和 services，不能建立宽松旁路。
5. components 不拥有业务写入能力。

## 5. 写入模型

MouseKeeperService 把跨表动作表达为命令，例如创建并初始分笼、转笼、终结状态、创建窝及后代、加入/退出实验、记录体重、软删除/恢复和示例批次删除。

每个写命令遵循以下约束：

- operationId 在 ActivityLog 上唯一；同一请求重放返回已有结果，改变请求内容后复用会拒绝。
- 可编辑实体使用 revision / expectedRevision，避免静默覆盖旧页面。
- 需要用户确认的规则返回结构化 warning，确认后在事务内重新读取现状。
- 跨表事实用单一 Dexie rw 事务写入；任一步失败自动回滚。
- 快速重复点击由 UI busy 状态、operationId 和唯一 helper key 共同防护。

ActivityLog 是命令审计轨迹，MouseEvent 是发生在小鼠身上的业务事实。两者不可互相替代。

## 6. 读取与派生状态

- 年龄、周龄、逾期、容量、性别/品系分布和仪表盘指标从事实派生，不保存第二份计数。
- Mouse.currentCageId 是列表查询投影；活动 CageAssignment 是权威关系。服务事务同步两者，完整性扫描检查漂移。
- WeightRecord 保存数值事实，并与 MouseEvent(type=weight) 一对一配对；创建、删除和恢复均原子执行。
- Records 中心对全局历史先按时间索引限制 100 条；按小鼠筛选时先走 mouseId/活动引用索引，再排序限制，避免“先截断再筛选”漏历史。
- 小鼠列表有分页和保存视图；路由级 React.lazy 切分减少首包工作。

## 7. 路由与工作区

一级工作区包括总览、小鼠、笼位、繁育、实验、记录、任务、数据与安全、设置。子路由提供表单、详情、复制小鼠、批量建档和快速称重。

AppShell 提供桌面侧栏、移动导航、全局搜索、创建菜单、跳到主内容和路由后主区域聚焦。每个懒加载边界使用结构化 Skeleton；顶层 ErrorBoundary 在渲染异常时提供恢复入口。

表单通过 useUnsavedChanges 保护站内链接、浏览器后退和关闭/刷新。危险操作使用确认对话框或确认短语。

## 8. 备份与恢复架构

备份包含 16 张表、逐表计数、schema/app 版本、数据库实例 ID 和 canonical SHA-256。普通导出自身也走不受信恢复验证器，防止从已损坏数据库生成“看似正常”的完整备份。唯一例外是事务内精确恢复前副本：它必须忠实保留当前状态，即使当前库已有不一致，因此只封装计数和校验和，不冒充已经通过恢复验证。

恢复分两阶段：

1. 事务外完成大小、UTF-8、JSON 安全、信封、版本、Zod、校验和、唯一键、关系与派生字段审计。
2. 验证通过后进入覆盖全部表的单一写事务；在同一事务开始处读取旧状态并完成安全副本摘要，再替换所有表。任何写入失败都会回滚；成功后界面发起该精确恢复前副本的下载，下载失败与数据库提交结果分别报告。

详细操作见 backup-and-recovery.md。

## 9. CSV 架构

Papa Parse 负责语法层；MouseImport 校验负责字段映射、枚举、日期和批内/库内重复；MouseImportRunner 对每个合法行开启事务，解析父母、笼位、标签并调用服务创建。错误行不会影响其他行，单行内不会留下部分标签或孤立小鼠。

所有 CSV 导出对电子表格公式前缀做单引号中和，并添加 UTF-8 BOM。

## 10. PWA

Vite 构建插件生成 asset-manifest.json。Service Worker 安装时缓存入口、manifest、图标和全部构建资产；导航离线回退到 index.html，运行时只对应用壳和 `/assets/` 静态资源采用 cache-first 并后台刷新。activate 删除旧 mousekeeper-shell-* 缓存并立即接管客户端。

生产环境注册 Service Worker；开发模式不注册。缓存不包含 IndexedDB、导入文件或备份下载。

## 11. 数据安全与失败边界

- Zod 与服务层共同校验日期、枚举、状态、谱系和关联。
- 活动唯一键用 Dexie 唯一索引表达可由 IndexedDB 强制的部分；其余“外键”规则在服务事务中显式检查。
- 数据库 blocked/versionchange 会派发事件，旧连接收到 versionchange 后关闭，不自动清库。
- 完整性扫描只读检查 16 表的 schema、缺失引用、活动唯一关系、谱系环、投影和 Weight/Event 配对。
- 导入文本通过 React 纯文本渲染，不使用 dangerouslySetInnerHTML。
- 备份未加密；隐私边界和残余风险见 known-limitations.md。

## 12. 性能取舍

索引覆盖活动唯一键、常用状态、日期、关系和搜索词；页面用分页、100 条历史上限与路由切分控制渲染。仪表盘、完整性扫描、全局导出和恢复本质上是线性全库操作，目前未移入 Worker。规模目标与未完成实测见 agent-notes/10_performance_review.md。
