import { useEffect, useRef, useState } from 'react'

/** 两次更新的最长间隔 */
const MAX_WAIT = 2000
/** 上次渲染耗时的倍数，过了这段时间才允许下次更新 */
const TIME_CONSUMING_RATE = 2

/**
 * 流式过程中按渲染耗时节流 Markdown 内容的更新：
 * 更新输出时记录开始时间，提交后按耗时 × TIME_CONSUMING_RATE（不超过 MAX_WAIT）
 * 算出下次允许更新的时间点；新内容在到期时更新，连续输入合并为最新内容。
 * 关闭节流时直接返回最新内容。
 */
export const useThrottleMarkdownRender = (content: string, enable: boolean) => {
  // 首次渲染从挂载时开始计时
  const startRef = useRef(performance.now())
  const updatableAtRef = useRef(0)
  const [output, setOutput] = useState(content)

  useEffect(() => {
    const now = performance.now()
    updatableAtRef.current =
      now + Math.min(MAX_WAIT, (now - startRef.current) * TIME_CONSUMING_RATE)
  }, [output])

  // 关闭节流时把缓存对齐到最新正文：续答会复用同一 message.id 并重新开启节流，
  // 若残留上一次流式中途的 output，会在重新开启的那一帧闪回旧内容。
  useEffect(() => {
    if (!enable) {
      updatableAtRef.current = 0
      if (output !== content) {
        setOutput(content)
      }
    }
  }, [enable, content, output])

  useEffect(() => {
    if (!enable) {
      return
    }
    const update = () => {
      startRef.current = performance.now()
      setOutput(content)
    }
    const delay = updatableAtRef.current - performance.now()
    if (delay <= 0) {
      update()
      return
    }
    const timer = setTimeout(update, delay)
    return () => clearTimeout(timer)
  }, [content, enable])

  return enable ? output : content
}
