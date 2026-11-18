import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)

// PWA：生产构建且安全上下文（https 或本机回环）时注册 Service Worker；
// file:// 打开或开发服务器不注册，行为与普通静态页一致。
if (
  __ENABLE_SW__ &&
  'serviceWorker' in navigator &&
  (location.protocol === 'https:' ||
    ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname))
) {
  void navigator.serviceWorker.register('sw.js').catch(() => {
    // 注册失败（如非主框架、缓存满）不影响页面功能
  })
}
