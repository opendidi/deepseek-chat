// 语音与备份链路间接引用 api/client.js，先注入构建期常量
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeReadAloudError } from '../src/services/speech/readAloud.js'
import {
  BackupError,
  MAX_ENCRYPTED_ARCHIVE_BYTES,
  importHistory,
} from '../src/services/chat/backup.js'

test('朗读错误分类：未知错误统一走本地化文案', () => {
  assert.deepEqual(describeReadAloudError(new Error('boom')), { key: 'ttsFailed' })
  assert.deepEqual(describeReadAloudError('oops'), { key: 'ttsFailed' })
})

test('超大归档在任何解密或读取之前就被拒绝', async () => {
  const file = new File(['x'], 'huge.zip.enc')
  Object.defineProperty(file, 'size', { value: MAX_ENCRYPTED_ARCHIVE_BYTES + 1 })
  await assert.rejects(
    () => importHistory(file, 'password'),
    (error: unknown) =>
      error instanceof BackupError && error.key === 'historyImportTooLarge'
  )
})
