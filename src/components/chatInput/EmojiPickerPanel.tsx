import { memo } from 'react'
import data from '@emoji-mart/data'
import Picker from '@emoji-mart/react'
import { useTheme } from '../../app/theme.js'
import { useIsMobile } from '../../app/viewport.js'
import { useSettings } from '../../services/settings.js'

type EmojiSelection = { native?: string }

/** 中文界面文案内置，否则 emoji-mart 会去 jsdelivr CDN 拉取语言包 */
const ZH_I18N = {
  search: '搜索',
  search_no_results_1: '哦不！',
  search_no_results_2: '没有找到相关表情',
  pick: '选择一个表情…',
  add_custom: '添加自定义表情',
  categories: {
    activity: '活动',
    custom: '自定义',
    flags: '旗帜',
    foods: '食物与饮品',
    frequent: '最近使用',
    nature: '动物与自然',
    objects: '物品',
    people: '表情与角色',
    places: '旅行与景点',
    search: '搜索结果',
    symbols: '符号',
  },
  skins: {
    choose: '选择默认肤色',
    1: '默认',
    2: '白色',
    3: '偏白',
    4: '中等',
    5: '偏黑',
    6: '黑色',
  },
}

/**
 * 懒加载的 emoji-mart 面板。
 * 使用 native 表情集，不依赖任何 CDN 雪碧图，离线与 file:// 打开时同样可用；
 * memo 让输入框文字变化时不会触发 Picker.update 重建面板。
 */
export const EmojiPickerPanel = memo(function EmojiPickerPanel({
  onSelect,
}: {
  onSelect: (emoji: string) => void
}) {
  const theme = useTheme()
  const locale = useSettings((state) => state.locale)
  const isMobile = useIsMobile()

  return (
    <Picker
      data={data}
      onEmojiSelect={(emoji: EmojiSelection) => {
        if (emoji.native) {
          onSelect(emoji.native)
        }
      }}
      theme={theme}
      locale={locale === 'zh-CN' ? 'zh' : 'en'}
      i18n={locale === 'zh-CN' ? ZH_I18N : undefined}
      set="native"
      previewPosition="none"
      skinTonePosition="search"
      maxFrequentRows={isMobile ? 1 : 2}
      // 移动端面板宽度跟随视口，交给 Picker 按容器宽度算每行列数，避免固定 300px 溢出
      dynamicWidth={isMobile}
      perLine={8}
      emojiSize={isMobile ? 24 : 22}
      emojiButtonSize={isMobile ? 36 : 34}
      autoFocus={!isMobile}
    />
  )
})
