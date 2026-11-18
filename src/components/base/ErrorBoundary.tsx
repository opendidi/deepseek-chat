import { Component, type ReactNode } from 'react'
import { translate } from '../../i18n/index.js'
import { Button } from './Button.js'
import styles from './ErrorBoundary.module.scss'

/** 会话区渲染异常时给出可恢复的提示，避免整页白屏 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override render() {
    if (this.state.failed) {
      return (
        <div className={styles.fallback} role="alert">
          <span>{translate('renderError')}</span>
          <Button variant="outlined" size="s" onClick={() => location.reload()}>
            {translate('retry')}
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
