import { clsx } from 'clsx'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'danger'
export type ButtonSize = 'small' | 'medium' | 'large' | 'icon'

export interface ButtonStyleOptions {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}

export function buttonClassName({
  variant = 'primary',
  size = 'medium',
  className
}: ButtonStyleOptions = {}) {
  return clsx(
    'ui-button',
    `ui-button--${variant}`,
    `ui-button--${size}`,
    className
  )
}
