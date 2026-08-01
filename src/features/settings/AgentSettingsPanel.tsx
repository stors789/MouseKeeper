import { Copy, Download, Eye, EyeOff, KeyRound, ListRestart, Plus, RefreshCw, ShieldAlert, Trash2, Upload } from 'lucide-react'
import { useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import { Alert } from '../../components/ui/Alert'
import { downloadBlob } from '../../lib/download'
import { providerClient } from '../../agent/runtime'
import { providerSettingsStore } from '../../agent/provider/settings-store'
import { secretStore } from '../../agent/provider/secret-store'
import { ProviderError, type ConnectionReport, type LLMPreset, type ProviderHeader, type ProviderProfile, type ProviderSettingsDocument, type SecretStoragePolicy } from '../../agent/provider/types'
import { CHAT_COMPATIBLE_CAPABILITIES, OPENAI_RESPONSES_CAPABILITIES } from '../../agent/provider/defaults'
import { readableError } from '../../lib/errors'

function useProviderSettings(): ProviderSettingsDocument {
  return useSyncExternalStore(
    (listener) => providerSettingsStore.subscribe(listener),
    () => providerSettingsStore.snapshot(),
    () => providerSettingsStore.snapshot()
  )
}

function numberValue(value: string): number | undefined {
  return value.trim() === '' ? undefined : Number(value)
}

function updateDocument(mutator: (document: ProviderSettingsDocument) => ProviderSettingsDocument) {
  providerSettingsStore.update(mutator)
}

function serializedHeaders(profile: ProviderProfile | undefined): string {
  if (!profile) return '[]'
  return JSON.stringify(profile.customHeaders.map((header) => ({
    name: header.name,
    value: header.secret ? '' : header.value ?? '',
    secret: header.secret,
    configured: header.secret && header.secretRef
      ? secretStore.metadata(header.secretRef).configured
      : undefined
  })), null, 2)
}

export function AgentSettingsPanel() {
  const settings = useProviderSettings()
  const initialProfile = settings.profiles[0]
  const initialPreset = settings.presets.find((item) => item.id === settings.defaultPresetId) ?? settings.presets[0]
  const [profileId, setProfileId] = useState(initialProfile?.id ?? '')
  const [presetId, setPresetId] = useState(initialPreset?.id ?? '')
  const [secret, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [secretPolicy, setSecretPolicy] = useState<SecretStoragePolicy>(() => initialProfile?.secretRef ? secretStore.metadata(initialProfile.secretRef).policy : 'prompt')
  const [headersJson, setHeadersJson] = useState(() => serializedHeaders(initialProfile))
  const [providerParamsJson, setProviderParamsJson] = useState(() => JSON.stringify(initialPreset?.providerParameters ?? {}, null, 2))
  const [busy, setBusy] = useState<string>()
  const [message, setMessage] = useState<{ tone: 'positive' | 'critical' | 'warning'; title: string; detail?: string }>()
  const importRef = useRef<HTMLInputElement>(null)
  const profile = settings.profiles.find((item) => item.id === profileId) ?? settings.profiles[0]
  const preset = settings.presets.find((item) => item.id === presetId) ?? settings.presets[0]
  const connection = profile ? settings.connectionReports[profile.id] : undefined

  if (!profile || !preset) return null

  const selectProfile = (id: string) => {
    const next = settings.profiles.find((item) => item.id === id)
    setProfileId(id)
    setHeadersJson(serializedHeaders(next))
    setSecretPolicy(next?.secretRef ? secretStore.metadata(next.secretRef).policy : 'prompt')
  }

  const selectPreset = (id: string) => {
    const next = settings.presets.find((item) => item.id === id)
    setPresetId(id)
    setProviderParamsJson(JSON.stringify(next?.providerParameters ?? {}, null, 2))
  }

  const updateProfile = (patch: Partial<ProviderProfile>) => {
    updateDocument((document) => ({
      ...document,
      profiles: document.profiles.map((item) =>
        item.id === profile.id
          ? { ...item, ...patch, id: item.id, updatedAt: new Date().toISOString() }
          : item
      )
    }))
  }

  const updatePreset = (patch: Partial<LLMPreset>) => {
    updateDocument((document) => ({
      ...document,
      presets: document.presets.map((item) =>
        item.id === preset.id
          ? { ...item, ...patch, id: item.id, updatedAt: new Date().toISOString() }
          : item
      )
    }))
  }

  const saveSecret = () => {
    try {
      const secretRef = profile.secretRef ?? `provider-${profile.id}`
      secretStore.set(secretRef, secret, secretPolicy)
      updateProfile({ secretRef })
      setSecret('')
      setMessage({ tone: 'positive', title: 'API Key 已保存', detail: '密钥不会进入业务备份、Agent 历史或模型上下文。' })
    } catch (error) {
      setMessage({ tone: 'critical', title: 'API Key 没有保存', detail: readableError(error) })
    }
  }

  const saveHeaders = () => {
    try {
      const parsed: unknown = JSON.parse(headersJson)
      if (!Array.isArray(parsed)) throw new Error('请求头必须是 JSON 数组')
      const headers: ProviderHeader[] = parsed.map((value, index) => {
        if (!value || typeof value !== 'object') throw new Error(`第 ${index + 1} 个请求头无效`)
        const source = value as Record<string, unknown>
        const secretHeader = source.secret === true
        const header: ProviderHeader = {
          id: profile.customHeaders[index]?.id ?? crypto.randomUUID(),
          name: typeof source.name === 'string' ? source.name : '',
          secret: secretHeader
        }
        if (secretHeader) {
          const existingRef = profile.customHeaders[index]?.secretRef
          const valueText = typeof source.value === 'string' ? source.value : ''
          header.secretRef = existingRef ?? `header-${profile.id}-${header.id}`
          if (valueText) secretStore.set(header.secretRef, valueText, secretPolicy)
        } else header.value = typeof source.value === 'string' ? source.value : ''
        return header
      })
      updateProfile({ customHeaders: headers })
      setMessage({ tone: 'positive', title: '自定义请求头已保存' })
    } catch (error) {
      setMessage({ tone: 'critical', title: '请求头没有保存', detail: readableError(error) })
    }
  }

  const saveProviderParameters = () => {
    try {
      const parsed: unknown = JSON.parse(providerParamsJson)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Provider 参数必须是 JSON 对象')
      updatePreset({ providerParameters: parsed as Record<string, unknown> })
      setMessage({ tone: 'positive', title: 'Provider 特有参数已保存' })
    } catch (error) {
      setMessage({ tone: 'critical', title: 'Provider 参数没有保存', detail: readableError(error) })
    }
  }

  const duplicatePreset = () => {
    const now = new Date().toISOString()
    const copy = { ...structuredClone(preset), id: crypto.randomUUID(), name: `${preset.name} 副本`, createdAt: now, updatedAt: now }
    updateDocument((document) => ({ ...document, presets: [...document.presets, copy] }))
    setPresetId(copy.id)
    setProviderParamsJson(JSON.stringify(copy.providerParameters, null, 2))
  }

  const addProfile = () => {
    const now = new Date().toISOString()
    const copy = { ...structuredClone(profile), id: crypto.randomUUID(), name: `${profile.name} 副本`, secretRef: undefined, customHeaders: [], createdAt: now, updatedAt: now }
    updateDocument((document) => ({ ...document, profiles: [...document.profiles, copy] }))
    setProfileId(copy.id)
    setHeadersJson('[]')
    setSecretPolicy('prompt')
  }

  const deletePreset = () => {
    if (settings.presets.length <= 1) return
    updateDocument((document) => {
      const presets = document.presets.filter((item) => item.id !== preset.id)
      return { ...document, presets, defaultPresetId: document.defaultPresetId === preset.id ? presets[0]!.id : document.defaultPresetId }
    })
    selectPreset(settings.presets.find((item) => item.id !== preset.id)!.id)
  }

  const runConnection = async (kind: 'models' | 'test') => {
    setBusy(kind)
    setMessage(undefined)
    try {
      if (kind === 'models') {
        const models = await providerClient.listModels(profile)
        const report: ConnectionReport = { ok: true, testedAt: new Date().toISOString(), method: 'models', modelCount: models.length }
        updateDocument((document) => ({ ...document, connectionReports: { ...document.connectionReports, [profile.id]: report } }))
        setMessage({ tone: 'positive', title: `读取到 ${models.length} 个模型`, detail: models.slice(0, 12).map((item) => item.id).join('、') || '接口可用，但没有返回模型。' })
      } else {
        const report = await providerClient.testConnection(profile, preset)
        updateDocument((document) => ({ ...document, connectionReports: { ...document.connectionReports, [profile.id]: report } }))
        setMessage(report.ok
          ? { tone: 'positive', title: '连接测试通过', detail: `方式：${report.method}` }
          : { tone: 'critical', title: '连接测试失败', detail: report.error?.message })
      }
    } catch (error) {
      const report: ConnectionReport = {
        ok: false,
        testedAt: new Date().toISOString(),
        method: kind === 'models' ? 'models' : 'generation',
        error: { kind: error instanceof ProviderError ? error.kind : 'protocol', message: readableError(error) }
      }
      updateDocument((document) => ({ ...document, connectionReports: { ...document.connectionReports, [profile.id]: report } }))
      setMessage({ tone: 'critical', title: '连接操作失败', detail: readableError(error) })
    } finally {
      setBusy(undefined)
    }
  }

  const importSettings = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const imported = providerSettingsStore.importWithoutSecrets(await file.text())
      const nextProfile = imported.profiles[0]!
      const nextPreset = imported.presets.find((item) => item.id === imported.defaultPresetId)!
      setProfileId(nextProfile.id)
      setPresetId(nextPreset.id)
      setHeadersJson(serializedHeaders(nextProfile))
      setSecretPolicy('prompt')
      setProviderParamsJson(JSON.stringify(nextPreset.providerParameters, null, 2))
      setMessage({ tone: 'positive', title: '非秘密配置已导入', detail: '所有 API Key 状态已重置，请按需重新输入。' })
    } catch (error) {
      setMessage({ tone: 'critical', title: '配置导入失败', detail: readableError(error) })
    } finally {
      event.target.value = ''
    }
  }

  return (
    <section className="agent-settings" aria-labelledby="agent-settings-title">
      <header className="agent-settings__header">
        <div>
          <p className="feature-page__eyebrow">自然语言操作层</p>
          <h3 id="agent-settings-title">Agent 服务与模型</h3>
          <p>配置保存在此浏览器；秘密与 16 表业务备份严格分离。</p>
        </div>
        <div className="agent-settings__actions">
          <Button size="small" variant="secondary" leadingIcon={<Download aria-hidden="true" size={15} />} onClick={() => downloadBlob(new Blob([providerSettingsStore.exportWithoutSecrets()], { type: 'application/json' }), 'mousekeeper-llm-settings.json')}>导出配置</Button>
          <Button size="small" variant="secondary" leadingIcon={<Upload aria-hidden="true" size={15} />} onClick={() => importRef.current?.click()}>导入配置</Button>
          <input ref={importRef} className="sr-only" type="file" accept=".json,application/json" onChange={(event) => void importSettings(event)} />
        </div>
      </header>

      <Alert title="浏览器密钥边界" tone="warning">
        官方 OpenAI Key 的安全默认是用户控制的本机或远程网关。浏览器直连仅作兼容模式；即使只存会话，运行中的同源脚本和扩展仍可能读取它。
      </Alert>
      {message ? <Alert title={message.title} tone={message.tone}>{message.detail}</Alert> : null}

      <div className="agent-settings__columns">
        <div className="agent-settings__panel">
          <div className="agent-settings__panel-heading">
            <h4>Provider</h4>
            <Button size="small" variant="tertiary" leadingIcon={<Plus aria-hidden="true" size={15} />} onClick={addProfile}>复制配置</Button>
          </div>
          <Field id="agent-profile" label="Provider 配置" required>
            <Select value={profile.id} options={settings.profiles.map((item) => ({ value: item.id, label: item.name }))} onValueChange={selectProfile} />
          </Field>
          <Field id="agent-profile-name" label="名称" required><Input value={profile.name} onChange={(event) => updateProfile({ name: event.target.value })} /></Field>
          <Field id="agent-protocol" label="API 协议" required>
            <Select value={profile.protocol} options={[
              { value: 'openai-responses', label: 'OpenAI Responses' },
              { value: 'compatible-responses', label: '兼容 Responses' },
              { value: 'compatible-chat-completions', label: '兼容 Chat Completions / 本地' }
            ]} onValueChange={(value) => updateProfile({
              protocol: value as ProviderProfile['protocol'],
              generationPath: value === 'compatible-chat-completions' ? '/chat/completions' : '/responses',
              capabilities: value === 'compatible-chat-completions' ? CHAT_COMPATIBLE_CAPABILITIES : OPENAI_RESPONSES_CAPABILITIES
            })} />
          </Field>
          <Field id="agent-base-url" label="Base URL" required description="不会自动追加 /v1。跨源服务必须允许 CORS。"><Input value={profile.baseUrl} onChange={(event) => updateProfile({ baseUrl: event.target.value })} /></Field>
          <div className="agent-settings__row">
            <Field id="agent-generation-path" label="生成路径" required><Input value={profile.generationPath} onChange={(event) => updateProfile({ generationPath: event.target.value })} /></Field>
            <Field id="agent-models-path" label="模型列表路径"><Input value={profile.modelsPath ?? ''} onChange={(event) => updateProfile({ modelsPath: event.target.value || undefined })} /></Field>
          </div>
          <div className="agent-settings__row">
            <Field id="agent-auth-mode" label="认证方式" required>
              <Select value={profile.authMode} options={[
                { value: 'none', label: '无认证 / 网关持钥' },
                { value: 'bearer', label: 'Bearer API Key' },
                { value: 'api-key-header', label: '自定义 Key Header' }
              ]} onValueChange={(value) => updateProfile({ authMode: value as ProviderProfile['authMode'] })} />
            </Field>
            {profile.authMode === 'api-key-header' ? <Field id="agent-key-header" label="Key Header" required><Input value={profile.apiKeyHeader ?? ''} onChange={(event) => updateProfile({ apiKeyHeader: event.target.value })} /></Field> : null}
          </div>
          {profile.authMode !== 'none' ? (
            <div className="agent-secret-box">
              <div className="agent-secret-box__title"><KeyRound aria-hidden="true" size={17} /><strong>API Key</strong><span>{profile.secretRef ? secretStore.metadata(profile.secretRef).masked ?? '未配置' : '未配置'}</span></div>
              <div className="agent-secret-box__input">
                <Input aria-label="API Key" autoComplete="off" type={showSecret ? 'text' : 'password'} value={secret} onChange={(event) => setSecret(event.target.value)} />
                <Button aria-label={showSecret ? '隐藏 API Key' : '显示 API Key'} size="icon" variant="tertiary" leadingIcon={showSecret ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />} onClick={() => setShowSecret((value) => !value)}>{showSecret ? '隐藏 API Key' : '显示 API Key'}</Button>
              </div>
              <div className="agent-secret-box__actions">
                <Select ariaLabel="API Key 保存方式" value={secretPolicy} options={[
                  { value: 'prompt', label: '每次启动输入（内存）' },
                  { value: 'session', label: '仅本次标签页会话' },
                  { value: 'local', label: '保存在本机浏览器（高风险）' },
                  { value: 'platform', label: '平台安全存储（当前不可用）', disabled: true }
                ]} onValueChange={(value) => setSecretPolicy(value as SecretStoragePolicy)} />
                <Button size="small" disabled={!secret} onClick={saveSecret}>保存 / 替换</Button>
                <Button size="small" variant="tertiary" disabled={!profile.secretRef} onClick={() => { if (profile.secretRef) secretStore.clear(profile.secretRef); setMessage({ tone: 'warning', title: 'API Key 已清除' }) }}>清除</Button>
              </div>
            </div>
          ) : null}
          <details className="agent-settings__advanced">
            <summary>Provider 高级设置</summary>
            <div className="agent-settings__row">
              <Field id="agent-org" label="Organization"><Input value={profile.organization ?? ''} onChange={(event) => updateProfile({ organization: event.target.value || undefined })} /></Field>
              <Field id="agent-project" label="Project"><Input value={profile.project ?? ''} onChange={(event) => updateProfile({ project: event.target.value || undefined })} /></Field>
            </div>
            <Field id="agent-headers" label="自定义请求头 JSON" description='格式：[ { "name": "X-Tenant", "value": "lab", "secret": false } ]。秘密值保存后会从文本中移除。'><Textarea rows={7} value={headersJson} onChange={(event) => setHeadersJson(event.target.value)} /></Field>
            <Button size="small" variant="secondary" onClick={saveHeaders}>保存请求头</Button>
            <label className="agent-check"><input type="checkbox" checked={profile.directBrowserRiskAccepted} onChange={(event) => updateProfile({ directBrowserRiskAccepted: event.target.checked })} /><span>我了解浏览器直连密钥的风险</span></label>
          </details>
          <div className="agent-settings__actions">
            <Button size="small" variant="secondary" loading={busy === 'models'} leadingIcon={<ListRestart aria-hidden="true" size={15} />} onClick={() => void runConnection('models')}>获取模型列表</Button>
            <Button size="small" loading={busy === 'test'} leadingIcon={<RefreshCw aria-hidden="true" size={15} />} onClick={() => void runConnection('test')}>测试连接</Button>
          </div>
          {connection ? <p className={`agent-connection-status is-${connection.ok ? 'ok' : 'error'}`}>
            <strong>{connection.ok ? '最近连接成功' : '最近连接失败'}</strong>
            <span>{new Date(connection.testedAt).toLocaleString('zh-CN')}{connection.error ? ` · ${connection.error.message}` : connection.modelCount !== undefined ? ` · ${connection.modelCount} 个模型` : ''}</span>
          </p> : null}
        </div>

        <div className="agent-settings__panel">
          <div className="agent-settings__panel-heading">
            <h4>模型预设</h4>
            <div>
              <Button aria-label="复制预设" size="icon" variant="tertiary" leadingIcon={<Copy aria-hidden="true" size={16} />} onClick={duplicatePreset}>复制预设</Button>
              <Button aria-label="删除预设" size="icon" variant="tertiary" leadingIcon={<Trash2 aria-hidden="true" size={16} />} disabled={settings.presets.length <= 1} onClick={deletePreset}>删除预设</Button>
            </div>
          </div>
          <Field id="agent-preset" label="当前编辑预设" required>
            <Select value={preset.id} options={settings.presets.map((item) => ({ value: item.id, label: `${item.name}${item.id === settings.defaultPresetId ? ' · 默认' : ''}` }))} onValueChange={selectPreset} />
          </Field>
          <Field id="agent-preset-name" label="预设名称" required><Input value={preset.name} onChange={(event) => updatePreset({ name: event.target.value })} /></Field>
          <Field id="agent-preset-provider" label="使用 Provider" required><Select value={preset.providerProfileId} options={settings.profiles.map((item) => ({ value: item.id, label: item.name }))} onValueChange={(value) => updatePreset({ providerProfileId: value })} /></Field>
          <Field id="agent-model" label="模型名称" required description="模型列表不可用时可直接手动输入。"><Input value={preset.model} onChange={(event) => updatePreset({ model: event.target.value })} /></Field>
          <div className="agent-settings__row">
            <Field id="agent-reasoning" label="思考强度"><Select value={preset.reasoningEffort ?? ''} clearLabel="不发送" options={[...new Set(profile.capabilities.reasoningEfforts.concat(preset.reasoningEffort ?? []))].filter(Boolean).map((value) => ({ value, label: value }))} onValueChange={(value) => updatePreset({ reasoningEffort: value || undefined })} /></Field>
            <Field id="agent-max-output" label="最大输出 token"><Input min={1} type="number" value={preset.maxOutputTokens ?? ''} onChange={(event) => updatePreset({ maxOutputTokens: numberValue(event.target.value) })} /></Field>
          </div>
          <div className="agent-settings__row">
            <Field id="agent-temperature" label="Temperature"><Input min={0} max={2} step="0.1" type="number" value={preset.temperature ?? ''} onChange={(event) => updatePreset({ temperature: numberValue(event.target.value) })} /></Field>
            <Field id="agent-top-p" label="Top P"><Input min={0} max={1} step="0.1" type="number" value={preset.topP ?? ''} onChange={(event) => updatePreset({ topP: numberValue(event.target.value) })} /></Field>
          </div>
          <div className="agent-settings__row">
            <Field id="agent-timeout" label="超时（毫秒）" required><Input min={1000} type="number" value={preset.timeoutMs} onChange={(event) => updatePreset({ timeoutMs: Number(event.target.value) })} /></Field>
            <Field id="agent-rounds" label="最大工具轮次" required><Input min={1} max={50} type="number" value={preset.maxToolRounds} onChange={(event) => updatePreset({ maxToolRounds: Number(event.target.value) })} /></Field>
          </div>
          <div className="agent-settings__row">
            <Field id="agent-retries" label="网络重试次数" required><Input min={0} max={5} type="number" value={preset.retries} onChange={(event) => updatePreset({ retries: Number(event.target.value) })} /></Field>
            <Field id="agent-history" label="保留历史消息" required><Input min={2} max={100} type="number" value={preset.historyLimit} onChange={(event) => updatePreset({ historyLimit: Number(event.target.value) })} /></Field>
          </div>
          <Field id="agent-context-strategy" label="上下文长度策略" required><Select value={preset.contextStrategy} options={[
            { value: 'drop-oldest', label: '丢弃最旧完整轮次' },
            { value: 'fail', label: '超限时报错' },
            { value: 'summarize-then-trim', label: '摘要后裁剪' }
          ]} onValueChange={(value) => updatePreset({ contextStrategy: value as LLMPreset['contextStrategy'] })} /></Field>
          <div className="agent-settings__toggles">
            <label className="agent-check"><input type="checkbox" checked={preset.stream} onChange={(event) => updatePreset({ stream: event.target.checked })} /><span>流式输出</span></label>
            <label className="agent-check"><input type="checkbox" checked={preset.parallelToolCalls} onChange={(event) => updatePreset({ parallelToolCalls: event.target.checked })} /><span>允许模型提出并行工具调用</span></label>
          </div>
          <Field id="agent-system-append" label="系统提示追加内容"><Textarea rows={5} value={preset.systemPromptAppend} onChange={(event) => updatePreset({ systemPromptAppend: event.target.value })} /></Field>
          <details className="agent-settings__advanced">
            <summary>Provider 特有参数</summary>
            <Field id="agent-provider-params" label="请求体扩展 JSON"><Textarea rows={7} value={providerParamsJson} onChange={(event) => setProviderParamsJson(event.target.value)} /></Field>
            <Button size="small" variant="secondary" onClick={saveProviderParameters}>保存扩展参数</Button>
          </details>
          <div className="agent-settings__actions">
            <Button variant={preset.id === settings.defaultPresetId ? 'secondary' : 'primary'} disabled={preset.id === settings.defaultPresetId} onClick={() => updateDocument((document) => ({ ...document, defaultPresetId: preset.id }))}>{preset.id === settings.defaultPresetId ? '当前默认预设' : '设为默认预设'}</Button>
          </div>
        </div>
      </div>
      <div className="agent-settings__privacy-note">
        <ShieldAlert aria-hidden="true" size={17} />
        <span>配置导出只包含 Provider 与预设，不包含 API Key 或秘密请求头。普通 MouseKeeper JSON 备份同样不包含这些秘密。</span>
      </div>
    </section>
  )
}
