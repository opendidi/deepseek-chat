import { useEffect, useMemo, useState } from 'react'
import { useChatStore } from '../../services/chat/store.js'
import { searchContent, type SearchHit } from '../../services/chat/search.js'
import type { SessionSummary } from '../../services/chat/types.js'

/** 消息级命中：跳转到具体消息时使用 */
export type ContentMatch = {
  sessionId: string
  messageId: string
  snippet: string
}

/**
 * 会话搜索：标题即时过滤；内容搜索（至少 2 个字符）防抖后走服务端全文索引，
 * 结果保持会话列表原有顺序，并给出每个命中会话的首条消息级定位。
 */
export const useSessionSearch = (query: string) => {
  const sessions = useChatStore((state) => state.sessions)
  const trimmed = query.trim()
  const [matches, setMatches] = useState<SearchHit[]>([])
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    const q = trimmed.toLowerCase()
    if (q.length < 2) {
      setMatches([])
      setScanning(false)
      return
    }
    let cancelled = false
    setScanning(true)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const hits = await searchContent(trimmed)
          if (cancelled) {
            return
          }
          // 只保留当前会话列表里存在的命中（防御性：服务器库与列表同源）
          const known = new Set(sessions.map((session) => session.id))
          setMatches(hits.filter((hit) => known.has(hit.sessionId)))
        } catch {
          if (!cancelled) {
            setMatches([])
          }
        } finally {
          if (!cancelled) {
            setScanning(false)
          }
        }
      })()
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, sessions])

  // 每个会话只取第一条命中（用于点击后跳转到具体消息）
  const matchBySession = useMemo(() => {
    const map = new Map<string, ContentMatch>()
    for (const hit of matches) {
      if (!map.has(hit.sessionId)) {
        map.set(hit.sessionId, hit)
      }
    }
    return map
  }, [matches])

  const results = useMemo<SessionSummary[] | null>(() => {
    const q = trimmed.toLowerCase()
    if (!q) {
      return null
    }
    return sessions.filter(
      (session) => session.title.toLowerCase().includes(q) || matchBySession.has(session.id)
    )
  }, [sessions, trimmed, matchBySession])

  return { results, scanning, matchBySession }
}
