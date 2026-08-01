# 小鼠 CSV 导入格式

## 1. 适用范围

CSV 导入用于批量创建小鼠，可同时解析已有父本、母本、笼位和标签。它不会导入历史事件、体重、实验成员或繁育组合；需要完整迁移时请使用 JSON 备份。

文件上限为 20 MB。解析使用首行表头、UTF-8 文本、标准 CSV 引号规则；支持 BOM、CRLF 和引号内逗号。空行会忽略。

## 2. 推荐表头

    id,earTag,experimentNumber,name,alias,strain,genotype,sex,birthDate,status,source,coatColor,notes,tags,sireEarTag,damEarTag,cageNumber

最小合法行必须满足：

- earTag 与 experimentNumber 至少一项非空；
- strain 非空；
- sex、status 若留空会分别使用 unknown、alive；
- birthDate 若填写必须是 YYYY-MM-DD、是真实日历日期且不晚于今天。

## 3. 字段说明

| 字段 | 必填 | 说明 |
|---|---:|---|
| id | 否 | 内部唯一 ID；通常留空由应用生成。文件内和数据库中都不得重复。 |
| earTag | 条件 | 耳标；与 experimentNumber 至少填一个。活动记录中规范化后唯一。 |
| experimentNumber | 条件 | 实验编号；可作为无耳标记录的可读编号。 |
| name / alias | 否 | 名称与别名。 |
| strain | 是 | 品系。 |
| genotype | 否 | 基因型。 |
| sex | 否 | 性别枚举或支持的中英文别名。 |
| birthDate | 否 | YYYY-MM-DD。 |
| status | 否 | 小鼠状态枚举或支持的中文别名。 |
| source / coatColor / notes | 否 | 来源、毛色与备注。包含逗号或换行时按 CSV 规则加双引号。 |
| tags | 否 | 多个标签用分号、中文分号或逗号分隔；不存在的标签会在该行事务中创建。 |
| sireEarTag / damEarTag | 否 | 可指向导入前已有的活动小鼠，或当前批次中已经成功导入的较早行；不能前向引用尚未提交的后续行。 |
| cageNumber | 否 | 必须指向导入前已经存在且未删除的笼位。 |

## 4. 枚举值

sex 可用：

- male、m、雄、雄性；
- female、f、雌、雌性；
- unknown、u、未知；
- intersex、间性；
- other、其他。

status 可用：

- alive、存活；
- experimental、in experiment、实验中；
- breeding、繁育中；
- reserved、预留；
- transferred、已转出；
- dead、已死亡；
- euthanized、已安乐死；
- other、其他。

匹配会先做 Unicode 规范化、去除首尾空白并忽略英文大小写。未知枚举是行错误，不会静默转换。

## 5. 导入步骤

1. 先在“数据与安全 → 备份与恢复”下载完整 JSON。
2. 打开“CSV 导入”，选择文件。
3. 检查自动字段映射；可为每个目标字段重新选择表头或设为不导入。
4. 查看有效、错误和警告行；错误原因按原始行号显示。
5. 点击“导入 N 行”。
6. 保存导入报告，并在小鼠列表按耳标或来源复核结果。

预览会检测 CSV 解析错误、必填项、非法日期/枚举、文件内重复 ID/耳标和数据库活动耳标冲突。提交开始时会读取活动父母、笼位和标签映射；每个成功行会把新耳标/标签加入批次映射，最终写入仍由服务事务重新验证唯一性和关系。

## 6. 部分成功语义

每个合法数据行是一个独立事务：该行创建的标签、小鼠和初始笼位分配要么全部成功，要么全部回滚。其他合法行仍可继续，因此最终报告区分：

- imported：导入成功；
- skipped：预览已判定无效；
- failed：预览后提交时因关系、唯一性、容量或存储错误失败。

这不是整个文件的全有或全无事务。若业务要求整批原子导入，请先在独立浏览器配置中验证后用 JSON 备份迁移。

## 7. 示例

仓库提供 [examples/mice-import-example.csv](examples/mice-import-example.csv)。示例中的 CAGE-A、SIRE-001 和 DAM-001 必须在导入前存在；如不存在，请清空对应关联列或先创建这些记录。

## 8. CSV 安全

应用把导入值作为纯文本渲染，不执行 HTML。所有 CSV 导出会在以 =、+、-、@、制表符或回车开头的单元格前添加单引号，以降低电子表格公式注入风险。导入文件仍属于不受信输入；打开来源不明的 CSV 或导出文件时，应遵循电子表格软件的安全提示。
