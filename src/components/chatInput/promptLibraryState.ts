import { create } from 'zustand'

/** 提示词库弹窗：从输入区的斜杠菜单与工具栏打开 */
export const usePromptLibrary = create(() => ({ open: false }))

export const openPromptLibrary = () => usePromptLibrary.setState({ open: true })

export const closePromptLibrary = () => usePromptLibrary.setState({ open: false })
