import { useEffect, useMemo, useState } from 'react'
import { useChatStore } from '../../services/chat/store.js'
import { sessionContentMatches } from '../../services/chat/search.js'
import type { SessionSummary } from '../../services/chat/types.js'

/**
 * 会话搜索：标题即时过滤；内容搜索（至少 2 个字符）防抖后逐条扫描，
 * 途中变化查询词或列表即中止旧扫描。结果保持会话列表原有顺序。
 */
export const useSessionSearch = (query: string) => {
  const sessions = useChatStore((state) => state.sessions)
  const trimmed = query.trim()
  const [contentIds, setContentIds] = useState<ReadonlySet<string>>(new Set())
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    const q = trimmed.toLowerCase()
    if (q.length < 2) {
      setContentIds(new Set())
      setScanning(false)
      return
    }
    let cancelled = false
    setScanning(true)
    const timer = setTimeout(() => {
      void (async () => {
        const hits = new Set<string>()
        for (const summary of sessions) {
          const match = await sessionContentMatches(summary.id, q).catch(() => false)
          if (cancelled) {
            return
          }
          if (match) {
            hits.add(summary.id)
            setContentIds(new Set(hits))
          }
        }
        if (!cancelled) {
          setScanning(false)
        }
      })()
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, sessions])

  const results = useMemo<SessionSummary[] | null>(() => {
    const q = trimmed.toLowerCase()
    if (!q) {
      return null
    }
    return sessions.filter(
      (session) => session.title.toLowerCase().includes(q) || contentIds.has(session.id)
    )
  }, [sessions, trimmed, contentIds])

  return { results, scanning }
}
