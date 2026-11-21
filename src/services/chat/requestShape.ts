/** 请求体里固定的系统提示词；工具声明统一由 agent/toolPolicy 决定 */
import { BASE_SYSTEM_PROMPTS, promptLocale } from '../agent/promptI18n.js'

export const systemPromptFor = (locale: string): string =>
  BASE_SYSTEM_PROMPTS[promptLocale(locale)]
