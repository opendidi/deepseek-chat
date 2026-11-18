import '../storageKeys.js'

const KEY = 'deepseek-chat:input-history'
/** 最多保留的已发送消息条数 */
const LIMIT = 50

let history: string[] = load()
/** 浏览位置：history.length 表示在「当前输入」，浏览中指向正在展示的条目 */
let cursor = history.length
/** 进入历史浏览时保存的草稿，按 ↓ 回到末尾时恢复 */
let savedDraft = ''

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(history.slice(-LIMIT)))
  } catch {
    // 存储不可用时只保留内存里的历史
  }
}

/** 发送成功后记录：与上一条相同的不重复入列 */
export const recordInputHistory = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed) {
    return
  }
  if (history.at(-1) === trimmed) {
    cursor = history.length
    savedDraft = ''
    return
  }
  history.push(trimmed)
  if (history.length > LIMIT) {
    history = history.slice(-LIMIT)
  }
  save()
  cursor = history.length
  savedDraft = ''
}

/** 手动输入使浏览复位 */
export const resetInputHistory = () => {
  cursor = history.length
  savedDraft = ''
}

/**
 * 输入历史浏览：空输入框按 ↑ 取上一条已发送消息，继续 ↑ 往更早翻；
 * ↓ 往回翻，回到末尾时恢复进入浏览前的草稿。返回 null 表示本次按键不处理。
 */
export const navigateInputHistory = (current: string, older: boolean): string | null => {
  if (older) {
    if (current) {
      return null
    }
    if (history.length === 0) {
      return null
    }
    if (cursor >= history.length) {
      savedDraft = current
      cursor = history.length - 1
    } else if (cursor > 0) {
      cursor--
    } else {
      return null
    }
    return history[cursor]
  }
  if (cursor >= history.length) {
    return null
  }
  cursor++
  if (cursor >= history.length) {
    const restore = savedDraft
    savedDraft = ''
    return restore
  }
  return history[cursor]
}
