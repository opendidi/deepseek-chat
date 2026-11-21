import { create } from 'zustand'

/**
 * 服务端访问口令（公网部署可选开启）：存 localStorage，随每个 /api 请求带 x-access-key 头。
 * 服务端返回 401 时置 unauthorized 标志，界面弹出输入门。
 */

const KEY = 'deepseek-chat:access-key'

type AccessKeyState = {
  /** 收到 401 且尚未验证通过 */
  unauthorized: boolean
}

export const useAccessKey = create<AccessKeyState>(() => ({ unauthorized: false }))

export const getAccessKey = (): string => {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export const setAccessKey = (key: string) => {
  try {
    localStorage.setItem(KEY, key)
  } catch {
    // 存储不可用时 Key 只留在内存，本次会话仍然可用
  }
  useAccessKey.setState({ unauthorized: false })
}

export const notifyUnauthorized = () => useAccessKey.setState({ unauthorized: true })
