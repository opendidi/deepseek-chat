/**
 * 启动存储后端（server/）：优先使用仓库内的 .venv 解释器，跨平台探测路径。
 * 用法：pnpm backend（或 BACKEND_PORT=8010 node scripts/backend.mjs）
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
// 未建 venv 时退回全局 python，报错信息里提示初始化步骤
const python = existsSync(venvPython) ? venvPython : 'python'
const port = process.env.BACKEND_PORT || '8000'

const child = spawn(
  python,
  ['-m', 'uvicorn', 'server.app:app', '--host', '127.0.0.1', '--port', port],
  { cwd: root, stdio: 'inherit' }
)
child.on('exit', (code) => process.exitCode = code ?? 0)
