/**
 * 历史归档的密码加密容器：`DSENC1` 魔数 + 16 字节盐 + 12 字节 IV + AES-256-GCM 密文。
 * 密钥经 PBKDF2（SHA-256，十万次迭代）从口令推导；口令错误或密文被改动时解密抛错。
 */

import { BackupError } from './errors.js'
import { MAX_ENCRYPTED_ARCHIVE_BYTES } from './zipReader.js'

const MAGIC = new TextEncoder().encode('DSENC1')
const SALT_LENGTH = 16
const IV_LENGTH = 12
const PBKDF2_ITERATIONS = 100_000

export class ArchiveDecryptError extends Error {
  constructor() {
    super('wrong password or corrupted archive')
    this.name = 'ArchiveDecryptError'
  }
}

const deriveKey = async (password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** 文件头是否为加密归档容器 */
export const isEncryptedArchive = async (file: File): Promise<boolean> => {
  const head = new Uint8Array(await file.slice(0, MAGIC.length).arrayBuffer())
  return MAGIC.every((byte, index) => head[index] === byte)
}

/** 用口令加密 ZIP 归档字节 */
export const encryptArchive = async (zip: Blob, password: string): Promise<Blob> => {
  const data = new Uint8Array(await zip.arrayBuffer())
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await deriveKey(password, salt)
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data))
  const out = new Uint8Array(MAGIC.length + SALT_LENGTH + IV_LENGTH + cipher.length)
  out.set(MAGIC, 0)
  out.set(salt, MAGIC.length)
  out.set(iv, MAGIC.length + SALT_LENGTH)
  out.set(cipher, MAGIC.length + SALT_LENGTH + IV_LENGTH)
  return new Blob([out], { type: 'application/octet-stream' })
}

/** 解密加密归档；口令错误或密文损坏时抛 ArchiveDecryptError */
export const decryptArchive = async (file: File, password: string): Promise<Blob> => {
  // 必须先挡住超大密文：arrayBuffer() 会一次性读入内存，此时还没有任何解压校验
  if (file.size > MAX_ENCRYPTED_ARCHIVE_BYTES) {
    throw new BackupError('historyImportTooLarge')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new ArchiveDecryptError()
  }
  const salt = bytes.slice(MAGIC.length, MAGIC.length + SALT_LENGTH)
  const iv = bytes.slice(MAGIC.length + SALT_LENGTH, MAGIC.length + SALT_LENGTH + IV_LENGTH)
  const cipher = bytes.slice(MAGIC.length + SALT_LENGTH + IV_LENGTH)
  const key = await deriveKey(password, salt)
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
    return new Blob([plain], { type: 'application/zip' })
  } catch {
    throw new ArchiveDecryptError()
  }
}
