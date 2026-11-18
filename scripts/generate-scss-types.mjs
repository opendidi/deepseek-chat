/**
 * 为缺少类型声明的 *.module.scss 生成 .d.ts（不覆盖手写声明）。
 * 用法：pnpm scss:types
 */
import fs from 'node:fs'
import path from 'node:path'

const srcDir = path.join(process.cwd(), 'src')

const walk = (dir, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(file, acc)
    } else if (entry.name.endsWith('.module.scss')) {
      acc.push(file)
    }
  }
  return acc
}

/** 只取本地类选择器；跳过注释、字符串、:global(...) 与小数 */
const classNames = (source) => {
  const cleaned = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'[^']*'|"[^"]*"/g, '')
    .replace(/:global\([^)]*\)/g, '')
  const names = new Set()
  for (const match of cleaned.matchAll(/(^|[^a-zA-Z0-9_-])\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)) {
    names.add(match[2])
  }
  return [...names].sort()
}

const header = '/** 由 scripts/generate-scss-types.mjs 生成；样式类名变化后重新运行 pnpm scss:types */\n'
const created = []
let checked = 0

for (const file of walk(srcDir)) {
  const declaration = `${file}.d.ts`
  const names = classNames(fs.readFileSync(file, 'utf8'))
  if (!fs.existsSync(declaration)) {
    const body = `${header}declare const styles: {\n${names
      .map((name) => `  readonly ${name}: string`)
      .join('\n')}\n}\nexport = styles\n`
    fs.writeFileSync(declaration, body)
    created.push(path.relative(process.cwd(), declaration))
    continue
  }
  checked += 1
}

console.log(
  JSON.stringify({ total: walk(srcDir).length, existing: checked, generated: created.length, created }, null, 2)
)
