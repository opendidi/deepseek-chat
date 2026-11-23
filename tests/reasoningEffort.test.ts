import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installMemoryStorage } from './helpers/localStorage.js'

// settings 模块在初始化时读写 localStorage，必须先装内存实现再动态导入
const { storage } = installMemoryStorage()
const { setReasoningEffort, setThinking, useSettings } = await import(
  '../src/services/settings.js'
)

test('默认推理强度为 high，与服务端默认行为一致', () => {
  assert.equal(useSettings.getState().reasoningEffort, 'high')
})

test('设置推理强度后写入 localStorage 并可回读', () => {
  for (const effort of ['low', 'high', 'max'] as const) {
    setReasoningEffort(effort)
    assert.equal(useSettings.getState().reasoningEffort, effort)
    assert.equal(storage.getItem('deepseek-chat:reasoning-effort'), effort)
  }
})

test('推理强度与思考开关独立：关掉思考不清空强度', () => {
  setReasoningEffort('max')
  setThinking(false)
  assert.equal(useSettings.getState().thinking, false)
  assert.equal(useSettings.getState().reasoningEffort, 'max')
  setThinking(true)
})

const { effortConfigFor } = await import('../src/services/api/types.js')

test('思考关闭时不传 output_config', () => {
  assert.equal(effortConfigFor(false, 'max'), undefined)
  assert.equal(effortConfigFor(undefined, 'high'), undefined)
})

test('思考开启时透传强度，缺省回退 high', () => {
  for (const effort of ['low', 'high', 'max'] as const) {
    assert.deepEqual(effortConfigFor(true, effort), { effort })
  }
  assert.deepEqual(effortConfigFor(true, undefined), { effort: 'high' })
})


const { applyEffortLevel, effortLevel } = await import('../src/services/settings.js')

test('四档映射：关闭档不是 effort 值，而是思考关闭', () => {
  assert.equal(effortLevel(false, 'high'), 'off')
  assert.equal(effortLevel(true, 'low'), 'low')
  assert.equal(effortLevel(true, 'high'), 'high')
  assert.equal(effortLevel(true, 'max'), 'max')
})

test('切到关闭档保留原强度，重新开启时恢复', () => {
  setReasoningEffort('max')
  setThinking(true)
  const off = applyEffortLevel('off', useSettings.getState().reasoningEffort)
  assert.equal(off.thinking, false)
  assert.equal(off.reasoningEffort, 'max')
  const on = applyEffortLevel('low', off.reasoningEffort)
  assert.equal(on.thinking, true)
  assert.equal(on.reasoningEffort, 'low')
})

test('关闭思考时请求不带 output_config', () => {
  assert.equal(effortConfigFor(false, 'max'), undefined)
  assert.equal(effortConfigFor(true, 'low')?.effort, 'low')
})
