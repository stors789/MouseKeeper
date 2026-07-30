import { clsx } from 'clsx'
import { forwardRef, type TextareaHTMLAttributes } from 'react'

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, invalid, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={clsx('ui-textarea', className)}
        aria-invalid={invalid || undefined}
        {...props}
      />
    )
  }
)
