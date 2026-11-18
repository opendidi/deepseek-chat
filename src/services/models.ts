import { getApiOrigin, request } from './api/client.js'
import type { ChatModel } from './api/types.js'
import { parseModelIds } from '../utils/modelId.js'

/** 每 1M tokens 的空闲价（¥）：缓存命中 / 输入 / 输出 */
export type ModelPrices = readonly [hit: string, input: string, output: string]

export type ModelInfo = {
  id: ChatModel
  /** 列表里展示的名称；云端模型直接用 id */
  name: string
  /** 云端返回、但没有本地定价的模型为 null */
  prices: ModelPrices | null
  source: 'builtin' | 'cloud'
}

/** 内置模型列表：随代码发布，不依赖网络请求 */
export const BUILTIN_MODELS: readonly ModelInfo[] = [
  {
    id: 'deepseek-flash',
    name: 'DeepSeek Flash',
    prices: ['0.02', '1.00', '4.00'],
    source: 'builtin',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    prices: ['0.15', '4.50', '13.50'],
    source: 'builtin',
  },
]

export const formatModelPrices = (prices: ModelPrices): string =>
  `¥${prices[0]} / ¥${prices[1]} / ¥${prices[2]}`

/** 云端模型没有本地展示名时回退到 id */
export const modelDisplayName = (id: ChatModel): string =>
  BUILTIN_MODELS.find((model) => model.id === id)?.name ?? id

/** GET /models：拉取服务端可用模型；与内置 id 相同的会补上本地定价 */
export const fetchCloudModels = async (apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> => {
  const response = await request(`${getApiOrigin()}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return []
  }
  return parseModelIds(payload).map((id) => {
    const builtin = BUILTIN_MODELS.find((model) => model.id === id)
    return {
      id,
      name: builtin?.name ?? id,
      prices: builtin?.prices ?? null,
      source: 'cloud' as const,
    }
  })
}
