import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

class TestStorage implements Storage {
  readonly #values = new Map<string, string>()

  get length() {
    return this.#values.size
  }

  clear() {
    this.#values.clear()
  }

  getItem(key: string) {
    return this.#values.get(key) ?? null
  }

  key(index: number) {
    return [...this.#values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.#values.delete(key)
  }

  setItem(key: string, value: string) {
    this.#values.set(key, String(value))
  }
}

if (typeof window !== 'undefined' && !window.localStorage) {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: new TestStorage()
  })
}

if (typeof window !== 'undefined' && !window.sessionStorage) {
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: new TestStorage()
  })
}
