import { create } from 'zustand'
import { getReplyText } from './reply.js'
import * as db from './db.js'
import type { StoredFavorite } from './db.js'
import type { AssistantMessage } from './types.js'

const favoriteId = (sessionId: string, messageId: string) => `${sessionId}:${messageId}`

/** 收藏夹：跨会话保存喜欢的回答；只在打开应用时从本地存储加载一次 */
export const useFavorites = create<{ favorites: StoredFavorite[] }>(() => ({ favorites: [] }))

const { setState, getState } = useFavorites

/** 启动时加载收藏列表 */
export const initFavorites = (): Promise<void> =>
  db
    .loadFavorites()
    .then((favorites) => setState({ favorites }))
    .catch((error: unknown) => {
      db.reportStorageError('load favorites')(error)
    })

/** 收藏列表刷新（历史替换后收藏会被清空） */
export const reloadFavorites = (): Promise<void> => initFavorites()

export const isFavorite = (sessionId: string, messageId: string): boolean =>
  getState().favorites.some((favorite) => favorite.id === favoriteId(sessionId, messageId))

/** 收藏 / 取消收藏一条回答 */
export const toggleFavorite = (sessionId: string, reply: AssistantMessage): void => {
  const id = favoriteId(sessionId, reply.id)
  if (isFavorite(sessionId, reply.id)) {
    void db.deleteFavorite(id).catch(db.reportStorageError('remove favorite'))
    setState((state) => ({
      favorites: state.favorites.filter((favorite) => favorite.id !== id),
    }))
    return
  }
  const text = getReplyText(reply).trim()
  if (!text) {
    return
  }
  const favorite: StoredFavorite = {
    id,
    sessionId,
    messageId: reply.id,
    text: text.slice(0, 500),
    createdAt: Date.now(),
  }
  void db.putFavorite(favorite).catch(db.reportStorageError('save favorite'))
  setState((state) => ({ favorites: [favorite, ...state.favorites] }))
}

/** 删除单条收藏（收藏夹里操作） */
export const removeFavorite = (id: string): void => {
  void db.deleteFavorite(id).catch(db.reportStorageError('remove favorite'))
  setState((state) => ({
    favorites: state.favorites.filter((favorite) => favorite.id !== id),
  }))
}

/** 删除会话时同步移除内存里该会话的收藏（DB 侧由 deleteSession 的事务一并清理） */
export const removeFavoritesBySession = (sessionId: string): void => {
  setState((state) => ({
    favorites: state.favorites.filter((favorite) => favorite.sessionId !== sessionId),
  }))
}
