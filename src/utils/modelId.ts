/**
 * 模型 id 来自 localStorage 或 GET /models，进请求体前先限制长度并排除控制字符。
 * 不用正则匹配控制字符，避免 lint 的 no-control-regex 告警。
 */
export const isSafeModelId = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 128 &&
  Array.from(value).every((char) => char.charCodeAt(0) >= 0x20)

/** 兼容 OpenAI 风格 { data: [{ id }] }；过滤脏数据、去重并限制条数 */
export const parseModelIds = (payload: unknown): string[] => {
  if (typeof payload !== 'object' || payload === null) {
    return []
  }
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) {
    return []
  }
  const ids: string[] = []
  for (const item of data) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const raw = (item as { id?: unknown }).id
    if (typeof raw !== 'string' || !isSafeModelId(raw.trim())) {
      continue
    }
    const id = raw.trim()
    if (!ids.includes(id)) {
      ids.push(id)
    }
  }
  return ids.slice(0, 50)
}
