import { create } from 'zustand'
import * as db from './db.js'
import {
  toSessionSummary,
  type AssistantMessage,
  type Session,
  type SessionSummary,
} from './types.js'

/** 保留最近打开的详情；当前会话、生成中及尚未成功保存的会话不淘汰。 */
const SESSION_CACHE_LIMIT = 5
/** 落盘防抖窗口：一次发送会触发多次 persist（开始、每个附件的 serverId、结束），合并成末次之后的一次写入 */
const PERSIST_DELAY = 300

export type ChatState = {
  ready: boolean
  initError: boolean
  /** 历史导入或全部删除期间锁定交互，提交成功前仍展示原有记录。 */
  importingHistory: boolean
  /** 仅列表元数据，按 updatedAt 降序；流式消息更新不会改变此数组。 */
  sessions: SessionSummary[]
  sessionCache: Record<string, Session>
  sessionLoadErrors: Record<string, boolean>
  sessionSaveErrors: Record<string, boolean>
  /** null 表示新对话（欢迎页） */
  activeId: string | null
  /** 正在生成回复的会话 */
  streaming: Record<string, AbortController>
}

export const useChatStore = create<ChatState>(() => ({
  ready: false,
  initError: false,
  importingHistory: false,
  sessions: [],
  sessionCache: {},
  sessionLoadErrors: {},
  sessionSaveErrors: {},
  activeId: null,
  streaming: {},
}))

export const get = useChatStore.getState
export const set = useChatStore.setState

/**
 * 拆分后的模块共享同一份可变运行时状态。
 * 集中成对象而非逐个导出 let：ESM 的导出绑定是只读的，外部模块无法给标量重新赋值，
 * 而 historyEpoch / initTask 等会被多个模块读写。
 */
export const runtime = {
  /** 允许自动补标题的请求；手动重命名后取消本轮标题写入 */
  titleRequests: new Set<AbortController>(),
  sessionAccess: new Map<string, number>(),
  unsavedSessions: new Set<string>(),
  /** 保存失败时保留原件，重试成功后才释放。 */
  pendingFiles: new Map<string, db.StoredFile[]>(),
  deletingSessions: new Set<string>(),
  deletionTasks: new Set<Promise<boolean>>(),
  streamFlushes: new Map<string, () => void>(),
  persistTimers: new Map<string, ReturnType<typeof setTimeout>>(),
  sessionLoads: new Map<string, { promise: Promise<void> }>(),
  /** 在途的落盘请求：防止 10s 补落盘与防抖触发叠加出重复的大请求 */
  inFlightSaves: new Map<string, Promise<void>>(),
  accessSequence: 0,
  historyEpoch: 0,
  initTask: undefined as Promise<void> | undefined,
}

export const sortSessions = (sessions: SessionSummary[]) =>
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

export const getSession = (id: string) => {
  const cache = get().sessionCache
  return Object.hasOwn(cache, id) ? cache[id] : undefined
}

export const getStreamController = (id: string) => {
  const streams = get().streaming
  return Object.hasOwn(streams, id) ? streams[id] : undefined
}

export const sameSummary = (a: SessionSummary, b: SessionSummary) =>
  a.title === b.title && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt

export const touchSession = (id: string) =>
  runtime.sessionAccess.set(id, ++runtime.accessSequence)

export const trimSessionCache = () => {
  const state = get()
  const ids = Object.keys(state.sessionCache)
  if (ids.length <= SESSION_CACHE_LIMIT) {
    return
  }
  const removable = ids
    .filter(
      (id) =>
        id !== state.activeId &&
        !Object.hasOwn(state.streaming, id) &&
        !runtime.unsavedSessions.has(id) &&
        !runtime.deletingSessions.has(id)
    )
    .sort((a, b) => (runtime.sessionAccess.get(a) ?? 0) - (runtime.sessionAccess.get(b) ?? 0))
  const evicted = new Set(removable.slice(0, ids.length - SESSION_CACHE_LIMIT))
  for (const id of evicted) {
    runtime.sessionAccess.delete(id)
  }
  if (evicted.size > 0) {
    set({
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !evicted.has(id))
      ),
    })
  }
}

export const updateSession = (id: string, update: (session: Session) => Session) =>
  set((state) => {
    const previous = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    if (!previous) {
      return state
    }
    const session = update(previous)
    if (session === previous) {
      return state
    }
    return {
      sessionCache: { ...state.sessionCache, [id]: session },
      sessions: sameSummary(previous, session)
        ? state.sessions
        : sortSessions(
            state.sessions.map((summary) =>
              summary.id === id ? toSessionSummary(session) : summary
            )
          ),
    }
  })

export const updateReply = (sessionId: string, reply: AssistantMessage) =>
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === reply.id
        ? { ...reply, parentId: message.parentId, selectedChildId: message.selectedChildId }
        : message
    ),
  }))

const saveSessionNow = (sessionId: string, force = false) => {
  // 历史替换/清空期间禁止把旧 sessionCache 写回，否则会留下不可见的孤儿会话
  if (get().importingHistory) {
    return
  }
  const session = getSession(sessionId)
  if (session) {
    runtime.unsavedSessions.add(sessionId)
    if (runtime.deletingSessions.has(sessionId)) {
      return
    }
    // 同一会话已有在途写入时跳过本次（避免同一大 payload 叠加重发）；
    // force（pagehide/隐藏）例外——那是最后一次落盘机会，宁可重发也不能丢
    if (!force && runtime.inFlightSaves.has(sessionId)) {
      return
    }
    const epoch = runtime.historyEpoch
    const files = runtime.pendingFiles.get(sessionId)
    const task = db
      .saveSession(session, files)
      .then(() => {
        if (epoch !== runtime.historyEpoch || !getSession(sessionId)) {
          return
        }
        if (runtime.pendingFiles.get(sessionId) === files) {
          runtime.pendingFiles.delete(sessionId)
        }
        if (getSession(sessionId) === session) {
          runtime.unsavedSessions.delete(sessionId)
          set((state) => ({
            sessionSaveErrors: Object.fromEntries(
              Object.entries(state.sessionSaveErrors).filter(([id]) => id !== sessionId)
            ),
          }))
          trimSessionCache()
        }
      })
      .catch((error: unknown) => {
        db.reportStorageError('save session')(error)
        if (epoch === runtime.historyEpoch && getSession(sessionId)) {
          set((state) => ({
            sessionSaveErrors: { ...state.sessionSaveErrors, [sessionId]: true },
          }))
        }
      })
    const tracked = task.finally(() => {
      if (runtime.inFlightSaves.get(sessionId) === tracked) {
        runtime.inFlightSaves.delete(sessionId)
      }
    })
    runtime.inFlightSaves.set(sessionId, tracked)
  }
}

/** 排程防抖落盘：总是先记入未保存集合，离开页面（bindChatPersistence）时强制写入 */
export const persist = (sessionId: string) => {
  if (!getSession(sessionId)) {
    return
  }
  runtime.unsavedSessions.add(sessionId)
  const pending = runtime.persistTimers.get(sessionId)
  if (pending !== undefined) {
    clearTimeout(pending)
  }
  runtime.persistTimers.set(
    sessionId,
    setTimeout(() => {
      runtime.persistTimers.delete(sessionId)
      saveSessionNow(sessionId)
    }, PERSIST_DELAY)
  )
}

/** 取消未触发的防抖并立即落盘；即使没有排程也补一次写入，兜底失败的旧账 */
const flushPersist = (sessionId: string, force = false) => {
  const pending = runtime.persistTimers.get(sessionId)
  if (pending !== undefined) {
    clearTimeout(pending)
    runtime.persistTimers.delete(sessionId)
  }
  if (runtime.unsavedSessions.has(sessionId)) {
    saveSessionNow(sessionId, force)
  }
}

export const retrySaveSessions = () => {
  if (!get().importingHistory) {
    runtime.unsavedSessions.forEach(persist)
  }
}

/** 离开前先合并尚未绘制的增量；隐藏期间浏览器可能暂停动画帧。 */
export const bindChatPersistence = () => {
  const save = (force = false) => {
    if (get().importingHistory) {
      return
    }
    for (const flush of runtime.streamFlushes.values()) {
      flush()
    }
    // 防抖中的、以及此前写入失败的所有会话一并落盘
    for (const id of runtime.unsavedSessions) {
      flushPersist(id, force)
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      save(true)
    }
  }
  const onPageHide = () => save(true)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', onPageHide)
  // 存储走 HTTP 后，pagehide 时的在途请求可能被浏览器丢弃；
  // 每 10s 把尚未保存的会话补写一次（saveSession 幂等），把丢数据窗口从「上次成功保存以来」缩到秒级
  const interval = window.setInterval(() => {
    if (runtime.unsavedSessions.size > 0 && !get().importingHistory) {
      save()
    }
  }, 10_000)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', onPageHide)
    window.clearInterval(interval)
  }
}
