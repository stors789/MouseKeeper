import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArchiveRestore,
  DatabaseBackup,
  Download,
  FileCheck2,
  FileDown,
  FileUp,
  FlaskConical,
  HardDriveDownload,
  Rat,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Upload
} from 'lucide-react'
import {
  useMemo,
  useState,
  type ChangeEvent
} from 'react'
import { appDatabase, appService } from '../../app/runtime'
import {
  BACKUP_TABLE_NAMES,
  backupBlob,
  createRestorePreview,
  exportDatabaseBackup,
  restoreDatabaseBackup,
  type RestorePreview
} from '../../backup'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Input'
import { StatusChip } from '../../components/ui/StatusChip'
import {
  mouseDisplayLabel,
  normalizeText
} from '../../domain'
import { useToast } from '../../hooks/useToast'
import { readableError } from '../../lib/errors'
import { downloadBlob } from '../../lib/download'
import { formatInstant } from '../../lib/format'
import {
  exportCagesCsv,
  exportEventsCsv,
  exportExperimentsCsv,
  exportMiceCsv,
  exportWeightsCsv
} from '../../import-export/exporters'
import {
  createCsvBlob,
  parseCsvPreview,
  type CsvPreview
} from '../../import-export/csv'
import {
  MOUSE_IMPORT_FIELDS,
  suggestMouseFieldMapping,
  validateMouseImport,
  type MouseFieldMapping,
  type MouseImportField,
  type MouseImportPreview
} from '../../import-export/mouse-import'
import {
  commitMouseImport,
  type MouseImportCommitReport
} from '../../import-export/mouse-import-runner'
import {
  createPurgePreview,
  purgeDeletedEntity,
  type PurgeEntityType,
  type PurgePreview
} from '../../services'

type DataTab = 'backup' | 'import' | 'export' | 'recycle' | 'sample'

const IMPORT_FIELD_LABELS: Record<MouseImportField, string> = {
  id: '内部 ID',
  earTag: '耳标号',
  experimentNumber: '实验编号',
  name: '名称',
  alias: '别名',
  strain: '品系',
  genotype: '基因型',
  sex: '性别',
  birthDate: '出生日期',
  status: '状态',
  source: '来源',
  coatColor: '毛色',
  notes: '备注',
  tags: '标签',
  sireEarTag: '父本耳标',
  damEarTag: '母本耳标',
  cageNumber: '笼位编号'
}

const TABLE_LABELS: Record<(typeof BACKUP_TABLE_NAMES)[number], string> = {
  mice: '小鼠',
  cages: '笼位',
  cageAssignments: '笼位分配',
  breedingPairs: '繁育组合',
  litters: '窝记录',
  experiments: '实验',
  experimentGroups: '实验组别',
  experimentAssignments: '实验分配',
  mouseEvents: '事件',
  weightRecords: '体重',
  tasks: '任务',
  tags: '标签',
  activityLogs: '活动日志',
  savedViews: '保存视图',
  appSettings: '应用设置',
  backupMetadata: '备份元数据'
}

function timestampFilename(prefix: string, extension: string): string {
  return `${prefix}-${new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')}.${extension}`
}

export function DataPage() {
  const { showToast } = useToast()
  const [tab, setTab] = useState<DataTab>('backup')
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [restoreFile, setRestoreFile] = useState<File>()
  const [restorePreview, setRestorePreview] = useState<RestorePreview>()
  const [restoreConfirmation, setRestoreConfirmation] = useState('')
  const [csvFile, setCsvFile] = useState<File>()
  const [csvPreview, setCsvPreview] = useState<CsvPreview>()
  const [mapping, setMapping] = useState<MouseFieldMapping>({})
  const [importReport, setImportReport] =
    useState<MouseImportCommitReport>()
  const [purgePreview, setPurgePreview] = useState<PurgePreview>()
  const [purgeConfirmation, setPurgeConfirmation] = useState('')

  const inventory = useLiveQuery(async () => {
    const [
      mice,
      cages,
      assignments,
      experiments,
      groups,
      experimentAssignments,
      weights,
      events,
      tasks,
      tags,
      deletedMice,
      deletedCages,
      deletedExperiments,
      deletedTasks,
      deletedTags
    ] = await Promise.all([
      appDatabase.mice.toArray(),
      appDatabase.cages.toArray(),
      appDatabase.cageAssignments.toArray(),
      appDatabase.experiments.toArray(),
      appDatabase.experimentGroups.toArray(),
      appDatabase.experimentAssignments.toArray(),
      appDatabase.weightRecords.toArray(),
      appDatabase.mouseEvents.toArray(),
      appDatabase.tasks.toArray(),
      appDatabase.tags.toArray(),
      appDatabase.mice.filter((item) => item.deletedFlag === 1).toArray(),
      appDatabase.cages.filter((item) => item.deletedFlag === 1).toArray(),
      appDatabase.experiments
        .filter((item) => item.deletedFlag === 1)
        .toArray(),
      appDatabase.tasks.filter((item) => item.deletedFlag === 1).toArray(),
      appDatabase.tags.filter((item) => item.deletedFlag === 1).toArray()
    ])
    const sampleCounts = new Map<string, number>()
    for (const entity of [...mice, ...cages, ...tags]) {
      if (entity.sampleBatchId) {
        sampleCounts.set(
          entity.sampleBatchId,
          (sampleCounts.get(entity.sampleBatchId) ?? 0) + 1
        )
      }
    }
    return {
      mice,
      cages,
      assignments,
      experiments,
      groups,
      experimentAssignments,
      weights,
      events,
      tasks,
      tags,
      deleted: {
        mice: deletedMice,
        cages: deletedCages,
        experiments: deletedExperiments,
        tasks: deletedTasks,
        tags: deletedTags
      },
      sampleBatches: [...sampleCounts.entries()].map(([id, count]) => ({
        id,
        count
      }))
    }
  }, [])

  const validatedImport = useMemo<MouseImportPreview | undefined>(() => {
    if (!csvPreview || !inventory) return undefined
    return validateMouseImport(csvPreview, mapping, {
      existingIds: new Set(inventory.mice.map((mouse) => normalizeText(mouse.id))),
      existingEarTags: new Set(
        inventory.mice.flatMap((mouse) =>
          mouse.deletedFlag === 0 && mouse.earTag
            ? [normalizeText(mouse.earTag)]
            : []
        )
      )
    })
  }, [csvPreview, inventory, mapping])

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    setError(undefined)
    try {
      await action()
    } catch (actionError) {
      setError(readableError(actionError))
    } finally {
      setBusy(undefined)
    }
  }

  const exportBackup = () =>
    run('backup-export', async () => {
      await appService.ensureAppSettings()
      const backup = await exportDatabaseBackup(appDatabase)
      downloadBlob(
        backupBlob(backup),
        timestampFilename('mousekeeper-backup', 'json')
      )
      showToast({
        title: '完整备份已导出',
        description: `${Object.values(backup.tableCounts).reduce((sum, value) => sum + value, 0)} 条记录`,
        tone: 'positive'
      })
    })

  const chooseRestoreFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setRestoreFile(file)
    setRestorePreview(undefined)
    setRestoreConfirmation('')
    setError(undefined)
    if (!file) return
    setBusy('restore-preview')
    try {
      setRestorePreview(await createRestorePreview(file))
    } catch (previewError) {
      setError(readableError(previewError))
    } finally {
      setBusy(undefined)
    }
  }

  const restoreBackup = () => {
    if (!restoreFile || !restorePreview?.canRestore) return
    void run('restore', async () => {
      const safetyBackup = await exportDatabaseBackup(appDatabase)
      downloadBlob(
        backupBlob(safetyBackup),
        timestampFilename('mousekeeper-before-restore', 'json')
      )
      await restoreDatabaseBackup(appDatabase, restoreFile)
      setRestoreFile(undefined)
      setRestorePreview(undefined)
      setRestoreConfirmation('')
      showToast({
        title: '本地数据已恢复',
        description: '恢复前安全备份也已下载。',
        tone: 'positive',
        duration: 10_000
      })
    })
  }

  const chooseCsvFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setCsvFile(file)
    setCsvPreview(undefined)
    setImportReport(undefined)
    setError(undefined)
    if (!file) return
    if (file.size > 20 * 1024 * 1024) {
      setError('CSV 文件超过 20 MB，请拆分后导入。')
      return
    }
    try {
      const preview = parseCsvPreview(await file.text())
      setCsvPreview(preview)
      setMapping(suggestMouseFieldMapping(preview.headers))
    } catch (parseError) {
      setError(readableError(parseError))
    }
  }

  const commitImport = () => {
    if (!validatedImport || validatedImport.validCount === 0) return
    void run('import', async () => {
      const report = await commitMouseImport(
        appDatabase,
        appService,
        validatedImport
      )
      setImportReport(report)
      showToast({
        title: 'CSV 导入处理完成',
        description: `成功 ${report.importedCount} · 跳过 ${report.skippedCount} · 失败 ${report.failedCount}`,
        tone: report.failedCount > 0 ? 'warning' : 'positive',
        duration: 10_000
      })
    })
  }

  const exportCsv = (
    kind: 'mice' | 'cages' | 'experiments' | 'weights' | 'events'
  ) => {
    if (!inventory) return
    void run(`csv:${kind}`, () => {
      const cageById = new Map(
        inventory.cages.map((cage) => [cage.id, cage])
      )
      const tagById = new Map(inventory.tags.map((tag) => [tag.id, tag]))
      const mouseById = new Map(
        inventory.mice.map((mouse) => [mouse.id, mouse])
      )
      const experimentById = new Map(
        inventory.experiments.map((experiment) => [
          experiment.id,
          experiment
        ])
      )
      let csv: string
      if (kind === 'mice') {
        csv = exportMiceCsv(
          inventory.mice.map((mouse) => ({
            mouse,
            cageNumber: mouse.currentCageId
              ? cageById.get(mouse.currentCageId)?.cageNumber
              : undefined,
            tagNames: mouse.tagIds.flatMap((id) => {
              const tag = tagById.get(id)
              return tag ? [tag.name] : []
            })
          }))
        )
      } else if (kind === 'cages') {
        csv = exportCagesCsv(
          inventory.cages.map((cage) => ({
            cage,
            currentCount: inventory.assignments.filter(
              (assignment) =>
                assignment.cageId === cage.id &&
                assignment.activeFlag === 1 &&
                assignment.deletedFlag === 0
            ).length
          }))
        )
      } else if (kind === 'experiments') {
        csv = exportExperimentsCsv(
          inventory.experiments.map((experiment) => ({
            experiment,
            groupCount: inventory.groups.filter(
              (group) => group.experimentId === experiment.id
            ).length,
            activeMouseCount: new Set(
              inventory.experimentAssignments
                .filter(
                  (assignment) =>
                    assignment.experimentId === experiment.id &&
                    assignment.activeFlag === 1
                )
                .map((assignment) => assignment.mouseId)
            ).size
          }))
        )
      } else if (kind === 'weights') {
        csv = exportWeightsCsv(
          inventory.weights.map((weight) => ({
            weight,
            mouseLabel: mouseById.has(weight.mouseId)
              ? mouseDisplayLabel(mouseById.get(weight.mouseId)!)
              : weight.mouseId
          }))
        )
      } else {
        csv = exportEventsCsv(
          inventory.events.map((event) => ({
            event,
            mouseLabel: mouseById.has(event.mouseId)
              ? mouseDisplayLabel(mouseById.get(event.mouseId)!)
              : event.mouseId,
            cageNumber: event.cageId
              ? cageById.get(event.cageId)?.cageNumber
              : undefined,
            experimentName: event.experimentId
              ? experimentById.get(event.experimentId)?.name
              : undefined
          }))
        )
      }
      downloadBlob(
        createCsvBlob(csv),
        timestampFilename(`mousekeeper-${kind}`, 'csv')
      )
      return Promise.resolve()
    })
  }

  const restoreEntity = (
    type: PurgeEntityType,
    id: string,
    revision: number
  ) => {
    void run(`restore:${type}:${id}`, async () => {
      if (type === 'mouse') {
        await appService.restoreMouse({
          operationId: crypto.randomUUID(),
          mouseId: id,
          expectedRevision: revision
        })
      } else if (type === 'cage') {
        await appService.restoreCage({
          operationId: crypto.randomUUID(),
          cageId: id,
          expectedRevision: revision
        })
      } else if (type === 'experiment') {
        await appService.restoreExperiment({
          operationId: crypto.randomUUID(),
          experimentId: id,
          expectedRevision: revision
        })
      } else if (type === 'task') {
        await appService.restoreTask({
          operationId: crypto.randomUUID(),
          taskId: id,
          expectedRevision: revision
        })
      } else {
        await appService.restoreTag({
          operationId: crypto.randomUUID(),
          tagId: id,
          expectedRevision: revision
        })
      }
      showToast({ title: '记录已恢复', tone: 'positive' })
    })
  }

  const inspectPurge = (type: PurgeEntityType, id: string) => {
    void run(`purge-preview:${type}:${id}`, async () => {
      setPurgePreview(await createPurgePreview(appDatabase, type, id))
      setPurgeConfirmation('')
    })
  }

  const confirmPurge = () => {
    if (!purgePreview || purgeConfirmation !== purgePreview.label) return
    void run('purge', async () => {
      const count = await purgeDeletedEntity(appDatabase, purgePreview)
      setPurgePreview(undefined)
      setPurgeConfirmation('')
      showToast({
        title: '记录已永久删除',
        description: `不可恢复地删除 ${count} 条记录`,
        tone: 'warning',
        duration: 10_000
      })
    })
  }

  const generateSample = () =>
    run('sample-generate', async () => {
      const result = await appService.generateSampleData({
        operationId: crypto.randomUUID()
      })
      showToast({
        title: '示例数据已生成',
        description: `批次 ${result.value.sampleBatchId.slice(0, 8)}`,
        tone: 'positive'
      })
    })

  const deleteSample = (sampleBatchId: string) =>
    run(`sample-delete:${sampleBatchId}`, async () => {
      const result = await appService.deleteSampleBatch({
        operationId: crypto.randomUUID(),
        sampleBatchId
      })
      showToast({
        title: '示例批次已完整删除',
        description: `${result.value.deletedCount} 条示例记录`,
        tone: 'warning'
      })
    })

  const recycleItems = inventory
    ? [
        ...inventory.deleted.mice.map((item) => ({
          type: 'mouse' as const,
          id: item.id,
          revision: item.revision,
          label: mouseDisplayLabel(item),
          deletedAt: item.deletedAt
        })),
        ...inventory.deleted.cages.map((item) => ({
          type: 'cage' as const,
          id: item.id,
          revision: item.revision,
          label: item.cageNumber,
          deletedAt: item.deletedAt
        })),
        ...inventory.deleted.experiments.map((item) => ({
          type: 'experiment' as const,
          id: item.id,
          revision: item.revision,
          label: item.name,
          deletedAt: item.deletedAt
        })),
        ...inventory.deleted.tasks.map((item) => ({
          type: 'task' as const,
          id: item.id,
          revision: item.revision,
          label: item.title,
          deletedAt: item.deletedAt
        })),
        ...inventory.deleted.tags.map((item) => ({
          type: 'tag' as const,
          id: item.id,
          revision: item.revision,
          label: item.name,
          deletedAt: item.deletedAt
        }))
      ].toSorted((left, right) =>
        (right.deletedAt ?? '').localeCompare(left.deletedAt ?? '')
      )
    : []

  return (
    <div className="feature-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">系统 / 数据安全</p>
          <h2>数据与安全</h2>
          <p>备份、恢复、导入、导出和回收站均直接操作此设备的 IndexedDB。</p>
        </div>
        <StatusChip
          icon={DatabaseBackup}
          label="本地优先"
          tone="positive"
        />
      </header>

      {error ? (
        <Alert title="数据操作没有完成" tone="critical">
          {error}
        </Alert>
      ) : null}

      <div className="segmented-tabs data-tabs" role="tablist" aria-label="数据工具">
        {(
          [
            ['backup', '备份与恢复'],
            ['import', 'CSV 导入'],
            ['export', 'CSV 导出'],
            ['recycle', `回收站 ${recycleItems.length}`],
            ['sample', '示例数据']
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={tab === value}
            key={value}
            role="tab"
            type="button"
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'backup' ? (
        <div className="data-tool-grid">
          <section className="data-tool-card">
            <header>
              <HardDriveDownload aria-hidden="true" size={21} />
              <div>
                <h3>导出完整 JSON 备份</h3>
                <p>包含版本、校验和与全部 16 张业务表。</p>
              </div>
            </header>
            <Alert title="建议定期下载" tone="informative">
              浏览器数据可能因清理站点数据、设备损坏或更换电脑而丢失。
            </Alert>
            <Button
              loading={busy === 'backup-export'}
              leadingIcon={<Download aria-hidden="true" size={17} />}
              onClick={() => void exportBackup()}
            >
              下载完整备份
            </Button>
          </section>

          <section className="data-tool-card">
            <header>
              <ArchiveRestore aria-hidden="true" size={21} />
              <div>
                <h3>替换恢复</h3>
                <p>先验证格式、版本、引用关系、计数和 SHA-256。</p>
              </div>
            </header>
            <label className="file-drop">
              <Upload aria-hidden="true" size={22} />
              <span>
                <strong>选择 MouseKeeper JSON 备份</strong>
                <small>最大 100 MB；选择文件不会立即修改数据。</small>
              </span>
              <input
                accept=".json,application/json"
                type="file"
                onChange={(event) => void chooseRestoreFile(event)}
              />
            </label>
            {busy === 'restore-preview' ? (
              <p role="status">正在验证备份…</p>
            ) : null}
            {restorePreview ? (
              <div className="restore-preview">
                <Alert
                  title={
                    restorePreview.canRestore
                      ? '备份验证通过'
                      : '备份不能恢复'
                  }
                  tone={restorePreview.canRestore ? 'positive' : 'critical'}
                >
                  {restorePreview.summary
                    ? `${restorePreview.summary.totalRecords} 条记录 · 导出于 ${formatInstant(
                        restorePreview.summary.exportedAt
                      )}`
                    : restorePreview.issues
                        .map((issue) => issue.message)
                        .join('；')}
                </Alert>
                {restorePreview.summary ? (
                  <dl className="backup-count-grid">
                    {BACKUP_TABLE_NAMES.map((table) => (
                      <div key={table}>
                        <dt>{TABLE_LABELS[table]}</dt>
                        <dd>{restorePreview.summary?.tableCounts[table]}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {restorePreview.canRestore ? (
                  <>
                    <Alert title="恢复将替换当前全部本地数据" tone="warning">
                      点击恢复时会先下载一份当前数据库安全备份；恢复在单一事务中执行，失败会自动回滚。
                    </Alert>
                    <label className="confirmation-field">
                      <span>
                        输入 <strong>替换本地数据</strong> 以确认
                      </span>
                      <Input
                        value={restoreConfirmation}
                        onChange={(event) =>
                          setRestoreConfirmation(event.target.value)
                        }
                      />
                    </label>
                    <Button
                      variant="danger"
                      disabled={restoreConfirmation !== '替换本地数据'}
                      loading={busy === 'restore'}
                      leadingIcon={<RefreshCw aria-hidden="true" size={17} />}
                      onClick={restoreBackup}
                    >
                      下载安全备份并执行恢复
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === 'import' ? (
        <section className="data-tool-card data-tool-card--wide">
          <header>
            <FileUp aria-hidden="true" size={21} />
            <div>
              <h3>导入小鼠 CSV</h3>
              <p>UTF-8、UTF-8 BOM 和中英文表头均可；错误行不会阻断其他有效行。</p>
            </div>
          </header>
          <label className="file-drop">
            <FileUp aria-hidden="true" size={22} />
            <span>
              <strong>{csvFile?.name ?? '选择 CSV 文件'}</strong>
              <small>最大 20 MB；先预览和映射，再提交。</small>
            </span>
            <input
              accept=".csv,text/csv"
              type="file"
              onChange={(event) => void chooseCsvFile(event)}
            />
          </label>
          {csvPreview ? (
            <>
              <div className="mapping-grid">
                {MOUSE_IMPORT_FIELDS.map((field) => (
                  <label key={field}>
                    <span>{IMPORT_FIELD_LABELS[field]}</span>
                    <select
                      value={mapping[field] ?? '__none__'}
                      onChange={(event) =>
                        setMapping((current) => ({
                          ...current,
                          [field]:
                            event.target.value === '__none__'
                              ? undefined
                              : event.target.value
                        }))
                      }
                    >
                      <option value="__none__">不导入</option>
                      {csvPreview.headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {validatedImport ? (
                <div className="import-summary">
                  <StatusChip
                    label={`${validatedImport.validCount} 行有效`}
                    tone="positive"
                  />
                  <StatusChip
                    label={`${validatedImport.invalidCount} 行错误`}
                    tone={
                      validatedImport.invalidCount > 0 ? 'critical' : 'neutral'
                    }
                  />
                  <StatusChip
                    label={`${validatedImport.warningCount} 行警告`}
                    tone={
                      validatedImport.warningCount > 0 ? 'warning' : 'neutral'
                    }
                  />
                </div>
              ) : null}
              <div className="import-preview-table">
                <table>
                  <thead>
                    <tr>
                      <th>行</th>
                      <th>状态</th>
                      <th>耳标 / 编号</th>
                      <th>品系</th>
                      <th>问题</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validatedImport?.rows.slice(0, 100).map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        <td>
                          <StatusChip
                            label={row.errors.length > 0 ? '错误' : '可导入'}
                            tone={
                              row.errors.length > 0 ? 'critical' : 'positive'
                            }
                          />
                        </td>
                        <td>
                          {row.candidate?.earTag ??
                            row.candidate?.experimentNumber ??
                            '—'}
                        </td>
                        <td>{row.candidate?.strain ?? '—'}</td>
                        <td>
                          {[...row.errors, ...row.warnings].join('；') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="form-actions">
                <span>
                  只提交通过预检的行；每行在独立事务中写入，业务失败会单行回滚。
                </span>
                <Button
                  disabled={!validatedImport?.validCount}
                  loading={busy === 'import'}
                  leadingIcon={<FileCheck2 aria-hidden="true" size={17} />}
                  onClick={commitImport}
                >
                  导入 {validatedImport?.validCount ?? 0} 行
                </Button>
              </div>
            </>
          ) : null}
          {importReport ? (
            <div className="import-report">
              <Alert
                title="导入报告"
                tone={importReport.failedCount > 0 ? 'warning' : 'positive'}
              >
                成功 {importReport.importedCount} · 跳过{' '}
                {importReport.skippedCount} · 失败 {importReport.failedCount}
              </Alert>
              <ul>
                {importReport.rows
                  .filter((row) => row.status !== 'imported')
                  .map((row) => (
                    <li key={row.rowNumber}>
                      第 {row.rowNumber} 行：{row.message}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'export' ? (
        <section className="data-tool-card data-tool-card--wide">
          <header>
            <FileDown aria-hidden="true" size={21} />
            <div>
              <h3>导出规范化 CSV</h3>
              <p>所有文本字段都会中和电子表格公式前缀，降低打开 CSV 时的注入风险。</p>
            </div>
          </header>
          <div className="export-grid">
            {(
              [
                ['mice', '小鼠档案', inventory?.mice.length ?? 0],
                ['cages', '笼位', inventory?.cages.length ?? 0],
                ['experiments', '实验', inventory?.experiments.length ?? 0],
                ['weights', '体重记录', inventory?.weights.length ?? 0],
                ['events', '事件记录', inventory?.events.length ?? 0]
              ] as const
            ).map(([kind, label, count]) => (
              <button key={kind} type="button" onClick={() => exportCsv(kind)}>
                <FileDown aria-hidden="true" size={18} />
                <span>
                  <strong>{label}</strong>
                  <small>{count} 条</small>
                </span>
                <Download aria-hidden="true" size={17} />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {tab === 'recycle' ? (
        <section className="data-tool-card data-tool-card--wide">
          <header>
            <Trash2 aria-hidden="true" size={21} />
            <div>
              <h3>回收站</h3>
              <p>恢复会重新检查唯一键；永久删除会先计算引用与影响范围。</p>
            </div>
          </header>
          {recycleItems.length === 0 ? (
            <EmptyState
              compact
              icon={ArchiveRestore}
              title="回收站为空"
              description="软删除的小鼠、笼位、实验、任务和标签会出现在这里。"
            />
          ) : (
            <ul className="recycle-list">
              {recycleItems.map((item) => (
                <li key={`${item.type}:${item.id}`}>
                  <div>
                    <strong>{item.label}</strong>
                    <span>
                      {item.type} ·{' '}
                      {item.deletedAt ? formatInstant(item.deletedAt) : '时间未知'}
                    </span>
                  </div>
                  <div className="row-actions">
                    <Button
                      size="small"
                      variant="secondary"
                      loading={busy === `restore:${item.type}:${item.id}`}
                      leadingIcon={<ArchiveRestore aria-hidden="true" size={15} />}
                      onClick={() =>
                        restoreEntity(
                          item.type,
                          item.id,
                          item.revision
                        )
                      }
                    >
                      恢复
                    </Button>
                    <Button
                      size="small"
                      variant="danger"
                      leadingIcon={<Trash2 aria-hidden="true" size={15} />}
                      onClick={() => inspectPurge(item.type, item.id)}
                    >
                      永久删除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === 'sample' ? (
        <section className="data-tool-card data-tool-card--wide">
          <header>
            <FlaskConical aria-hidden="true" size={21} />
            <div>
              <h3>示例数据</h3>
              <p>示例记录带独立批次标记，可闭合删除，不影响用户数据。</p>
            </div>
          </header>
          <Button
            loading={busy === 'sample-generate'}
            leadingIcon={<Rat aria-hidden="true" size={17} />}
            onClick={() => void generateSample()}
          >
            生成一组示例数据
          </Button>
          {inventory?.sampleBatches.length ? (
            <ul className="sample-batch-list">
              {inventory.sampleBatches.map((batch) => (
                <li key={batch.id}>
                  <div>
                    <strong>示例批次 {batch.id.slice(0, 8)}</strong>
                    <span>至少 {batch.count} 个顶层实体</span>
                  </div>
                  <Button
                    size="small"
                    variant="danger"
                    loading={busy === `sample-delete:${batch.id}`}
                    onClick={() => void deleteSample(batch.id)}
                  >
                    删除整个批次
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-copy">当前没有示例批次。</p>
          )}
        </section>
      ) : null}

      <Dialog
        open={Boolean(purgePreview)}
        onOpenChange={(open) => {
          if (!open) {
            setPurgePreview(undefined)
            setPurgeConfirmation('')
          }
        }}
        title="永久删除记录"
        description="此操作不可撤销，也不会出现在回收站中。"
        footer={
          <>
            <Button
              variant="tertiary"
              onClick={() => setPurgePreview(undefined)}
            >
              取消
            </Button>
            <Button
              variant="danger"
              disabled={
                !purgePreview?.canPurge ||
                purgeConfirmation !== purgePreview.label
              }
              loading={busy === 'purge'}
              leadingIcon={<ShieldAlert aria-hidden="true" size={16} />}
              onClick={confirmPurge}
            >
              永久删除
            </Button>
          </>
        }
      >
        {purgePreview ? (
          <div className="purge-preview">
            <Alert
              title={
                purgePreview.canPurge
                  ? `将删除 ${Object.values(purgePreview.deleteCounts).reduce((sum, value) => sum + value, 0)} 条记录`
                  : '存在引用，禁止永久删除'
              }
              tone={purgePreview.canPurge ? 'warning' : 'critical'}
            >
              {purgePreview.blockers.length > 0
                ? purgePreview.blockers.join('；')
                : Object.entries(purgePreview.deleteCounts)
                    .filter(([, count]) => count > 0)
                    .map(([name, count]) => `${name} ${count}`)
                    .join('、')}
            </Alert>
            {purgePreview.canPurge ? (
              <label className="confirmation-field">
                <span>
                  输入记录名称 <strong>{purgePreview.label}</strong> 以确认
                </span>
                <Input
                  autoFocus
                  value={purgeConfirmation}
                  onChange={(event) =>
                    setPurgeConfirmation(event.target.value)
                  }
                />
              </label>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}
