import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  FileUp,
  History,
  LoaderCircle,
  Pencil,
  Quote,
  RotateCcw,
  Send,
  Settings2,
  Square,
  TriangleAlert,
  X
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type KeyboardEvent
} from 'react'
import { Link } from 'wouter'
import { agentOrchestrator, recoveryManager } from '../../agent/runtime'
import type { AgentProgress, AgentRunReference, AgentRunResult } from '../../agent/orchestrator'
import { providerSettingsStore } from '../../agent/provider/settings-store'
import { secretStore } from '../../agent/provider/secret-store'
import type { AgentCommandRun } from '../../agent/recovery'
import { applicationContextStore, fileBroker, type EntityReference } from '../../application'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { StatusChip } from '../../components/ui/StatusChip'
import { Textarea } from '../../components/ui/Textarea'
import { readableError } from '../../lib/errors'
import { commandCanUndo, commandHasChanges, commandStatusLabel, prependBoundedRun } from './run-presentation'

interface RunView {
  commandRun: AgentCommandRun
  result?: AgentRunResult
}

function sessionId(): string {
  const key = 'mousekeeper:agent-session-id'
  const current = window.sessionStorage.getItem(key)
  if (current) return current
  const next = crypto.randomUUID()
  window.sessionStorage.setItem(key, next)
  return next
}

function contextRoute(): string {
  return window.sessionStorage.getItem('mousekeeper:agent-context-route') ?? '/dashboard'
}

function selectedFromRoute(route: string): EntityReference[] {
  const match = route.match(/^\/(mice|cages|breeding|experiments)\/([^/]+)(?:\/.*)?$/)
  if (!match) return []
  const typeByRoute: Record<string, string> = {
    mice: 'mouse',
    cages: 'cage',
    breeding: 'breedingPair',
    experiments: 'experiment'
  }
  return [{
    type: typeByRoute[match[1]!]!,
    id: decodeURIComponent(match[2]!),
    href: `/${match[1]}/${match[2]}`
  }]
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value))
}

function recoveryLabel(run: AgentCommandRun): string {
  if (run.status === 'undone') return '已撤回'
  if (run.recoveryKind === 'full-backup') return '完整恢复点'
  if (run.recoveryKind === 'row-diff') return '逐行恢复点'
  return '无数据变化'
}

function statusTone(run: AgentCommandRun): 'positive' | 'critical' | 'warning' | 'neutral' {
  if (run.status === 'succeeded') return 'positive'
  if (run.status === 'failed' || run.status === 'undo-conflict') return 'critical'
  if (run.status === 'running') return 'warning'
  return 'neutral'
}

export function AgentPage() {
  const settings = useSyncExternalStore(
    (listener) => providerSettingsStore.subscribe(listener),
    () => providerSettingsStore.snapshot(),
    () => providerSettingsStore.snapshot()
  )
  const pageContext = useSyncExternalStore(
    applicationContextStore.subscribe,
    applicationContextStore.snapshot,
    applicationContextStore.snapshot
  )
  const [presetId, setPresetId] = useState(settings.defaultPresetId)
  const [prompt, setPrompt] = useState('')
  const [runs, setRuns] = useState<RunView[]>([])
  const [busy, setBusy] = useState(false)
  const [liveText, setLiveText] = useState('')
  const [liveTraces, setLiveTraces] = useState<AgentCommandRun['traces']>([])
  const [error, setError] = useState<string>()
  const [undoing, setUndoing] = useState<string>()
  const [fileBusy, setFileBusy] = useState<string>()
  const [referenceIds, setReferenceIds] = useState<string[]>([])
  const abortRef = useRef<AbortController | undefined>(undefined)
  const activeExecutionRef = useRef<string | undefined>(undefined)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const route = pageContext?.route ?? contextRoute()
  const selected = pageContext ? [...pageContext.selected] : selectedFromRoute(route)
  const preset = settings.presets.find((item) => item.id === presetId) ?? settings.presets[0]
  const profile = settings.profiles.find((item) => item.id === preset?.providerProfileId)
  const configured = Boolean(profile && (
    profile.authMode === 'none' ||
    (profile.secretRef && secretStore.metadata(profile.secretRef).configured)
  ))
  const references = referenceIds.flatMap((id): AgentRunReference[] => {
    const run = runs.find((item) => item.commandRun.id === id)?.commandRun
    return run ? [{
      id: run.id,
      createdAt: run.createdAt,
      prompt: run.prompt,
      status: run.status,
      summary: run.summary,
      error: run.error,
      capabilityIds: [...run.capabilityIds]
    }] : []
  })

  const toggleReference = (id: string) => {
    setReferenceIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id].slice(-6))
  }

  useEffect(() => {
    void recoveryManager.recent(30).then((history) => {
      setRuns(history.map((commandRun) => ({ commandRun })))
    }).catch((historyError) => setError(readableError(historyError)))
  }, [])

  const recordProgress = (progress: AgentProgress) => {
    if (progress.type === 'text-delta') setLiveText(progress.text)
    if (progress.type === 'text') setLiveText(progress.text)
    if (progress.type === 'tool-started') {
      setLiveTraces((current) => [...current, progress.trace])
    }
    if (progress.type === 'tool-completed') {
      setLiveTraces((current) => current.map((trace) =>
        trace.capabilityId === progress.trace.capabilityId && trace.startedAt === progress.trace.startedAt
          ? progress.trace
          : trace
      ))
    }
  }

  const execute = async (text: string) => {
    if (!text.trim() || busy || !preset || !profile) return
    const controller = new AbortController()
    const executionId = crypto.randomUUID()
    abortRef.current = controller
    activeExecutionRef.current = executionId
    setBusy(true)
    setError(undefined)
    setLiveText('')
    setLiveTraces([])
    try {
      const result = await agentOrchestrator.run({
        sessionId: sessionId(),
        prompt: text.trim(),
        profile,
        preset,
        context: {
          currentRoute: route,
          selected,
          references,
          visibleFilters: pageContext?.visibleFilters,
          locale: navigator.language || 'zh-CN',
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          now: new Date().toISOString()
        }
      }, controller.signal, {
        onProgress: (progress) => {
          if (activeExecutionRef.current === executionId) recordProgress(progress)
        }
      })
      setRuns((current) => prependBoundedRun(current, { commandRun: result.commandRun, result }))
      if (result.status === 'failed') setError(result.error ?? 'Agent 命令没有完成')
      setPrompt('')
      setReferenceIds([])
    } catch (runError) {
      setError(readableError(runError))
    } finally {
      if (activeExecutionRef.current === executionId) activeExecutionRef.current = undefined
      abortRef.current = undefined
      setBusy(false)
      setLiveText('')
      setLiveTraces([])
    }
  }

  const submit = () => void execute(prompt)

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  const undo = async (runId: string) => {
    setUndoing(runId)
    setError(undefined)
    try {
      const result = await recoveryManager.undo(runId)
      setRuns((current) => current.map((item) => item.commandRun.id === runId
        ? { ...item, commandRun: result.commandRun, result: item.result ? { ...item.result, commandRun: result.commandRun } : undefined }
        : item))
    } catch (undoError) {
      setError(readableError(undoError))
      const latest = await recoveryManager.get(runId)
      if (latest) setRuns((current) => current.map((item) => item.commandRun.id === runId ? { ...item, commandRun: latest } : item))
    } finally {
      setUndoing(undefined)
    }
  }

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>, requestId: string, originalPrompt: string) => {
    const file = event.target.files?.[0]
    if (!file) return
    setFileBusy(requestId)
    setError(undefined)
    try {
      const request = fileBroker.provide(requestId, file)
      const previewCapability = request.kind === 'backup-restore' ? 'data.backup.preview' : 'data.csv.preview'
      const commitCapability = request.kind === 'backup-restore' ? 'data.backup.restore' : 'data.csv.import'
      await execute(`原始指令是：“${originalPrompt}”。我已通过用户手势选择文件“${file.name}”。必须先调用 ${previewCapability}，fileRequestId 为 ${requestId}。预览通过后：若原始指令明确要求执行恢复或导入，立即用预览结果的 previewToken 调用 ${commitCapability}；若原始指令只要求选择、检查或预览，则显示预览后停止。`)
    } catch (fileError) {
      setError(readableError(fileError))
    } finally {
      event.target.value = ''
      setFileBusy(undefined)
    }
  }

  return (
    <div className="agent-workspace">
      <header className="agent-workspace__header">
        <div>
          <p className="feature-page__eyebrow">操作台 / 可审计执行</p>
          <h2><Bot aria-hidden="true" size={27} />MouseKeeper Agent</h2>
          <p>用自然语言调用与界面相同的业务能力；每次命令形成独立执行记录与恢复边界。</p>
        </div>
        <Link className="ui-button ui-button--secondary ui-button--small" href="/settings">
          <Settings2 aria-hidden="true" size={15} />模型设置
        </Link>
      </header>

      <section className="agent-context-strip" aria-label="Agent 当前上下文">
        <span><strong>页面上下文</strong>{route}</span>
        <span><strong>当前筛选</strong>{pageContext ? `${pageContext.workspace} · ${Object.entries(pageContext.visibleFilters).filter(([, value]) => value !== undefined && value !== '' && value !== 'all').map(([key, value]) => `${key}=${String(value)}`).join('，') || '无筛选'}` : '无页面状态'}</span>
        <span><strong>选中对象</strong>{selected.length ? selected.map((item) => `${item.type} · ${item.label ?? item.id}`).join('；') : '无'}</span>
        <label>
          <strong>模型预设</strong>
          <Select ariaLabel="Agent 模型预设" value={preset?.id ?? ''} options={settings.presets.map((item) => ({ value: item.id, label: `${item.name} · ${item.model}` }))} onValueChange={setPresetId} />
        </label>
      </section>

      {!configured ? (
        <Alert title="模型连接尚未就绪" tone="warning" action={<Link href="/settings">前往设置</Link>}>
          当前 Provider 需要 API Key，但还没有配置可用秘密。也可以把认证方式设为“无认证 / 网关持钥”。
        </Alert>
      ) : null}
      {error ? <Alert title="Agent 操作没有完成" tone="critical">{error}</Alert> : null}

      <div className="agent-workspace__grid">
        <section className="agent-command-panel" aria-labelledby="agent-command-title">
          <div className="agent-section-heading">
            <div>
              <span>COMMAND</span>
              <h3 id="agent-command-title">描述你要完成的工作</h3>
            </div>
            <StatusChip label={configured ? '连接配置可用' : '等待配置'} tone={configured ? 'positive' : 'warning'} />
          </div>
          <div className="agent-composer">
            {references.length ? <div className="agent-references" aria-label="已引用的对话记录">
              <div><Quote aria-hidden="true" size={15} /><strong>已引用 {references.length} 条记录</strong><span>将随本次命令发送给模型</span></div>
              <div>{references.map((reference) => <button disabled={busy} key={reference.id} type="button" onClick={() => toggleReference(reference.id)} title="移除引用"><span>{reference.prompt}</span><X aria-hidden="true" size={13} /></button>)}</div>
            </div> : null}
            <Textarea
              aria-label="Agent 命令"
              autoFocus
              disabled={busy}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="例如：找到笼位 C-12 中所有在研小鼠，给它们创建明天下午 3 点称重任务，然后打开任务页只看未完成。"
              ref={composerRef}
              rows={8}
              value={prompt}
            />
            <div className="agent-composer__footer">
              <span>Enter 执行 · Shift + Enter 换行 · ⌘/Ctrl + J 随时打开</span>
              {busy ? (
                <Button variant="secondary" leadingIcon={<Square aria-hidden="true" size={14} />} onClick={() => { activeExecutionRef.current = undefined; setLiveText(''); abortRef.current?.abort() }}>停止</Button>
              ) : (
                <Button disabled={!configured || !prompt.trim()} leadingIcon={<Send aria-hidden="true" size={15} />} onClick={submit}>执行命令</Button>
              )}
            </div>
          </div>

          {busy ? (
            <div className="agent-live-run" aria-live="polite">
              <div><LoaderCircle aria-hidden="true" className="ui-button__spinner" size={17} /><strong>正在执行</strong></div>
              {liveTraces.length ? <ol className="agent-trace-list">{liveTraces.map((trace) => <li data-status={trace.status} key={`${trace.capabilityId}:${trace.startedAt}`}><span /> <div><strong>{trace.capabilityId}</strong><p>{trace.summary ?? (trace.status === 'running' ? '正在调用共享业务能力…' : trace.error)}</p></div></li>)}</ol> : <p>模型正在解析目标与可用能力…</p>}
              {liveText ? <p className="agent-live-run__text">{liveText}</p> : null}
            </div>
          ) : null}

          <div className="agent-command-examples">
            <span>可直接尝试</span>
            {[
              '统计最近 7 天体重下降超过 10% 的小鼠，并打开第一只的档案',
              '把逾期任务按到期时间排序，只显示未完成',
              '导出全部小鼠 CSV',
              '创建一个完整备份'
            ].map((example) => <button key={example} type="button" onClick={() => { setPrompt(example); composerRef.current?.focus() }}>{example}</button>)}
          </div>
        </section>

        <section className="agent-ledger" aria-labelledby="agent-ledger-title">
          <div className="agent-section-heading">
            <div>
              <span>EXECUTION LEDGER</span>
              <h3 id="agent-ledger-title">执行记录</h3>
            </div>
            <History aria-hidden="true" size={18} />
          </div>
          {runs.length === 0 ? (
            <div className="agent-ledger__empty"><Bot aria-hidden="true" size={28} /><strong>还没有 Agent 命令</strong><p>执行后，这里会显示工具调用、影响对象、警告与恢复点。</p></div>
          ) : (
            <div className="agent-run-list">
              {runs.map(({ commandRun, result }) => {
                const hasChanges = commandHasChanges(commandRun)
                const canUndo = commandCanUndo(commandRun)
                const fileRequests = result?.results.flatMap((item) => item.artifacts ?? []).filter((artifact) => artifact.kind === 'file-request') ?? []
                const filePreviews = result?.results.filter((item) => item.capabilityId === 'data.backup.preview' || item.capabilityId === 'data.csv.preview') ?? []
                const openTargets = result?.results.flatMap((item) => item.open ? [item.open] : []) ?? []
                return (
                  <article className="agent-run-card" data-status={commandRun.status} key={commandRun.id}>
                    <header>
                      <div>
                        <span>{dateTime(commandRun.createdAt)} · {commandRun.model ?? '未知模型'}</span>
                        <h4>{commandRun.prompt}</h4>
                      </div>
                      <StatusChip label={commandStatusLabel(commandRun)} tone={statusTone(commandRun)} icon={commandRun.status === 'succeeded' ? CheckCircle2 : commandRun.status === 'running' ? LoaderCircle : TriangleAlert} />
                    </header>
                    <p className="agent-run-card__summary">{commandRun.summary ?? commandRun.error ?? '没有摘要'}</p>

                    {commandRun.traces.length ? <ol className="agent-trace-list">{commandRun.traces.map((trace) => <li data-status={trace.status} key={`${trace.capabilityId}:${trace.startedAt}`}><span /><div><strong>{trace.capabilityId}</strong><p>{trace.summary ?? trace.error ?? '调用完成'}</p></div></li>)}</ol> : null}

                    {result?.affected.length ? <div className="agent-affected"><strong>受影响记录</strong><div>{result.affected.map((entity) => entity.href ? <Link href={entity.href} key={`${entity.type}:${entity.id}`}>{entity.label ?? entity.id}<ArrowUpRight aria-hidden="true" size={12} /></Link> : <span key={`${entity.type}:${entity.id}`}>{entity.label ?? entity.id}</span>)}</div></div> : null}

                    {fileRequests.map((artifact) => {
                      const request = fileBroker.getRequest(artifact.id)
                      return request?.status === 'waiting' ? <label className="agent-file-request" key={artifact.id}><FileUp aria-hidden="true" size={18} /><span><strong>{artifact.name}</strong><small>选择后自动继续预览，并按原始指令决定是否提交</small></span><span className="ui-button ui-button--primary ui-button--small">{fileBusy === artifact.id ? '处理中…' : '选择文件'}</span><input className="sr-only" disabled={busy || Boolean(fileBusy)} type="file" accept={request.accept} onChange={(event) => void chooseFile(event, artifact.id, commandRun.prompt)} /></label> : null
                    })}

                    {filePreviews.map((preview) => (
                      <details className="agent-file-preview" key={`${preview.capabilityId}:${commandRun.id}`}>
                        <summary>查看文件预览详情</summary>
                        <pre>{JSON.stringify(preview.data, null, 2)}</pre>
                      </details>
                    ))}

                    <footer>
                      <span>{commandRun.status === 'failed' && hasChanges ? '执行失败，但已记录可撤回变化' : recoveryLabel(commandRun)} · {commandRun.changes.length + commandRun.preferenceChanges.length} 项变化</span>
                      <div>
                        <Button aria-pressed={referenceIds.includes(commandRun.id)} disabled={busy} size="small" variant={referenceIds.includes(commandRun.id) ? 'secondary' : 'tertiary'} leadingIcon={<Quote aria-hidden="true" size={14} />} onClick={() => toggleReference(commandRun.id)}>{referenceIds.includes(commandRun.id) ? '已引用' : '引用'}</Button>
                        <Button size="small" variant="tertiary" leadingIcon={<Pencil aria-hidden="true" size={14} />} onClick={() => { setPrompt(commandRun.prompt); composerRef.current?.focus() }}>编辑重发</Button>
                        <Button size="small" variant="tertiary" disabled={busy} onClick={() => void execute(commandRun.prompt)}>重试</Button>
                        {openTargets.map((target) => <Link className="ui-button ui-button--tertiary ui-button--small" href={target.href} key={target.href}>{target.label}<ArrowUpRight aria-hidden="true" size={13} /></Link>)}
                        {canUndo ? <Button size="small" variant="secondary" loading={undoing === commandRun.id} leadingIcon={<RotateCcw aria-hidden="true" size={14} />} onClick={() => void undo(commandRun.id)}>撤回整条命令</Button> : null}
                      </div>
                    </footer>
                    <details><summary>技术详情</summary><pre>{JSON.stringify({ id: commandRun.id, capabilities: commandRun.capabilityIds, recovery: commandRun.recoveryKind, warnings: result?.results.flatMap((item) => item.warnings) ?? [], error: commandRun.error }, null, 2)}</pre></details>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
