import { zodResolver } from '@hookform/resolvers/zod'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, FlaskConical, Save } from 'lucide-react'
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
import {
  EXPERIMENT_GROUP_TYPES,
  EXPERIMENT_STATUSES,
  isValidLocalDate
} from '../../domain'
import { useToast } from '../../hooks/useToast'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { readableError } from '../../lib/errors'
import {
  EXPERIMENT_GROUP_TYPE_LABELS,
  EXPERIMENT_STATUS_LABELS
} from '../../lib/labels'

const experimentSchema = z
  .object({
    code: z.string().trim().max(120),
    name: z.string().trim().min(1, '请填写实验名称').max(240),
    description: z.string().max(10_000),
    startDate: z.string(),
    endDate: z.string(),
    status: z.enum(EXPERIMENT_STATUSES),
    intervention: z.string().trim().max(500),
    dose: z.string().trim().max(300),
    frequency: z.string().trim().max(300),
    principalInvestigator: z.string().trim().max(240),
    notes: z.string().max(10_000),
    initialGroupName: z.string().trim().max(240),
    initialGroupType: z.enum(EXPERIMENT_GROUP_TYPES),
    exclusionSet: z.string().trim().max(120)
  })
  .superRefine((values, context) => {
    for (const field of ['startDate', 'endDate'] as const) {
      if (values[field] && !isValidLocalDate(values[field])) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: '请选择有效日期'
        })
      }
    }
    if (values.startDate && values.endDate && values.endDate < values.startDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: '结束日期不能早于开始日期'
      })
    }
  })

type ExperimentValues = z.infer<typeof experimentSchema>

const DEFAULT_VALUES: ExperimentValues = {
  code: '',
  name: '',
  description: '',
  startDate: '',
  endDate: '',
  status: 'planned',
  intervention: '',
  dose: '',
  frequency: '',
  principalInvestigator: '',
  notes: '',
  initialGroupName: '对照组',
  initialGroupType: 'control',
  exclusionSet: 'study-arm'
}

function optional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

export function ExperimentFormPage({
  experimentId
}: {
  experimentId?: string
}) {
  const [, navigate] = useLocation()
  const { showToast } = useToast()
  const [submitError, setSubmitError] = useState<string>()
  const experiment = useLiveQuery(
    () =>
      experimentId
        ? appDatabase.experiments.get(experimentId)
        : undefined,
    [experimentId]
  )
  const {
    control,
    formState: { errors, isDirty, isSubmitting },
    handleSubmit,
    register,
    reset
  } = useForm<ExperimentValues>({
    resolver: zodResolver(experimentSchema),
    defaultValues: DEFAULT_VALUES
  })
  useUnsavedChanges(isDirty)

  useEffect(() => {
    if (!experiment) return
    reset({
      code: experiment.code ?? '',
      name: experiment.name,
      description: experiment.description ?? '',
      startDate: experiment.startDate ?? '',
      endDate: experiment.endDate ?? '',
      status: experiment.status,
      intervention: experiment.intervention ?? '',
      dose: experiment.dose ?? '',
      frequency: experiment.frequency ?? '',
      principalInvestigator: experiment.principalInvestigator ?? '',
      notes: experiment.notes ?? '',
      initialGroupName: '',
      initialGroupType: 'custom',
      exclusionSet: ''
    })
  }, [experiment, reset])

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(undefined)
    try {
      if (experimentId && experiment) {
        const result = await appService.updateExperiment({
          operationId: crypto.randomUUID(),
          experimentId,
          expectedRevision: experiment.revision,
          patch: {
            code: optional(values.code) ?? null,
            name: values.name,
            description: optional(values.description) ?? null,
            startDate: optional(values.startDate) ?? null,
            endDate: optional(values.endDate) ?? null,
            status: values.status,
            intervention: optional(values.intervention) ?? null,
            dose: optional(values.dose) ?? null,
            frequency: optional(values.frequency) ?? null,
            principalInvestigator:
              optional(values.principalInvestigator) ?? null,
            notes: optional(values.notes) ?? null
          }
        })
        showToast({
          title: '实验已更新',
          description: result.value.name,
          tone: 'positive'
        })
        navigate(`/experiments/${encodeURIComponent(experimentId)}`)
        return
      }

      if (!values.initialGroupName.trim()) {
        setSubmitError('创建实验时至少需要一个初始组别。')
        return
      }
      const result = await appService.createExperimentWithInitialGroup({
        operationId: crypto.randomUUID(),
        code: optional(values.code),
        name: values.name,
        description: optional(values.description),
        startDate: optional(values.startDate),
        endDate: optional(values.endDate),
        status: values.status,
        intervention: optional(values.intervention),
        dose: optional(values.dose),
        frequency: optional(values.frequency),
        principalInvestigator: optional(values.principalInvestigator),
        notes: optional(values.notes),
        initialGroup: {
          name: values.initialGroupName,
          groupType: values.initialGroupType,
          exclusionSet: optional(values.exclusionSet),
          intervention: optional(values.intervention),
          dose: optional(values.dose),
          frequency: optional(values.frequency)
        }
      })
      showToast({
        title: '实验与初始组别已创建',
        description: result.value.experiment.name,
        tone: 'positive'
      })
      navigate(
        `/experiments/${encodeURIComponent(result.value.experiment.id)}`
      )
    } catch (error) {
      setSubmitError(readableError(error))
    }
  })

  return (
    <div className="feature-page feature-form-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">
            研究 / 实验 / {experimentId ? '编辑' : '新建'}
          </p>
          <h2>{experimentId ? '编辑实验' : '新建实验'}</h2>
          <p>
            {experimentId
              ? '结束实验只改变状态，不会删除成员与事件历史。'
              : '实验和首个组别会在同一事务中创建，避免留下半成品。'}
          </p>
        </div>
        <Link
          className={buttonClassName({ variant: 'tertiary' })}
          href={
            experimentId
              ? `/experiments/${encodeURIComponent(experimentId)}`
              : '/experiments'
          }
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
        <section className="form-section" aria-labelledby="experiment-basic-title">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="experiment-basic-title">基本信息</h3>
              <p>代码可选但在活动实验中保持唯一，名称是主要识别信息。</p>
            </div>
          </div>
          <div className="form-grid">
            <Field id="experiment-code" label="实验代码" error={errors.code?.message}>
              <Input autoComplete="off" {...register('code')} />
            </Field>
            <Field
              id="experiment-name"
              label="实验名称"
              required
              error={errors.name?.message}
            >
              <Input autoComplete="off" {...register('name')} />
            </Field>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Field id="experiment-status" label="状态" required>
                  <Select
                    ref={field.ref}
                    name={field.name}
                    onBlur={field.onBlur}
                    options={EXPERIMENT_STATUSES.map((value) => ({
                      value,
                      label: EXPERIMENT_STATUS_LABELS[value]
                    }))}
                    value={field.value}
                    onValueChange={field.onChange}
                  />
                </Field>
              )}
            />
            <Field
              id="experiment-owner"
              label="实验负责人"
              error={errors.principalInvestigator?.message}
            >
              <Input autoComplete="off" {...register('principalInvestigator')} />
            </Field>
          </div>
          <Field
            id="experiment-description"
            label="实验描述"
            error={errors.description?.message}
          >
            <Textarea rows={4} {...register('description')} />
          </Field>
        </section>

        <section className="form-section" aria-labelledby="experiment-schedule-title">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="experiment-schedule-title">计划与干预</h3>
              <p>组别可以覆盖实验级干预信息。</p>
            </div>
          </div>
          <div className="form-grid">
            <Field
              id="experiment-start"
              label="开始日期"
              error={errors.startDate?.message}
            >
              <Input type="date" {...register('startDate')} />
            </Field>
            <Field
              id="experiment-end"
              label="结束日期"
              error={errors.endDate?.message}
            >
              <Input type="date" {...register('endDate')} />
            </Field>
            <Field
              id="experiment-intervention"
              label="干预方式"
              error={errors.intervention?.message}
            >
              <Input autoComplete="off" {...register('intervention')} />
            </Field>
            <Field
              id="experiment-dose"
              label="剂量"
              error={errors.dose?.message}
            >
              <Input autoComplete="off" {...register('dose')} />
            </Field>
            <Field
              id="experiment-frequency"
              label="频率"
              error={errors.frequency?.message}
            >
              <Input autoComplete="off" {...register('frequency')} />
            </Field>
          </div>
        </section>

        {!experimentId ? (
          <section className="form-section" aria-labelledby="initial-group-title">
            <div className="form-section__heading">
              <span className="assay-rail-mark" aria-hidden="true" />
              <div>
                <h3 id="initial-group-title">初始组别</h3>
                <p>至少创建一个组别；相同排斥集表示组别互斥。</p>
              </div>
            </div>
            <div className="form-grid">
              <Field
                id="initial-group-name"
                label="组别名称"
                required
                error={errors.initialGroupName?.message}
              >
                <Input autoComplete="off" {...register('initialGroupName')} />
              </Field>
              <Controller
                control={control}
                name="initialGroupType"
                render={({ field }) => (
                  <Field id="initial-group-type" label="组别类型" required>
                    <Select
                      ref={field.ref}
                      name={field.name}
                      onBlur={field.onBlur}
                      options={EXPERIMENT_GROUP_TYPES.map((value) => ({
                        value,
                        label: EXPERIMENT_GROUP_TYPE_LABELS[value]
                      }))}
                      value={field.value}
                      onValueChange={field.onChange}
                    />
                  </Field>
                )}
              />
              <Field
                id="initial-group-exclusion"
                label="互斥集合"
                description="例如 study-arm；同一小鼠不能同时加入同一实验中相同集合的两个组。"
                error={errors.exclusionSet?.message}
              >
                <Input autoComplete="off" {...register('exclusionSet')} />
              </Field>
            </div>
          </section>
        ) : null}

        <section className="form-section" aria-labelledby="experiment-notes-title">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="experiment-notes-title">备注</h3>
              <p>可记录方案版本、停药条件或其他上下文。</p>
            </div>
          </div>
          <Field id="experiment-notes" label="备注" error={errors.notes?.message}>
            <Textarea rows={5} {...register('notes')} />
          </Field>
        </section>

        <div className="form-actions">
          <Link
            className={buttonClassName({ variant: 'tertiary' })}
            href={
              experimentId
                ? `/experiments/${encodeURIComponent(experimentId)}`
                : '/experiments'
            }
          >
            取消
          </Link>
          <Button
            type="submit"
            loading={isSubmitting}
            loadingLabel="正在保存实验…"
            leadingIcon={
              experimentId ? (
                <Save aria-hidden="true" size={17} />
              ) : (
                <FlaskConical aria-hidden="true" size={17} />
              )
            }
          >
            {experimentId ? '保存实验更改' : '创建实验与组别'}
          </Button>
        </div>
      </form>
    </div>
  )
}
