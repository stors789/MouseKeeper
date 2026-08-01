import { zodResolver } from '@hookform/resolvers/zod'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Dna, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
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
import {
  BREEDING_PAIR_STATUSES,
  isValidLocalDate,
  mouseDisplayLabel,
  todayLocalDate
} from '../../domain'
import { useToast } from '../../hooks/useToast'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { readableError } from '../../lib/errors'
import {
  BREEDING_STATUS_LABELS,
  MOUSE_SEX_LABELS,
  MOUSE_STATUS_LABELS
} from '../../lib/labels'
import { WarningRequiredError } from '../../services'

const breedingSchema = z
  .object({
    sireId: z.string().min(1, '请选择父本'),
    damId: z.string().min(1, '请选择母本'),
    pairedOn: z.string().refine(isValidLocalDate, '请选择有效合笼日期'),
    expectedDeliveryDate: z.string(),
    status: z.enum(BREEDING_PAIR_STATUSES),
    notes: z.string().max(10_000)
  })
  .superRefine((values, context) => {
    if (values.sireId === values.damId) {
      context.addIssue({
        code: 'custom',
        path: ['damId'],
        message: '父本和母本不能是同一只小鼠'
      })
    }
    if (
      values.expectedDeliveryDate &&
      (!isValidLocalDate(values.expectedDeliveryDate) ||
        values.expectedDeliveryDate < values.pairedOn)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expectedDeliveryDate'],
        message: '预计生产日期必须有效且不早于合笼日期'
      })
    }
  })

type BreedingValues = z.infer<typeof breedingSchema>

const DEFAULT_VALUES: BreedingValues = {
  sireId: '',
  damId: '',
  pairedOn: todayLocalDate(),
  expectedDeliveryDate: '',
  status: 'active',
  notes: ''
}

interface PendingBreeding {
  operationId: string
  values: BreedingValues
  warnings: readonly string[]
}

function optional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

export function BreedingFormPage() {
  const [, navigate] = useLocation()
  const { showToast } = useToast()
  const [submitError, setSubmitError] = useState<string>()
  const [pending, setPending] = useState<PendingBreeding>()
  const [showAllCandidates, setShowAllCandidates] = useState(false)
  const mice = useLiveQuery(
    () =>
      appDatabase.mice
        .filter((mouse) => mouse.deletedFlag === 0)
        .sortBy('earTag'),
    []
  )
  const {
    control,
    formState: { errors, isDirty, isSubmitting },
    handleSubmit,
    register
  } = useForm<BreedingValues>({
    resolver: zodResolver(breedingSchema),
    defaultValues: DEFAULT_VALUES
  })
  useUnsavedChanges(isDirty)

  const createPair = async (
    operationId: string,
    values: BreedingValues,
    warningAcknowledgements?: readonly string[]
  ) =>
    appService.createBreedingPair({
      operationId,
      sireId: values.sireId,
      damId: values.damId,
      pairedOn: values.pairedOn,
      expectedDeliveryDate: optional(values.expectedDeliveryDate),
      status: values.status,
      notes: optional(values.notes),
      warningAcknowledgements
    })

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(undefined)
    const operationId = crypto.randomUUID()
    try {
      const result = await createPair(operationId, values)
      showToast({ title: '繁育组合已创建', tone: 'positive' })
      navigate(`/breeding/${encodeURIComponent(result.value.id)}`)
    } catch (error) {
      if (error instanceof WarningRequiredError) {
        setPending({ operationId, values, warnings: error.warnings })
        return
      }
      setSubmitError(readableError(error))
    }
  })

  const confirmWarnings = async () => {
    if (!pending) return
    setSubmitError(undefined)
    try {
      const result = await createPair(
        pending.operationId,
        pending.values,
        pending.warnings
      )
      showToast({
        title: '已确认警告并创建繁育组合',
        description: '确认内容已记录在活动日志中。',
        tone: 'warning'
      })
      navigate(`/breeding/${encodeURIComponent(result.value.id)}`)
    } catch (error) {
      setSubmitError(readableError(error))
    }
  }

  return (
    <div className="feature-page feature-form-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">研究 / 繁育 / 新建</p>
          <h2>新建繁育组合</h2>
          <p>性别、状态与历史重复会触发显式警告；谱系循环会直接阻止。</p>
        </div>
        <Link
          className={buttonClassName({ variant: 'tertiary' })}
          href="/breeding"
        >
          <ArrowLeft aria-hidden="true" size={17} />
          返回
        </Link>
      </header>

      {submitError ? (
        <Alert title="没有创建繁育组合" tone="critical">
          {submitError}
        </Alert>
      ) : null}
      {pending ? (
        <Alert
          title="组合需要明确确认"
          tone="warning"
          action={
            <div className="alert-actions">
              <Button
                variant="tertiary"
                onClick={() => setPending(undefined)}
              >
                返回修改
              </Button>
              <Button
                variant="secondary"
                leadingIcon={<TriangleAlert aria-hidden="true" size={16} />}
                onClick={() => void confirmWarnings()}
              >
                确认风险并创建
              </Button>
            </div>
          }
        >
          检测到：{pending.warnings.join('、')}。表单已锁定，请核对选中的小鼠后再继续。
        </Alert>
      ) : null}

      <form className="entity-form" onSubmit={(event) => void onSubmit(event)}>
        <fieldset className="form-fieldset-reset" disabled={Boolean(pending)}>
        <section className="form-section" aria-labelledby="breeding-parents-title">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="breeding-parents-title">父本与母本</h3>
              <p>候选列表显示性别与当前状态，异常选择仍需二次确认。</p>
            </div>
          </div>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={showAllCandidates}
              onChange={(event) => setShowAllCandidates(event.target.checked)}
            />
            <span>显示全部性别候选（异常选择保存时仍需确认）</span>
          </label>
          <div className="form-grid">
            <Controller
              control={control}
              name="sireId"
              render={({ field }) => (
                <Field
                  id="breeding-sire"
                  label="父本"
                  required
                  error={errors.sireId?.message}
                >
                  <Select
                    key={field.value}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    options={(mice ?? [])
                      .filter(
                        (mouse) => showAllCandidates || mouse.sex === 'male'
                      )
                      .map((mouse) => ({
                        value: mouse.id,
                        label: `${mouseDisplayLabel(mouse)} · ${MOUSE_SEX_LABELS[mouse.sex]} · ${MOUSE_STATUS_LABELS[mouse.status]}`
                      }))}
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  />
                </Field>
              )}
            />
            <Controller
              control={control}
              name="damId"
              render={({ field }) => (
                <Field
                  id="breeding-dam"
                  label="母本"
                  required
                  error={errors.damId?.message}
                >
                  <Select
                    key={field.value}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    options={(mice ?? [])
                      .filter(
                        (mouse) => showAllCandidates || mouse.sex === 'female'
                      )
                      .map((mouse) => ({
                        value: mouse.id,
                        label: `${mouseDisplayLabel(mouse)} · ${MOUSE_SEX_LABELS[mouse.sex]} · ${MOUSE_STATUS_LABELS[mouse.status]}`
                      }))}
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  />
                </Field>
              )}
            />
          </div>
        </section>

        <section className="form-section" aria-labelledby="breeding-plan-title">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="breeding-plan-title">日期与计划</h3>
              <p>日期按本地日历保存，避免跨时区造成日期漂移。</p>
            </div>
          </div>
          <div className="form-grid">
            <Field
              id="breeding-paired-on"
              label="合笼日期"
              required
              error={errors.pairedOn?.message}
            >
              <Input type="date" {...register('pairedOn')} />
            </Field>
            <Field
              id="breeding-delivery"
              label="预计生产日期"
              error={errors.expectedDeliveryDate?.message}
            >
              <Input type="date" {...register('expectedDeliveryDate')} />
            </Field>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Field id="breeding-status" label="初始状态" required>
                  <Select
                    key={field.value}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    options={(['planned', 'active'] as const).map((value) => ({
                      value,
                      label: BREEDING_STATUS_LABELS[value]
                    }))}
                    value={field.value}
                    onValueChange={field.onChange}
                  />
                </Field>
              )}
            />
          </div>
          <Field id="breeding-notes" label="备注" error={errors.notes?.message}>
            <Textarea rows={5} {...register('notes')} />
          </Field>
        </section>

        <div className="form-actions">
          <Link
            className={buttonClassName({ variant: 'tertiary' })}
            href="/breeding"
          >
            取消
          </Link>
          <Button
            type="submit"
            disabled={Boolean(pending)}
            loading={isSubmitting}
            loadingLabel="正在创建组合…"
            leadingIcon={<Dna aria-hidden="true" size={17} />}
          >
            保存繁育组合
          </Button>
        </div>
        </fieldset>
      </form>
    </div>
  )
}
