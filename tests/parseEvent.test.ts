import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readMessageEvent } from '../src/services/api/parseEvent.js'

const start = (content_block: unknown) => ({
  type: 'content_block_start',
  index: 0,
  content_block,
})

const BAD = 'javascript:alert(document.querySelector("html").outerHTML)'
const OK = 'https://ok.example/page'

test('text 块的引用过滤掉非 http(s) 地址', () => {
  const event = readMessageEvent(
    start({
      type: 'text',
      text: 'hello',
      citations: [
        { type: 'web_search_result_location', url: OK, title: 'ok' },
        { type: 'web_search_result_location', url: BAD, title: 'bad' },
      ],
    })
  )
  assert.ok(event)
  const json = JSON.stringify(event)
  assert.ok(json.includes(OK))
  assert.ok(!json.includes('javascript:'), '恶意协议不应进入渲染数据')
})

test('citations_delta 携带非法 url 时整帧丢弃', () => {
  assert.equal(
    readMessageEvent({
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'citations_delta',
        citation: { type: 'web_search_result_location', url: BAD },
      },
    }),
    null
  )
})

test('搜索结果按 url 与站点图标协议过滤', () => {
  const result = (url: string, site_icon: string | null) => ({
    type: 'web_search_result',
    url,
    title: 'title',
    snippet: null,
    site_name: null,
    site_icon,
    page_age: null,
  })
  const event = readMessageEvent(
    start({
      type: 'web_search_tool_result',
      tool_use_id: 'tool-1',
      kind: 'search',
      content: [
        result(OK, null),
        result(BAD, null),
        result(OK, 'data:image/svg+xml,<svg onload=alert(1)>'),
      ],
    })
  )
  assert.ok(event)
  const json = JSON.stringify(event)
  assert.equal((json.match(/web_search_result/g) ?? []).length, 1, '只剩合法的一条')
  assert.ok(!json.includes('data:image'))
})

test('网页抓取结果与工具调用的 url 非法时整帧丢弃', () => {
  assert.equal(
    readMessageEvent(
      start({
        type: 'web_fetch_tool_result',
        tool_use_id: 'tool-1',
        kind: 'read_link',
        content: {
          type: 'web_fetch_result',
          url: BAD,
          content: { title: 'title' },
          published_at: null,
        },
      })
    ),
    null
  )
  assert.equal(
    readMessageEvent(
      start({
        type: 'server_tool_use',
        id: 'tool-1',
        kind: 'read_link',
        name: 'deepseek_read_url',
        input: { action: 'open_page', url: BAD },
      })
    ),
    null
  )
})

test('合法事件与文本内容保持不变', () => {
  const event = readMessageEvent(start({ type: 'text', text: '正文', citations: [] }))
  assert.ok(event)
  assert.ok(JSON.stringify(event).includes('正文'))
  assert.equal(readMessageEvent({ type: 'unknown_event' }), null)
})
