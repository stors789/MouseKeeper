import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import {
  ThemeContext,
  type ResolvedTheme,
  type ThemePreference
} from './themeContext'

const THEME_STORAGE_KEY = 'mousekeeper:theme:v1'
const DARK_MODE_QUERY = '(prefers-color-scheme: dark)'

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function readStoredTheme(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system'
  }

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(storedTheme) ? storedTheme : 'system'
  } catch {
    return 'system'
  }
}

function readSystemTheme(): ResolvedTheme {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return 'light'
  }

  return window.matchMedia(DARK_MODE_QUERY).matches ? 'dark' : 'light'
}

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [preference, setPreference] =
    useState<ThemePreference>(readStoredTheme)
  const [systemTheme, setSystemTheme] =
    useState<ResolvedTheme>(readSystemTheme)
  const resolvedTheme =
    preference === 'system' ? systemTheme : preference

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    root.dataset.themePreference = preference
    root.style.colorScheme = resolvedTheme
  }, [preference, resolvedTheme])

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference)
    } catch {
      // Theme persistence is optional when storage is unavailable.
    }
  }, [preference])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined
    }

    const mediaQuery = window.matchMedia(DARK_MODE_QUERY)
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light')
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
