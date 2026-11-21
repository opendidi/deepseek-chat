import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  appendBranch,
  buildMessageVersions,
  getVisibleMessages,
  normalizeSession,
  selectVersion,
  sessionStructureKey,
} from '../src/services/chat/branches.js'
import type { AssistantMessage, Message, Session, UserMessage } from '../src/services/chat/types.js'

const user = (id: string): UserMessage => ({
  id,
  role: 'user',
  content: id,
  files: [],
  createdAt: 0,
})

const assistant = (id: string): AssistantMessage => ({
  id,
  role: 'assistant',
  createdAt: 0,
  model: null,
  prefix: false,
  status: 'done',
  blocks: [],
})

const ids = (messages: Message[]) => messages.map((message) => message.id)

const linear = (): Session => ({
  id: 's1',
  title: '',
  createdAt: 0,
  updatedAt: 0,
  messages: [user('u1'), assistant('a1'), user('u2'), assistant('a2')],
})

test('线性会话规范化后得到完整父子链', () => {
  const session = normalizeSession(linear())
  assert.equal(session.rootMessageId, 'u1')
  assert.equal(session.messages[0].parentId, null)
  assert.equal(session.messages[0].selectedChildId, 'a1')
  assert.deepEqual(ids(getVisibleMessages(session)), ['u1', 'a1', 'u2', 'a2'])
})

test('正文更新（消息对象换新但结构不变）复用同一份版本索引', () => {
  const session = normalizeSession(linear())
  const first = buildMessageVersions(session, new Map())
  const unchanged = buildMessageVersions(session, first)
  assert.equal(unchanged, first)

  // 模拟流式正文只替换最后一条消息：版本索引仍应稳定，历史消息无需重绘
  const last = session.messages[session.messages.length - 1]
  const updated: Message = last.role === 'assistant' ? { ...last, blocks: [] } : last
  const streamed: Session = {
    ...session,
    messages: [...session.messages.slice(0, -1), updated],
  }
  assert.equal(buildMessageVersions(streamed, first), first)
})

test('追加与切换分支只改变选中路径', () => {
  const base = normalizeSession(linear())
  const branched = appendBranch(base, 'a1', [user('u3'), assistant('a3')])
  assert.deepEqual(ids(getVisibleMessages(branched)), ['u1', 'a1', 'u3', 'a3'])
  // 原分支数据仍在，切换后可恢复
  assert.ok(branched.messages.some((message) => message.id === 'u2'))
  assert.deepEqual(ids(getVisibleMessages(selectVersion(branched, 'u2'))), ['u1', 'a1', 'u2', 'a2'])
})

test('结构签名忽略正文变化，只在分支关系变化时改变', () => {
  const base = normalizeSession(linear())
  const key = sessionStructureKey(base)
  const streamed: Session = {
    ...base,
    messages: base.messages.map((message) =>
      message.role === 'assistant' ? { ...message, blocks: [...message.blocks] } : message
    ),
  }
  assert.equal(sessionStructureKey(streamed), key)

  const branched = appendBranch(base, 'a1', [user('u3'), assistant('a3')])
  assert.notEqual(sessionStructureKey(branched), key)
})

test('结构签名不变时可见路径仍返回最新消息对象', () => {
  const base = normalizeSession(linear())
  const streamed: Session = {
    ...base,
    messages: base.messages.map((message) =>
      message.role === 'assistant' ? { ...message, status: 'streaming' } : message
    ),
  }
  const path = getVisibleMessages(streamed)
  assert.equal(path[1]?.role === 'assistant' && path[1].status, 'streaming')
  assert.notEqual(getVisibleMessages(streamed), getVisibleMessages(base))
})
