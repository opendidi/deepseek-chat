/**
 * 旧版 IndexedDB 存储的只读访问：仅供「迁移到本机服务」读取既有数据。
 * 写入一律走新的 HTTP 存储层（db.ts），这里不提供任何写能力，也不做库迁移。
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Session, SessionSummary } from './types.js'

/** 旧 files 表的值：只有 id 与原件字节 */
type LegacyStoredFile = { id: string; blob: Blob }

/** 旧摘要行额外带 fileIds（multiEntry 索引用），读取时用不到 */
type LegacyStoredSessionSummary = SessionSummary & { fileIds: string[] }

interface LegacyChatDB extends DBSchema {
  sessions: { key: string; value: Session }
  sessionSummaries: { key: string; value: LegacyStoredSessionSummary }
  files: { key: string; value: LegacyStoredFile }
  favorites: {
    key: string
    value: {
      id: string
      sessionId: string
      messageId: string
      text: string
      createdAt: number
    }
  }
}

const DB_NAME = 'deepseek-chat'

let dbPromise: Promise<IDBPDatabase<LegacyChatDB>> | null = null

const getDB = () =>
  (dbPromise ??= openDB<LegacyChatDB>(DB_NAME).catch((error: unknown) => {
    // 打开失败（如存储被禁用）不缓存拒绝，下次启动可重试
    dbPromise = null
    throw error
  }))

/** 旧库不存在对应 store（未用过或全新浏览器/新 origin）时返回各自的空值 */
type LegacyStoreName = 'sessions' | 'sessionSummaries' | 'files' | 'favorites'

const withStore = async <T>(
  name: LegacyStoreName,
  empty: T,
  run: (db: IDBPDatabase<LegacyChatDB>) => Promise<T>
): Promise<T> => {
  const db = await getDB()
  if (!db.objectStoreNames.contains(name)) {
    return empty
  }
  return await run(db)
}

export const loadSessionSummaries = (): Promise<SessionSummary[]> =>
  withStore('sessionSummaries', [], async (db) =>
    (await db.getAll('sessionSummaries')).map((summary) => {
      const { fileIds: _fileIds, ...rest } = summary
      void _fileIds
      return rest
    })
  )

export const loadSession = async (id: string): Promise<Session | undefined> =>
  withStore('sessions', undefined, async (db) => await db.get('sessions', id))

export const loadFile = async (id: string): Promise<Blob | undefined> =>
  withStore('files', undefined, async (db) => (await db.get('files', id))?.blob)

export const loadFavorites = (): Promise<
  { id: string; sessionId: string; messageId: string; text: string; createdAt: number }[]
> => withStore('favorites', [], async (db) => await db.getAll('favorites'))
