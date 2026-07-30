import type {
  BackupEnvelope,
  BackupUnsignedEnvelope
} from './types'

function encodePrimitive(value: null | boolean | number | string): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Canonical JSON cannot encode a non-finite number')
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) {
    throw new TypeError('Value is not JSON serializable')
  }
  return encoded
}

function encodeCanonical(value: unknown, inArray = false): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return encodePrimitive(value)
  }

  if (Array.isArray(value)) {
    return `[${Array.from(value, item => encodeCanonical(item, true)).join(
      ','
    )}]`
  }

  if (typeof value === 'object') {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new TypeError('Canonical JSON only accepts plain objects')
    }

    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(
        ([key, item]) =>
          `${encodePrimitive(key)}:${encodeCanonical(item, false)}`
      )
    return `{${entries.join(',')}}`
  }

  if (value === undefined && !inArray) {
    throw new TypeError('Canonical JSON cannot encode undefined')
  }
  throw new TypeError(`Canonical JSON cannot encode ${typeof value}`)
}

export function canonicalJson(value: unknown): string {
  return encodeCanonical(value)
}

export async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is unavailable')
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  )
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function backupChecksumPayload(
  backup: BackupUnsignedEnvelope | BackupEnvelope
): BackupUnsignedEnvelope {
  return {
    format: backup.format,
    backupFormatVersion: backup.backupFormatVersion,
    schemaVersion: backup.schemaVersion,
    appVersion: backup.appVersion,
    exportedAt: backup.exportedAt,
    backupId: backup.backupId,
    databaseInstanceId: backup.databaseInstanceId,
    tableCounts: backup.tableCounts,
    data: backup.data
  }
}

export async function calculateBackupChecksum(
  backup: BackupUnsignedEnvelope | BackupEnvelope
): Promise<string> {
  return sha256Hex(canonicalJson(backupChecksumPayload(backup)))
}
