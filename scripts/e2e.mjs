/**
 * 生产构建上的浏览器冒烟测试：pnpm build && pnpm test:e2e
 * 覆盖样式加载、模型面板、选区引用提交、会话刷新恢复；无 Chrome 时自动跳过。
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(process.cwd(), 'dist')
const PORT = Number(process.env.E2E_PORT || 8122)
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9372)
const BASE = `http://127.0.0.1:${PORT}/deepseek/`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

const chrome =
  (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)
    ? process.env.CHROME_PATH
    : null) || CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate))

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('[e2e] dist/index.html 不存在，请先运行 pnpm build')
  process.exit(1)
}
if (!chrome) {
  console.log('[e2e] 未找到 Chrome，跳过浏览器冒烟测试')
  process.exit(0)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (!pathname.startsWith('/deepseek/')) {
    res.writeHead(404)
    res.end()
    return
  }
  const relative = pathname.slice('/deepseek/'.length)
  let file = path.join(ROOT, relative)
  if (!relative || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(ROOT, 'index.html')
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

const proc = spawn(
  chrome,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${path.join(process.cwd(), '.test-build', 'chrome-e2e')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: 'ignore' }
)

let ws
try {
  let target
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      target = list.find((item) => item.type === 'page')
      if (target) break
    } catch {}
    await sleep(250)
  }
  if (!target) throw new Error('Chrome CDP 未就绪')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  let seq = 0
  const pending = new Map()
  const consoleErrors = []
  const cssResponses = []
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const task = pending.get(message.id)
      pending.delete(message.id)
      message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails?.text || 'exception')
    } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleErrors.push(message.params.entry.text)
    } else if (
      message.method === 'Network.responseReceived' &&
      message.params.response.url.endsWith('.css')
    ) {
      cssResponses.push(message.params.response.status)
    }
  }
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  const ready = async () => {
    for (let i = 0; i < 80; i += 1) {
      if (await evaluate('!!document.querySelector("textarea")').catch(() => false)) return
      await sleep(250)
    }
    throw new Error('页面未就绪')
  }
  const typeAndSend = async (text) => {
    await evaluate(`(() => {
      const ta = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(text)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await sleep(180)
    await evaluate(`document.querySelector('button[aria-label="发送"]').click()`)
  }

  await call('Page.enable')
  await call('Runtime.enable')
  await call('Log.enable')
  await call('Network.enable')
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      try { localStorage.setItem('deepseek-chat:api-key', 'sk-e2e-placeholder') } catch (e) {}
      window.__req = [];
      const usage = { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 };
      const frame = (event) => 'event: ' + event.type + '\\ndata: ' + JSON.stringify(event) + '\\n\\n';
      const events = [
        { type: 'message_start', message: { id: 'm1', model: 'deepseek-flash', usage } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '需要我详细讲某个规则吗？' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage },
        { type: 'message_stop' },
      ];
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/\\/anthropic\\/v1\\/messages/.test(url)) {
          window.__req.push(JSON.parse((init && init.body) || '{}'));
          return Promise.resolve(new Response(events.map(frame).join(''), {
            status: 200, headers: { 'Content-Type': 'text/event-stream' },
          }));
        }
        if (/\\/models(\\?|$)/.test(url)) {
          return Promise.resolve(new Response(JSON.stringify({ data: [
            { id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }, { id: 'custom-model' },
          ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return original(input, init);
      };
    `,
  })
  await call('Page.navigate', { url: BASE })
  await ready()
  await sleep(400)

  const styles = await evaluate(`(() => ({
    brand: getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-brand-text').trim()
      || getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-text').trim(),
    sheets: document.styleSheets.length,
  }))()`)

  await evaluate(`document.querySelector('button[aria-label="选择模型"]').click()`)
  await sleep(280)
  const panel = await evaluate(`(() => {
    const p = document.querySelector('[role="dialog"]');
    const r = p.getBoundingClientRect();
    return { width: Math.round(r.width), cards: p.querySelectorAll('[role="radio"]').length };
  })()`)
  await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /从云端获取/.test(b.textContent)).click()`)
  await sleep(320)
  const cloudCount = await evaluate(`document.querySelectorAll('[role="radio"]').length`)
  await evaluate(`document.querySelector('button[aria-label="选择模型"]').click()`)
  await sleep(150)

  await typeAndSend('第一个问题')
  for (let i = 0; i < 60; i += 1) {
    if (await evaluate(`document.body.innerText.includes('需要我详细讲某个规则吗')`)) break
    await sleep(200)
  }
  await sleep(400)
  await evaluate(`(() => {
    const p = [...document.querySelectorAll('.ds-assistant-message-main-content p')].at(-1);
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let node = null;
    while (walker.nextNode()) {
      if ((walker.currentNode.textContent || '').includes('某个规则')) { node = walker.currentNode; break; }
    }
    const text = node.textContent || '';
    const start = text.indexOf('某个规则');
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 4);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const r = range.getBoundingClientRect();
    p.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: Math.round(r.left + 4), clientY: Math.round(r.bottom + 2),
      bubbles: true, cancelable: true,
    }));
  })()`)
  await sleep(250)
  const menuItems = await evaluate(
    `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(b => b.innerText.trim())`
  )
  await evaluate(
    `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(b => b.innerText.includes('引用')).click()`
  )
  await sleep(250)
  await typeAndSend('可以。')
  await sleep(600)
  const quoted = await evaluate(`(() => {
    const last = window.__req.at(-1) || {};
    const user = (last.messages || []).filter((m) => m.role === 'user').at(-1);
    const content = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content);
    return { containsQuote: content.startsWith('> 某个规则'), content };
  })()`)

  const hashBefore = await evaluate('location.hash')
  await call('Page.reload', { ignoreCache: true })
  await ready()
  await sleep(600)
  const restored = await evaluate(`(() => ({
    hash: location.hash,
    welcome: document.body.innerText.includes('今天有什么可以帮到你'),
    hasMessage: document.body.innerText.includes('可以。'),
  }))()`)

  const checks = {
    cssLoaded: cssResponses.length > 0 && cssResponses.every((status) => status === 200),
    brandColor: styles.brand === '#3964fe',
    panelWidth: panel.width === 300,
    cloudModels: cloudCount === 3,
    menuItems: menuItems.join('/') === '引用/复制',
    quoteSubmitted: quoted.containsQuote,
    sessionRestored: restored.hash === hashBefore && !restored.welcome && restored.hasMessage,
    noConsoleErrors: consoleErrors.length === 0,
  }
  const ok = Object.values(checks).every(Boolean)
  console.log(JSON.stringify({ ok, checks, details: { styles, panel, cloudCount, menuItems, quoted, restored, consoleErrors } }, null, 2))
  if (!ok) process.exitCode = 1
} catch (error) {
  console.error(`[e2e] ${error.message}`)
  process.exitCode = 1
} finally {
  ws?.close()
  proc.kill()
  server.closeAllConnections?.()
  server.close()
}
