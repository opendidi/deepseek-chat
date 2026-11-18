import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  addPrompt,
  removePrompt,
  updatePrompt,
  usePrompts,
  type PromptTemplate,
} from '../../services/prompts.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { closePromptLibrary, usePromptLibrary } from './promptLibraryState.js'
import styles from './PromptLibrary.module.css'

/** 提示词库：列表管理（新建 / 编辑 / 删除）。使用入口在输入框的斜杠菜单 */
export const PromptLibrary = () => {
  const open = usePromptLibrary((state) => state.open)
  return open ? <LibraryContent /> : null
}

const LibraryContent = () => {
  const t = useTranslate()
  const prompts = usePrompts((state) => state.prompts)
  // null 为列表；'new' 为新建；其余为正在编辑的提示词 id
  const [editing, setEditing] = useState<null | 'new' | string>(null)

  useEffect(() => () => setEditing(null), [])

  const editingPrompt =
    editing && editing !== 'new' ? (prompts.find((prompt) => prompt.id === editing) ?? null) : null

  return (
    <Modal
      title={t('promptLibrary')}
      className={styles.dialog}
      onClose={closePromptLibrary}
      footer={
        <div className={styles.footer}>
          <Button
            variant="outlined"
            size="m"
            onClick={() => setEditing('new')}
            disabled={editing !== null || prompts.length >= 100}
          >
            {t('promptAdd')}
          </Button>
        </div>
      }
    >
      {editing !== null ? (
        <PromptEditor
          prompt={editingPrompt}
          onCancel={() => setEditing(null)}
          onSave={(title, content) => {
            if (editing === 'new') {
              addPrompt(title, content)
            } else if (editingPrompt) {
              updatePrompt(editingPrompt.id, title, content)
            }
            setEditing(null)
          }}
        />
      ) : prompts.length === 0 ? (
        <div className={styles.empty}>{t('promptEmpty')}</div>
      ) : (
        <div className={styles.list}>
          {prompts.map((prompt) => (
            <div key={prompt.id} className={styles.item}>
              <div className={styles.text}>
                <div className={styles.title}>{prompt.title}</div>
                <div className={styles.preview}>{prompt.content}</div>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.action}
                  aria-label={t('promptEdit')}
                  onClick={() => setEditing(prompt.id)}
                >
                  {t('promptEdit')}
                </button>
                <button
                  type="button"
                  className={clsx(styles.action, styles.danger)}
                  aria-label={t('delete')}
                  onClick={() => removePrompt(prompt.id)}
                >
                  {t('delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

/** 新建 / 编辑共用表单；标题与内容都必填 */
const PromptEditor = ({
  prompt,
  onSave,
  onCancel,
}: {
  prompt: PromptTemplate | null
  onSave: (title: string, content: string) => void
  onCancel: () => void
}) => {
  const t = useTranslate()
  const [title, setTitle] = useState(prompt?.title ?? '')
  const [content, setContent] = useState(prompt?.content ?? '')
  const valid = title.trim() !== '' && content.trim() !== ''
  return (
    <div className={styles.editor}>
      <input
        className={styles.titleInput}
        value={title}
        placeholder={t('promptTitlePlaceholder')}
        maxLength={60}
        onChange={(event) => setTitle(event.target.value)}
        autoFocus
      />
      <textarea
        className={styles.contentInput}
        value={content}
        placeholder={t('promptContentPlaceholder')}
        maxLength={4000}
        rows={6}
        onChange={(event) => setContent(event.target.value)}
      />
      <div className={styles.editorActions}>
        <Button variant="outlined" size="m" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          variant="primary"
          size="m"
          disabled={!valid}
          onClick={() => valid && onSave(title, content)}
        >
          {t('promptSave')}
        </Button>
      </div>
    </div>
  )
}
