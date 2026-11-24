/**
 * 会话存储：本机 FastAPI + SQLite 后端的 HTTP 适配层。
 * 函数签名与旧的 IndexedDB 实现完全一致，全部消费方零改动；
 * 服务端语义（单事务保存、删除引用计数、导入原子替换）见 server/storage/ 包的模块注释。
 *
 * 所有请求走同源相对路径 /api：开发模式由 rspack dev server 代理到 127.0.0.1:8000，
 * 生产模式由后端直接托管 dist/，页面与接口同源。失败时抛错，由调用方的
 * sessionSaveErrors / sessionLoadErrors 呈现重试入口。
 */

import { getAccessKey, notifyUnauthorized } from './accessKey.js'
import type { Session, SessionSummary } from './types.js'

/** 文件原件按附件的本地 id 存储，所有引用同一 id 的消息共用一份；用于缩略图、打开查看，以及没有 serverId 时补传。 */
export type StoredFile = {
  id: string
  blob: Blob
}

/** 收藏的回答；id 形如 `{sessionId}:{messageId}`，一条回答只收藏一份。 */
export type StoredFavorite = {
  id: string
  sessionId: string
  messageId: string
  /** 收藏时的回答纯文本，用于收藏夹预览 */
  text: string
  createdAt: number
}

const api = (path: string) => `/api${path}`

/** 读接口的超时：后端卡死（磁盘满/进程挂起）时不让界面永久悬挂；写接口不设——大附件上传合法耗时较长 */
const GET_TIMEOUT = 15_000

/** 非 2xx 一律抛错；需要把 404 映射为 undefined 的读取（loadSession/loadFile）自行处理 */
async function request(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const accessKey = getAccessKey()
  if (accessKey) {
    headers.set('x-access-key', accessKey)
  }
  const response = await fetch(api(path), { ...init, headers })
  if (response.status === 401) {
    // 服务端开启/更换了访问口令：弹出输入门
    notifyUnauthorized()
  }
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} failed with ${response.status}`)
  }
  return response
}

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await request(path, init)
  return (await response.json()) as T
}

const requestJsonAllow404 = async <T>(path: string): Promise<T | undefined> => {
  const response = await request(path, { signal: AbortSignal.timeout(GET_TIMEOUT) })
  if (response.status === 404) {
    return undefined
  }
  return (await response.json()) as T
}

// ---------- 会话 ----------

export type SearchHit = {
  sessionId: string
  messageId: string
  /** 命中位置附近的上下文摘录 */
  snippet: string
}

/** 消息级全文检索（服务端维护的搜索索引，LIKE 子串匹配，CJK 友好） */
export const searchMessages = async (query: string): Promise<SearchHit[]> =>
  requestJson<SearchHit[]>(`/search?q=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(GET_TIMEOUT),
  })

export const loadSessionSummaries = async (): Promise<SessionSummary[]> =>
  requestJson<SessionSummary[]>('/sessions', { signal: AbortSignal.timeout(GET_TIMEOUT) })

export const loadSession = async (id: string): Promise<Session | undefined> =>
  requestJsonAllow404<Session>(`/sessions/${encodeURIComponent(id)}`)

/**
 * 整会话保存：multipart 单请求（session JSON + 附件原件），服务端在单事务内写入，
 * 会话、消息、引用与原件全部成功或全部回滚。文件名即附件 id。
 * session 也用文件 part 传输：starlette 对非文件 part 有 1MB 上限，长会话 JSON 会被拦。
 */
export const saveSession = async (session: Session, files: StoredFile[] = []): Promise<void> => {
  const form = new FormData()
  form.append(
    'session',
    new File([JSON.stringify(session)], 'session.json', { type: 'application/json' })
  )
  for (const { id, blob } of files) {
    // MIME 以消息 payload 里的 mimeType 为准（服务端按 id 关联），这里尽量带上 blob 类型
    form.append('files', new File([blob], id, { type: blob.type }))
  }
  await request(`/sessions/${encodeURIComponent(session.id)}`, { method: 'PUT', body: form })
}

/** 未打开的会话也可重命名，服务端原子更新；会话不存在时静默（与旧实现一致） */
export const renameSession = async (id: string, title: string): Promise<void> => {
  await request(`/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
}

/** 未打开的会话也可置顶，服务端原子更新；会话不存在时静默 */
export const setSessionPinned = async (id: string, pinned: boolean): Promise<void> => {
  await request(`/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned }),
  })
}

/** 删除会话并级联清理收藏；附件原件由服务端按引用计数清理（仍被其他会话引用的保留） */
export const deleteSession = async (sessionId: string): Promise<void> => {
  await request(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
}

// ---------- 收藏 ----------

export const loadFavorites = async (): Promise<StoredFavorite[]> => {
  const favorites = await requestJson<StoredFavorite[]>('/favorites')
  // 新收藏在前
  return favorites.sort((a, b) => b.createdAt - a.createdAt)
}

export const putFavorite = async (favorite: StoredFavorite): Promise<void> => {
  await request(`/favorites/${encodeURIComponent(favorite.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(favorite),
  })
}

export const deleteFavorite = async (id: string): Promise<void> => {
  await request(`/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ---------- 附件原件 ----------

/** 返回附件原件 Blob；本地没有原件（如导入的旧档案）时为 undefined，界面只展示文件名 */
export const loadFile = async (id: string): Promise<Blob | undefined> => {
  const response = await fetch(api(`/files/${encodeURIComponent(id)}`))
  if (response.status === 404) {
    return undefined
  }
  if (!response.ok) {
    throw new Error(`GET /files/${id} failed with ${response.status}`)
  }
  return await response.blob()
}

// ---------- 导入暂存 ----------

/** 清空导入暂存：开始导入前清除上次中断（如关闭页面）遗留的数据，导入失败后清除本次写入。 */
export const clearStaging = async (): Promise<void> => {
  await request('/import/begin', { method: 'POST' })
}

export const addStagingSession = async (session: Session): Promise<void> => {
  // 服务端对重复 id 返回 409 → request 抛错（与旧版 IndexedDB add 的重复键语义一致）
  await request('/import/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  })
}

export const saveStagingFiles = async (files: StoredFile[]): Promise<void> => {
  const form = new FormData()
  for (const { id, blob } of files) {
    form.append('files', new File([blob], id, { type: blob.type }))
  }
  await request('/import/files', { method: 'POST', body: form })
}

/** 图片位于会话 JSON 之后；全部读完后回填具体 MIME，保留归档给出的 isImage 标识。 */
export const updateStagingFileTypes = async (types: ReadonlyMap<string, string>): Promise<void> => {
  await request('/import/file-types', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ types: Object.fromEntries(types) }),
  })
}

/**
 * 导入完成后用暂存替换正式数据：服务端单事务替换会话与原件、清空收藏与暂存，
 * 事务失败整体回滚；直接返回新摘要列表，调用方无需再发起可能失败的读取。
 */
export const commitStaging = async (): Promise<SessionSummary[]> =>
  requestJson<SessionSummary[]>('/import/commit', { method: 'POST' })

/** 本地存储失败不打断对话，只在控制台留痕 */
export const reportStorageError = (action: string) => (error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[storage] ${action} failed`, error)
}
