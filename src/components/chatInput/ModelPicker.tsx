import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import type { ChatModel } from '../../services/api/types.js'
import {
  BUILTIN_MODELS,
  fetchCloudModels,
  formatModelPrices,
  modelDisplayName,
  type ModelInfo,
} from '../../services/models.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { IconCheckOutline16, IconChevronDownOutline14, IconModelOutline14, IconRefreshOutline16 } from '../base/icons.js'
import { Tooltip } from '../base/Tooltip.js'
import styles from './ModelPicker.module.scss'

/** 模型选择：触发按钮上方弹出完整面板，内置列表可与 GET /models 的云端列表互换 */
export const ModelPicker = ({
  chatModel,
  onPick,
}: {
  chatModel: ChatModel
  onPick: (model: ChatModel) => void
}) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<'builtin' | 'cloud'>('builtin')
  const [cloudModels, setCloudModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { side: 'top', align: 'start', offset: 8, measureKey: source }
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
    } catch {
      if (!controller.signal.aborted) {
        // 请求失败不影响内置列表，面板继续可用
        setError(t('modelFetchFailed'))
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
            onClick={() => setOpen((value) => !value)}
          >
            <span className={styles.triggerIcon}>
              <IconModelOutline14 />
            </span>
            <span className={styles.triggerLabel}>{modelDisplayName(chatModel)}</span>
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
              className={styles.panel}
              style={position ?? { top: 0, left: 0, visibility: 'hidden' }}
              role="dialog"
              aria-label={t('settingsModel')}
            >
              <div className={styles.header}>
                <h2 className={styles.title}>{t('settingsModel')}</h2>
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
                        onPick(model.id)
                        setOpen(false)
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
            </div>,
            document.body
          )
        : null}
    </>
  )
}
