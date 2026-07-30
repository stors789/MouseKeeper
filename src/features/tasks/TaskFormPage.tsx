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
import {
  TASK_PRIORITIES,
  isValidLocalDate,
  mouseDisplayLabel,
  todayLocalDate
} from '../../domain'
import { useToast } from '../../hooks/useToast'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { readableError } from '../../lib/errors'
import { TASK_PRIORITY_LABELS } from '../../lib/labels'

const taskSchema = z.object({
  title: z.string().trim().min(1, '请填写任务标题').max(240),
  dueDate: z.string().refine(isValidLocalDate, '请选择有效截止日期'),
  dueTime: z.string(),
  priority: z.enum(TASK_PRIORITIES),
  mouseId: z.string(),
  cageId: z.string(),
  experimentId: z.string(),
  notes: z.string().max(10_000)
})

type TaskValues = z.infer<typeof taskSchema>

const DEFAULT_VALUES: TaskValues = {
  title: '',
  dueDate: todayLocalDate(),
  dueTime: '',
  priority: 'normal',
  mouseId: '',
  cageId: '',
  experimentId: '',
  notes: ''
}

function optional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

export function TaskFormPage({ taskId }: { taskId?: string }) {
  const [, navigate] = useLocation()
  const { showToast } = useToast()
  const [submitError, setSubmitError] = useState<string>()
  const options = useLiveQuery(async () => {
    const [task, mice, cages, experiments] = await Promise.all([
      taskId ? appDatabase.tasks.get(taskId) : Promise.resolve(undefined),
      appDatabase.mice
        .filter((mouse) => mouse.deletedFlag === 0)
        .toArray(),
      appDatabase.cages
        .filter((cage) => cage.deletedFlag === 0)
        .toArray(),
      appDatabase.experiments
        .filter((experiment) => experiment.deletedFlag === 0)
        .toArray()
    ])
    return { task, mice, cages, experiments }
  }, [taskId])
  const {
    control,
    formState: { errors, isDirty, isSubmitting },
    handleSubmit,
    register,
    reset
  } = useForm<TaskValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: DEFAULT_VALUES
  })
  useUnsavedChanges(isDirty)

  useEffect(() => {
    if (!options?.task) return
    reset({
      title: options.task.title,
      dueDate: options.task.dueDate,
      dueTime: options.task.dueTime ?? '',
      priority: options.task.priority,
      mouseId: options.task.mouseId ?? '',
      cageId: options.task.cageId ?? '',
      experimentId: options.task.experimentId ?? '',
      notes: options.task.notes ?? ''
    })
  }, [options?.task, reset])

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(undefined)
    try {
      if (taskId && options?.task) {
        await appService.updateTask({
          operationId: crypto.randomUUID(),
          taskId,
          expectedRevision: options.task.revision,
          patch: {
            title: values.title,
            dueDate: values.dueDate,
            dueTime: optional(values.dueTime) ?? null,
            priority: values.priority,
            mouseId: optional(values.mouseId) ?? null,
            cageId: optional(values.cageId) ?? null,
            experimentId: optional(values.experimentId) ?? null,
            notes: optional(values.notes) ?? null
          }
        })
        showToast({ title: '任务已更新', tone: 'positive' })
      } else {
        await appService.createTask({
          operationId: crypto.randomUUID(),
          title: values.title,
          dueDate: values.dueDate,
          dueTime: optional(values.dueTime),
          priority: values.priority,
          mouseId: optional(values.mouseId),
          cageId: optional(values.cageId),
          experimentId: optional(values.experimentId),
          notes: optional(values.notes)
        })
        showToast({ title: '任务已创建', tone: 'positive' })
      }
      navigate('/tasks')
    } catch (error) {
      setSubmitError(readableError(error))
    }
  })

  return (
    <div className="feature-page feature-form-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">
            工作 / 任务 / {taskId ? '编辑' : '新建'}
          </p>
          <h2>{taskId ? '编辑任务' : '新建任务'}</h2>
          <p>任务保存在当前设备，可关联小鼠、笼位和实验。</p>
        </div>
        <Link
          className={buttonClassName({ variant: 'tertiary' })}
          href="/tasks"
        >
          <ArrowLeft aria-hidden="true" size={17} />
          返回
        </Link>
      </header>

      {submitError ? (
        <Alert title="没有保存任务" tone="critical">
          {submitError}
        </Alert>
      ) : null}

      <form className="entity-form" onSubmit={(event) => void onSubmit(event)}>
        <section className="form-section" aria-labelledby="task-basic-title">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="task-basic-title">任务内容</h3>
              <p>标题应描述一个可完成的具体动作。</p>
            </div>
          </div>
          <Field
            id="task-title"
            label="标题"
            required
            error={errors.title?.message}
          >
            <Input autoFocus autoComplete="off" {...register('title')} />
          </Field>
          <div className="form-grid">
            <Field
              id="task-due-date"
              label="截止日期"
              required
              error={errors.dueDate?.message}
            >
              <Input type="date" {...register('dueDate')} />
            </Field>
            <Field id="task-due-time" label="截止时间">
              <Input type="time" {...register('dueTime')} />
            </Field>
            <Controller
              control={control}
              name="priority"
              render={({ field }) => (
                <Field id="task-priority" label="优先级" required>
                  <Select
                    options={TASK_PRIORITIES.map((value) => ({
                      value,
                      label: TASK_PRIORITY_LABELS[value]
                    }))}
                    value={field.value}
                    onValueChange={field.onChange}
                  />
                </Field>
              )}
            />
          </div>
        </section>

        <section className="form-section" aria-labelledby="task-links-title">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="task-links-title">关联对象</h3>
              <p>可同时关联多个类型，方便从工作区回溯上下文。</p>
            </div>
          </div>
          <div className="form-grid">
            <Controller
              control={control}
              name="mouseId"
              render={({ field }) => (
                <Field id="task-mouse" label="小鼠">
                  <Select
                    placeholder="未关联"
                    options={(options?.mice ?? []).map((mouse) => ({
                      value: mouse.id,
                      label: mouseDisplayLabel(mouse)
                    }))}
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  />
                </Field>
              )}
            />
            <Controller
              control={control}
              name="cageId"
              render={({ field }) => (
                <Field id="task-cage" label="笼位">
                  <Select
                    placeholder="未关联"
                    options={(options?.cages ?? []).map((cage) => ({
                      value: cage.id,
                      label: cage.cageNumber
                    }))}
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  />
                </Field>
              )}
            />
            <Controller
              control={control}
              name="experimentId"
              render={({ field }) => (
                <Field id="task-experiment" label="实验">
                  <Select
                    placeholder="未关联"
                    options={(options?.experiments ?? []).map((experiment) => ({
                      value: experiment.id,
                      label: experiment.name
                    }))}
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  />
                </Field>
              )}
            />
          </div>
          <Field id="task-notes" label="备注" error={errors.notes?.message}>
            <Textarea rows={5} {...register('notes')} />
          </Field>
        </section>

        <div className="form-actions">
          <Link
            className={buttonClassName({ variant: 'tertiary' })}
            href="/tasks"
          >
            取消
          </Link>
          <Button
            type="submit"
            loading={isSubmitting}
            leadingIcon={<Save aria-hidden="true" size={17} />}
          >
            {taskId ? '保存任务更改' : '创建任务'}
          </Button>
        </div>
      </form>
    </div>
  )
}
