import { X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { clsx } from 'clsx'
import {
  ToastContext,
  type ToastInput
} from './toastContext'

interface ToastRecord extends ToastInput {
  id: string
}

let toastSequence = 0

function createToastId() {
  toastSequence += 1
  return `toast-${toastSequence}`
}

interface ToastProviderProps {
  children: ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback((input: ToastInput) => {
    const id = createToastId()
    const nextToast: ToastRecord = {
      ...input,
      id,
      tone: input.tone ?? 'informative',
      duration: input.duration ?? 5000
    }

    setToasts((current) => [...current.slice(-2), nextToast])
    return id
  }, [])

  const value = useMemo(
    () => ({ dismissToast, showToast }),
    [dismissToast, showToast]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-label="通知"
        aria-live="polite"
        className="ui-toast-region"
      >
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={dismissToast}
          />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

interface ToastItemProps {
  toast: ToastRecord
  onDismiss: (id: string) => void
}

function ToastItem({ onDismiss, toast }: ToastItemProps) {
  const { action, description, duration = 5000, id, title } = toast

  useToastTimer(id, duration, onDismiss)

  return (
    <section
      className={clsx('ui-toast', `is-${toast.tone ?? 'informative'}`)}
      role={toast.tone === 'critical' ? 'alert' : 'status'}
    >
      <span className="ui-toast__rail" aria-hidden="true" />
      <div className="ui-toast__content">
        <p className="ui-toast__title">{title}</p>
        {description ? (
          <p className="ui-toast__description">{description}</p>
        ) : null}
        {action ? (
          <button
            className="ui-toast__action"
            type="button"
            onClick={() => {
              action.onClick()
              onDismiss(id)
            }}
          >
            {action.label}
          </button>
        ) : null}
      </div>
      <button
        aria-label="关闭通知"
        className="ui-toast__close"
        type="button"
        onClick={() => onDismiss(id)}
      >
        <X aria-hidden="true" size={16} />
      </button>
    </section>
  )
}

function useToastTimer(
  id: string,
  duration: number,
  onDismiss: (id: string) => void
) {
  useEffect(() => {
    if (duration <= 0) {
      return undefined
    }

    const timer = window.setTimeout(() => onDismiss(id), duration)
    return () => window.clearTimeout(timer)
  }, [duration, id, onDismiss])
}
