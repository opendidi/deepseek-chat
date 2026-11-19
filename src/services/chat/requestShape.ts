/** 请求体里固定的系统提示词与工具声明：请求发送与上下文分类估算共用同一份定义 */
import type { CreateMessageRequest } from '../api/types.js'
import { clientToolParams } from '../agent/tools.js'

export const BASE_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/** 阅读链接始终开启，智能搜索开关控制是否另行声明搜索工具（含边想边搜）。 */
export const serverTools = (search: boolean): CreateMessageRequest['tools'] => {
  const tools: CreateMessageRequest['tools'] = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}

/** 本轮请求实际下发的工具定义文本，用于按字符权重估算「工具定义」占用的 token */
export const toolDefinitionText = (search: boolean, agentTools: boolean): string =>
  JSON.stringify([
    ...serverTools(search),
    ...(agentTools ? clientToolParams() : []),
  ])
