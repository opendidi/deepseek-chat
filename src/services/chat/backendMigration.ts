/**
 * 一次性把旧浏览器 IndexedDB 里的会话/附件/收藏搬进本机 SQLite 服务。
 * 按会话逐条对账：服务器上已存在的跳过（saveSession upsert 幂等，重复搬无副作用），
 * 缺失的补搬——上次迁移中途失败时，下次启动会继续完成剩余部分。
 * 只有「服务器上没有任何旧会话」且服务器已有别的数据（用户已在用新后端）时才整体放弃，
 * 避免覆盖；迁移失败不置标记，下次启动重试。
 */

import { loadSessionSummaries, putFavorite, saveSession, type StoredFile } from './db.js'
import * as legacyIdb from './legacyIdb.js'
import { showToast } from '../../components/base/toastState.js'

const MIGRATED_KEY = 'deepseek-chat:backend-migrated'

/** 迁移已做过（成功或确认无需迁移）后不再读取旧库 */
const markMigrated = () => localStorage.setItem(MIGRATED_KEY, '1')

export const maybeMigrateLegacyData = async (): Promise<void> => {
  if (localStorage.getItem(MIGRATED_KEY) !== null) {
    return
  }
  try {
    const legacySummaries = await legacyIdb.loadSessionSummaries()
    if (legacySummaries.length === 0) {
      // 旧库没有数据：无需迁移，置标记避免每次启动都读 IndexedDB
      markMigrated()
      return
    }
    const serverSummaries = await loadSessionSummaries()
    const serverIds = new Set(serverSummaries.map((summary) => summary.id))
    const pending = legacySummaries.filter((summary) => !serverIds.has(summary.id))
    if (pending.length === 0) {
      // 旧会话全部已在服务器上：迁移早已完成
      markMigrated()
      return
    }
    if (pending.length === legacySummaries.length && serverSummaries.length > 0) {
      // 服务器上全是与新存储无关的会话：用户已在使用新后端，不自动覆盖，
      // 剩余旧数据靠 ZIP 导入导出手工对齐
      markMigrated()
      return
    }
    for (const summary of pending) {
      const session = await legacyIdb.loadSession(summary.id)
      if (!session) {
        continue
      }
      // 原件按附件 id 去重收集：多消息共用同一 id 时只传一份
      const files: StoredFile[] = []
      const seen = new Set<string>()
      for (const message of session.messages) {
        if (message.role !== 'user') {
          continue
        }
        for (const file of message.files) {
          if (seen.has(file.id)) {
            continue
          }
          seen.add(file.id)
          const blob = await legacyIdb.loadFile(file.id)
          if (blob) {
            files.push({ id: file.id, blob })
          }
        }
      }
      await saveSession(session, files)
    }
    for (const favorite of await legacyIdb.loadFavorites()) {
      await putFavorite(favorite)
    }
    markMigrated()
    showToast({ key: 'backendMigrated', params: { count: pending.length } })
  } catch (error) {
    // 迁移失败不打断启动；不置标记，下次启动继续尝试
    // eslint-disable-next-line no-console
    console.error('[storage] legacy migration failed', error)
  }
}
