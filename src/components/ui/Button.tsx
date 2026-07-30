import { LoaderCircle } from 'lucide-react'
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode
} from 'react'
import {
  buttonClassName,
  type ButtonStyleOptions
} from './buttonStyles'

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    ButtonStyleOptions {
  loading?: boolean
  loadingLabel?: string
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      children,
      className,
      disabled,
      leadingIcon,
      loading = false,
      loadingLabel = '正在处理…',
      size = 'medium',
      trailingIcon,
      type = 'button',
      variant = 'primary',
      ...props
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={buttonClassName({ variant, size, className })}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <LoaderCircle
            aria-hidden="true"
            className="ui-button__spinner"
            size={16}
          />
        ) : (
          leadingIcon
        )}
        <span className={size === 'icon' ? 'sr-only' : undefined}>
          {loading ? loadingLabel : children}
        </span>
        {loading ? null : trailingIcon}
      </button>
    )
  }
)

// Compatibility export for business modules; implementation stays outside the
// component file so the button itself remains independently testable.
// eslint-disable-next-line react-refresh/only-export-components
export { buttonClassName } from './buttonStyles'
