# MouseKeeper

MouseKeeper 是面向个人实验人员的本地优先小鼠群体管理 PWA。它覆盖小鼠档案、笼位、繁育、实验、事件、体重、任务、备份恢复和 CSV 交换，不需要账号或后端服务。

业务数据默认只保存在当前浏览器配置的 IndexedDB 中。应用不会自动把实验数据上传到网络；清除站点数据、删除浏览器配置或设备损坏仍可能造成数据丢失，因此请定期下载完整 JSON 备份并保存到独立位置。

## 已实现功能

- 总览：群体指标、性别/品系/状态/周龄分布、最近小鼠、任务、活动、容量和异常提醒。
- 小鼠：创建、编辑、复制、批量建档、搜索、组合筛选、排序、分页、保存视图、批量状态/转笼/标签、详情时间线、软删除与恢复。
- 笼位：容量、组成、分配、移出、转笼历史、容量警告和带成员笼位的删除保护。
- 繁育：父母规则提示、组合、窝记录、断奶信息和原子批量创建后代。
- 实验：实验与组别、批量加入/退出、互斥组保护、干预信息和历史保留。
- 记录：一般事件、体重、趋势、异常值提示、快速连续称重、编辑与软删除。
- 任务：今日/逾期/未来 7 天、关联对象筛选、完成、恢复、取消和删除。
- 数据安全：16 张业务表的 SHA-256 完整 JSON 备份、预检、恢复前安全副本、事务性恢复、CSV 预览与逐行导入、五类 CSV 导出、示例数据和完整性扫描。
- 客户端：浅色/深色/跟随系统、桌面侧栏、移动端导航、离线应用壳和可安装 PWA。

## 环境要求

- Node.js 20.19 或更高版本
- npm 10 或兼容版本
- 现代 Chromium 浏览器；Safari/WebKit、Firefox、Windows Edge 和真实手机仍需额外平台验收

## 本地启动

首次安装依赖并启动开发服务器：

    npm ci
    npm run dev

终端会显示本地地址，通常为 http://localhost:5173。开发模式不会注册 Service Worker。

生产构建与本地预览：

    npm run build
    npm run preview

默认预览地址通常为 http://localhost:4173。生产模式会注册 Service Worker；首次在线访问并等待其接管后，可以测试离线重载。

## 质量检查

    npm run lint
    npm run typecheck
    npm test
    npm run test:coverage
    npm run build
    npm run test:e2e

Playwright 会构建生产版本并运行 Desktop Chrome 和 Pixel 7 两个项目。安装浏览器运行时可使用：

    npx playwright install chromium

## 第一次使用

1. 进入“笼位”创建笼位，或在“数据与安全 → 示例数据”生成一组明确标识的示例记录。
2. 创建小鼠并选择初始笼位；也可用“批量建档”创建同一批次。
3. 从小鼠详情记录体重、事件、任务或进入实验；从笼位详情执行移入、移出和转笼。
4. 在“设置”运行完整性扫描并请求浏览器持久存储。
5. 在录入真实数据前后分别下载完整 JSON 备份，并把文件复制到浏览器之外的可靠位置。

## PWA 安装与离线

在生产构建或 HTTPS 部署中打开应用后，使用浏览器地址栏或菜单中的“安装应用”操作。localhost 可作为安全来源测试安装。安装能力由浏览器决定，应用不伪造安装成功状态。

Service Worker 只缓存版本化应用壳和明确的同源静态资源，不缓存导入文件或备份下载。IndexedDB 与缓存相互独立；所有业务命令只依赖本地数据库，但当前自动化只验证了离线打开工作区，尚未覆盖完整离线写入矩阵。清除站点存储会同时删除数据库和缓存。

## 备份、恢复和 CSV

- 完整 JSON 是灾难恢复格式，包含 schemaVersion、应用版本、导出时间、16 张表、表计数和 SHA-256 校验。
- 恢复会先完成大小、JSON 安全、格式、版本、行结构、校验和、重复主键与引用完整性检查；通过后才允许输入确认短语。
- 恢复在覆盖全部表的单一事务中执行，并下载事务开始时读取的精确恢复前安全副本。
- CSV 适合交换小鼠及报表，不包含完整关系历史，不能替代 JSON 备份。
- CSV 导入逐行提交：错误行隔离，单行中的标签、小鼠和初始笼位分配在同一事务中完成。

详见 [备份恢复说明](docs/backup-and-recovery.md) 和 [CSV 导入格式](docs/csv-import-format.md)。示例文件位于 [docs/examples/mice-import-example.csv](docs/examples/mice-import-example.csv)。

## 数据与隐私

- IndexedDB 数据库名和产品版本集中配置在 src/config/app.ts。
- localStorage 仅保存主题和列表显示偏好，不保存核心业务记录。
- 数据导出全部在浏览器本地生成；仓库不包含真实实验数据、数据库转储、密钥或 Token。
- JSON 校验和用于发现意外损坏，不是加密、数字签名或来源认证。需要保密时，应使用操作系统加密磁盘或加密归档保护备份文件。

## 项目结构

    src/app/             运行时组合与错误处理
    src/components/      通用 UI 原语
    src/config/          集中产品配置
    src/domain/          类型、校验、日期与纯规则
    src/db/              Dexie schema 与完整性扫描
    src/services/        事务性业务命令
    src/features/        各业务工作区页面
    src/backup/          JSON 导出、验证与恢复
    src/import-export/   CSV 解析、映射、导入与导出
    src/layout/          路由壳、导航和搜索
    e2e/                 Playwright 核心流程
    docs/                架构、数据和操作文档
    agent-notes/         独立审查与迭代记录

## 进一步文档

- [架构说明](docs/architecture.md)
- [数据模型](docs/data-model.md)
- [迁移策略](docs/migrations.md)
- [测试与验收](docs/testing.md)
- [已知限制](docs/known-limitations.md)

MouseKeeper v0.1.0 不是受监管 LIMS、医疗器械或合规记录系统，也不提供云同步、多用户权限、电子签名或自动远程备份。
