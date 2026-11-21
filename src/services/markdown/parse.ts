import type { Node as MdAstNode, Nodes, Parent, RootContent, Root, Text } from 'mdast'
import { findAndReplace } from 'mdast-util-find-and-replace'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-llm-math'
import type { Source } from '../chat/view.js'

/** 正文里的 [citation:N]，已换成对应来源 */
export interface CitationNode extends MdAstNode {
  type: 'citation'
  source: Source
}

declare module 'mdast' {
  interface RootContentMap {
    citation: CitationNode
  }

  interface PhrasingContentMap {
    citation: CitationNode
  }
}

const text = (value: string): Text => ({ type: 'text', value })

type ParseOptions = {
  sources?: Source[]
  disableLink: boolean
}

const sourceKey = (sources?: Source[]): string =>
  sources ? sources.map((source) => `${source.index}:${source.url}`).join('|') : ''

/**
 * 解析一份 markdown 文本为顶层块，并把渲染器不单独处理的节点提前换掉，渲染时无需再读原文：
 * - 传入 sources 时，[citation:N] 换成角标节点，找不到来源的直接去掉
 * - disableLink 时链接只保留文字
 * - 删除线保留原样的 ~ 定界符，脚注、引用式链接与定义显示原文
 */
const parseBlocks = (input: string, { sources, disableLink }: ParseOptions): RootContent[] => {
  const ast = fromMarkdown(input, {
    extensions: [
      // codeIndented 语法导致有前导空格的列表无法正常渲染
      { ...gfm(), disable: { null: ['codeIndented'] } },
      math({ singleDollarTextMath: true }),
    ],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
  if (sources) {
    const sourcesByIndex = new Map(sources.map((source) => [source.index, source]))
    findAndReplace(
      ast,
      [
        /\[citation:(\d+)\]/g,
        (_: string, index: string): CitationNode | '' => {
          const source = sourcesByIndex.get(Number(index))
          return source ? { type: 'citation', source } : ''
        },
      ],
      { ignore: ['linkReference'] }
    )
  }
  const raw = (node: Nodes) => input.slice(node.position?.start.offset, node.position?.end.offset)
  // 先处理子节点，再按需把当前节点换成若干节点
  const simplify = (node: Nodes): Nodes[] => {
    if ('children' in node) {
      ;(node as Parent).children = node.children.flatMap(simplify) as RootContent[]
    }
    switch (node.type) {
      case 'link':
        return disableLink ? node.children : [node]
      case 'delete': {
        // 解析器保证首尾定界符等长
        const delimiter = raw(node).match(/^~+/)?.[0] ?? ''
        return [text(delimiter), ...node.children, text(delimiter)]
      }
      case 'footnoteReference':
      case 'imageReference':
      case 'linkReference':
        return [text(raw(node))]
      case 'footnoteDefinition':
      case 'definition':
        return [{ type: 'paragraph', children: [text(raw(node))] }]
      default:
        return [node]
    }
  }
  simplify(ast)
  return ast.children
}

export const toMdAst = (input: string, opts: ParseOptions): Root => ({
  type: 'root',
  children: parseBlocks(input, opts),
})

/** 把切片解析出的块坐标平移为绝对坐标（原位修改，节点本身是刚解析的新对象） */
const shiftPositions = (nodes: RootContent[], offset: number): void => {
  for (const node of nodes) {
    const { position } = node
    if (position) {
      if (position.start.offset !== undefined) {
        position.start.offset += offset
      }
      if (position.end.offset !== undefined) {
        position.end.offset += offset
      }
    }
    if ('children' in node) {
      shiftPositions(node.children as RootContent[], offset)
    }
  }
}

/**
 * 流式增量解析器：markdown 在流式期间只追加不修改，已完成的前缀块直接复用上一次的解析结果——
 * 块对象引用不变，渲染层所有 memo 子组件的 props 保持稳定，整棵子树跳过 reconcile；
 * 每次只重解析「稳定边界之后」的未完成区（通常只有最后一个块在生长）。
 * 内容被编辑（非追加增长）时自动退回全量解析。每个 Markdown 实例持有一个独立解析器。
 */
export const createIncrementalParser = () => {
  let prevInput = ''
  let prevKey = ''
  /** 已完成的块，覆盖 prevInput 的 [0, covered) 区间；position 为绝对坐标 */
  let kept: RootContent[] = []
  let covered = 0
  /** 未完成区 input.slice(covered) 的解析结果；position 已平移为绝对坐标 */
  let pending: RootContent[] = []

  return (input: string, opts: ParseOptions): Root => {
    const key = `${sourceKey(opts.sources)}#${opts.disableLink}`
    if (key === prevKey && input.startsWith(prevInput)) {
      if (input.length === prevInput.length) {
        // 内容完全没变：直接复用，块引用保持稳定
        return { type: 'root', children: [...kept, ...pending] }
      }
      // 追加式增长：把未完成区里除最后一个块之外的稳定块提升进 kept
      //（最后一个块在流式期间持续生长，整块重解析）
      if (pending.length >= 2) {
        const stable = pending.slice(0, -1)
        kept.push(...stable)
        const boundary = pending[pending.length - 2].position?.end?.offset
        if (boundary !== undefined) {
          covered = boundary
        }
        pending = pending.slice(-1)
      }
      // 重解析未完成区；covered 一定落在顶层块的边界上，切片解析不会改变前文语义
      pending = parseBlocks(input.slice(covered), opts)
      shiftPositions(pending, covered)
      prevInput = input
      return { type: 'root', children: [...kept, ...pending] }
    }
    // 内容被编辑或选项变化：全量重解析
    kept = []
    covered = 0
    pending = parseBlocks(input, opts)
    prevInput = input
    prevKey = key
    return { type: 'root', children: pending }
  }
}
