import * as DialogPrimitive from '@radix-ui/react-dialog'
import { clsx } from 'clsx'
import { X } from 'lucide-react'
import { useId, type ReactNode } from 'react'

export type DialogSize = 'small' | 'medium' | 'large' | 'drawer'

export interface DialogProps {
  title: string
  description: string
  children: ReactNode
  trigger?: ReactNode
  footer?: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  size?: DialogSize
  className?: string
}

export function Dialog({
  children,
  className,
  defaultOpen,
  description,
  footer,
  onOpenChange,
  open,
  size = 'medium',
  title,
  trigger
}: DialogProps) {
  const descriptionId = useId()

  return (
    <DialogPrimitive.Root
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      open={open}
    >
      {trigger ? (
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      ) : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-dialog__overlay" />
        <DialogPrimitive.Content
          aria-describedby={descriptionId}
          aria-label={title}
          aria-labelledby={undefined}
          className={clsx(
            'ui-dialog__content',
            `ui-dialog__content--${size}`,
            className
          )}
        >
          <header className="ui-dialog__header">
            <div>
              <DialogPrimitive.Title className="ui-dialog__title">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                className="ui-dialog__description"
                id={descriptionId}
              >
                {description}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              className="ui-dialog__close"
              aria-label="关闭对话框"
            >
              <X aria-hidden="true" size={18} />
            </DialogPrimitive.Close>
          </header>
          <div className="ui-dialog__body">{children}</div>
          {footer ? <footer className="ui-dialog__footer">{footer}</footer> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
