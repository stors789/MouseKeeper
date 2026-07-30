import { zodResolver } from '@hookform/resolvers/zod'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Link, useLocation } from 'wouter'
import { z } from 'zod'
import { appDatabase, appService } from '../../app/runtime'
import { Alert } from '../../components/ui/Alert'
import { Button, buttonClassName } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Textarea } from '../../components/ui/Textarea'
import { CAGE_STATUSES } from '../../domain'
import { useToast } from '../../hooks/useToast'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { readableError } from '../../lib/errors'
import { CAGE_STATUS_LABELS } from '../../lib/labels'

const cageSchema = z.object({
  cageNumber: z.string().trim().min(1, '请填写笼位编号').max(120),
  room: z.string().trim().max(160),
  rack: z.string().trim().max(160),
  maxCapacity: z
    .number()
    .int('容量必须是整数')
    .min(1, '容量至少为 1')
    .max(10_000, '容量不能超过 10000'),
  primaryStrain: z.string().trim().max(240),
  purpose: z.string().trim().max(300),
  status: z.enum(CAGE_STATUSES),
  notes: z.string().max(10_000)
})

type CageFormValues = z.infer<typeof cageSchema>

const DEFAULT_VALUES: CageFormValues = {
  cageNumber: '',
  room: '',
  rack: '',
  maxCapacity: 5,
  primaryStrain: '',
  purpose: '',
  status: 'active',
  notes: ''
}

function optional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

export function CageFormPage({ cageId }: { cageId?: string }) {
  const [, navigate] = useLocation()
  const { showToast } = useToast()
  const [submitError, setSubmitError] = useState<string>()
  const cage = useLiveQuery(
    () => (cageId ? appDatabase.cages.get(cageId) : undefined),
    [cageId]
  )
  const {
    control,
    formState: { errors, isDirty, isSubmitting },
    handleSubmit,
    register,
    reset
  } = useForm<CageFormValues>({
    resolver: zodResolver(cageSchema),
    defaultValues: DEFAULT_VALUES
  })
  useUnsavedChanges(isDirty)

  useEffect(() => {
    if (!cage) return
    reset({
      cageNumber: cage.cageNumber,
      room: cage.room ?? '',
      rack: cage.rack ?? '',
      maxCapacity: cage.maxCapacity,
      primaryStrain: cage.primaryStrain ?? '',
      purpose: cage.purpose ?? '',
      status: cage.status,
      notes: cage.notes ?? ''
    })
  }, [cage, reset])

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(undefined)
    try {
      if (cageId && cage) {
        const result = await appService.updateCage({
          operationId: crypto.randomUUID(),
          cageId,
          expectedRevision: cage.revision,
          patch: {
            cageNumber: values.cageNumber,
            room: optional(values.room) ?? null,
            rack: optional(values.rack) ?? null,
            maxCapacity: values.maxCapacity,
            primaryStrain: optional(values.primaryStrain) ?? null,
            purpose: optional(values.purpose) ?? null,
            status: values.status,
            notes: optional(values.notes) ?? null
          }
        })
        showToast({
          title: '笼位已更新',
          description: result.value.cageNumber,
          tone: 'positive'
        })
        navigate(`/cages/${encodeURIComponent(cageId)}`)
        return
      }

      const result = await appService.createCage({
        operationId: crypto.randomUUID(),
        cageNumber: values.cageNumber,
        room: optional(values.room),
        rack: optional(values.rack),
        maxCapacity: values.maxCapacity,
        primaryStrain: optional(values.primaryStrain),
        purpose: optional(values.purpose),
        status: values.status,
        notes: optional(values.notes)
      })
      showToast({
        title: '笼位已创建',
        description: result.value.cageNumber,
        tone: 'positive'
      })
      navigate(`/cages/${encodeURIComponent(result.value.id)}`)
    } catch (error) {
      setSubmitError(readableError(error))
    }
  })

  if (cageId && cage && cage.deletedFlag === 1) {
    return (
      <div className="feature-page">
        <Alert title="笼位已在回收站" tone="warning">
          请先在“数据与安全”页面恢复后再编辑。
        </Alert>
        <Link
          className={buttonClassName({ variant: 'secondary' })}
          href="/cages"
        >
          返回笼位列表
        </Link>
      </div>
    )
  }

  return (
    <div className="feature-page feature-form-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">
            群体管理 / 笼位 / {cageId ? '编辑' : '新建'}
          </p>
          <h2>{cageId ? '编辑笼位' : '新建笼位'}</h2>
          <p>笼位编号在活动记录中保持唯一，容量用于转笼风险提示。</p>
        </div>
        <Link
          className={buttonClassName({ variant: 'tertiary' })}
          href={cageId ? `/cages/${encodeURIComponent(cageId)}` : '/cages'}
        >
          <ArrowLeft aria-hidden="true" size={17} />
          返回
        </Link>
      </header>

      {submitError ? (
        <Alert title="没有保存当前更改" tone="critical">
          {submitError}
        </Alert>
      ) : null}

      <form className="entity-form" onSubmit={(event) => void onSubmit(event)}>
        <section className="form-section" aria-labelledby="cage-identity-title">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="cage-identity-title">笼位识别</h3>
              <p>使用稳定、易读且不会与其他活动笼位重复的编号。</p>
            </div>
          </div>
          <div className="form-grid">
            <Field
              id="cage-number"
              label="笼位编号"
              required
              error={errors.cageNumber?.message}
            >
              <Input autoComplete="off" {...register('cageNumber')} />
            </Field>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Field id="cage-status" label="状态" required>
                  <Select
                    ref={field.ref}
                    name={field.name}
                    onBlur={field.onBlur}
                    options={CAGE_STATUSES.map((value) => ({
                      value,
                      label: CAGE_STATUS_LABELS[value]
                    }))}
                    value={field.value}
                    onValueChange={field.onChange}
                  />
                </Field>
              )}
            />
            <Field id="cage-room" label="房间 / 区域" error={errors.room?.message}>
              <Input autoComplete="off" {...register('room')} />
            </Field>
            <Field id="cage-rack" label="架位" error={errors.rack?.message}>
              <Input autoComplete="off" {...register('rack')} />
            </Field>
          </div>
        </section>

        <section className="form-section" aria-labelledby="cage-use-title">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="cage-use-title">容量与用途</h3>
              <p>超过容量不会静默写入，必须在转笼流程中明确确认。</p>
            </div>
          </div>
          <div className="form-grid">
            <Field
              id="cage-capacity"
              label="最大容量"
              required
              error={errors.maxCapacity?.message}
            >
              <Input
                min={1}
                max={10_000}
                type="number"
                {...register('maxCapacity', { valueAsNumber: true })}
              />
            </Field>
            <Field
              id="cage-strain"
              label="主要品系"
              error={errors.primaryStrain?.message}
            >
              <Input autoComplete="off" {...register('primaryStrain')} />
            </Field>
            <Field
              id="cage-purpose"
              label="用途"
              error={errors.purpose?.message}
            >
              <Input autoComplete="off" {...register('purpose')} />
            </Field>
          </div>
        </section>

        <section className="form-section" aria-labelledby="cage-notes-title">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="cage-notes-title">备注</h3>
              <p>可记录消毒、隔离或饲养注意事项。</p>
            </div>
          </div>
          <Field id="cage-notes" label="备注" error={errors.notes?.message}>
            <Textarea rows={5} {...register('notes')} />
          </Field>
        </section>

        <div className="form-actions">
          <Link
            className={buttonClassName({ variant: 'tertiary' })}
            href={cageId ? `/cages/${encodeURIComponent(cageId)}` : '/cages'}
          >
            取消
          </Link>
          <Button
            type="submit"
            loading={isSubmitting}
            loadingLabel="正在保存笼位…"
            leadingIcon={<Save aria-hidden="true" size={17} />}
          >
            {cageId ? '保存笼位更改' : '保存笼位'}
          </Button>
        </div>
      </form>
    </div>
  )
}
