import { saveBlob } from '../platform/files'

export function downloadBlob(blob: Blob, filename: string): Promise<void> {
  return saveBlob(blob, filename).then(() => undefined)
}

export function downloadText(
  contents: string,
  filename: string,
  type = 'text/plain;charset=utf-8'
): Promise<void> {
  return downloadBlob(new Blob([contents], { type }), filename)
}
