import assert from 'node:assert/strict'
import { test } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import {
  ArchiveError,
  isZipFile,
  readArchive,
  readEntry,
  skipEntry,
} from '../src/services/chat/history/zipReader.js'

const asFile = (bytes: Uint8Array, name = 'archive.zip') => {
  // fflate 返回 Uint8Array<ArrayBufferLike>，复制到普通 ArrayBuffer 才能作为 BlobPart
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength))
  copy.set(bytes)
  return new File([copy], name)
}

/** 找到中央目录第一条记录（PK\x01\x02），用于伪造条目声明大小 */
const centralDirectoryOffset = (bytes: Uint8Array) => {
  for (let index = 0; index < bytes.length - 4; index++) {
    if (
      bytes[index] === 0x50 &&
      bytes[index + 1] === 0x4b &&
      bytes[index + 2] === 1 &&
      bytes[index + 3] === 2
    ) {
      return index
    }
  }
  return -1
}

test('isZipFile 通过本地文件头签名识别 ZIP', async () => {
  assert.equal(await isZipFile(asFile(strToU8('not a zip'))), false)
  assert.equal(await isZipFile(asFile(zipSync({ 'a.txt': strToU8('x') }))), true)
})

test('正常归档按条目顺序解压且内容一致', async () => {
  const bytes = zipSync({ 'manifest.json': strToU8('hello') }, { level: 6 })
  const paths: string[] = []
  for await (const entry of readArchive(asFile(bytes))) {
    paths.push(entry.path)
    assert.equal(entry.size, 5)
    assert.equal(await (await readEntry(entry)).text(), 'hello')
  }
  assert.deepEqual(paths, ['manifest.json'])
})

test('损坏的签名直接抛 ArchiveError', async () => {
  await assert.rejects(async () => {
    for await (const entry of readArchive(asFile(strToU8('PK\x03\x04garbage')))) {
      await skipEntry(entry)
    }
  }, ArchiveError)
})

test('zip bomb：目录声明超大解压体积时在解压前拒绝', async () => {
  const bytes = zipSync({ 'manifest.json': strToU8('hello') }, { level: 6 })
  const offset = centralDirectoryOffset(bytes)
  assert.ok(offset >= 0, '应能定位中央目录')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // 中央目录 +24 是 uncompressed size；伪造成 40MB（单条上限 32MB）
  view.setUint32(offset + 24, 40 * 1024 * 1024, true)
  await assert.rejects(async () => {
    for await (const entry of readArchive(asFile(bytes))) {
      await skipEntry(entry)
    }
  }, ArchiveError)
})
