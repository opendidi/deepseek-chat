/**
 * 对话状态的对外入口。
 *
 * 实现按职责拆在同级模块里，本文件只保留公共 API 的聚合导出与会话级 CRUD：
 * - storeRuntime.ts    zustand store、跨模块共享的运行时状态、缓存淘汰、落盘防抖
 * - sessionLifecycle.ts 初始化、会话加载、历史替换、地址栏同步
 * - streamReply.ts    附件补传编排与 SSE / Agent 工具请求循环
 * - messageActions.ts 发送、重生成、编辑、续写、版本切换、上传重试
 *
 * 外部模块一律从 store.js 导入，拆分不改变任何公共 API。
 */
export {
  bindChatPersistence,
  retrySaveSessions,
  useChatStore,
} from './storeRuntime.js'
export { bindHashSync, initChat, replaceHistory } from './sessionLifecycle.js'
export {
  continueReply,
  editMessage,
  regenerateReply,
  retryUpload,
  selectMessageVersion,
  sendMessage,
  stopReply,
} from './messageActions.js'

import { clearDraft } from './drafts.js'
import { removeFavoritesBySession } from './favorites.js'
import * as db from './db.js'
import { ensureSessionLoaded, waitForIdle } from './sessionLifecycle.js'
import {
  get,
  getSession,
  getStreamController,
  persist,
  runtime,
  set,
  sortSessions,
  touchSession,
  trimSessionCache,
  updateSession,
} from './storeRuntime.js'
import type { SessionSummary } from './types.js'

export const newChat = () => {
  if (!get().importingHistory) {
    set({ activeId: null })
    trimSessionCache()
  }
}

export const selectSession = (id: string) => {
  if (!get().importingHistory && get().sessions.some((session) => session.id === id)) {
    touchSession(id)
    set({ activeId: id })
    void ensureSessionLoaded(id)
    trimSessionCache()
  }
}

export const renameSession = (id: string, title: string) => {
  if (get().importingHistory || runtime.deletingSessions.has(id)) {
    return
  }
  const controller = getStreamController(id)
  if (controller) {
    runtime.titleRequests.delete(controller)
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, title }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session
      ),
    }))
    void db.renameSession(id, title).catch(db.reportStorageError('rename session'))
  }
}

/** 置顶 / 取消置顶：与重命名一样支持未打开的会话。 */
export const setSessionPinned = (id: string, pinned: boolean) => {
  if (get().importingHistory || runtime.deletingSessions.has(id)) {
    return
  }
  const apply = (summary: SessionSummary): SessionSummary => ({
    ...summary,
    pinned: pinned || undefined,
  })
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, pinned: pinned || undefined }))
  }
  // pinned 不参与 sameSummary 比较，列表重排统一在这里处理
  set((state) => ({
    sessions: sortSessions(
      state.sessions.map((session) => (session.id === id ? apply(session) : session))
    ),
  }))
  if (getSession(id)) {
    persist(id)
  } else {
    void db.setSessionPinned(id, pinned).catch(db.reportStorageError('pin session'))
  }
}

/**
 * 删除会话；本地原件仅在没有其他会话引用时清理。远端文件不删：导入、编辑、重新生成都会复用同一个附件，
 * 同一服务端文件可能被多个会话引用，不维护引用计数。
 */
export const removeSession = (id: string): Promise<boolean> => {
  const task = removeSessionData(id).finally(() => runtime.deletionTasks.delete(task))
  runtime.deletionTasks.add(task)
  return task
}

const removeSessionData = async (id: string): Promise<boolean> => {
  if (get().importingHistory || runtime.deletingSessions.has(id)) {
    return false
  }
  const epoch = runtime.historyEpoch
  runtime.deletingSessions.add(id)
  try {
    getStreamController(id)?.abort()
    // 等本会话的流收尾，避免删除之后又被收尾保存写回来。
    await waitForIdle(id)
    if (epoch !== runtime.historyEpoch) {
      return false
    }
    await db.deleteSession(id)
    if (epoch !== runtime.historyEpoch) {
      return true
    }
    runtime.sessionLoads.delete(id)
    runtime.sessionAccess.delete(id)
    runtime.unsavedSessions.delete(id)
    runtime.pendingFiles.delete(id)
    clearDraft(id)
    // DB 事务已清掉该会话的收藏，内存列表同步移除
    removeFavoritesBySession(id)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => key !== id)
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => key !== id)
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => key !== id)
      ),
      activeId: state.activeId === id ? null : state.activeId,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete session')(error)
    return false
  } finally {
    runtime.deletingSessions.delete(id)
    // 删除失败时保留会话，并保存停止生成后的最新状态。
    if (getSession(id)) {
      if (get().importingHistory) {
        runtime.unsavedSessions.add(id)
      } else {
        persist(id)
      }
    }
  }
}
