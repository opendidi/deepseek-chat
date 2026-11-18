import * as db from './db.js'
import type { Session } from './types.js'

/** 会话内容是否包含 query（用户提问与回答正文；思考内容不参与搜索） */
const matchesContent = (session: Session, query: string): boolean =>
  session.messages.some((message) =>
    message.role === 'user'
      ? message.content.toLowerCase().includes(query)
      : message.blocks.some(
          (block) => block.type === 'text' && block.text.toLowerCase().includes(query)
        )
  )

/** 单个会话的内容搜索：不存在或读取失败时返回 false */
export const sessionContentMatches = async (id: string, query: string): Promise<boolean> => {
  const session = await db.loadSession(id)
  return session ? matchesContent(session, query) : false
}
