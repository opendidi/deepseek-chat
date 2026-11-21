/**
 * katex 的 Node 测试替身：micromark-extension-llm-math 的 html.js 会 Eagerly import katex，
 * 而 pnpm 在 Windows 上的嵌套解析在纯 Node 环境下失败（打包器无此问题）。
 * AST 解析只用 fromMarkdown，从不调用 katex 的序列化，这里提供无害的空实现即可。
 */
const katex = { renderToString: () => '' }
export const renderToString = () => ''

// 导入方（llm-math/html.js）使用默认导入，替身必须保留 default 导出
// eslint-disable-next-line import/no-default-export
export default katex
