/** 输入栏的聊天模式切换：与设置 → 模型里的模式设置共用同一份状态 */
import { useTranslate } from '../../i18n/index.js'
import { CHAT_MODES, type ChatMode } from '../../services/agent/toolConstants.js'
import { setChatMode, useSettings } from '../../services/settings.js'
import { IconCheckedOutline14, IconListOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { Menu, type MenuOption } from '../base/Menu.js'

export const MODE_LABELS = {
  chat: 'chatModeChat',
  standard: 'chatModeStandard',
  full: 'chatModeFull',
} as const

/** 聊天模式的菜单选项：独立选择器与移动端「更多」菜单共用 */
export const chatModeMenuOptions = (
  translate: (key: (typeof MODE_LABELS)[ChatMode]) => string,
  mode: ChatMode
): MenuOption[] =>
  CHAT_MODES.map((value) => ({
    key: `chat-mode-${value}`,
    label: translate(MODE_LABELS[value]),
    icon: mode === value ? <IconCheckedOutline14 /> : <span />,
    onSelect: () => setChatMode(value),
  }))

export const ChatModePicker = () => {
  const t = useTranslate()
  const mode = useSettings((state) => state.chatMode)
  return (
    <Menu options={chatModeMenuOptions(t, mode)}>
      {({ toggle, ...triggerProps }) => (
        <IconButton
          icon={<IconListOutline16 />}
          tooltip={`${t('chatMode')} · ${t(MODE_LABELS[mode])}`}
          ariaLabel={t('chatModeTooltip')}
          onClick={toggle}
          {...triggerProps}
        />
      )}
    </Menu>
  )
}
