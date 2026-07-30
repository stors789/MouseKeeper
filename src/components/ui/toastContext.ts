import { createContext } from 'react'
import type { AlertTone } from './Alert'

interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastInput {
  title: string
  description?: string
  tone?: AlertTone
  duration?: number
  action?: ToastAction
}

export interface ToastContextValue {
  showToast: (toast: ToastInput) => string
  dismissToast: (id: string) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)
