import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { ApiError } from '../../services/api/client.js'
import type { ChatModel } from '../../services/api/types.js'
import {
  applyEffortLevel,
  effortLevel,
  setReasoningEffort,
  setThinking,
  useSettings,
  type EffortLevel,
} from '../../services/settings.js'
import {
  BUILTIN_MODELS,
  fetchCloudModels,
  formatModelPrices,
  modelDisplayName,
  type ModelInfo,
} from '../../services/models.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconModelOutline14,
  IconRefreshOutline16,
} from '../base/icons.js'
import { Tooltip } from '../base/Tooltip.js'
import styles from './ModelPicker.module.scss'

const LEVELS: readonly EffortLevel[] = ['off', 'low', 'high', 'max']
/** 紧凑面板与触发按钮的档位名：关闭用中文，其余用英文（贴近参考图） */
const EFFORT_SHORT: Record<EffortLevel, string> = {
  off: '关闭',
  low: 'Low',
  high: 'High',
  max: 'Max',
}
/** 档位对应的配色类，驱动滑块的渐变与星点 */
const EFFORT_CLASS: Record<EffortLevel, string> = {
  off: 'effortOff',
  low: 'effortLow',
  high: 'effortHigh',
  max: 'effortMax',
}

/** 模型选择：触发按钮上方弹出完整面板，内置列表可与 GET /models 的云端列表互换 */
export const ModelPicker = ({
  chatModel,
  onPick,
}: {
  chatModel: ChatModel
  onPick: (model: ChatModel) => void
}) => {
  const t = useTranslate()
  const thinking = useSettings((state) => state.thinking)
  const reasoningEffort = useSettings((state) => state.reasoningEffort)
  const level = effortLevel(thinking, reasoningEffort)
  const levelIndex = LEVELS.indexOf(level)

  const changeLevel = (next: EffortLevel) => {
    const applied = applyEffortLevel(next, reasoningEffort)
    setThinking(applied.thinking)
    setReasoningEffort(applied.reasoningEffort)
  }
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'compact' | 'models'>('compact')
  const [source, setSource] = useState<'builtin' | 'cloud'>('builtin')
  const [cloudModels, setCloudModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { side: 'top', align: 'start', offset: 8, measureKey: `${view}:${source}` }
  )
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false))

  useEffect(() => () => abortRef.current?.abort(), [])

  const models = source === 'cloud' && cloudModels.length > 0 ? cloudModels : BUILTIN_MODELS

  const fetchFromCloud = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const list = await fetchCloudModels(controller.signal)
      if (controller.signal.aborted) {
        return
      }
      if (list.length === 0) {
        setError(t('modelCloudEmpty'))
        return
      }
      setCloudModels(list)
      setSource('cloud')
    } catch (cause) {
      if (!controller.signal.aborted) {
        // 请求失败不影响内置列表，面板继续可用
        setError(
          cause instanceof ApiError && cause.kind === 'keyMissing'
            ? t('serverKeyMissing')
            : t('modelFetchFailed')
        )
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }
    }
  }

  return (
    <>
      <span ref={anchorRef} className={styles.anchor}>
        <Tooltip content={open ? '' : t('modelSwitch')}>
          <button
            type="button"
            className={clsx(styles.trigger, open && styles.triggerOpen)}
            aria-label={t('modelSwitch')}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => {
              if (!open) {
                setView('compact')
              }
              setOpen((value) => !value)
            }}
          >
            <span className={styles.triggerIcon}>
              <IconModelOutline14 />
            </span>
            <span className={styles.triggerLabel}>{modelDisplayName(chatModel)}</span>
            <span className={styles.triggerEffort}>{EFFORT_SHORT[level]}</span>
            <span className={styles.chevron}>
              <IconChevronDownOutline14 />
            </span>
          </button>
        </Tooltip>
      </span>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={clsx(styles.panel, view === 'compact' && styles.panelCompact)}
              style={position ?? { top: 0, left: 0, visibility: 'hidden' }}
              role="dialog"
              aria-label={view === 'models' ? t('settingsModel') : t('modelSwitch')}
            >
              {view === 'models' ? (
                <>
                  <div className={styles.header}>
                    <span className={styles.titleGroup}>
                      <button
                        type="button"
                        className={styles.back}
                        aria-label={t('modelBack')}
                        onClick={() => setView('compact')}
                      >
                        <IconChevronRightOutline14 />
                      </button>
                      <h2 className={styles.title}>{t('settingsModel')}</h2>
                    </span>
                    <button
                      type="button"
                      className={styles.fetch}
                      disabled={loading}
                      onClick={() => void fetchFromCloud()}
                    >
                      <span className={clsx(styles.refreshIcon, loading && styles.spinning)}>
                        <IconRefreshOutline16 />
                      </span>
                      {loading ? t('modelFetching') : t('modelFetchFromCloud')}
                    </button>
                  </div>

                  <div className={styles.list} role="radiogroup" aria-label={t('settingsModel')}>
                    {models.map((model) => {
                      const selected = model.id === chatModel
                      return (
                        <button
                          key={model.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={clsx(styles.card, selected && styles.cardSelected)}
                          onClick={() => {
                            // 先切视图再改模型：onPick 会让 chatModel prop 变化并重渲染，
                            // 反过来调用会让弹窗被关掉、视图切不过去（e2e effortSplit 覆盖）
                            setView('compact')
                            onPick(model.id)
                          }}
                        >
                          <span className={styles.cardMain}>
                            <span className={styles.cardTitleRow}>
                              <span className={styles.cardName}>{model.name}</span>
                              <span className={styles.tag}>
                                {t(model.source === 'builtin' ? 'modelBuiltinTag' : 'modelCloudTag')}
                              </span>
                            </span>
                            <span className={styles.cardId}>{model.id}</span>
                            <span className={styles.cardPrice}>
                              {model.prices
                                ? formatModelPrices(model.prices)
                                : t('modelPriceUnavailable')}
                            </span>
                          </span>
                          {selected ? (
                            <span className={styles.check}>
                              <IconCheckOutline16 />
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>

                  {error ? <p className={styles.error}>{error}</p> : null}

                  <div className={styles.footer}>
                    <div className={styles.sourceRow}>
                      <span>{t(source === 'cloud' ? 'modelCloudList' : 'modelBuiltinList')}</span>
                      {source === 'cloud' ? (
                        <button
                          type="button"
                          className={styles.sourceLink}
                          onClick={() => {
                            setSource('builtin')
                            setError(null)
                          }}
                        >
                          {t('modelUseBuiltin')}
                        </button>
                      ) : null}
                    </div>
                    <p className={styles.note}>{t('modelPriceNote')}</p>
                  </div>
                </>
              ) : (
                <div className={styles.compactView}>
                  <button
                    type="button"
                    className={styles.compactModelRow}
                    onClick={() => setView('models')}
                  >
                    <span className={styles.compactLabel}>{t('settingsModel')}</span>
                    <span className={styles.compactModelName}>
                      {modelDisplayName(chatModel)}
                      <IconChevronRightOutline14 />
                    </span>
                  </button>
                  <div className={clsx(styles.compactEffort, styles[EFFORT_CLASS[level]])}>
                    <div className={styles.compactEffortHead}>
                      <span className={styles.compactLabel}>{t('reasoningEffort')}</span>
                      <span
                        className={clsx(
                          styles.compactEffortName,
                          level === 'max' && styles.compactEffortNameWarn
                        )}
                      >
                        {level === 'max' ? t('reasoningEffortMaxCost') : EFFORT_SHORT[level]}
                      </span>
                    </div>
                    <input
                      type="range"
                      className={styles.effortSlider}
                      min={0}
                      max={LEVELS.length - 1}
                      step={1}
                      value={levelIndex}
                      style={{ '--effort-index': levelIndex } as { [key: string]: number }}
                      aria-label={t('reasoningEffort')}
                      onChange={(event) => changeLevel(LEVELS[Number(event.target.value)])}
                    />
                  </div>
                </div>
              )}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
