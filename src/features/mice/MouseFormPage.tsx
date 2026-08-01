import { zodResolver } from '@hookform/resolvers/zod'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Save, TriangleAlert } from 'lucide-react'
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
  MOUSE_SEXES,
  MOUSE_STATUSES,
  isValidLocalDate,
  mouseDisplayLabel,
  todayLocalDate
} from '../../domain'
import { useToast } from '../../hooks/useToast'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { readableError } from '../../lib/errors'
import {
  MOUSE_SEX_LABELS,
  MOUSE_STATUS_LABELS
} from '../../lib/labels'
import {
  WarningRequiredError,
  type CreateMouseWithCageInput
} from '../../services'

const mouseFormSchema = z
  .object({
    earTag: z.string().trim().max(120),
    experimentNumber: z.string().trim().max(120),
    name: z.string().trim().max(160),
    alias: z.string().trim().max(160),
    strain: z.string().trim().min(1, '请填写品系').max(240),
    genotype: z.string().trim().max(500),
    sex: z.enum(MOUSE_SEXES),
    birthDate: z.string().trim(),
    status: z.enum(MOUSE_STATUSES),
    source: z.string().trim().max(300),
    coatColor: z.string().trim().max(160),
    sireId: z.string(),
    damId: z.string(),
    cageId: z.string(),
    notes: z.string().max(10_000)
  })
  .superRefine((values, context) => {
    if (!values.earTag && !values.experimentNumber) {
      context.addIssue({
        code: 'custom',
        message: '耳标号和实验编号至少填写一项',
        path: ['earTag']
      })
    }
    if (
      values.birthDate &&
      (!isValidLocalDate(values.birthDate) ||
        values.birthDate > todayLocalDate())
    ) {
      context.addIssue({
        code: 'custom',
        message: '出生日期必须是有效日期且不能晚于今天',
        path: ['birthDate']
      })
    }
    if (values.sireId && values.sireId === values.damId) {
      context.addIssue({
        code: 'custom',
        message: '父本和母本不能是同一只小鼠',
        path: ['damId']
      })
    }
  })

type MouseFormValues = z.infer<typeof mouseFormSchema>

const DEFAULT_VALUES: MouseFormValues = {
  earTag: '',
  experimentNumber: '',
  name: '',
  alias: '',
  strain: '',
  genotype: '',
  sex: 'unknown',
  birthDate: '',
  status: 'alive',
  source: '',
  coatColor: '',
  sireId: '',
  damId: '',
  cageId: '',
  notes: ''
}

function optional(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

interface PendingCageAssignment {
  input: CreateMouseWithCageInput
  warnings: readonly string[]
}

export function MouseFormPage({
  mouseId,
  copyFromId
}: {
  mouseId?: string
  copyFromId?: string
}) {
  const [, navigate] = useLocation()
  const { showToast } = useToast()
  const [submitError, setSubmitError] = useState<string>()
  const [pendingCage, setPendingCage] = useState<PendingCageAssignment>()
  const options = useLiveQuery(async () => {
    const sourceId = mouseId ?? copyFromId
    const [mice, cages, mouse] = await Promise.all([
      appDatabase.mice
        .filter((item) => item.deletedFlag === 0 && item.id !== mouseId)
        .toArray(),
      appDatabase.cages
        .filter(
          (cage) =>
            cage.deletedFlag === 0 &&
            cage.status !== 'retired' &&
            cage.status !== 'inactive'
        )
        .toArray(),
      sourceId
        ? appDatabase.mice.get(sourceId)
        : Promise.resolve(undefined)
    ])
    return { mice, cages, mouse }
  }, [copyFromId, mouseId])
  const {
    control,
    formState: { errors, isDirty, isSubmitting },
    handleSubmit,
    register,
    reset
  } = useForm<MouseFormValues>({
    resolver: zodResolver(mouseFormSchema),
    defaultValues: DEFAULT_VALUES
  })

  useUnsavedChanges(isDirty && !pendingCage)

  useEffect(() => {
    if (!options?.mouse) return
    const mouse = options.mouse
    reset({
      earTag: copyFromId ? '' : (mouse.earTag ?? ''),
      experimentNumber: copyFromId
        ? ''
        : (mouse.experimentNumber ?? ''),
      name: mouse.name ?? '',
      alias: mouse.alias ?? '',
      strain: mouse.strain,
      genotype: mouse.genotype ?? '',
      sex: mouse.sex,
      birthDate: mouse.birthDate ?? '',
      status: copyFromId ? 'alive' : mouse.status,
      source: mouse.source ?? '',
      coatColor: mouse.coatColor ?? '',
      sireId: mouse.sireId ?? '',
      damId: mouse.damId ?? '',
      cageId: copyFromId ? '' : (mouse.currentCageId ?? ''),
      notes: mouse.notes ?? ''
    })
  }, [copyFromId, options?.mouse, reset])

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(undefined)
    try {
      if (mouseId) {
        if (!options?.mouse) {
          throw new Error('找不到要编辑的小鼠，未执行任何写入。')
        }
        const result = await appService.updateMouse({
          operationId: crypto.randomUUID(),
          mouseId,
          expectedRevision: options.mouse.revision,
          patch: {
            earTag: optional(values.earTag) ?? null,
            experimentNumber: optional(values.experimentNumber) ?? null,
            name: optional(values.name) ?? null,
            alias: optional(values.alias) ?? null,
            strain: values.strain,
            genotype: optional(values.genotype) ?? null,
            sex: values.sex,
            birthDate: optional(values.birthDate) ?? null,
            sireId: optional(values.sireId) ?? null,
            damId: optional(values.damId) ?? null,
            source: optional(values.source) ?? null,
            coatColor: optional(values.coatColor) ?? null,
            notes: optional(values.notes) ?? null
          }
        })
        showToast({
          title: '小鼠档案已更新',
          description: mouseDisplayLabel(result.value),
          tone: 'positive'
        })
        navigate(`/mice/${encodeURIComponent(mouseId)}`)
        return
      }

      const input: CreateMouseWithCageInput = {
        operationId: crypto.randomUUID(),
        earTag: optional(values.earTag),
        experimentNumber: optional(values.experimentNumber),
        name: optional(values.name),
        alias: optional(values.alias),
        strain: values.strain,
        genotype: optional(values.genotype),
        sex: values.sex,
        birthDate: optional(values.birthDate),
        sireId: optional(values.sireId),
        damId: optional(values.damId),
        status: values.status,
        source: optional(values.source),
        coatColor: optional(values.coatColor),
        notes: optional(values.notes),
        initialCageId: optional(values.cageId),
        initialCageReason: '建档时分配'
      }
      let result
      try {
        result = await appService.createMouseWithCage(input)
      } catch (error) {
        if (error instanceof WarningRequiredError) {
          setPendingCage({ input, warnings: error.warnings })
          showToast({
            title: '建档与笼位分配待确认',
            description: '当前事务尚未写入；确认容量警告后再原子保存。',
            tone: 'warning',
            duration: 8000
          })
          return
        }
        throw error
      }

      showToast({
        title: '小鼠已创建',
        description: mouseDisplayLabel(result.value.mouse),
        tone: 'positive'
      })
      navigate(`/mice/${encodeURIComponent(result.value.mouse.id)}`)
    } catch (error) {
      setSubmitError(readableError(error))
    }
  })

  const confirmCageAssignment = async () => {
    if (!pendingCage) return
    setSubmitError(undefined)
    try {
      const result = await appService.createMouseWithCage({
        ...pendingCage.input,
        initialCageReason: '建档时确认超容分配',
        warningAcknowledgements: pendingCage.warnings
      })
      showToast({
        title: '小鼠已创建并分配笼位',
        tone: 'positive'
      })
      navigate(`/mice/${encodeURIComponent(result.value.mouse.id)}`)
    } catch (error) {
      setSubmitError(readableError(error))
    }
  }

  if ((mouseId || copyFromId) && options === undefined) {
    return (
      <div className="feature-page" aria-busy="true">
        <Alert title="正在加载小鼠档案">确认记录存在后才会开放编辑。</Alert>
      </div>
    )
  }

  if ((mouseId || copyFromId) && options && !options.mouse) {
    return (
      <div className="feature-page">
        <Alert title="找不到小鼠档案" tone="critical">
          记录可能已被永久删除或当前链接无效。
        </Alert>
        <Link
          className={buttonClassName({ variant: 'secondary' })}
          href="/mice"
        >
          返回小鼠列表
        </Link>
      </div>
    )
  }

  if ((mouseId || copyFromId) && options?.mouse?.deletedFlag === 1) {
    return (
      <div className="feature-page">
        <Alert title="小鼠档案已在回收站" tone="warning">
          请先在“数据与安全”页面恢复后再编辑。
        </Alert>
        <Link
          className={buttonClassName({ variant: 'secondary' })}
          href="/mice"
        >
          返回小鼠列表
        </Link>
      </div>
    )
  }

  return (
    <div className="feature-page feature-form-page">
      <header className="feature-page__header">
        <div>
          <p className="feature-page__eyebrow">
            群体管理 / 小鼠 /{' '}
            {mouseId ? '编辑' : copyFromId ? '复制创建' : '新建'}
          </p>
          <h2>
            {mouseId
              ? '编辑小鼠档案'
              : copyFromId
                ? '复制相似小鼠'
                : '新建小鼠'}
          </h2>
          <p>
            {copyFromId
              ? '已复制生物学和描述字段；编号、状态关系与当前笼位不会沿用。'
              : '业务数据将在保存后写入此浏览器的 IndexedDB；至少填写一个可读编号。'}
          </p>
        </div>
        <Link
          className={buttonClassName({ variant: 'tertiary' })}
          href={
            mouseId
              ? `/mice/${encodeURIComponent(mouseId)}`
              : copyFromId
                ? `/mice/${encodeURIComponent(copyFromId)}`
                : '/mice'
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
      {pendingCage ? (
        <Alert
          title="目标笼位已达到或超过容量"
          tone="warning"
          action={
            <div className="alert-actions">
              <Button
                variant="tertiary"
                onClick={() => setPendingCage(undefined)}
              >
                返回修改
              </Button>
              <Button
                variant="secondary"
                leadingIcon={<TriangleAlert aria-hidden="true" size={16} />}
                onClick={() => void confirmCageAssignment()}
              >
                确认超容并原子保存
              </Button>
            </div>
          }
        >
          当前事务尚未写入。表单已锁定，明确确认后才会同时创建档案和笼位分配。
        </Alert>
      ) : null}

      <form className="entity-form" onSubmit={(event) => void onSubmit(event)}>
        <fieldset
          className="form-fieldset-reset"
          disabled={Boolean(pendingCage)}
        >
        <section aria-labelledby="mouse-identity-heading" className="form-section">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="mouse-identity-heading">身份信息</h3>
              <p>耳标号和实验编号至少填写一项。</p>
            </div>
          </div>
          <div className="form-grid">
            <Field
              id="mouse-ear-tag"
              label="耳标号"
              error={errors.earTag?.message}
            >
              <Input autoComplete="off" {...register('earTag')} />
            </Field>
            <Field
              id="mouse-experiment-number"
              label="实验编号"
              error={errors.experimentNumber?.message}
            >
              <Input autoComplete="off" {...register('experimentNumber')} />
            </Field>
            <Field id="mouse-name" label="名称" error={errors.name?.message}>
              <Input autoComplete="off" {...register('name')} />
            </Field>
            <Field id="mouse-alias" label="别名" error={errors.alias?.message}>
              <Input autoComplete="off" {...register('alias')} />
            </Field>
          </div>
        </section>

        <section aria-labelledby="mouse-biology-heading" className="form-section">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="mouse-biology-heading">生物学信息</h3>
              <p>年龄和周龄由出生日期自动计算，不作为重复事实保存。</p>
            </div>
          </div>
          <div className="form-grid">
            <Controller
              control={control}
              name="sex"
              render={({ field }) => (
                <Field
                  id="mouse-sex"
                  label="性别"
                  required
                  error={errors.sex?.message}
                >
                  <Select
                    key={field.value}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    options={MOUSE_SEXES.map((value) => ({
                      value,
                      label: MOUSE_SEX_LABELS[value]
                    }))}
                    value={field.value}
                    onValueChange={field.onChange}
                  />
                </Field>
              )}
            />
            <Field
              id="mouse-birth-date"
              label="出生日期"
              error={errors.birthDate?.message}
            >
              <Input type="date" max={todayLocalDate()} {...register('birthDate')} />
            </Field>
            <Field
              id="mouse-strain"
              label="品系"
              required
              error={errors.strain?.message}
            >
              <Input autoComplete="off" {...register('strain')} />
            </Field>
            <Field
              id="mouse-genotype"
              label="基因型"
              error={errors.genotype?.message}
            >
              <Input autoComplete="off" {...register('genotype')} />
            </Field>
            <Field
              id="mouse-coat-color"
              label="毛色"
              error={errors.coatColor?.message}
            >
              <Input autoComplete="off" {...register('coatColor')} />
            </Field>
            <Field
              id="mouse-source"
              label="来源"
              error={errors.source?.message}
            >
              <Input autoComplete="off" {...register('source')} />
            </Field>
          </div>
        </section>

        <section aria-labelledby="mouse-relations-heading" className="form-section">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="mouse-relations-heading">状态、位置与谱系</h3>
              <p>编辑现有档案时，状态和笼位请从详情页专用动作修改。</p>
            </div>
          </div>
          <div className="form-grid">
            {!mouseId ? (
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Field id="mouse-status" label="当前状态" required>
                    <Select
                      key={field.value}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      options={MOUSE_STATUSES.map((value) => ({
                        value,
                        label: MOUSE_STATUS_LABELS[value]
                      }))}
                      value={field.value}
                      onValueChange={field.onChange}
                    />
                  </Field>
                )}
              />
            ) : null}
            {!mouseId ? (
              <Controller
                control={control}
                name="cageId"
                render={({ field }) => (
                  <Field id="mouse-cage" label="初始笼位">
                    <Select
                      key={field.value}
                      ref={field.ref}
                      clearLabel="暂不分配"
                      onBlur={field.onBlur}
                      placeholder="暂不分配"
                      options={(options?.cages ?? []).map((cage) => ({
                        value: cage.id,
                        label: [
                          cage.cageNumber,
                          cage.room,
                          `${cage.maxCapacity} 只上限`
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      }))}
                      value={field.value}
                      onValueChange={field.onChange}
                    />
                  </Field>
                )}
              />
            ) : null}
            <Controller
              control={control}
              name="sireId"
              render={({ field }) => (
                <Field id="mouse-sire" label="父本">
                  <Select
                    key={field.value}
                    ref={field.ref}
                    clearLabel="未关联"
                    onBlur={field.onBlur}
                    placeholder="未关联"
                    options={(options?.mice ?? []).map((mouse) => ({
                      value: mouse.id,
                      label: `${mouseDisplayLabel(mouse)} · ${MOUSE_SEX_LABELS[mouse.sex]} · ${MOUSE_STATUS_LABELS[mouse.status]}`
                    }))}
                    value={field.value}
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
                  id="mouse-dam"
                  label="母本"
                  error={errors.damId?.message}
                >
                  <Select
                    key={field.value}
                    ref={field.ref}
                    clearLabel="未关联"
                    onBlur={field.onBlur}
                    placeholder="未关联"
                    options={(options?.mice ?? []).map((mouse) => ({
                      value: mouse.id,
                      label: `${mouseDisplayLabel(mouse)} · ${MOUSE_SEX_LABELS[mouse.sex]} · ${MOUSE_STATUS_LABELS[mouse.status]}`
                    }))}
                    value={field.value}
                    onValueChange={field.onChange}
                  />
                </Field>
              )}
            />
          </div>
        </section>

        <section aria-labelledby="mouse-notes-heading" className="form-section">
          <div className="form-section__heading">
            <span className="assay-rail-mark" aria-hidden="true" />
            <div>
              <h3 id="mouse-notes-heading">备注</h3>
              <p>支持中英文长文本；保存失败时输入不会被清空。</p>
            </div>
          </div>
          <Field id="mouse-notes" label="备注" error={errors.notes?.message}>
            <Textarea rows={6} {...register('notes')} />
          </Field>
        </section>

        <div className="form-actions">
          <Link
            className={buttonClassName({ variant: 'tertiary' })}
            href={mouseId ? `/mice/${encodeURIComponent(mouseId)}` : '/mice'}
          >
            取消
          </Link>
          <Button
            type="submit"
            disabled={Boolean(pendingCage)}
            loading={isSubmitting}
            loadingLabel="正在保存小鼠…"
            leadingIcon={<Save aria-hidden="true" size={17} />}
          >
            {mouseId ? '保存档案更改' : '保存小鼠'}
          </Button>
        </div>
        </fieldset>
      </form>
    </div>
  )
}
