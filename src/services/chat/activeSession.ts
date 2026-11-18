import { isSafeModelId } from '../../utils/modelId.js'

/**
 * 当前会话 id 写在地址栏 hash（#s=<id>）：刷新、复制链接、多标签各自独立都能恢复。
 * 不用 localStorage，避免多个标签页互相覆盖「当前会话」。
 */
const PREFIX = '#s='

/** 纯解析，便于单测；非法 id 一律忽略，避免把脏值带进会话查询 */
export const parseActiveSessionHash = (hash: string): string | null => {
  if (!hash.startsWith(PREFIX)) {
    return null
  }
  let id: string
  try {
    id = decodeURIComponent(hash.slice(PREFIX.length))
  } catch {
    return null
  }
  return isSafeModelId(id) ? id : null
}

export const readActiveSessionId = (): string | null =>
  typeof window === 'undefined' ? null : parseActiveSessionHash(window.location.hash)

/** 用 replaceState 更新，不产生一长串浏览历史；file:// 下可能禁止 history API，忽略即可 */
export const writeActiveSessionId = (id: string | null): void => {
  if (typeof window === 'undefined') {
    return
  }
  const hash = id ? `${PREFIX}${encodeURIComponent(id)}` : ''
  if (window.location.hash === hash) {
    return
  }
  try {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}${hash}`
    )
  } catch {
    // 会话数据不受影响，只是地址栏不更新
  }
}
