import { create } from 'zustand'

/** 「↑ 编辑上一条提问」的请求：输入框设置目标消息，UserMessage 命中后进入编辑并清除 */
type EditRequestState = {
  messageId: string | null
}

export const useEditRequest = create<EditRequestState>(() => ({ messageId: null }))

export const requestMessageEdit = (messageId: string) => useEditRequest.setState({ messageId })

export const clearMessageEdit = (messageId: string) =>
  useEditRequest.setState((state) => (state.messageId === messageId ? { messageId: null } : state))
