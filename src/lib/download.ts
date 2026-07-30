export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function downloadText(
  contents: string,
  filename: string,
  type = 'text/plain;charset=utf-8'
): void {
  downloadBlob(new Blob([contents], { type }), filename)
}
