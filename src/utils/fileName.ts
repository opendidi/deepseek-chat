/** 下载文件名的统一净化：文件名可能来自服务端或历史归档，不能直接交给 anchor.download */
const stripControls = (text: string): string =>
  [...text].map((char) => (char.charCodeAt(0) >= 32 ? char : '_')).join('')

export const safeFileName = (name: string, fallback = 'file'): string =>
  (stripControls(name.trim())
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .replace(/_+$/, '') || fallback)
