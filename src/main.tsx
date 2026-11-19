import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.scss'
import './app/global.scss'

// KaTeX 约 300 KiB（gzip 约 90 KiB），懒加载机制已在 MathFormula 内置；
// 这里只在主线程空闲时预载，避免首屏冷加载就拉公式引擎，页面没有公式时也不影响功能。
if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(() => ensureKatex())
} else {
  setTimeout(() => ensureKatex(), 1500)
}

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
