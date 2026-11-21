import { runClientTool } from '../agent/tools.js'
import type { ToolStep } from './types.js'
import { readToolInput } from './reply.js'

/**
 * 并行执行一轮客户端工具调用，返回带结果、耗时与状态的步骤。
 * 解析失败的入参直接转成可回传的错误；allowedNames 用来拒绝模型幻觉出的工具名。
 * 纯函数（除工具执行外不依赖 store），便于单独测试与复用。
 */
export const runToolSteps = async (
  steps: readonly ToolStep[],
  signal: AbortSignal,
  allowedNames?: ReadonlySet<string>
): Promise<ToolStep[]> => {
  const results = await Promise.all(
    steps.map(async (step) => {
      const startedAt = Date.now()
      const parsed = readToolInput(step.inputJson)
      const outcome = parsed.error
        ? { content: parsed.error, isError: true }
        : await runClientTool(step.name, parsed.input, signal, allowedNames)
      return {
        id: step.id,
        content: outcome.content,
        isError: outcome.isError,
        startedAt,
        endedAt: Date.now(),
      }
    })
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
          startedAt: result.startedAt,
          endedAt: result.endedAt,
        }
      : step
  })
}
