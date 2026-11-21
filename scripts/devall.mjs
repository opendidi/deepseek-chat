/**
 * 一键双启：存储后端（uvicorn :8000）+ 前端 devServer（:8090，/api 已代理）。
 * 用法：pnpm dev:all；任一进程退出或 Ctrl+C 时整组退出。
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
const backendPort = process.env.BACKEND_PORT || '8000'
const rspackCli = path.join(root, 'node_modules', '@rspack', 'cli', 'bin', 'rspack.js')

const children = []

const run = (name, command, args, options = {}) => {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    ...options,
  })
  child.on('exit', (code, signal) => {
    console.log(`[dev:all] ${name} 退出（code=${code ?? '-'} signal=${signal ?? '-'}）`)
    shutdown()
  })
  children.push(child)
  return child
}

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill()
    }
  }
  process.exit(0)
}

// 前后端严格分离：后端纯 API（SERVE_DIST=0 不托管 dist），前端走 devServer + /api 代理
run('backend', python, ['-m', 'uvicorn', 'server.app:app', '--host', '127.0.0.1', '--port', backendPort], {
  env: { ...process.env, SERVE_DIST: '0' },
})
run('frontend', process.execPath, [rspackCli, 'serve', '-c', 'rspack.config.ts'])

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
