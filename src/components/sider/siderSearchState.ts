import { create } from 'zustand'

/**
 * 侧边栏搜索框的聚焦请求：Ctrl+K 触发。
 * 桌面端收起或移动端抽屉未打开时，先展开再由 Sider 挂载后的时间戳检查聚焦，
 * 因此除了自增序号还记录请求时间。
 */
export const useSiderSearchFocus = create(() => ({ token: 0, at: 0 }))

export const requestSiderSearchFocus = () =>
  useSiderSearchFocus.setState((state) => ({ token: state.token + 1, at: Date.now() }))
