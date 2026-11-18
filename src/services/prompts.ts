import { create } from 'zustand'
import { createId } from '../utils/id.js'
import { useSettings } from './settings.js'

/** 提示词模板：标题用于列表与斜杠菜单，内容为插入输入框的正文 */
export type PromptTemplate = {
  id: string
  title: string
  content: string
}

const KEY = 'chat-demo:prompts'
const MAX_COUNT = 100
const MAX_TITLE = 60
const MAX_CONTENT = 4000

/** 首次使用时按界面语言准备三条示例，之后完全由用户管理 */
const seedPrompts = (locale: 'zh-CN' | 'en-US'): PromptTemplate[] => {
  const zh: PromptTemplate[] = [
    {
      id: createId(),
      title: '翻译助手',
      content: '请把下面这段话翻译成英文，保留原意与语气：\n\n',
    },
    {
      id: createId(),
      title: '代码审查',
      content: '请审查下面这段代码，指出潜在的问题并给出改进建议：\n\n',
    },
    { id: createId(), title: '要点总结', content: '请把下面的内容总结成不超过 5 条要点：\n\n' },
  ]
  const en: PromptTemplate[] = [
    {
      id: createId(),
      title: 'Translator',
      content: 'Translate the following text into Chinese, keeping the tone:\n\n',
    },
    {
      id: createId(),
      title: 'Code review',
      content: 'Review the following code and suggest improvements:\n\n',
    },
    {
      id: createId(),
      title: 'Key points',
      content: 'Summarize the following into at most 5 bullet points:\n\n',
    },
  ]
  return locale === 'zh-CN' ? zh : en
}

const sanitize = (prompts: PromptTemplate[]): PromptTemplate[] =>
  prompts
    .filter(
      (prompt) =>
        typeof prompt.id === 'string' &&
        typeof prompt.title === 'string' &&
        typeof prompt.content === 'string' &&
        prompt.title.trim() &&
        prompt.content.trim()
    )
    .slice(0, MAX_COUNT)
    .map(({ id, title, content }) => ({
      id,
      title: title.slice(0, MAX_TITLE),
      content: content.slice(0, MAX_CONTENT),
    }))

const initialPrompts = (): PromptTemplate[] => {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === null) {
      const seeded = seedPrompts(useSettings.getState().locale)
      localStorage.setItem(KEY, JSON.stringify(seeded))
      return seeded
    }
    const parsed: unknown = JSON.parse(saved)
    return Array.isArray(parsed) ? sanitize(parsed as PromptTemplate[]) : []
  } catch {
    return []
  }
}

const save = (prompts: PromptTemplate[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(prompts))
  } catch {
    // 存储不可用时只保留内存里的提示词
  }
}

export const usePrompts = create<{ prompts: PromptTemplate[] }>(() => ({
  prompts: initialPrompts(),
}))

const { setState, getState } = usePrompts

const commit = (prompts: PromptTemplate[]) => {
  save(prompts)
  setState({ prompts })
}

export const addPrompt = (title: string, content: string) => {
  commit([
    ...getState().prompts,
    {
      id: createId(),
      title: title.trim().slice(0, MAX_TITLE),
      content: content.trim().slice(0, MAX_CONTENT),
    },
  ])
}

export const updatePrompt = (id: string, title: string, content: string) => {
  commit(
    getState().prompts.map((prompt) =>
      prompt.id === id
        ? {
            ...prompt,
            title: title.trim().slice(0, MAX_TITLE),
            content: content.trim().slice(0, MAX_CONTENT),
          }
        : prompt
    )
  )
}

export const removePrompt = (id: string) => {
  commit(getState().prompts.filter((prompt) => prompt.id !== id))
}
