import { runClientTool } from '../agent/tools.js'
import type { ToolStep } from './types.js'
import { parseToolInput } from './reply.js'

/**
 * 并行执行一轮客户端工具调用，返回带结果与状态的步骤。
 * 纯函数（除工具执行外不依赖 store），便于单独测试与复用。
 */
export const runToolSteps = async (
  steps: readonly ToolStep[],
  signal: AbortSignal
): Promise<ToolStep[]> => {
  const results = await Promise.all(
    steps.map(async (step) => ({
      id: step.id,
      ...(await runClientTool(step.name, parseToolInput(step.inputJson), signal)),
    }))
  )
  const byId = new Map(results.map((result) => [result.id, result]))
  return steps.map((step): ToolStep => {
    const result = byId.get(step.id)
    return result
      ? {
          ...step,
          status: result.isError ? 'error' : 'done',
          result: result.content,
          isError: result.isError,
        }
      : step
  })
}
