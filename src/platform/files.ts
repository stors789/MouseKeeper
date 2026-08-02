import { open, save } from '@tauri-apps/plugin-dialog'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'
import { basename } from '@tauri-apps/api/path'
import { isNativeApp } from './runtime'

export interface SavedFile {
  runtime: 'web' | 'tauri'
  path?: string
}

export type ImportFileKind = 'json' | 'csv'

export async function pickImportFile(kind: ImportFileKind): Promise<File | undefined> {
  if (!isNativeApp()) throw new Error('浏览器文件选择必须由文件输入控件发起')
  const path = await open({
    multiple: false,
    directory: false,
    pickerMode: 'document',
    fileAccessMode: 'copy',
    filters: [{
      name: kind === 'json' ? 'MouseKeeper JSON' : 'CSV',
      extensions: kind === 'json' ? ['json', 'application/json'] : ['csv', 'text/csv']
    }]
  })
  if (!path) return undefined
  const bytes = await readFile(path)
  const name = await basename(path)
  return new File([bytes], name, {
    type: kind === 'json' ? 'application/json' : 'text/csv'
  })
}

function extension(filename: string): string | undefined {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1) : undefined
}

async function saveWithTauri(blob: Blob, filename: string): Promise<SavedFile> {
  const suffix = extension(filename)
  const path = await save({
    defaultPath: filename,
    filters: suffix ? [{ name: suffix.toUpperCase(), extensions: [suffix] }] : undefined
  })
  if (!path) throw new Error('用户取消了保存；文件尚未写入磁盘')
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
  return { runtime: 'tauri', path }
}

function saveWithBrowser(blob: Blob, filename: string): SavedFile {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return { runtime: 'web' }
}

/** Native save dialog in Tauri; Blob download fallback in Web/PWA. */
export async function saveBlob(blob: Blob, filename: string): Promise<SavedFile> {
  return isNativeApp() ? saveWithTauri(blob, filename) : saveWithBrowser(blob, filename)
}
