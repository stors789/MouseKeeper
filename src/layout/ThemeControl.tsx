import { Monitor } from 'lucide-react'
import { Select } from '../components/ui/Select'
import type { ThemePreference } from '../hooks/themeContext'
import { useTheme } from '../hooks/useTheme'

const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
] as const

interface ThemeControlProps {
  compact?: boolean
}

export function ThemeControl({ compact = false }: ThemeControlProps) {
  const { preference, setPreference } = useTheme()

  return (
    <div className="theme-control">
      <Monitor aria-hidden="true" size={17} />
      {compact ? null : (
        <Select
          ariaLabel="主题模式"
          className="theme-control__select"
          value={preference}
          options={THEME_OPTIONS}
          onValueChange={(value) =>
            setPreference(value as ThemePreference)
          }
        />
      )}
      {compact ? <span className="sr-only">主题：{preference}</span> : null}
    </div>
  )
}
