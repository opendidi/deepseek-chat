import { create } from 'zustand'
import { useSettings } from '../settings.js'

/**
 * 高德 Key 的按需输入门：Agent 调用地图工具且未配置 Key 时打开，
 * 用户填写后 resolve 放行，本轮工具继续执行；取消 / 中止则 resolve(null)。
 * 状态放在 services 层（runToolSteps 的回合前置检查要用），弹窗 UI 在组件层。
 */

type AmapKeyGateState = {
  open: boolean
  resolve: ((key: string | null) => void) | null
  /** 用户刚取消过输入门：本轮工具直接回引导错误，不再重复弹门 */
  cancelled: boolean
}

export const useAmapKeyGate = create<AmapKeyGateState>(() => ({
  open: false,
  resolve: null,
  cancelled: false,
}))

/** 是否已配置高德 Key（Agent 回合的前置检查用） */
export const isAmapConfigured = (): boolean => !!useSettings.getState().amapKey?.trim()

/** 打开输入门并等待结果；signal 中止时视为取消（返回 null） */
export const requestAmapKey = (signal?: AbortSignal): Promise<string | null> =>
  new Promise((resolve) => {
    useAmapKeyGate.setState({ open: true, resolve, cancelled: false })
    const onAbort = () => finish(null)
    const finish = (key: string | null) => {
      signal?.removeEventListener('abort', onAbort)
      useAmapKeyGate.setState({ open: false, resolve: null })
      resolve(key)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

/** 用户提交口令后由输入门调用：放行等待方并记录 Key（记录在组件层走 setAmapKey） */
/** 取消输入门：本轮未完成区的地图工具直接回引导错误（cancelled 标记） */
export const cancelAmapKey = () => resolveAmapKeyGate(null)

export const resolveAmapKeyGate = (key: string | null) => {
  const { resolve } = useAmapKeyGate.getState()
  // 取消（null）时标记本轮已放弃，后续 requireKey 直接回引导错误不再弹门；提交则清除标记
  useAmapKeyGate.setState({ open: false, resolve: null, cancelled: key === null })
  resolve?.(key)
}
