import { useLiveQuery } from 'dexie-react-hooks'
import {
  Database,
  HardDrive,
  MonitorCog,
  ShieldCheck
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { appDatabase } from '../../app/runtime'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { StatusChip } from '../../components/ui/StatusChip'
import { APP_CONFIG } from '../../config/app'
import { scanIntegrity, type IntegrityReport } from '../../db'
import { useTheme } from '../../hooks/useTheme'
import type { ThemePreference } from '../../hooks/themeContext'
import { readableError } from '../../lib/errors'
import { AgentSettingsPanel } from './AgentSettingsPanel'

const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
] as const

function formatBytes(value: number | undefined): string {
  if (value === undefined) return '浏览器未提供'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(2)} GB`
}

export function SettingsPage() {
  const { preference, resolvedTheme, setPreference } = useTheme()
  const [storageEstimate, setStorageEstimate] =
    useState<StorageEstimate>()
  const [persistent, setPersistent] = useState<boolean>()
  const [integrity, setIntegrity] = useState<IntegrityReport>()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const counts = useLiveQuery(async () => {
    const values = await Promise.all(
      appDatabase.tables.map((table) => table.count())
    )
    return {
      records: values.reduce((sum, count) => sum + count, 0),
      tables: values.length
    }
  }, [])

  useEffect(() => {
    if (!navigator.storage) return
    void navigator.storage.estimate().then(setStorageEstimate)
    if (navigator.storage.persisted) {
      void navigator.storage.persisted().then(setPersistent)
    }
  }, [])

  const requestPersistence = async () => {
    if (!navigator.storage?.persist) {
      setError('当前浏览器不支持持久存储请求。')
      return
    }
    setBusy('persistence')
    setError(undefined)
    try {
      setPersistent(await navigator.storage.persist())
      setStorageEstimate(await navigator.storage.estimate())
    } catch (requestError) {
      setError(readableError(requestError))
    } finally {
      setBusy(undefined)
    }
  }

  const runIntegrityCheck = async () => {
    setBusy('integrity')
    setError(undefined)
    try {
      setIntegrity(await scanIntegrity(appDatabase))
    } catch (scanError) {
      setError(readableError(scanError))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="feature-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">系统 / 设置</p>
          <h2>设置</h2>
          <p>界面偏好存入 localStorage；业务事实始终保存在 IndexedDB。</p>
        </div>
        <StatusChip
          icon={ShieldCheck}
          label="无需账号"
          tone="positive"
        />
      </header>

      {error ? (
        <Alert title="设置操作没有完成" tone="critical">
          {error}
        </Alert>
      ) : null}

      <div className="settings-grid">
        <section className="settings-card">
          <header>
            <MonitorCog aria-hidden="true" size={21} />
            <div>
              <h3>外观</h3>
              <p>主题选择只影响界面，不修改业务数据。</p>
            </div>
          </header>
          <label className="setting-row">
            <span>
              <strong>主题模式</strong>
              <small>当前实际显示：{resolvedTheme === 'dark' ? '深色' : '浅色'}</small>
            </span>
            <Select
              ariaLabel="主题模式"
              value={preference}
              options={THEME_OPTIONS}
              onValueChange={(value) =>
                setPreference(value as ThemePreference)
              }
            />
          </label>
        </section>

        <section className="settings-card">
          <header>
            <HardDrive aria-hidden="true" size={21} />
            <div>
              <h3>浏览器存储</h3>
              <p>请求持久存储可降低浏览器自动清理本地数据的概率。</p>
            </div>
          </header>
          <dl className="stacked-facts">
            <div>
              <dt>已使用</dt>
              <dd>{formatBytes(storageEstimate?.usage)}</dd>
            </div>
            <div>
              <dt>估算配额</dt>
              <dd>{formatBytes(storageEstimate?.quota)}</dd>
            </div>
            <div>
              <dt>持久存储</dt>
              <dd>
                {persistent === undefined
                  ? '浏览器未报告'
                  : persistent
                    ? '已授予'
                    : '未授予'}
              </dd>
            </div>
          </dl>
          <Button
            variant="secondary"
            disabled={persistent === true}
            loading={busy === 'persistence'}
            onClick={() => void requestPersistence()}
          >
            {persistent ? '已启用持久存储' : '请求持久存储'}
          </Button>
        </section>

        <section className="settings-card">
          <header>
            <Database aria-hidden="true" size={21} />
            <div>
              <h3>数据库与版本</h3>
              <p>版本集中配置，迁移由 Dexie schema 版本管理。</p>
            </div>
          </header>
          <dl className="stacked-facts">
            <div>
              <dt>应用版本</dt>
              <dd>{APP_CONFIG.version}</dd>
            </div>
            <div>
              <dt>Schema 版本</dt>
              <dd>{APP_CONFIG.schemaVersion}</dd>
            </div>
            <div>
              <dt>Dexie 数据库版本</dt>
              <dd>{appDatabase.verno}</dd>
            </div>
            <div>
              <dt>业务表 / 记录</dt>
              <dd>
                {counts ? `${counts.tables} / ${counts.records}` : '读取中'}
              </dd>
            </div>
          </dl>
          <Button
            variant="secondary"
            loading={busy === 'integrity'}
            onClick={() => void runIntegrityCheck()}
          >
            运行完整性扫描
          </Button>
          {integrity ? (
            <Alert
              title={
                integrity.ok
                  ? '数据库完整性检查通过'
                  : `发现 ${integrity.issues.length} 个问题`
              }
              tone={integrity.ok ? 'positive' : 'critical'}
            >
              {integrity.ok
                ? `检查了 ${Object.values(integrity.counts).reduce((sum, count) => sum + count, 0)} 条记录。`
                : integrity.issues
                    .slice(0, 5)
                    .map((issue) => issue.message)
                    .join('；')}
            </Alert>
          ) : null}
        </section>
      </div>
      <AgentSettingsPanel />
    </div>
  )
}
