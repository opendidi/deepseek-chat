import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installMemoryStorage } from './helpers/localStorage.js'

installMemoryStorage()

test('fetchMcpTools 拉工具并缓存，失败时返回空数组', async () => {
  let calls = 0
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    calls += 1
    return new Response(JSON.stringify([
      { name: 'mcp__fs__read', description: '读取', input_schema: { type: 'object', properties: {} } },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  try {
    const { fetchMcpTools, invalidateMcpTools } = await import('../src/services/mcp.js')
    invalidateMcpTools()
    const first = await fetchMcpTools()
    assert.equal(first.tools.length, 1)
    assert.equal(first.error, null)
    assert.equal(first.tools[0].name, 'mcp__fs__read')
    await fetchMcpTools()
    assert.equal(calls, 1, '30 秒内应命中缓存')
    invalidateMcpTools()
  } finally {
    globalThis.fetch = original
  }
})

test('fetchMcpTools 网络失败时静默降级为空', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('offline')
  }) as typeof fetch
  try {
    const { fetchMcpTools, invalidateMcpTools } = await import('../src/services/mcp.js')
    invalidateMcpTools()
    const result = await fetchMcpTools()
    assert.deepEqual(result.tools, [])
    assert.ok(result.error)
    invalidateMcpTools()
  } finally {
    globalThis.fetch = original
  }
})

test('isMcpTool 按前缀识别', async () => {
  const { isMcpTool } = await import('../src/services/mcp.js')
  assert.equal(isMcpTool('mcp__fs__read'), true)
  assert.equal(isMcpTool('get_current_time'), false)
})

test('callMcpTool 走后端并把结果转成 ToolStep 形态', async () => {
  let body: Record<string, unknown> | null = null
  const original = globalThis.fetch
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? '{}'))
    return new Response(JSON.stringify({ content: '文件内容' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  try {
    const { callMcpTool } = await import('../src/services/mcp.js')
    const result = await callMcpTool('mcp__fs__read', { path: '/tmp/a' })
    assert.deepEqual(result, { content: '文件内容', isError: false })
    assert.equal((body as { name: string } | null)?.name, 'mcp__fs__read')
  } finally {
    globalThis.fetch = original
  }
})

test('resolveChatTools 把 MCP 工具并入声明，但不计入 clientNames', async () => {
  const { resolveChatTools } = await import('../src/services/agent/toolPolicy.js')
  const resolved = resolveChatTools({
    mode: 'standard',
    search: false,
    agentTools: false,
    enabledTools: new Set(),
    mcpTools: [{
      name: 'mcp__fs__read',
      description: '读取文件',
      input_schema: { type: 'object', properties: {} },
    }],
  })
  assert.ok(resolved.tools.some((tool) => 'name' in tool && tool.name === 'mcp__fs__read'))
  assert.equal(resolved.clientNames.has('mcp__fs__read'), false)
})


test('工具级开关持久化并拒绝非 MCP 工具名', async () => {
  const { setMcpDisabledTools, toggleMcpTool, useSettings } = await import('../src/services/settings.js')
  setMcpDisabledTools([])
  toggleMcpTool('mcp__fs__write', false)
  toggleMcpTool('get_current_time', false) // 非 MCP 名应被忽略
  assert.deepEqual(useSettings.getState().mcpDisabledTools, ['mcp__fs__write'])
  toggleMcpTool('mcp__fs__write', true)
  assert.deepEqual(useSettings.getState().mcpDisabledTools, [])
})

test('resolveChatTools 按禁用名单过滤 MCP 工具', async () => {
  const { resolveChatTools } = await import('../src/services/agent/toolPolicy.js')
  const resolved = resolveChatTools({
    mode: 'standard',
    search: false,
    agentTools: false,
    enabledTools: new Set(),
    mcpTools: [
      { name: 'mcp__fs__read', description: '读', input_schema: { type: 'object', properties: {} } },
      { name: 'mcp__fs__write', description: '写', input_schema: { type: 'object', properties: {} } },
    ],
    mcpDisabledTools: ['mcp__fs__write'],
  })
  const names = resolved.tools.flatMap((tool) => 'name' in tool ? [tool.name] : [])
  assert.ok(names.includes('mcp__fs__read'))
  assert.ok(!names.includes('mcp__fs__write'))
})

test('buildMcpConfig 把 stdio 草稿转成规范配置', async () => {
  const { buildMcpConfig, toServerDraft } = await import('../src/services/mcp.js')
  const draft = toServerDraft('fs', {
    enabled: true,
    command: 'npx',
    args: ['-y', 'server-filesystem'],
    env: { TOKEN: 'abc' },
    timeout: 20,
  })
  const config = buildMcpConfig([draft])
  assert.deepEqual(config.servers.fs, {
    enabled: true,
    timeout: 20,
    command: 'npx',
    args: ['-y', 'server-filesystem'],
    env: { TOKEN: 'abc' },
  })
})

test('buildMcpConfig 支持 HTTP 草稿并解析 headers', async () => {
  const { buildMcpConfig, toServerDraft } = await import('../src/services/mcp.js')
  const draft = toServerDraft('remote', {
    enabled: false,
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer x' },
    timeout: 15,
  })
  const config = buildMcpConfig([draft])
  assert.equal(config.servers.remote.url, 'https://example.com/mcp')
  assert.deepEqual(config.servers.remote.headers, { Authorization: 'Bearer x' })
  assert.equal(config.servers.remote.command, undefined)
})

test('buildMcpConfig 拒绝空名/双下划线/非法 JSON', async () => {
  const { buildMcpConfig, toServerDraft } = await import('../src/services/mcp.js')
  const good = { enabled: true, command: 'python', timeout: 30 }
  assert.throws(() => buildMcpConfig([{ ...toServerDraft('', good) }]), /名称不能为空/)
  assert.throws(() => buildMcpConfig([{ ...toServerDraft('bad__name', good) }]), /双下划线/)
  const badEnv = toServerDraft('x', good)
  badEnv.envText = '{ not json }'
  assert.throws(() => buildMcpConfig([badEnv]), /合法 JSON/)
})

test('fetchMcpConfig / saveMcpConfig 走正确的端点', async () => {
  const seen: { url: string; method?: string; body?: unknown }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    const url = String(input)
    const payload = url.endsWith('/config')
      ? init?.method === 'PUT'
        ? { ok: true, config: { servers: { z: { enabled: false, command: 'python' } } } }
        : { servers: {}, canWrite: true, reason: null }
      : []
    return new Response(JSON.stringify(payload), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  try {
    const { fetchMcpConfig, saveMcpConfig, invalidateMcpTools } = await import('../src/services/mcp.js')
    invalidateMcpTools()
    const config = await fetchMcpConfig()
    assert.deepEqual(config.servers, {})
    assert.equal(config.canWrite, true)
    const saved = await saveMcpConfig({ servers: { z: { enabled: false, command: 'python' } } })
    assert.equal(saved.servers.z.command, 'python')
    assert.equal(seen[0].url, '/api/mcp/config')
    assert.equal(seen[1].method, 'PUT')
    assert.deepEqual((seen[1].body as { servers: unknown }).servers, {
      z: { enabled: false, command: 'python' },
    })
  } finally {
    globalThis.fetch = original
  }
})
