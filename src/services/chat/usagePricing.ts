/**
 * 用量计费口径的唯一来源：账本记账与统计页估算共用这里的价格与规则。
 * 单价单位统一为「元 / 百万 token」，顺序为 [命中, 未命中, 输出]。
 */
import { BUILTIN_MODELS } from '../models.js'

/** 附加用量单价（¥）；服务端搜索免费开关关闭时按旧规则计费 */
export const EXTRA_PRICES = {
  legacySearch: 0.005, // 5 元 / 1000 次
  pageFetch: 0.0015, // 元 / 页
  ttsChar: 0.0003, // 元 / 字符
  asrSecond: 0.00021666666666666668, // 元 / 秒
} as const

export const CONTEXT_WINDOW = 1_000_000
/** 为输出预留的 token，不参与上下文占用计算 */
export const OUTPUT_RESERVE = 8_200
/** 上下文占用达到窗口的该比例后建议压缩，仅为本地展示阈值 */
export const CONTEXT_COMPRESS_RATIO = 0.8

export type TokenPrices = readonly [hit: number, input: number, output: number]

/** 未知模型按列表首个内置模型（DeepSeek Flash）兜底 */
export const modelPrices = (model: string | null): TokenPrices => {
  const found =
    BUILTIN_MODELS.find((item) => item.id === model) ?? BUILTIN_MODELS[0]
  const prices = found.prices ?? BUILTIN_MODELS[0].prices
  if (!prices) {
    return [0, 0, 0]
  }
  // 显式解构，让长度与元素类型真正受元组约束
  const [hit, input, output] = prices
  return [Number(hit), Number(input), Number(output)]
}

const BEIJING_OFFSET = 8 * 60 * 60 * 1000

/** 官方定价页口径：北京时间工作日 9:00–12:00、14:00–18:00 高峰翻倍 */
export const beijingParts = (time: number) => {
  const shifted = new Date(time + BEIJING_OFFSET)
  return {
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours() + shifted.getUTCMinutes() / 60,
  }
}

export const peakFactor = (time: number): number => {
  const { weekday, hour } = beijingParts(time)
  if (weekday === 0 || weekday === 6) {
    return 1
  }
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18) ? 2 : 1
}

/** 中英文按不同字符权重粗估 token，仅用于上下文占用展示 */
export const estimateTokens = (text: string): number => {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  return Math.round(cjk + (text.length - cjk) / 4)
}

export type CostParts = {
  /** 未命中缓存输入 */
  input: number
  /** 缓存写入 */
  cacheWrite: number
  /** 命中缓存输入 */
  cacheRead: number
  output: number
  webSearch?: number
  pageFetch?: number
}

/** 一次请求的估算费用：token 按模型单价与北京时段，附加项受免费开关控制 */
export const estimateRequestCost = ({
  model,
  at,
  parts,
  freeServerTools,
}: {
  model: string | null
  at: number
  parts: CostParts
  freeServerTools: boolean
}): number => {
  const [hitPrice, inputPrice, outputPrice] = modelPrices(model)
  const tokenCost =
    ((parts.cacheRead * hitPrice +
      (parts.input + parts.cacheWrite) * inputPrice +
      parts.output * outputPrice) /
      1_000_000) *
    peakFactor(at)
  const extraCost = freeServerTools
    ? 0
    : (parts.webSearch ?? 0) * EXTRA_PRICES.legacySearch +
      (parts.pageFetch ?? 0) * EXTRA_PRICES.pageFetch
  return tokenCost + extraCost
}

export const mediaCost = (ttsChars: number, asrSeconds: number): number =>
  ttsChars * EXTRA_PRICES.ttsChar + asrSeconds * EXTRA_PRICES.asrSecond
