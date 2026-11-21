/**
 * API Key 的统一掩码：sk-**** + 末四位。
 * 固定星号数量，避免从长度反推出 Key 长度；任何界面展示 Key 时都走这里。
 */
export const maskApiKey = (key: string | null | undefined): string => {
  if (!key) {
    return '—'
  }
  const trimmed = key.trim()
  if (!trimmed) {
    return '—'
  }
  // 过短的 Key 末四位即整个 Key，直接整体隐藏
  return trimmed.length < 8 ? 'sk-****' : `sk-****${trimmed.slice(-4)}`
}
