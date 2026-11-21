/**
 * 运行后端测试（server/tests）：跨平台探测 .venv 解释器后执行 pytest。
 * 用法：pnpm test:backend
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const venvPython =
  process.platform === 'win32'
    ? path.join(root, '.venv', 'Scripts', 'python.exe')
    : path.join(root, '.venv', 'bin', 'python')
const python = existsSync(venvPython) ? venvPython : 'python'

const child = spawn(python, ['-m', 'pytest', 'server/tests', '-q'], {
  cwd: root,
  stdio: 'inherit',
})
child.on('exit', (code) => process.exitCode = code ?? 0)
