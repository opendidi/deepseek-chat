import clsx from 'clsx'
import { errorStatus, SettingCell, SettingSwitch, type Status } from './settingsShared.js'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconChartOutline16,
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconModelOutline14,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  ArchiveDecryptError,
  BackupError,
  MAX_ENCRYPTED_ARCHIVE_BYTES,
  archiveIsEncrypted,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import type { ClientTool, ToolCategory } from '../../services/agent/tools.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import { regionCodes, getRegionName, loadProvinces, type ProvinceOption } from '../../services/location.js'
import {
  isChineseBrowser,
  setApiOrigin,
  setAgentTools,
  setAutoCompress,
  setChatMode,
  setContinueAfterRefusal,
  setFontSize,
  setLocale,
  setAmapKey,
  setLocation,
  setMaxTokens,
  setPreventWithdraw,
  setRememberApiKey,
  setSkipSafetyCheck,
  setStreamOutput,
  setSystemPrompt,
  setTemperature,
  setThemePreference,
  setTopP,
  setTtsVoice,
  toggleToolName,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { useAlive } from '../../utils/useAlive.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import { openPromptLibrary } from '../chatInput/promptLibraryState.js'
import { UsageStatsCell } from './UsageStats.js'
import { modelDisplayName } from '../../services/models.js'
import { TOOL_REGISTRY } from '../../services/agent/tools.js'
import { downloadBlob } from '../../utils/download.js'
import styles from './Settings.module.scss'

/** 统计分区按需加载：聚合逻辑与图表不进入首屏主包 */
const UsagePanel = lazy(() =>
  import('./UsagePanel.js').then((module) => ({ default: module.UsagePanel }))
)

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  {
    value: 'model',
    label: 'settingDialogAsideModelOptionLabel',
    icon: <IconModelOutline14 />,
  },
  {
    value: 'stats',
    label: 'settingDialogAsideStatsOptionLabel',
    icon: <IconChartOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
]

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyDelete.busy) {
            closeSettings()
          }
        }}
      >
        <div
          role="tablist"
          aria-label={t('settings')}
          className={styles.navigation}
          onKeyDown={(event) => {
            const current = sections.findIndex((item) => item.value === section)
            let next = current
            if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
              next = (current + 1) % sections.length
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
              next = (current - 1 + sections.length) % sections.length
            } else if (event.key === 'Home') {
              next = 0
            } else if (event.key === 'End') {
              next = sections.length - 1
            } else {
              return
            }
            event.preventDefault()
            setSection(sections[next].value)
            const tabs = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
            tabs[next]?.focus()
          }}
        >
          {sections.map((item) => (
            <button
              key={item.value}
              id={`settings-tab-${item.value}`}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              aria-controls="settings-tabpanel"
              tabIndex={section === item.value ? 0 : -1}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id="settings-tabpanel"
          aria-labelledby={`settings-tab-${section}`}
          tabIndex={0}
          className={styles.content}
        >
          {section === 'general' ? (
            <>
              <ThemeSetting />
              <LocaleSetting />
              <FontSizeSetting />
              <TtsVoiceSetting />
              <LocationSetting />
              <SystemPromptSetting />
              <ApiOriginSetting />
              <PromptLibrarySetting />
            </>
          ) : section === 'model' ? (
            <>
              <ModelSetting />
              <ChatModeSetting />
              <TemperatureSetting />
              <TopPSetting />
              <MaxTokensSetting />
              <ModelSwitches />
              <AgentToolSettings />
            </>
          ) : section === 'stats' ? (
            <Suspense fallback={<div className={styles.usageEmpty}>{t('usageLoading')}</div>}>
              <UsagePanel />
            </Suspense>
          ) : (
            <>
              <ApiKeyField editor={apiKeyEditor} />
              <RememberApiKeySetting />
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <ExportHistory disabled={historyBusy} />
              <ExportEncrypted disabled={historyBusy} />
              <UsageStatsCell />
              <SettingCell
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
              {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
            </>
          )}
        </div>
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)
  const alive = useAlive()

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      if (alive.current) {
        setOpened(false)
      }
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      if (alive.current) {
        setBusy(false)
      }
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  // 省市大表随设置弹窗懒加载；加载完成前省份下拉为空
  const [provinceOptions, setProvinceOptions] = useState<ProvinceOption[]>([])
  useEffect(() => {
    let cancelled = false
    void loadProvinces().then((options) => {
      if (!cancelled) {
        setProvinceOptions(options)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])
  const province =
    location?.region === 'CN'
      ? provinceOptions.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinceOptions.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 当前模型只读展示：切换统一走输入框工具栏的模型面板 */
const ModelSetting = () => {
  const t = useTranslate()
  const chatModel = useSettings((state) => state.chatModel)
  return (
    <SettingCell
      label={t('settingsCurrentModel')}
      description={t('settingsCurrentModelDesc')}
      status={null}
      action={<span className={styles.modelBadge}>{modelDisplayName(chatModel)}</span>}
    />
  )
}

/** 界面字号档位：小 / 中（默认）/ 大 */
const FontSizeSetting = () => {
  const t = useTranslate()
  const fontSize = useSettings((state) => state.fontSize)
  return (
    <SettingCell
      label={t('settingsFontSize')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsFontSize')}
          value={fontSize}
          options={[
            { value: 's', label: t('fontSizeSmall') },
            { value: 'm', label: t('fontSizeMedium') },
            { value: 'l', label: t('fontSizeLarge') },
          ]}
          onChange={setFontSize}
        />
      }
    />
  )
}

/** 自定义系统提示词（人设）：随每次生成请求发送 */
const SystemPromptSetting = () => {
  const t = useTranslate()
  const systemPrompt = useSettings((state) => state.systemPrompt)
  const [text, setText] = useState(systemPrompt)
  return (
    <div className={clsx(styles.cell)}>
      <div className={styles.label}>{t('settingsSystemPrompt')}</div>
      <div className={styles.description}>{t('settingsSystemPromptDesc')}</div>
      <textarea
        className={styles.textArea}
        value={text}
        placeholder={t('settingsSystemPromptPlaceholder')}
        maxLength={2000}
        rows={3}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => setSystemPrompt(text)}
      />
    </div>
  )
}

/** 数字设置项的公共实现：留空恢复服务端默认（null），非法输入报错；
 * clamp 模式把区间外的值收敛到 [min, max]（温度 / Top P），非 clamp 模式下小于 min 报错（最大输出） */
const NumberField = ({
  labelKey,
  descKey,
  value,
  setValue,
  min,
  max,
  clamp = false,
  integer = false,
}: {
  labelKey: TranslationKey
  descKey: TranslationKey
  value: number | null
  setValue: (value: number | null) => void
  min: number
  max: number
  clamp?: boolean
  integer?: boolean
}) => {
  const t = useTranslate()
  const [text, setText] = useState(() => (value === null ? '' : String(value)))
  const [error, setError] = useState(false)
  const commit = () => {
    const trimmed = text.trim()
    if (!trimmed) {
      setValue(null)
      setError(false)
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || (!clamp && parsed < min)) {
      setError(true)
      return
    }
    // 范围外的值不弹错，直接收敛到合法区间
    const next = integer
      ? Math.floor(parsed)
      : clamp
        ? Math.min(max, Math.max(min, parsed))
        : parsed
    setValue(next)
    setText(String(next))
    setError(false)
  }
  return (
    <SettingCell
      label={t(labelKey)}
      description={t(descKey)}
      status={error ? { key: 'settingsInvalidNumber', error: true } : null}
      action={
        <input
          className={styles.numberInput}
          aria-label={t(labelKey)}
          inputMode={integer ? 'numeric' : 'decimal'}
          placeholder={t('settingsDefaultPlaceholder')}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setError(false)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
            }
          }}
        />
      }
    />
  )
}

/** Top P：与温度一样留空使用服务端默认值，范围 0.01–1 */
const TopPSetting = () => {
  const topP = useSettings((state) => state.topP)
  return (
    <NumberField
      labelKey="settingsTopP"
      descKey="settingsTopPDesc"
      value={topP}
      setValue={setTopP}
      min={0.01}
      max={1}
      clamp
    />
  )
}

/** 模型页的行为开关：每一项都对应请求组装或渲染链路上的真实分支 */
const MODEL_SWITCH_FIELDS = [
  {
    field: 'streamOutput',
    label: 'settingsStreamOutput',
    desc: 'settingsStreamOutputDesc',
    set: setStreamOutput,
  },
  {
    field: 'preventWithdraw',
    label: 'settingsPreventWithdraw',
    desc: 'settingsPreventWithdrawDesc',
    set: setPreventWithdraw,
  },
  {
    field: 'skipSafetyCheck',
    label: 'settingsSkipSafetyCheck',
    desc: 'settingsSkipSafetyCheckDesc',
    set: setSkipSafetyCheck,
  },
  {
    field: 'autoCompress',
    label: 'settingsAutoCompress',
    desc: 'settingsAutoCompressDesc',
    set: setAutoCompress,
  },
  {
    field: 'continueAfterRefusal',
    label: 'settingsContinueAfterRefusal',
    desc: 'settingsContinueAfterRefusalDesc',
    set: setContinueAfterRefusal,
  },
  {
    field: 'agentTools',
    label: 'settingsAgentTools',
    desc: 'settingsAgentToolsDesc',
    set: setAgentTools,
  },
] as const

const ModelSwitches = () => {
  const t = useTranslate()
  const settings = useSettings()
  return (
    <>
      {MODEL_SWITCH_FIELDS.map((item) => (
        <SettingSwitch
          key={item.field}
          label={t(item.label)}
          description={t(item.desc)}
          checked={settings[item.field]}
          onChange={item.set}
        />
      ))}
    </>
  )
}

/** 聊天模式：决定实际下发给模型的工具集；输入栏也能直接切换 */
const ChatModeSetting = () => {
  const t = useTranslate()
  const chatMode = useSettings((state) => state.chatMode)
  return (
    <SettingCell
      label={t('settingsChatMode')}
      description={t('settingsChatModeDesc')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsChatMode')}
          value={chatMode}
          options={[
            { value: 'chat', label: t('chatModeChat') },
            { value: 'standard', label: t('chatModeStandard') },
            { value: 'full', label: t('chatModeFull') },
          ]}
          onChange={setChatMode}
        />
      }
    />
  )
}

const TOOL_LABEL_KEYS: Record<string, TranslationKey> = {
  get_current_time: 'toolNameGetCurrentTime',
  calculate: 'toolNameCalculate',
  get_page_context: 'toolNameGetPageContext',
  amap_place_search: 'toolNameAmapPlaceSearch',
  amap_geocode: 'toolNameAmapGeocode',
  amap_weather: 'toolNameAmapWeather',
  amap_route_planning: 'toolNameAmapRoutePlanning',
}

const TOOL_CATEGORY_KEYS = {
  basic: 'toolCategoryBasic',
  browser: 'toolCategoryBrowser',
  map: 'toolCategoryMap',
  workspace: 'toolCategoryWorkspace',
} as const

/** 按工具粒度授权；工具按分类分块展示，读取页面内容的工具默认关闭 */
const AgentToolSettings = () => {
  const t = useTranslate()
  const enabled = useSettings((state) => state.enabledToolNames)
  const amapKey = useSettings((state) => state.amapKey)
  const [keyDraft, setKeyDraft] = useState(amapKey)
  // 按分类分组，保持注册表顺序
  const groups = useMemo(() => {
    const map = new Map<ToolCategory, ClientTool[]>()
    for (const tool of TOOL_REGISTRY) {
      const list = map.get(tool.category) ?? []
      list.push(tool)
      map.set(tool.category, list)
    }
    return [...map.entries()]
  }, [])
  const commitKey = () => {
    if (keyDraft.trim() !== amapKey) {
      setAmapKey(keyDraft)
    }
  }
  return (
    <div className={styles.cell}>
      <div className={styles.label}>{t('settingsAgentToolsTitle')}</div>
      <div className={styles.description}>{t('settingsAgentToolsDesc')}</div>
      {groups.map(([category, tools]) => (
        <div key={category} className={styles.toolGroup}>
          <div className={styles.toolGroupTitle}>{t(TOOL_CATEGORY_KEYS[category])}</div>
          {tools.map((tool) => (
            <SettingSwitch
              key={tool.name}
              label={t(TOOL_LABEL_KEYS[tool.name] ?? 'settingsAgentToolsTitle')}
              description={
                tool.requiresConsent ? `${t(TOOL_CATEGORY_KEYS[tool.category])} · ${t('toolRequiresConsent')}` : undefined
              }
              checked={enabled.includes(tool.name)}
              onChange={(value) => toggleToolName(tool.name, value)}
            />
          ))}
          {category === 'map' ? (
            <div className={styles.amapKeyBlock}>
              <div className={clsx(styles.description, styles.amapKeyHint)}>
                {t('settingsAmapKeyDesc')}
              </div>
              <input
                type="text"
                className={styles.textInput}
                autoComplete="off"
                spellCheck={false}
                placeholder="在高德开放平台创建「Web 服务」Key 后粘贴"
                value={keyDraft}
                onChange={(event) => setKeyDraft(event.target.value)}
                onBlur={commitKey}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitKey()
                  }
                }}
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

const TemperatureSetting = () => {
  const temperature = useSettings((state) => state.temperature)
  return (
    <NumberField
      labelKey="settingsTemperature"
      descKey="settingsTemperatureDesc"
      value={temperature}
      setValue={setTemperature}
      min={0}
      max={2}
      clamp
    />
  )
}

const MaxTokensSetting = () => {
  const maxTokens = useSettings((state) => state.maxTokens)
  return (
    <NumberField
      labelKey="settingsMaxTokens"
      descKey="settingsMaxTokensDesc"
      value={maxTokens}
      setValue={setMaxTokens}
      min={1}
      max={Number.POSITIVE_INFINITY}
      integer
    />
  )
}

/** 自定义 API 服务地址；留空使用构建期默认地址 */
const ApiOriginSetting = () => {
  const t = useTranslate()
  const apiOrigin = useSettings((state) => state.apiOrigin)
  const [text, setText] = useState(apiOrigin ?? '')
  const [error, setError] = useState(false)
  const commit = () => {
    const trimmed = text.trim()
    if (trimmed && !/^https?:\/\/.+/i.test(trimmed)) {
      setError(true)
      return
    }
    setApiOrigin(text)
    setError(false)
  }
  return (
    <SettingCell
      label={t('settingsApiOrigin')}
      description={t('settingsApiOriginDesc')}
      status={error ? { key: 'settingsApiOriginInvalid', error: true } : null}
      action={
        <input
          className={clsx(styles.textInput, styles.originInput)}
          aria-label={t('settingsApiOrigin')}
          type="url"
          spellCheck={false}
          placeholder="https://api.deepseek.com"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setError(false)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
            }
          }}
        />
      }
    />
  )
}

/** 提示词库入口：与输入框斜杠菜单共用同一个管理弹窗 */
const PromptLibrarySetting = () => {
  const t = useTranslate()
  return (
    <SettingCell
      label={t('promptLibrary')}
      description={t('settingsPromptLibraryDesc')}
      status={null}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          onClick={openPromptLibrary}
        >
          {t('view')}
        </Button>
      }
    />
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上；加密容器需先输入解密密码 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  const needPassword = historyImport.encrypted
  const ready = !needPassword || historyImport.password.trim() !== ''
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button
            variant="dangerOutlined"
            size="m"
            disabled={!ready}
            onClick={() => void historyImport.confirm()}
          >
            {needPassword ? t('importEncryptedConfirm') : t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
      {needPassword ? (
        <input
          className={clsx(styles.textInput, styles.importPassword)}
          type="password"
          aria-label={t('importEncryptedPassword')}
          placeholder={t('importEncryptedPassword')}
          value={historyImport.password}
          autoFocus
          onChange={(event) => historyImport.setPassword(event.target.value)}
        />
      ) : null}
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 关闭后 API Key 只在内存中，刷新页面即需重新输入。 */
const RememberApiKeySetting = () => {
  const t = useTranslate()
  const remember = useSettings((state) => state.rememberApiKey)
  return (
    <SettingCell
      label={t('apiKeyRemember')}
      description={t('apiKeyRememberDesc')}
      status={null}
      action={
        <button
          type="button"
          role="switch"
          aria-checked={remember}
          aria-label={t('apiKeyRemember')}
          className={clsx(styles.switch, remember && styles.switchOn)}
          onClick={() => setRememberApiKey(!remember)}
        >
          <span className={styles.switchThumb} />
        </button>
      }
    />
  )
}

/** 选文件后先提示覆盖（加密容器先输密码）；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [encrypted, setEncrypted] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)
  const alive = useAlive()

  const select = (selected: File | null) => {
    setFile(null)
    setEncrypted(false)
    setPassword('')
    if (!selected) {
      return
    }
    if (selected.size > MAX_ENCRYPTED_ARCHIVE_BYTES) {
      setStatus({ key: 'historyImportTooLarge', error: true })
      return
    }
    setFile(selected)
    void archiveIsEncrypted(selected)
      .then((value) => {
        if (alive.current) {
          setEncrypted(value)
        }
      })
      .catch(() => {
        if (alive.current) {
          setEncrypted(false)
          setStatus({ key: 'historyImportFailed', error: true })
        }
      })
  }

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    const target = file
    const key = password
    setFile(null)
    setBusy(true)
    setStatus(null)
    try {
      const count = await importHistory(target, key)
      if (alive.current) {
        setStatus({
          key: count === 1 ? 'historyImportedOne' : 'historyImported',
          params: { count },
        })
      }
    } catch (error) {
      if (alive.current) {
        setStatus(
          error instanceof ArchiveDecryptError
            ? { key: 'importWrongPassword', error: true }
            : error instanceof BackupError
              ? { key: error.key, error: true }
              : { key: 'historyImportFailed', error: true }
        )
      }
    } finally {
      importing.current = false
      if (alive.current) {
        setBusy(false)
      }
    }
  }

  return {
    file,
    encrypted,
    password,
    setPassword,
    busy,
    status,
    select,
    cancel: () => select(null),
    confirm,
  }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,.enc,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 导出任务的公共状态：busy、结果文案与弹窗关闭后的存活检查，两个导出入口共用 */
const useExportTask = () => {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const alive = useAlive()
  const run = async (task: (signal: { alive: () => boolean }) => Promise<void>) => {
    setBusy(true)
    setStatus(null)
    try {
      await task({ alive: () => alive.current })
    } catch (error) {
      if (alive.current) {
        setStatus(errorStatus('historyExportFailed', error))
      }
    } finally {
      if (alive.current) {
        setBusy(false)
      }
    }
  }
  return { busy, status, setStatus, run }
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const { busy, status, run } = useExportTask()

  const onExport = () =>
    run(async () => {
      const { name, blob } = await exportHistory()
      // 下载是用户发起的副作用，即使弹窗已关闭也应完成
      downloadBlob(name, blob)
    })

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}

/** 加密导出：设置密码（可留空，留空即普通 ZIP）后下载 */
const ExportEncrypted = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [password, setPassword] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const { busy, status, setStatus, run } = useExportTask()

  const mismatch = confirmText !== '' && password !== confirmText
  const ready = password === '' || (confirmText !== '' && password === confirmText)

  const onExport = () =>
    run(async ({ alive }) => {
      const { name, blob } = await exportHistory({ password: password || undefined })
      // 下载是用户发起的副作用，即使弹窗已关闭也应完成
      downloadBlob(name, blob)
      if (alive()) {
        setStatus({ key: 'exportEncryptedDone' })
      }
    })

  return (
    <div className={styles.cell}>
      <div className={styles.label}>{t('exportEncrypted')}</div>
      <div className={styles.description}>{t('exportEncryptedDesc')}</div>
      <div className={styles.exportFields}>
        <input
          className={styles.textInput}
          type="password"
          aria-label={t('exportEncrypted')}
          placeholder={t('exportPasswordPlaceholder')}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {password ? (
          <input
            className={styles.textInput}
            type="password"
            aria-label={t('exportPasswordConfirm')}
            placeholder={t('exportPasswordConfirm')}
            autoComplete="new-password"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
          />
        ) : null}
        {mismatch ? (
          <div className={clsx(styles.description, styles.error)}>
            {t('exportPasswordMismatch')}
          </div>
        ) : null}
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty || !ready}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
        {status ? (
          <div className={clsx(styles.description, status.error && styles.error)}>
            {t(status.key, status.params)}
          </div>
        ) : null}
      </div>
    </div>
  )
}
