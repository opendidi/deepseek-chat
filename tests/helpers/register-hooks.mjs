import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

// node --import 本文件：注册 katex 测试替身的解析钩子（pnpm Windows 嵌套解析的死结绕行）
register('./katex-resolver.mjs', pathToFileURL('./tests/helpers/'))
