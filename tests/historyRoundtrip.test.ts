import { API_ORIGIN_SHIM } from './helpers/apiOrigin.js'
// 导入即注入 __API_ORIGIN__ 全局量，须先于下方间接引用 client.js 的模块
void API_ORIGIN_SHIM
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toSessionFile } from '../src/services/chat/history/toArchive.js'
import { toLocalSession } from '../src/services/chat/history/toLocal.js'
import { getVisibleMessages } from '../src/services/chat/branches.js'
import { imagePath } from '../src/services/chat/history/paths.js'
import type { Session } from '../src/services/chat/types.js'

// 导出（toSessionFile）与导入（toLocalSession）的往返一致性：
// 内容、思考、状态、附件元数据必须无损还原，否则导出再导入会静默丢历史。

const session = (): Session => ({
  id: 's1',
  title: '往返测试',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  messages: [
    {
      id: 'u1',
      role: 'user',
      content: '帮我算一下',
      createdAt: 1_700_000_000_000,
      files: [
        {
          id: 'f1',
          serverId: 'file-abc',
          name: '数据.png',
          size: 123,
          isImage: true,
          mimeType: 'image/png',
        },
      ],
    },
    {
      id: 'a1',
      role: 'assistant',
      createdAt: 1_700_000_010_000,
      model: null,
      thinking: true,
      search: false,
      prefix: false,
      status: 'done',
      blocks: [
        { type: 'thinking', thinking: '先拆解问题' },
        { type: 'text', text: '答案是 42' },
      ],
    },
  ],
})

test('会话导出→导入往返：正文、思考、状态与标题无损', () => {
  const file = toSessionFile(session(), () => null)
  const { session: restored } = toLocalSession(file)

  assert.equal(restored.title, '往返测试')
  const visible = getVisibleMessages(restored)
  assert.equal(visible.length, 2)

  const [user, reply] = visible
  assert.equal(user.role, 'user')
  assert.equal(user.role === 'user' ? user.content : '', '帮我算一下')

  assert.equal(reply.role, 'assistant')
  if (reply.role !== 'assistant') {
    return
  }
  assert.equal(reply.status, 'done')
  assert.equal(reply.thinking, true)
  assert.equal(
    reply.blocks
      .filter((block) => block.type === 'thinking')
      .map((block) => (block.type === 'thinking' ? block.thinking : ''))
      .join(''),
    '先拆解问题'
  )
  assert.equal(
    reply.blocks
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join(''),
    '答案是 42'
  )
})

test('附件往返：元数据保留，远端身份与 MIME 不跨归档（导入后重新补传）', () => {
  const file = toSessionFile(session(), () => null)
  const { session: restored } = toLocalSession(file)
  const user = getVisibleMessages(restored)[0]
  assert.ok(user.role === 'user')
  const [attachment] = user.files
  assert.equal(attachment.name, '数据.png')
  assert.equal(attachment.size, 123)
  assert.equal(attachment.isImage, true)
  // 导入的数据 serverId 清空、MIME 待图片原件回填
  assert.equal(attachment.serverId, null)
  assert.equal(attachment.mimeType, '')
})

test('图片附件通过 exportImage 挂到会话目录，导入端列出待读取清单', () => {
  const file = toSessionFile(session(), (image) =>
    image.isImage ? imagePath('s1', image.id, image.name) : null
  )
  const { images } = toLocalSession(file)
  assert.equal(images.size, 1)
  const [[path, fileId]] = [...images]
  assert.equal(fileId, 'f1')
  assert.equal(path, imagePath('s1', 'f1', '数据.png'))
})

test('停止的回答按归档状态还原，不变成「已完成」', () => {
  const base = session()
  const [user, replyBase] = base.messages
  if (replyBase.role !== 'assistant') {
    assert.fail('测试数据第二条应为回答')
  }
  const stopped: Session = {
    ...base,
    messages: [user, { ...replyBase, status: 'stopped' }],
  }
  const { session: restored } = toLocalSession(toSessionFile(stopped, () => null))
  const reply = getVisibleMessages(restored)[1]
  assert.ok(reply.role === 'assistant')
  // 归档侧 INCOMPLETE/WIP 导入时按「已停止」处理，与协议一致
  assert.equal(reply.status, 'stopped')
})
