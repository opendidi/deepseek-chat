declare module '*.module.scss' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.scss' {}

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {}

/** 公开 API 的地址，见 rspack.config.ts 的 createConfig */
declare const __API_ORIGIN__: string

/** 是否注册 Service Worker（仅生产构建为 true） */
declare const __ENABLE_SW__: boolean

/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}

/** @emoji-mart/react 是 Web Component 的 React 包装；包内没有可用的 TS 声明，在此补齐常用 props */
declare module '@emoji-mart/react' {
  export type EmojiMartEmoji = {
    id?: string
    name?: string
    native?: string
    unified?: string
    keywords?: string[]
    shortcodes?: string
    skin?: number
  }

  export type PickerProps = {
    data: unknown
    i18n?: Record<string, unknown>
    onEmojiSelect?: (emoji: EmojiMartEmoji) => void
    onClickOutside?: (event: MouseEvent) => void
    onAddCustomEmoji?: (emoji: unknown) => void
    theme?: 'light' | 'dark' | 'auto'
    locale?: string
    set?: 'native' | 'apple' | 'facebook' | 'google' | 'twitter'
    previewPosition?: 'default' | 'top' | 'bottom' | 'none'
    skinTonePosition?: 'preview' | 'search' | 'none'
    navPosition?: 'top' | 'bottom' | 'none'
    perLine?: number
    maxFrequentRows?: number
    emojiSize?: number
    emojiButtonSize?: number
    dynamicWidth?: boolean
    autoFocus?: boolean
    noCountryFlags?: boolean
    categories?: string[]
    skin?: number | string
    color?: string
  }

  const Picker: import('react').ComponentType<PickerProps>
  export default Picker
}

/** @emoji-mart/data 运行时导出的是 JSON，包内 .d.ts 只声明了接口类型 */
declare module '@emoji-mart/data' {
  const data: {
    categories: { id: string; emojis: string[] }[]
    emojis: Record<string, unknown>
    aliases: Record<string, string>
    sheet: { cols: number; rows: number }
  }
  export default data
}
