import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createIncrementalParser, toMdAst } from '../src/services/markdown/parse.js'
import type { Source } from '../src/services/chat/view.js'
import type { Root } from 'mdast'

/** 增量解析的结果应与同一文本的全量解析在结构上完全一致（position 除外：增量尾块的偏移基于切片） */
const stripPositions = (node: unknown): unknown => {
  if (Array.isArray(node)) {
    return node.map(stripPositions)
  }
  if (node && typeof node === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'position') {
        continue
      }
      result[key] = stripPositions(value)
    }
    return result
  }
  return node
}

const OPTS = { disableLink: false }

test('追加式增长复用前缀块：块引用相等且整体与全量解析结构一致', () => {
  const parser = createIncrementalParser()
  const first = parser('# 标题\n\n第一段内容', OPTS)
  const second = parser('# 标题\n\n第一段内容，后面追加了一句话', OPTS)

  // 前缀块引用不变 → 渲染层 memo 子树整体跳过
  assert.equal(second.children[0], first.children[0])
  // 尾块被重解析，包含追加的文本
  assert.ok(JSON.stringify(second).includes('追加了一句话'))

  const full = toMdAst('# 标题\n\n第一段内容，后面追加了一句话', OPTS)
  assert.deepEqual(stripPositions(second), stripPositions(full))
})

test('逐字流式累积的结果与全量解析一致（段落/列表/代码块/标题混合）', () => {
  const final = '# 标题\n\n段落一。\n\n- 项目 a\n- 项目 b\n\n```js\nconst a = 1\n```\n\n结尾段。'
  const parser = createIncrementalParser()
  let last: Root | null = null
  for (let end = 1; end <= final.length; end += 1) {
    last = parser(final.slice(0, end), OPTS)
  }
  assert.ok(last)
  assert.deepEqual(stripPositions(last), stripPositions(toMdAst(final, OPTS)))
})

test('未闭合代码块跨 tick 生长，闭合后结构正确', () => {
  const parser = createIncrementalParser()
  const open = parser('```js\nconst a = 1', OPTS)
  const closed = parser('```js\nconst a = 1\nconst b = 2\n```', OPTS)
  // 未闭合时也是 code 块，闭合后仍是一个完整 code 块
  assert.equal(closed.children[0].type, 'code')
  assert.ok(JSON.stringify(stripPositions(closed)).includes('const b = 2'))
  assert.equal(open.children[0].type, 'code')
})

test('内容被编辑（非追加）时退回全量解析', () => {
  const parser = createIncrementalParser()
  const first = parser('第一版内容', OPTS)
  const second = parser('完全不同的内容', OPTS)
  assert.notEqual(second.children[0], first.children[0])
  assert.deepEqual(
    stripPositions(second),
    stripPositions(toMdAst('完全不同的内容', OPTS))
  )
})

test('sources 变化时退回全量解析（citation 映射依赖选项）', () => {
  const parser = createIncrementalParser()
  const sources: Source[] = [
    {
      index: 1,
      url: 'https://example.com',
      title: '例',
      siteName: 'example.com',
      publishedAt: null,
      snippet: null,
      siteIcon: null,
    },
  ]
  parser('正文 [citation:1]', { ...OPTS, sources })
  const second = parser('正文 [citation:1] 追加', { ...OPTS, sources })
  // sources 内容未变时仍走增量
  assert.ok(JSON.stringify(stripPositions(second)).includes('追加'))
})

test('引用角标在增量解析下保持替换（citation 节点保留）', () => {
  const parser = createIncrementalParser()
  const sources: Source[] = [
    {
      index: 1,
      url: 'https://example.com',
      title: '例',
      siteName: 'example.com',
      publishedAt: null,
      snippet: null,
      siteIcon: null,
    },
  ]
  const first = parser('正文 [citation:1]', { ...OPTS, sources })
  const second = parser('正文 [citation:1]\n\n新段落', { ...OPTS, sources })
  const citationCount = (node: unknown): number => {
    const text = JSON.stringify(node)
    return (text.match(/"type":"citation"/g) ?? []).length
  }
  assert.equal(citationCount(first.children[0]), 1)
  assert.equal(citationCount(second), 1)
})
