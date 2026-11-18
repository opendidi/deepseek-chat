/** 选区右键菜单的尺寸与视口收口，抽成纯函数便于单测 */
export const SELECTION_MENU_WIDTH = 156
export const SELECTION_MENU_HEIGHT = 36
export const SELECTION_VIEWPORT_PADDING = 8

export const clampMenuPosition = (
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number
) => ({
  left: Math.max(
    SELECTION_VIEWPORT_PADDING,
    Math.min(x, viewportWidth - SELECTION_MENU_WIDTH - SELECTION_VIEWPORT_PADDING)
  ),
  top: Math.max(
    SELECTION_VIEWPORT_PADDING,
    Math.min(y + 6, viewportHeight - SELECTION_MENU_HEIGHT - SELECTION_VIEWPORT_PADDING)
  ),
})
