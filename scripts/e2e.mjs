/**
 * 生产构建上的浏览器冒烟测试：pnpm build && pnpm test:e2e
 * 覆盖样式加载、模型面板、选区引用提交、会话刷新恢复（真实 SQLite 后端持久化）；无 Chrome 时自动跳过。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DIST = path.join(ROOT_DIR, 'dist')
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 8123)
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9372)
const BASE = `http://127.0.0.1:${BACKEND_PORT}/`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** 轮询条件而不是固定等待：慢机器上不会因时序不足误报失败 */
const waitFor = async (predicate, timeout = 8000, interval = 50) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if (await predicate()) {
        return true
      }
    } catch {}
    await sleep(interval)
  }
  return false
}

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

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('[e2e] dist/index.html 不存在，请先运行 pnpm build')
  process.exit(1)
}
if (!chrome) {
  console.log('[e2e] 未找到 Chrome，跳过浏览器冒烟测试')
  process.exit(0)
}

// 存储后端托管 dist/ 并提供 /api：隔离的数据目录与全新浏览器 profile，保证每次跑的是确定状态
const DATA_DIR = path.join(ROOT_DIR, '.test-build', 'e2e-data')
const PROFILE = path.join(ROOT_DIR, '.test-build', 'chrome-e2e')
const venvPython =
  process.platform === 'win32'
    ? path.join(ROOT_DIR, '.venv', 'Scripts', 'python.exe')
    : path.join(ROOT_DIR, '.venv', 'bin', 'python')
const python = fs.existsSync(venvPython) ? venvPython : 'python'
fs.rmSync(DATA_DIR, { force: true, recursive: true })
fs.rmSync(PROFILE, { force: true, recursive: true })
fs.rmSync(path.join(ROOT_DIR, '.test-build', 'chrome-e2e-mobile'), { force: true, recursive: true })

const backend = spawn(
  python,
  ['-m', 'uvicorn', 'server.app:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)],
  {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: { ...process.env, DIST_DIR: DIST, DATA_DIR },
  }
)
const backendReady = await waitFor(async () => (await fetch(`${BASE}api/health`)).ok, 15_000)
if (!backendReady) {
  backend.kill()
  throw new Error('存储后端未就绪（需要先创建 .venv 并安装 requirements.txt）')
}

const proc = spawn(
  chrome,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
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
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails
      const text = detail.exception?.description || detail.exception?.value || detail.text
      throw new Error('evaluate failed: ' + text)
    }
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
  await waitFor(() => evaluate(`document.styleSheets.length > 0`))

  const styles = await evaluate(`(() => ({
    brand: getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-brand-text').trim()
      || getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-text').trim(),
    sheets: document.styleSheets.length,
  }))()`)

  await evaluate(`document.querySelector('button[aria-label="选择模型"]').click()`)
  await waitFor(() => evaluate(`!!document.querySelector('[role="dialog"]')`))
  const panel = await evaluate(`(() => {
    const p = document.querySelector('[role="dialog"]');
    const r = p.getBoundingClientRect();
    return { width: Math.round(r.width), cards: p.querySelectorAll('[role="radio"]').length };
  })()`)
  await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /从云端获取/.test(b.textContent)).click()`)
  await waitFor(async () => (await evaluate(`document.querySelectorAll('[role="radio"]').length`)) === 3)
  const cloudCount = await evaluate(`document.querySelectorAll('[role="radio"]').length`)
  await evaluate(`document.querySelector('button[aria-label="选择模型"]').click()`)
  await waitFor(async () => !(await evaluate(`!!document.querySelector('[role="dialog"]')`)))

  await typeAndSend('第一个问题')
  for (let i = 0; i < 60; i += 1) {
    if (await evaluate(`document.body.innerText.includes('需要我详细讲某个规则吗')`)) break
    await sleep(200)
  }
  await waitFor(() => evaluate(`!!document.querySelector('.ds-assistant-message-main-content')`))
  // mermaid 图表懒加载 + 渲染，作为依赖升级的回归覆盖
  const replyState = await evaluate(`(() => ({
    hasText: document.body.innerText.includes('需要我详细讲某个规则吗'),
    paragraphs: document.querySelectorAll('.ds-assistant-message-main-content p').length,
    requests: window.__req.length,
  }))()`)
  if (!replyState.hasText || replyState.paragraphs === 0) {
    throw new Error(`回复正文未就绪：${JSON.stringify(replyState)}`)
  }
  const selected = await evaluate(`(() => {
    const p = [...document.querySelectorAll('.ds-assistant-message-main-content p')].at(-1);
    if (!p) return false;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let node = null;
    while (walker.nextNode()) {
      if ((walker.currentNode.textContent || '').includes('某个规则')) { node = walker.currentNode; break; }
    }
    if (!node) return false;
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
    return true;
  })()`)
  if (!selected) {
    throw new Error('未能在回复正文中定位引用文字')
  }
  await waitFor(() => evaluate(`!!document.querySelector('[role="menu"] [role="menuitem"]')`))
  const menuItems = await evaluate(
    `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(b => b.innerText.trim())`
  )
  await evaluate(
    `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(b => b.innerText.includes('引用')).click()`
  )
  await waitFor(() => evaluate(`(document.querySelector('textarea')?.value || '').includes('某个规则')`))
  const repliesBefore = await evaluate(
    `document.querySelectorAll('.ds-assistant-message-main-content').length`
  )
  await typeAndSend('可以。')
  await waitFor(
    async () =>
      (await evaluate(`document.querySelectorAll('.ds-assistant-message-main-content').length`)) >
      repliesBefore
  )
  const quoted = await evaluate(`(() => {
    const last = window.__req.at(-1) || {};
    const user = (last.messages || []).filter((m) => m.role === 'user').at(-1);
    const content = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content);
    return { containsQuote: content.startsWith('> 某个规则'), content };
  })()`)

  const hashBefore = await evaluate('location.hash')
  // 等服务器确认本轮已落盘（300ms 防抖 + HTTP 写入），再 reload 验证恢复——消除时序竞态
  const sid = hashBefore.slice('#s='.length)
  await waitFor(async () => {
    const stored = await (await fetch(`${BASE}api/sessions/${sid}`)).json()
    return stored.messages?.length === 4
  })
  // 标记旧文档：reload 后标记消失才说明新页面已真正加载，避免在旧 DOM 上提前断言
  await evaluate(`window.__oldDoc = true`)
  await call('Page.reload', { ignoreCache: true })
  await waitFor(async () =>
    (await evaluate(`typeof window.__oldDoc === 'undefined' && !!document.querySelector('textarea')`))
  )
  await ready()
  await waitFor(() => evaluate(`document.body.innerText.includes('可以。')`))
  const restored = await evaluate(`(() => ({
    hash: location.hash,
    welcome: document.body.innerText.includes('今天有什么可以帮到你'),
    hasMessage: document.body.innerText.includes('可以。'),
    bodyText: document.body.innerText.slice(0, 220),
  }))()`)

  await evaluate(
    `[...document.querySelectorAll('button')].find(b => b.innerText.trim() === '设置').click()`
  )
  await waitFor(() => evaluate(`!!document.querySelector('[role="dialog"]')`))
  const statsTab = await evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find(b => b.innerText.trim() === '统计');
    if (!tab) return false;
    tab.click();
    return true;
  })()`)
  await waitFor(() => evaluate(`document.querySelectorAll('[class*="kpiValue-"]').length >= 6`))
  const stats = await evaluate(`(() => {
    const panel = document.querySelector('[role="tabpanel"]');
    const text = panel?.innerText || '';
    return {
      tabs: [...document.querySelectorAll('[role="tab"]')].map(b => b.innerText.trim()),
      hasTitle: text.includes('用量概览'),
      hasKpi: text.includes('预估费用') && text.includes('总 Token'),
      hasRanges: text.includes('今天') && text.includes('7 天') && text.includes('30 天'),
      hasBilling: text.includes('计费口径') && text.includes('服务端搜索与抓取免费'),
      hasContext: text.includes('上下文统计管理'),
      hasExports: text.includes('导出统计 JSON') && text.includes('导出 CSV'),
      kpiCount: panel?.querySelectorAll('[class*="kpiValue-"]').length ?? 0,
    };
  })()`)
  await evaluate(
    `[...document.querySelectorAll('[role="tabpanel"] button')].find(b => b.innerText.trim() === '30 天').click()`
  )
  await waitFor(() => evaluate(`document.querySelectorAll('[class*="heatCell-"]').length > 0`))
  const heatCells = await evaluate(`document.querySelectorAll('[class*="heatCell-"]').length`)

  // 三个时间范围共用同一个绘图区高度，切换时柱状图不应忽高忽矮
  const barHeights = {}
  for (const label of ['今天', '7 天', '30 天']) {
    await evaluate(
      `[...document.querySelectorAll('[role="tabpanel"] button')].find(b => b.innerText.trim() === ${JSON.stringify(label)}).click()`
    )
    await waitFor(() => evaluate(`!!document.querySelector('[class*="bars-"]')`))
    barHeights[label] = await evaluate(
      `Math.round(document.querySelector('[class*="bars-"]').getBoundingClientRect().height)`
    )
  }
  const barHeightValues = Object.values(barHeights)

  // 移动视口冒烟：390x844 下工具行低频入口应收进「⋯ 更多」菜单
  const MOBILE_CDP_PORT = Number(process.env.E2E_MOBILE_CDP_PORT || 9373)
  let mobileMenu = false
  const mproc = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${MOBILE_CDP_PORT}`,
      `--user-data-dir=${path.join(ROOT_DIR, '.test-build', 'chrome-e2e-mobile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--disable-gpu',
      '--window-size=390,844',
      'about:blank',
    ],
    { stdio: 'ignore' }
  )
  try {
    let mtarget
    for (let i = 0; i < 60; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${MOBILE_CDP_PORT}/json/list`)).json()
        mtarget = list.find((item) => item.type === 'page')
        if (mtarget) break
      } catch {}
      await sleep(250)
    }
    if (mtarget) {
      const mws = new WebSocket(mtarget.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => {
        mws.onopen = resolve
        mws.onerror = reject
      })
      let mseq = 0
      const mpending = new Map()
      mws.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.id && mpending.has(message.id)) {
          const task = mpending.get(message.id)
          mpending.delete(message.id)
          message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result)
        }
      }
      const mcall = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = ++mseq
          mpending.set(id, { resolve, reject })
          mws.send(JSON.stringify({ id, method, params }))
        })
      const mevaluate = async (expression) => {
        const result = await mcall('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
        })
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed')
        return result.result.value
      }
      await mcall('Page.enable')
      await mcall('Runtime.enable')
      await mcall('Page.addScriptToEvaluateOnNewDocument', {
        source: `try { localStorage.setItem('deepseek-chat:api-key', 'sk-e2e-placeholder') } catch (e) {}`,
      })
      await mcall('Page.navigate', { url: BASE })
      let mobileReady = false
      for (let i = 0; i < 80; i += 1) {
        if (await mevaluate('!!document.querySelector("textarea")').catch(() => false)) {
          mobileReady = true
          break
        }
        await sleep(250)
      }
      if (mobileReady) {
        mobileMenu = await mevaluate(`!!document.querySelector('button[aria-label="更多"]')`)
      }
      mws.close()
    }
  } catch {
    mobileMenu = false
  } finally {
    mproc.kill()
  }

  const checks = {
    cssLoaded: cssResponses.length > 0 && cssResponses.every((status) => status === 200 || status === 304),
    brandColor: styles.brand === '#3964fe',
    panelWidth: panel.width === 300,
    cloudModels: cloudCount === 3,
    menuItems: menuItems.join('/') === '引用/复制',
    quoteSubmitted: quoted.containsQuote,
    sessionRestored: restored.hash === hashBefore && !restored.welcome && restored.hasMessage,
    statsTab: statsTab && stats.tabs.includes('统计'),
    statsPanel: stats.hasTitle && stats.hasKpi && stats.hasRanges && stats.kpiCount >= 6,
    statsBilling: stats.hasBilling && stats.hasContext && stats.hasExports,
    statsHeatmap: heatCells > 0,
    statsBarHeightConsistent:
      barHeightValues.length === 3 &&
      barHeightValues[0] > 0 &&
      barHeightValues.every((height) => height === barHeightValues[0]),
    noConsoleErrors: consoleErrors.length === 0,
    mobileMenu,
  }
  const ok = Object.values(checks).every(Boolean)
  console.log(JSON.stringify({ ok, checks, details: { styles, panel, cloudCount, menuItems, quoted, restored, stats, heatCells, barHeights, consoleErrors } }, null, 2))
  if (!ok) process.exitCode = 1
} catch (error) {
  console.error(`[e2e] ${error.stack || error.message || error}`)
  console.error('[e2e] page console errors:', JSON.stringify(consoleErrors))
  process.exitCode = 1
} finally {
  ws?.close()
  proc.kill()
  backend.kill()
}
