import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as db from '../src/services/chat/db.js'
import type { AssistantMessage, Session, UserMessage } from '../src/services/chat/types.js'

// db.ts 直接面向 IndexedDB，此前完全无测试。这里用 fake-indexeddb 覆盖
// 三个最容易出数据事故的事务：saveSession 的会话+摘要+文件写入、
// deleteSession 的文件引用计数清理、commitStaging 的整体替换。

const user = (id: string, overrides: Partial<UserMessage> = {}): UserMessage => ({
  id,
  role: 'user',
  content: `question-${id}`,
  files: [],
  createdAt: 1_000,
  ...overrides,
})

const reply = (id: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id,
  role: 'assistant',
  createdAt: 1_100,
  model: null,
  prefix: false,
  status: 'done',
  blocks: [{ type: 'text', text: `answer-${id}` }],
  ...overrides,
})

const session = (id: string, messages: Session['messages'], overrides: Partial<Session> = {}): Session => ({
  id,
  title: `title-${id}`,
  createdAt: 1_000,
  updatedAt: 2_000,
  messages,
  ...overrides,
})

const file = (id: string): db.StoredFile => ({ id, blob: new Blob([`blob-${id}`]) })

test('saveSession 写入会话、摘要与文件，loadSession 读回一致', async () => {
  const s = session('db-save-1', [user('u1'), reply('a1')])
  await db.saveSession(s, [file('db-save-file-1')])
  const loaded = await db.loadSession('db-save-1')
  assert.ok(loaded)
  assert.equal(loaded.title, 'title-db-save-1')
  assert.equal(loaded.messages.length, 2)
  assert.deepEqual(loaded.messages[0], s.messages[0])

  const summaries = await db.loadSessionSummaries()
  const summary = summaries.find((item) => item.id === 'db-save-1')
  assert.ok(summary)
  assert.equal(summary.title, 'title-db-save-1')
  assert.equal(summary.pinned, undefined)
  // 摘要不携带消息
  assert.ok(!('messages' in summary))

  const blob = await db.loadFile('db-save-file-1')
  assert.ok(blob)
  assert.equal(await blob.text(), 'blob-db-save-file-1')
})

test('renameSession 与 setSessionPinned 同步更新详情和列表', async () => {
  const s = session('db-rename-1', [user('u1'), reply('a1')])
  await db.saveSession(s)

  await db.renameSession('db-rename-1', 'renamed')
  const renamed = await db.loadSession('db-rename-1')
  assert.equal(renamed?.title, 'renamed')
  assert.ok((await db.loadSessionSummaries()).find((item) => item.id === 'db-rename-1')?.title === 'renamed')

  await db.setSessionPinned('db-rename-1', true)
  assert.equal((await db.loadSession('db-rename-1'))?.pinned, true)
  assert.equal(
    (await db.loadSessionSummaries()).find((item) => item.id === 'db-rename-1')?.pinned,
    true
  )
  await db.setSessionPinned('db-rename-1', false)
  assert.equal((await db.loadSession('db-rename-1'))?.pinned, undefined)
})

test('deleteSession 只清理无引用的文件：被其他会话引用的原件保留', async () => {
  // 两个会话共用同一附件 id
  const shared = user('u1', {
    files: [{ id: 'db-shared-file', serverId: null, name: 'a.png', size: 3, isImage: true, mimeType: 'image/png' }],
  })
  await db.saveSession(session('db-del-a', [shared]), [file('db-shared-file')])
  await db.saveSession(session('db-del-b', [shared]), [])

  await db.deleteSession('db-del-a')
  assert.equal(await db.loadSession('db-del-a'), undefined)
  // 仍被 db-del-b 引用，原件保留
  assert.ok(await db.loadFile('db-shared-file'))

  await db.deleteSession('db-del-b')
  assert.equal(await db.loadFile('db-shared-file'), undefined)

  // 会话收藏随会话一起清理
  await db.putFavorite({ id: 'db-del-x:a1', sessionId: 'db-del-x', messageId: 'a1', text: 'x', createdAt: 5 })
  await db.saveSession(session('db-del-x', [user('u1'), reply('a1')]))
  await db.deleteSession('db-del-x')
  assert.equal((await db.loadFavorites()).length, 0)
})

test('commitStaging 用暂存整体替换正式数据并清空收藏，失败回滚由事务保证', async () => {
  await db.saveSession(session('db-old', [user('u1'), reply('a1')]))
  await db.putFavorite({ id: 'db-old:a1', sessionId: 'db-old', messageId: 'a1', text: 'old', createdAt: 6 })

  await db.clearStaging()
  await db.addStagingSession(session('db-new', [user('u2'), reply('a2')]))
  await db.saveStagingFiles([file('db-new-file')])

  const summaries = await db.commitStaging()
  assert.deepEqual(summaries.map((item) => item.id), ['db-new'])
  assert.equal(await db.loadSession('db-old'), undefined)
  assert.ok(await db.loadSession('db-new'))
  assert.ok(await db.loadFile('db-new-file'))
  // 旧会话收藏被整体替换清空
  assert.equal((await db.loadFavorites()).length, 0)
  // 暂存清空
  await db.clearStaging()
})
