import { create } from 'zustand'

/** 消息级搜索跳转：侧栏命中后设置目标，MessageList 打开对应会话时滚动定位并清除 */
type MessageJumpState = {
  target: { sessionId: string; messageId: string } | null
}

export const useMessageJump = create<MessageJumpState>(() => ({ target: null }))

export const requestMessageJump = (sessionId: string, messageId: string) =>
  useMessageJump.setState({ target: { sessionId, messageId } })

export const clearMessageJump = () => useMessageJump.setState({ target: null })
