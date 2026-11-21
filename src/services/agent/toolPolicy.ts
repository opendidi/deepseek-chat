/**
 * Agent 工具策略：按聊天模式决定实际下发的工具集，并提供重复调用检测与步骤聚合。
 * 把策略从 store 的请求循环里抽出来，便于单测和按工具粒度配置。
 */
import type { CreateMessageRequest } from '../api/types.js'
import type { ToolStep } from '../chat/types.js'
import { TOOL_NAMES, clientToolParams, TOOL_REGISTRY } from './tools.js'
import { MAX_AGENT_TURNS } from './toolConstants.js'
import type { ChatMode } from './toolConstants.js'

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

export type ToolPolicyInput = {
  mode: ChatMode
  search: boolean
  /** 旧版总开关；standard 模式继续遵守，full 模式强制开启全部已启用工具 */
  agentTools: boolean
  /** 按工具粒度开启的名单 */
  enabledTools: ReadonlySet<string>
  /** 界面语言，决定发给模型的工具描述 */
  locale?: string
}

export type ResolvedTools = {
  tools: CreateMessageRequest['tools']
  /** 本轮允许模型调用的客户端工具名，用于拒绝幻觉工具 */
  clientNames: ReadonlySet<string>
}

/** 三档模式：仅聊天不下发任何工具；标准沿用现有开关；完整模式放开全部已启用工具与搜索 */
export const resolveChatTools = ({
  mode,
  search,
  agentTools,
  enabledTools,
  locale = 'zh-CN',
}: ToolPolicyInput): ResolvedTools => {
  if (mode === 'chat') {
    return { tools: [], clientNames: new Set() }
  }
  const allowClient = mode === 'full' || agentTools
  const names = new Set(
    TOOL_REGISTRY.filter((tool) => {
      if (!enabledTools.has(tool.name)) {
        return false
      }
      // 地图工具只由自身开关与服务器 Key 配置控制，不走 agentTools 总开关
      if (tool.category === 'map') {
        return true
      }
      if (tool.category === 'workspace') {
        return mode === 'full'
      }
      return allowClient
    }).map((tool) => tool.name)
  )
  const client = clientToolParams(names, locale)
  return {
    tools: [...serverTools(mode === 'full' || search), ...client],
    clientNames: new Set(client.map((tool) => tool.name)),
  }
}

/** 请求里工具声明的估算文本（按字符权重折算 token） */
export const toolDefinitionText = (tools: CreateMessageRequest['tools']): string =>
  JSON.stringify(tools)

/** 全部可配置的客户端工具名 */
export const configurableToolNames = (): readonly string[] => TOOL_NAMES

/** 当前轮（从 0 开始）结束后是否已达工具往返上限 */
export const isTurnLimitReached = (turn: number, maxTurns = MAX_AGENT_TURNS): boolean =>
  turn + 1 >= maxTurns

export const stepSignature = (
  step: Pick<ToolStep, 'name' | 'inputJson'>
): string => `${step.name}\u0000${step.inputJson}`

/** 与本轮之前出现过的调用完全相同的步骤 id，用于阻止模型原地打转 */
export const findRepeatedSteps = (
  steps: readonly ToolStep[],
  seen: ReadonlySet<string>
): string[] => steps.filter((step) => seen.has(stepSignature(step))).map((step) => step.id)

export type ToolNameStats = {
  name: string
  calls: number
  errors: number
  totalMs: number
  avgMs: number
}

export type ToolStats = {
  calls: number
  errors: number
  totalMs: number
  avgMs: number
  byName: ToolNameStats[]
}

/** 聚合工具步骤：调用次数、失败数、耗时与按工具分布 */
export const summarizeToolSteps = (steps: readonly ToolStep[]): ToolStats => {
  const byName = new Map<string, ToolNameStats>()
  let errors = 0
  let totalMs = 0
  for (const step of steps) {
    const item = byName.get(step.name) ?? {
      name: step.name,
      calls: 0,
      errors: 0,
      totalMs: 0,
      avgMs: 0,
    }
    item.calls += 1
    const failed = step.status === 'error'
    if (failed) {
      errors += 1
      item.errors += 1
    }
    const duration =
      step.startedAt !== undefined && step.endedAt !== undefined
        ? Math.max(0, step.endedAt - step.startedAt)
        : 0
    item.totalMs += duration
    totalMs += duration
    byName.set(step.name, item)
  }
  const list = [...byName.values()]
    .map((item) => ({ ...item, avgMs: item.calls ? Math.round(item.totalMs / item.calls) : 0 }))
    .sort((a, b) => b.calls - a.calls)
  return {
    calls: steps.length,
    errors,
    totalMs,
    avgMs: steps.length ? Math.round(totalMs / steps.length) : 0,
    byName: list,
  }
}
