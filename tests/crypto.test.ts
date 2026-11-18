import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ArchiveDecryptError,
  decryptArchive,
  encryptArchive,
  isEncryptedArchive,
} from '../src/services/chat/history/crypto.js'

const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5])

const zipBlob = () => new Blob([zipBytes], { type: 'application/zip' })

test('加密归档可用原口令解密还原', async () => {
  const encrypted = await encryptArchive(zipBlob(), 'pw123456')
  const decrypted = await decryptArchive(new File([encrypted], 'a.zip.enc'), 'pw123456')
  const plain = new Uint8Array(await decrypted.arrayBuffer())
  assert.deepEqual([...plain], [...zipBytes])
})

test('口令错误或密文损坏时解密抛错', async () => {
  const encrypted = await encryptArchive(zipBlob(), 'pw123456')
  await assert.rejects(
    decryptArchive(new File([encrypted], 'a.zip.enc'), 'wrong-pw'),
    ArchiveDecryptError
  )
  // 篡改密文（GCM 校验失败）
  const tampered = new Uint8Array(await encrypted.arrayBuffer())
  tampered[tampered.length - 1] ^= 0xff
  await assert.rejects(
    decryptArchive(new File([tampered], 'a.zip.enc'), 'pw123456'),
    ArchiveDecryptError
  )
})

test('识别加密容器与非加密 ZIP', async () => {
  const encrypted = await encryptArchive(zipBlob(), 'pw123456')
  assert.equal(await isEncryptedArchive(new File([encrypted], 'a.zip.enc')), true)
  assert.equal(await isEncryptedArchive(new File([zipBlob()], 'a.zip')), false)
})
