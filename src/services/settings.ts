import './storageKeys.js'
import { create } from 'zustand'
import type { ChatModel } from './api/types.js'
import type { TtsVoice } from './api/speech.js'
import { isSafeModelId } from '../utils/modelId.js'
import { normalizeLocation, parseLocationShape, type UserLocation } from './location.js'
import {
  ALL_TOOL_NAMES,
  AMAP_TOOL_NAMES,
  DEFAULT_TOOL_NAMES,
  type ChatMode,
} from './agent/toolConstants.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 界面整体字号档位；默认中等 */
export type FontSizePreference = 's' | 'm' | 'l'

/**
 * 推理强度：请求时映射为 output_config.effort。
 * 上游实际只有 low/high/max 三档；界面上的「关闭」是 thinking=false，不是 effort 值。
 */
export type ReasoningEffort = 'low' | 'high' | 'max'

/** 界面的四档：off=关闭思考，其余三档对应 reasoningEffort */
export type EffortLevel = 'off' | ReasoningEffort

/** 把「思考开关 + 强度」归一成界面档位 */
export const effortLevel = (thinking: boolean, effort: ReasoningEffort): EffortLevel =>
  thinking ? effort : 'off'

/** 把界面档位还原成思考开关与强度；关闭时保留原强度，方便重新打开时恢复 */
export const applyEffortLevel = (
  level: EffortLevel,
  current: ReasoningEffort
): { thinking: boolean; reasoningEffort: ReasoningEffort } =>
  level === 'off'
    ? { thinking: false, reasoningEffort: current }
    : { thinking: true, reasoningEffort: level }

import './storageKeys.js'

/** 本机设置，存 localStorage：语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态。模型 API Key 已移至服务端 .env。 */
type Settings = {
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  /** 推理强度；思考关闭时不生效。默认 high 与服务端默认行为一致 */
  reasoningEffort: ReasoningEffort
  search: boolean
  siderCollapsed: boolean
  /** 聊天模型，默认 deepseek-flash */
  chatModel: ChatModel
  /** 采样温度；null 使用服务端默认值，范围 0–2 */
  temperature: number | null
  /** 核采样阈值；null 使用服务端默认值，范围 0.01–1 */
  topP: number | null
  /** 单次回复的最大输出 Token；null 使用服务端默认值 */
  maxTokens: number | null
  /** 逐字显示回复；关闭后等完整回复生成完再一次性显示 */
  streamOutput: boolean
  /** 安全拒绝时保留已下发的正文与思维链，不按协议丢弃 */
  preventWithdraw: boolean
  /** 请求不携带 safety_check 字段 */
  skipSafetyCheck: boolean
  /** 安全拒绝的回复也允许继续生成 */
  continueAfterRefusal: boolean
  /** 长会话请求前把较早轮次折叠成本地摘要，只影响本次请求 */
  autoCompress: boolean
  /** 允许模型调用浏览器端工具并自动执行多轮工具往返 */
  agentTools: boolean
  /** 输入栏聊天模式：仅聊天 / 标准 / 完整，决定实际下发的工具集 */
  chatMode: ChatMode
  /** 按工具粒度开启的客户端工具名；需要授权的页面工具默认关闭 */
  enabledToolNames: string[]
  /** 被禁用的 MCP 工具名（mcp__ 前缀）；空数组表示全部启用 */
  mcpDisabledTools: string[]
  /** 用量统计里服务端搜索/抓取是否按官方新规则免费 */
  usageFreeServerTools: boolean
  /** 今日预估费用达到该金额时提醒一次（¥）；0 表示关闭 */
  usageDailyQuota: number
  /** 自定义 API 服务地址；null 使用构建期默认值 */
  /** 自定义系统提示词（人设），随每次请求发送；空串表示未设置 */
  systemPrompt: string
  /** 界面字号档位，默认中等 */
  fontSize: FontSizePreference
}

const KEYS = {
  locale: 'deepseek-chat:locale',
  location: 'deepseek-chat:location',
  themePreference: 'deepseek-chat:theme-preference',
  ttsVoice: 'deepseek-chat:tts-voice',
  thinking: 'deepseek-chat:thinking',
  reasoningEffort: 'deepseek-chat:reasoning-effort',
  search: 'deepseek-chat:search',
  siderCollapsed: 'deepseek-chat:sider-collapsed',
  chatModel: 'deepseek-chat:chat-model',
  temperature: 'deepseek-chat:temperature',
  topP: 'deepseek-chat:top-p',
  maxTokens: 'deepseek-chat:max-tokens',
  streamOutput: 'deepseek-chat:stream-output',
  preventWithdraw: 'deepseek-chat:prevent-withdraw',
  skipSafetyCheck: 'deepseek-chat:skip-safety-check',
  continueAfterRefusal: 'deepseek-chat:continue-after-refusal',
  autoCompress: 'deepseek-chat:auto-compress',
  agentTools: 'deepseek-chat:agent-tools',
  chatMode: 'deepseek-chat:chat-mode',
  enabledToolNames: 'deepseek-chat:enabled-tool-names',
  mcpDisabledTools: 'deepseek-chat:mcp-disabled-tools',
  /** 用户显式关闭过的地图工具：服务器配置了 Key 也不再自动开启 */
  amapOptOut: 'deepseek-chat:amap-optout',
  usageFreeServerTools: 'deepseek-chat:usage-free-server-tools',
  usageDailyQuota: 'deepseek-chat:usage-daily-quota',
  systemPrompt: 'deepseek-chat:system-prompt',
  fontSize: 'deepseek-chat:font-size',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

/**
 * 初始位置走同步的结构校验（省市大表是懒加载的），保存过的值写入前已完整校验过；
 * 随后由下方 useSettings 创建后的异步复核兜底，清掉手改 localStorage 之类的坏数据。
 */
const initialLocation = (): UserLocation | null => {
  try {
    const location = parseLocationShape(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 未保存过或值异常时用默认模型；云端拉取的模型 id 直接保留 */
const initialChatModel = (): ChatModel => {
  const saved = read(KEYS.chatModel)?.trim()
  return saved && isSafeModelId(saved) ? saved : 'deepseek-flash'
}

const initialTemperature = (): number | null => {
  // 未保存过时为 null，Number(null) 是 0 会误判成有效温度，先判空
  const saved = read(KEYS.temperature)
  if (saved === null || saved.trim() === '') {
    return null
  }
  const value = Number(saved)
  return Number.isFinite(value) && value >= 0 && value <= 2 ? value : null
}

const initialTopP = (): number | null => {
  const saved = read(KEYS.topP)
  if (saved === null || saved.trim() === '') {
    return null
  }
  const value = Number(saved)
  return Number.isFinite(value) && value >= 0.01 && value <= 1 ? value : null
}

/** 布尔开关：未保存过时走默认值，避免升级后行为突变 */
const initialFlag = (key: string, fallback: boolean): boolean => {
  const saved = read(key)
  return saved === 'true' ? true : saved === 'false' ? false : fallback
}

const initialMaxTokens = (): number | null => {
  const saved = read(KEYS.maxTokens)
  if (saved === null || saved.trim() === '') {
    return null
  }
  const value = Number(saved)
  return Number.isInteger(value) && value > 0 ? value : null
}

const initialSystemPrompt = (): string => read(KEYS.systemPrompt) ?? ''

const initialFontSize = (): FontSizePreference => {
  const saved = read(KEYS.fontSize)
  return saved === 's' || saved === 'l' ? saved : 'm'
}

const REASONING_EFFORTS: readonly ReasoningEffort[] = ['low', 'high', 'max']

const initialReasoningEffort = (): ReasoningEffort => {
  const saved = read(KEYS.reasoningEffort)
  // 旧版本的 medium 档已移除，迁移到 high（两者上游映射相同）
  if (saved === 'medium') {
    write(KEYS.reasoningEffort, 'high')
    return 'high'
  }
  return REASONING_EFFORTS.includes(saved as ReasoningEffort)
    ? (saved as ReasoningEffort)
    : 'high'
}

const initialMcpDisabledTools = (): string[] => {
  const raw = read(KEYS.mcpDisabledTools)
  if (!raw) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === 'string' && name.startsWith('mcp__'))
      : []
  } catch {
    return []
  }
}

const initialChatMode = (): ChatMode => {
  const saved = read(KEYS.chatMode)
  return saved === 'chat' || saved === 'full' ? saved : 'standard'
}

/** 只接受注册表里的工具名；无配置时给默认名单，需要授权的页面工具不默认开启 */
const initialEnabledTools = (): string[] => {
  const raw = read(KEYS.enabledToolNames)
  if (!raw) {
    return [...DEFAULT_TOOL_NAMES]
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? ALL_TOOL_NAMES.filter((name) => parsed.includes(name))
      : [...DEFAULT_TOOL_NAMES]
  } catch {
    return [...DEFAULT_TOOL_NAMES]
  }
}

// 清理旧版本残留在 localStorage 的明文 Key：Key 现在只存服务端 .env，浏览器不应再保留副本。
try {
  write('deepseek-chat:api-key', null)
  write('deepseek-chat:remember-api-key', null)
} catch {
  // 存储不可用时不阻塞启动
}

const savedLocation = initialLocation()

export const useSettings = create<Settings>(() => ({
  locale: initialLocale(),
  location: savedLocation,
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  reasoningEffort: initialReasoningEffort(),
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  chatModel: initialChatModel(),
  temperature: initialTemperature(),
  topP: initialTopP(),
  maxTokens: initialMaxTokens(),
  streamOutput: initialFlag(KEYS.streamOutput, true),
  preventWithdraw: initialFlag(KEYS.preventWithdraw, false),
  skipSafetyCheck: initialFlag(KEYS.skipSafetyCheck, false),
  continueAfterRefusal: initialFlag(KEYS.continueAfterRefusal, false),
  autoCompress: initialFlag(KEYS.autoCompress, false),
  agentTools: initialFlag(KEYS.agentTools, false),
  chatMode: initialChatMode(),
  enabledToolNames: initialEnabledTools(),
  mcpDisabledTools: initialMcpDisabledTools(),
  usageFreeServerTools: initialFlag(KEYS.usageFreeServerTools, true),
  usageDailyQuota: Math.max(0, Number(read(KEYS.usageDailyQuota)) || 0),
  systemPrompt: initialSystemPrompt(),
  fontSize: initialFontSize(),
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

// 省市大表加载后复核初始位置：结构校验放过的坏数据（如手改的 localStorage）在这里清掉
if (savedLocation?.province !== undefined) {
  void normalizeLocation(savedLocation).then((location) => {
    if (!location && useSettings.getState().location === savedLocation) {
      useSettings.setState({ location: null })
    }
  })
}

export const setLocation = (value: UserLocation | null) => {
  // 完整校验要查省市大表（异步）；来源是设置里已加载的选项列表，正常必然通过
  void normalizeLocation(value).then((location) => {
    write(KEYS.location, location ? JSON.stringify(location) : null)
    useSettings.setState({ location })
  })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setReasoningEffort = (reasoningEffort: ReasoningEffort) => {
  write(KEYS.reasoningEffort, reasoningEffort)
  useSettings.setState({ reasoningEffort })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setChatModel = (chatModel: ChatModel) => {
  write(KEYS.chatModel, chatModel)
  useSettings.setState({ chatModel })
}

export const setTemperature = (temperature: number | null) => {
  write(KEYS.temperature, temperature === null ? null : String(temperature))
  useSettings.setState({ temperature })
}

export const setTopP = (topP: number | null) => {
  write(KEYS.topP, topP === null ? null : String(topP))
  useSettings.setState({ topP })
}

export const setStreamOutput = (streamOutput: boolean) => {
  write(KEYS.streamOutput, String(streamOutput))
  useSettings.setState({ streamOutput })
}

export const setPreventWithdraw = (preventWithdraw: boolean) => {
  write(KEYS.preventWithdraw, String(preventWithdraw))
  useSettings.setState({ preventWithdraw })
}

export const setSkipSafetyCheck = (skipSafetyCheck: boolean) => {
  write(KEYS.skipSafetyCheck, String(skipSafetyCheck))
  useSettings.setState({ skipSafetyCheck })
}

export const setContinueAfterRefusal = (continueAfterRefusal: boolean) => {
  write(KEYS.continueAfterRefusal, String(continueAfterRefusal))
  useSettings.setState({ continueAfterRefusal })
}

export const setAutoCompress = (autoCompress: boolean) => {
  write(KEYS.autoCompress, String(autoCompress))
  useSettings.setState({ autoCompress })
}

/**
 * 服务器配置了 AMAP_KEY 时自动启用地图工具：
 * 每次启动按服务器回报同步一次，用户显式关闭过的工具保持关闭。
 */
export const syncAmapToolAvailability = (serverAmapConfigured: boolean) => {
  if (!serverAmapConfigured) {
    return
  }
  let optOut: string[] = []
  try {
    const parsed: unknown = JSON.parse(read(KEYS.amapOptOut) ?? '[]')
    optOut = Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === 'string')
      : []
  } catch {
    optOut = []
  }
  const missing = AMAP_TOOL_NAMES.filter(
    (name) => !useSettings.getState().enabledToolNames.includes(name) && !optOut.includes(name)
  )
  if (missing.length === 0) {
    return
  }
  const merged = [...useSettings.getState().enabledToolNames, ...missing]
  write(KEYS.enabledToolNames, JSON.stringify(merged))
  useSettings.setState({ enabledToolNames: merged })
}

/** 用户显式关闭地图工具时记录，避免自动同步反复开启 */
export const setAmapToolOptOut = (name: string) => {
  try {
    const parsed: unknown = JSON.parse(read(KEYS.amapOptOut) ?? '[]')
    const list = Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === 'string')
      : []
    if (!list.includes(name)) {
      list.push(name)
      write(KEYS.amapOptOut, JSON.stringify(list))
    }
  } catch {
    // 存储不可用时跳过记录
  }
}

export const setAgentTools = (agentTools: boolean) => {
  write(KEYS.agentTools, String(agentTools))
  useSettings.setState({ agentTools })
}

export const setChatMode = (chatMode: ChatMode) => {
  write(KEYS.chatMode, chatMode)
  useSettings.setState({ chatMode })
}

export const setEnabledToolNames = (enabledToolNames: string[]) => {
  const names = ALL_TOOL_NAMES.filter((name) => enabledToolNames.includes(name))
  write(KEYS.enabledToolNames, JSON.stringify(names))
  useSettings.setState({ enabledToolNames: names })
}

export const setMcpDisabledTools = (mcpDisabledTools: string[]) => {
  const names = [...new Set(mcpDisabledTools.filter((name) => name.startsWith('mcp__')))]
  write(KEYS.mcpDisabledTools, JSON.stringify(names))
  useSettings.setState({ mcpDisabledTools: names })
}

export const toggleMcpTool = (name: string, enabled: boolean) => {
  const current = useSettings.getState().mcpDisabledTools
  const next = enabled ? current.filter((item) => item !== name) : [...new Set([...current, name])]
  setMcpDisabledTools(next)
}

/** 按工具粒度开关；顺序始终与注册表一致 */
export const toggleToolName = (name: string, enabled: boolean) => {
  const current = useSettings.getState().enabledToolNames
  setEnabledToolNames(
    enabled ? [...new Set([...current, name])] : current.filter((item) => item !== name)
  )
}

export const setUsageFreeServerTools = (usageFreeServerTools: boolean) => {
  write(KEYS.usageFreeServerTools, String(usageFreeServerTools))
  useSettings.setState({ usageFreeServerTools })
}

/** 每日费用提醒额度；0 关闭，负数与非法值归零 */
export const setUsageDailyQuota = (quota: number) => {
  const value = Number.isFinite(quota) ? Math.max(0, Math.round(quota * 100) / 100) : 0
  write(KEYS.usageDailyQuota, String(value))
  useSettings.setState({ usageDailyQuota: value })
}

export const setMaxTokens = (maxTokens: number | null) => {
  write(KEYS.maxTokens, maxTokens === null ? null : String(maxTokens))
  useSettings.setState({ maxTokens })
}

/** 传 null 恢复构建期默认地址 */
export const setSystemPrompt = (systemPrompt: string) => {
  const trimmed = systemPrompt.trim()
  write(KEYS.systemPrompt, trimmed || null)
  useSettings.setState({ systemPrompt: trimmed })
}

export const setFontSize = (fontSize: FontSizePreference) => {
  write(KEYS.fontSize, fontSize)
  useSettings.setState({ fontSize })
}
