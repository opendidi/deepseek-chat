import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installMemoryStorage } from './helpers/localStorage.js'

// settings 模块在初始化时就读写 localStorage，必须先装内存实现再动态导入
installMemoryStorage()
const { setApiKey, setRememberApiKey, useSettings } = await import('../src/services/settings.js')

test('全新用户默认记住 API Key（输入的 Key 刷新后仍在）', () => {
  assert.equal(useSettings.getState().rememberApiKey, true)
  assert.equal(useSettings.getState().apiKey, null)

  // 输入 Key（remember 开着）：明文落盘，下次启动 initialRememberApiKey 为 true 时读回
  setApiKey('sk-test-1234')
  assert.equal(useSettings.getState().apiKey, 'sk-test-1234')
  assert.notEqual(useSettings.getState().rememberApiKey, false)
})

test('显式关闭记住后，Key 只在内存中、不落盘', () => {
  setRememberApiKey(false)
  assert.equal(useSettings.getState().rememberApiKey, false)

  setApiKey('sk-memory-only')
  assert.equal(useSettings.getState().apiKey, 'sk-memory-only')
  assert.equal(useSettings.getState().rememberApiKey, false)
})
