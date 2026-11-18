/**
 * 会写进 href / window.open / img.src 的外部地址校验。
 * 只接受绝对 HTTP(S) URL，拒绝 javascript:、data:、vbscript: 以及相对路径，
 * 避免服务端返回（或历史归档里留存）的不可信字符串被浏览器当作脚本执行。
 */
export const isWebUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0
    )
  } catch {
    return false
  }
}

/** 合规则原样返回，否则返回 undefined：<a> 没有 href 时不会导航。 */
export const safeWebUrl = (value: unknown): string | undefined =>
  typeof value === 'string' && isWebUrl(value) ? value : undefined
