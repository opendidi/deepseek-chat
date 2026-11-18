import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clampMenuPosition,
  SELECTION_MENU_HEIGHT,
  SELECTION_MENU_WIDTH,
  SELECTION_VIEWPORT_PADDING,
} from '../src/utils/selectionMenu.js'

test('菜单在右键坐标下方一点显示', () => {
  assert.deepEqual(clampMenuPosition(300, 200, 1280, 900), { left: 300, top: 206 })
})

test('靠近右下边缘时收口到视口内', () => {
  const pos = clampMenuPosition(1279, 899, 1280, 900)
  assert.equal(
    pos.left,
    1280 - SELECTION_MENU_WIDTH - SELECTION_VIEWPORT_PADDING
  )
  assert.equal(
    pos.top,
    900 - SELECTION_MENU_HEIGHT - SELECTION_VIEWPORT_PADDING
  )
})

test('靠近左上边缘时不越出内边距', () => {
  assert.deepEqual(clampMenuPosition(-20, -20, 1280, 900), {
    left: SELECTION_VIEWPORT_PADDING,
    top: SELECTION_VIEWPORT_PADDING,
  })
})

test('窄视口下仍保持可见', () => {
  const pos = clampMenuPosition(160, 300, 120, 400)
  assert.equal(pos.left, SELECTION_VIEWPORT_PADDING)
  assert.ok(pos.top + SELECTION_MENU_HEIGHT <= 400)
})
