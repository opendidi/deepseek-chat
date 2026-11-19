/**
 * 为 *.module.scss 同步生成 .d.ts。生成是确定性的：同一样式总产出相同声明，
 * 因此每次都重写，类名增删改名后声明随之更新（此前「存在即跳过」会让声明悄悄过期）。
 * 用法：pnpm scss:types            生成/更新全部声明
 *       pnpm scss:types --check    只校验声明是否与样式一致（CI 用），不一致退出码 1
 */
import fs from 'node:fs'
import path from 'node:path'

const checkOnly = process.argv.includes('--check')
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
const declarationOf = (file) => {
  const names = classNames(fs.readFileSync(file, 'utf8'))
  return `${header}declare const styles: {\n${names
    .map((name) => `  readonly ${name}: string`)
    .join('\n')}\n}\nexport = styles\n`
}

const written = []
const stale = []
const files = walk(srcDir)

for (const file of files) {
  const declaration = `${file}.d.ts`
  const body = declarationOf(file)
  const current = fs.existsSync(declaration) ? fs.readFileSync(declaration, 'utf8') : null
  if (current === body) {
    continue
  }
  if (checkOnly) {
    stale.push(path.relative(process.cwd(), declaration))
  } else {
    fs.writeFileSync(declaration, body)
    written.push(path.relative(process.cwd(), declaration))
  }
}

if (checkOnly) {
  if (stale.length > 0) {
    console.error(
      JSON.stringify(
        {
          stale,
          hint: '样式类名与 .d.ts 不一致，运行 pnpm scss:types 更新后一并提交',
        },
        null,
        2
      )
    )
    process.exitCode = 1
  } else {
    console.log(JSON.stringify({ total: files.length, check: 'ok' }))
  }
} else {
  console.log(JSON.stringify({ total: files.length, updated: written.length, written }, null, 2))
}
