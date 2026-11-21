/** 聊天模式与工具名单的零依赖常量，供 settings 与工具策略共用，避免模块循环 */

export type ChatMode = 'chat' | 'standard' | 'full'

export const CHAT_MODES: readonly ChatMode[] = ['chat', 'standard', 'full']

/** 全部客户端工具名 */
export const ALL_TOOL_NAMES: readonly string[] = [
  'get_current_time',
  'calculate',
  'get_page_context',
]

/** 默认只开启无隐私风险的基础工具；页面内容工具需用户单独授权 */
export const DEFAULT_TOOL_NAMES: readonly string[] = ['get_current_time', 'calculate']

/** Agent 工具往返的最大轮次 */
export const MAX_AGENT_TURNS = 6

/** 工具结果留在请求上下文里的字符预算，超出后较早的结果替换为摘要 */
export const MAX_TOOL_CONTEXT_CHARS = 12_000
