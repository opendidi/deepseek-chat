/** 会话内容搜索：走服务端维护的 FTS 索引，返回消息级命中（含定位与摘录） */
import { searchMessages, type SearchHit } from './db.js'

export type { SearchHit }

/** 全文搜索：至少 1 个字符；调用方（侧栏搜索）负责防抖与最少字符门槛 */
export const searchContent = async (query: string): Promise<SearchHit[]> =>
  searchMessages(query)
