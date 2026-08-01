import {
  ArrowLeft,
  Plus,
  Save,
  Trash2
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'wouter'
import { appService } from '../../app/runtime'
import { Alert } from '../../components/ui/Alert'
import { Button, buttonClassName } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import {
  MOUSE_SEXES,
  MOUSE_STATUSES,
  isValidLocalDate,
  todayLocalDate,
  type MouseSex,
  type MouseStatus
} from '../../domain'
import { useToast } from '../../hooks/useToast'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { readableError } from '../../lib/errors'
import {
  MOUSE_SEX_LABELS,
  MOUSE_STATUS_LABELS
} from '../../lib/labels'

interface MouseDraft {
  key: string
  earTag: string
  experimentNumber: string
  name: string
  sex: MouseSex
}

function newDraft(): MouseDraft {
  return {
    key: crypto.randomUUID(),
    earTag: '',
    experimentNumber: '',
    name: '',
    sex: 'unknown'
  }
}

function formString(data: FormData, key: string): string {
  const value = data.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

export function MouseBulkCreatePage() {
  const [, navigate] = useLocation()
  const { showToast } = useToast()
  const [rows, setRows] = useState<MouseDraft[]>([
    newDraft(),
    newDraft(),
    newDraft()
  ])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [isDirty, setIsDirty] = useState(false)
  useUnsavedChanges(isDirty && !busy)

  const updateRow = (
    key: string,
    patch: Partial<Omit<MouseDraft, 'key'>>
  ) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row))
    )

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const strain = formString(values, 'strain')
    const genotype = formString(values, 'genotype')
    const birthDate = formString(values, 'birthDate')
    const source = formString(values, 'source')
    const notes = formString(values, 'notes')
    const status = formString(values, 'status') as MouseStatus
    const activeRows = rows.filter(
      (row) =>
        row.earTag.trim() ||
        row.experimentNumber.trim() ||
        row.name.trim()
    )
    if (!strain) {
      setError('请填写共享品系。')
      return
    }
    if (birthDate && (!isValidLocalDate(birthDate) || birthDate > todayLocalDate())) {
      setError('出生日期无效或晚于今天。')
      return
    }
    if (activeRows.length === 0) {
      setError('请至少填写一行小鼠。')
      return
    }
    if (
      activeRows.some(
        (row) => !row.earTag.trim() && !row.experimentNumber.trim()
      )
    ) {
      setError('每一行的耳标号和实验编号至少填写一项。')
      return
    }
    const normalizedTags = activeRows
      .map((row) => row.earTag.trim().toLocaleLowerCase())
      .filter(Boolean)
    if (new Set(normalizedTags).size !== normalizedTags.length) {
      setError('批次内存在重复耳标号。')
      return
    }

    setBusy(true)
    setError(undefined)
    try {
      const result = await appService.createMice({
        operationId: crypto.randomUUID(),
        entries: activeRows.map((row) => ({
          earTag: row.earTag.trim() || undefined,
          experimentNumber: row.experimentNumber.trim() || undefined,
          name: row.name.trim() || undefined,
          strain,
          genotype: genotype || undefined,
          sex: row.sex,
          birthDate: birthDate || undefined,
          status,
          source: source || undefined,
          notes: notes || undefined
        }))
      })
      showToast({
        title: '批量创建完成',
        description: `${result.value.mice.length} 只小鼠已在一个事务中建档`,
        tone: 'positive'
      })
      setIsDirty(false)
      navigate('/mice')
    } catch (actionError) {
      setError(readableError(actionError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="feature-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">群体管理 / 小鼠 / 批量创建</p>
          <h2>批量创建小鼠</h2>
          <p>共享生物学信息，逐行填写身份；任一行失败时整批回滚。</p>
        </div>
        <Link
          className={buttonClassName({ variant: 'tertiary' })}
          href="/mice"
        >
          <ArrowLeft aria-hidden="true" size={17} />
          返回列表
        </Link>
      </header>

      {error ? (
        <Alert title="没有创建批次" tone="critical">
          {error}
        </Alert>
      ) : null}

      <form
        className="entity-form"
        onChange={() => setIsDirty(true)}
        onSubmit={(event) => void submit(event)}
      >
        <section className="form-section" aria-labelledby="bulk-shared-title">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="bulk-shared-title">共享字段</h3>
              <p>这些值将应用于本批次每一只小鼠。</p>
            </div>
          </div>
          <div className="form-grid">
            <Field id="bulk-strain" label="品系" required>
              <Input name="strain" required />
            </Field>
            <Field id="bulk-genotype" label="基因型">
              <Input name="genotype" />
            </Field>
            <Field id="bulk-birth-date" label="出生日期">
              <Input name="birthDate" type="date" max={todayLocalDate()} />
            </Field>
            <Field id="bulk-status" label="初始状态" required>
              <Select
                name="status"
                defaultValue="alive"
                options={MOUSE_STATUSES.map((status) => ({
                  value: status,
                  label: MOUSE_STATUS_LABELS[status]
                }))}
              />
            </Field>
            <Field id="bulk-source" label="来源">
              <Input name="source" />
            </Field>
          </div>
          <Field id="bulk-notes" label="共享备注">
            <Textarea name="notes" rows={3} />
          </Field>
        </section>

        <section className="form-section" aria-labelledby="bulk-rows-title">
          <div className="form-section__heading form-section__heading--action">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="bulk-rows-title">小鼠身份</h3>
              <p>空白行会忽略；耳标号与实验编号至少填写一项。</p>
            </div>
            <Button
              type="button"
              size="small"
              variant="secondary"
              leadingIcon={<Plus aria-hidden="true" size={15} />}
              onClick={() => setRows((current) => [...current, newDraft()])}
            >
              添加一行
            </Button>
          </div>
          <div className="bulk-mouse-table" role="table">
            <div className="bulk-mouse-row bulk-mouse-row--header" role="row">
              <span role="columnheader">序号</span>
              <span role="columnheader">耳标号</span>
              <span role="columnheader">实验编号</span>
              <span role="columnheader">名称</span>
              <span role="columnheader">性别</span>
              <span role="columnheader">操作</span>
            </div>
            {rows.map((row, index) => (
              <div className="bulk-mouse-row" role="row" key={row.key}>
                <span role="cell">{index + 1}</span>
                <label className="responsive-table-field">
                  <span>耳标号</span>
                  <Input
                    aria-label={`第 ${index + 1} 行耳标号`}
                    value={row.earTag}
                    onChange={(event) =>
                      updateRow(row.key, { earTag: event.target.value })
                    }
                  />
                </label>
                <label className="responsive-table-field">
                  <span>实验编号</span>
                  <Input
                    aria-label={`第 ${index + 1} 行实验编号`}
                    value={row.experimentNumber}
                    onChange={(event) =>
                      updateRow(row.key, {
                        experimentNumber: event.target.value
                      })
                    }
                  />
                </label>
                <label className="responsive-table-field">
                  <span>名称</span>
                  <Input
                    aria-label={`第 ${index + 1} 行名称`}
                    value={row.name}
                    onChange={(event) =>
                      updateRow(row.key, { name: event.target.value })
                    }
                  />
                </label>
                <label className="responsive-table-field">
                  <span>性别</span>
                  <Select
                    ariaLabel={`第 ${index + 1} 行性别`}
                    value={row.sex}
                    options={MOUSE_SEXES.map((sex) => ({
                      value: sex,
                      label: MOUSE_SEX_LABELS[sex]
                    }))}
                    onValueChange={(sex) =>
                      updateRow(row.key, { sex: sex as MouseSex })
                    }
                  />
                </label>
                <Button
                  aria-label={`删除第 ${index + 1} 行`}
                  type="button"
                  size="icon"
                  variant="tertiary"
                  disabled={rows.length === 1}
                  leadingIcon={<Trash2 aria-hidden="true" size={15} />}
                  onClick={() =>
                    setRows((current) =>
                      current.filter((item) => item.key !== row.key)
                    )
                  }
                />
              </div>
            ))}
          </div>
        </section>

        <div className="form-actions">
          <Link
            className={buttonClassName({ variant: 'tertiary' })}
            href="/mice"
          >
            取消
          </Link>
          <Button
            type="submit"
            loading={busy}
            leadingIcon={<Save aria-hidden="true" size={17} />}
          >
            原子创建批次
          </Button>
        </div>
      </form>
    </div>
  )
}
