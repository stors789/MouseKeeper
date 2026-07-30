import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode
} from 'react'
import { clsx } from 'clsx'

interface FieldControlProps {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  'aria-required'?: boolean
  invalid?: boolean
}

export interface FieldProps {
  id: string
  label: string
  children: ReactElement<FieldControlProps>
  description?: ReactNode
  error?: ReactNode
  required?: boolean
  optionalLabel?: string
  className?: string
}

export function Field({
  children,
  className,
  description,
  error,
  id,
  label,
  optionalLabel = '选填',
  required = false
}: FieldProps) {
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ')
  const control = isValidElement<FieldControlProps>(children)
    ? cloneElement(children, {
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
        'aria-required': required || undefined,
        invalid: error ? true : undefined
      })
    : children

  return (
    <div className={clsx('ui-field', className)}>
      <div className="ui-field__label-row">
        <label className="ui-field__label" htmlFor={id}>
          {label}
          {required ? (
            <span aria-hidden="true" className="ui-field__required">
              *
            </span>
          ) : null}
        </label>
        {required ? null : (
          <span className="ui-field__optional">{optionalLabel}</span>
        )}
      </div>
      {control}
      {description ? (
        <p className="ui-field__description" id={descriptionId}>
          {description}
        </p>
      ) : null}
      {error ? (
        <p className="ui-field__error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
