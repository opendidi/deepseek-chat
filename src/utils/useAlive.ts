import { useEffect, useRef } from 'react'

/**
 * 异步操作完成时的存活标记：组件卸载后不再 setState。
 * 每次挂载都重新置 true，兼容 StrictMode 的 effect 二次执行。
 * 返回值是稳定的 ref，可以安全放进 useEffect 依赖数组。
 */
export const useAlive = () => {
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  return alive
}
