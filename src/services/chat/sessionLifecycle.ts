import { useSettings } from '../settings.js'
import { createId } from '../../utils/id.js'
import { clearAllDrafts } from './drafts.js'
import { reloadFavorites } from './favorites.js'
import { readActiveSessionId, writeActiveSessionId } from './activeSession.js'
import { normalizeSession } from './branches.js'
import { settleReply } from './reply.js'
import * as db from './db.js'
import { maybeMigrateLegacyData } from './backendMigration.js'
import {
  get,
  getSession,
  persist,
  retrySaveSessions,
  runtime,
  sameSummary,
  set,
  sortSessions,
  touchSession,
  trimSessionCache,
  useChatStore,
  type ChatState,
} from './storeRuntime.js'
import type { AssistantMessage, Session, SessionSummary } from './types.js'

/**
 * activeId 的任何变化都同步到地址栏：选中、新建、删除、导入历史、首次发消息创建会话全部覆盖。
 * 手动修改 hash（含浏览器前进后退）时反向同步界面。
 * 拆成显式绑定函数：node 测试导入本模块时不再挂全局监听，应用入口（App.tsx）调用一次。
 */
export const bindHashSync = (): (() => void) => {
  if (typeof window === 'undefined') {
    return () => {}
  }
  let syncedActiveId = get().activeId
  const unsubscribe = useChatStore.subscribe((state) => {
    if (state.activeId !== syncedActiveId) {
      syncedActiveId = state.activeId
      writeActiveSessionId(state.activeId)
    }
  })
  const onHashChange = () => {
    const id = readActiveSessionId()
    if (id === get().activeId) {
      return
    }
    if (id && get().sessions.some((item) => item.id === id)) {
      set({ activeId: id })
      void ensureSessionLoaded(id)
    } else {
      set({ activeId: null })
      // activeId 本来就是 null 时订阅不会写地址栏，这里显式清掉失效的 hash
      writeActiveSessionId(null)
    }
  }
  window.addEventListener('hashchange', onHashChange)
  return () => {
    unsubscribe()
    window.removeEventListener('hashchange', onHashChange)
  }
}

/** 按当前开关创建回复：深度思考对应 thinking，智能搜索控制 deepseek_web_search。 */
export const createReply = (): AssistantMessage => {
  const { thinking, search, chatModel } = useSettings.getState()
  return {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: chatModel,
    thinking,
    search,
    prefix: true,
    status: 'pending',
    blocks: [],
  }
}

/** 仍在生成中的回复（页面关闭或导出时未结束）按「已停止」处理 */
const settleInterrupted = (session: Session): Session => {
  if (
    !session.messages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  ) {
    return session
  }
  return {
    ...session,
    messages: session.messages.map((m) =>
      m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
        ? settleReply(m, 'stopped', session.updatedAt)
        : m
    ),
  }
}

export const initChat = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  if (runtime.initTask) {
    return runtime.initTask
  }
  const epoch = runtime.historyEpoch
  set({ initError: false })
  runtime.initTask = (async () => {
    try {
      // 首次使用本机服务时，把旧 IndexedDB 数据一次性搬进 SQLite（内部自判，幂等）
      await maybeMigrateLegacyData()
      const summaries = await db.loadSessionSummaries()
      if (epoch === runtime.historyEpoch) {
        // 刷新后按地址栏恢复上次打开的会话；id 已不存在时清掉 hash 回到欢迎页
        const stored = readActiveSessionId()
        const activeId = stored && summaries.some((item) => item.id === stored) ? stored : null
        set({ ready: true, sessions: sortSessions(summaries), activeId })
        if (activeId) {
          void ensureSessionLoaded(activeId)
        } else if (stored) {
          writeActiveSessionId(null)
        }
      }
    } catch (error) {
      if (epoch === runtime.historyEpoch) {
        set({ initError: true })
        db.reportStorageError('read local sessions')(error)
      }
    } finally {
      if (epoch === runtime.historyEpoch) {
        runtime.initTask = undefined
      }
    }
  })()
  return runtime.initTask
}

/** 同一会话合并并发读取；切换只改变 activeId，旧请求不会把界面切回去。 */
export const ensureSessionLoaded = (id: string): Promise<void> => {
  if (getSession(id)) {
    return Promise.resolve()
  }
  const pending = runtime.sessionLoads.get(id)
  if (pending) {
    return pending.promise
  }
  const epoch = runtime.historyEpoch
  set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: false } }))
  const load = { promise: Promise.resolve() }
  runtime.sessionLoads.set(id, load)
  load.promise = (async () => {
    try {
      const stored = await db.loadSession(id)
      if (epoch !== runtime.historyEpoch || runtime.sessionLoads.get(id) !== load) {
        return
      }
      const summary = get().sessions.find((session) => session.id === id)
      if (!summary) {
        return
      }
      if (!stored) {
        throw new Error(`Session ${id} is missing from local storage`)
      }
      const settled = settleInterrupted(normalizeSession(stored))
      // 读取期间可能已在列表重命名，保留最新元数据，不能让旧读取覆盖它。
      const session = sameSummary(settled, summary) ? settled : { ...settled, ...summary }
      touchSession(id)
      set((state) => ({ sessionCache: { ...state.sessionCache, [id]: session } }))
      if (session !== stored) {
        persist(id)
      }
      trimSessionCache()
    } catch (error) {
      if (epoch === runtime.historyEpoch && runtime.sessionLoads.get(id) === load) {
        set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: true } }))
        db.reportStorageError('read session')(error)
      }
    } finally {
      if (runtime.sessionLoads.get(id) === load) {
        runtime.sessionLoads.delete(id)
      }
    }
  })()
  return load.promise
}

/** 等所有回复的收尾（落盘）完成 */
export const waitForIdle = (sessionId?: string) =>
  new Promise<void>((resolve) => {
    const isIdle = (state: ChatState) =>
      sessionId === undefined
        ? Object.keys(state.streaming).length === 0
        : !Object.hasOwn(state.streaming, sessionId)
    if (isIdle(get())) {
      resolve()
      return
    }
    const unsubscribe = useChatStore.subscribe((state) => {
      if (isIdle(state)) {
        unsubscribe()
        resolve()
      }
    })
  })

/**
 * 替换历史对话：先写入暂存，成功后原子替换旧记录；写入为空即删除全部会话与附件。
 * 期间停止生成并禁止修改会话；失败时清除暂存，保留原有记录。
 */
export const replaceHistory = async (write: () => Promise<void>): Promise<number> => {
  if (get().importingHistory) {
    throw new Error('History replacement is already in progress')
  }
  set({ importingHistory: true })
  try {
    for (const controller of Object.values(get().streaming)) {
      controller.abort()
    }
    // 被 abort 的流仍会在 finally 里 persist()：取消所有待触发的防抖写入，
    // 否则 300ms 后可能把旧 sessionCache 写进替换完成后的正式 store。
    for (const timer of runtime.persistTimers.values()) {
      clearTimeout(timer)
    }
    runtime.persistTimers.clear()
    // 已开始的单条删除先同步到内存，避免本次替换失败后列表残留已被删除的记录。
    await Promise.all(runtime.deletionTasks)
    runtime.historyEpoch += 1
    runtime.initTask = undefined
    runtime.sessionLoads.clear()
    await waitForIdle()
    await db.clearStaging()
    let summaries: SessionSummary[]
    try {
      await write()
      summaries = await db.commitStaging()
    } catch (error) {
      await db.clearStaging().catch(db.reportStorageError('clear unfinished history replacement'))
      throw error
    }
    runtime.sessionAccess.clear()
    runtime.unsavedSessions.clear()
    runtime.pendingFiles.clear()
    clearAllDrafts()
    set({
      ready: true,
      initError: false,
      sessions: sortSessions(summaries),
      sessionCache: {},
      sessionLoadErrors: {},
      sessionSaveErrors: {},
      activeId: null,
    })
    // 历史替换会清空收藏，刷新内存里的收藏列表
    void reloadFavorites()
    return summaries.length
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId, ready } = get()
    // 替换失败时恢复被取消的详情读取，原有记录继续可用。
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    } else if (!ready) {
      void initChat()
    }
  }
}
