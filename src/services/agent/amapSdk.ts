import { getAccessKey } from '../chat/accessKey.js'

/**
 * 高德 JS API SDK 懒加载：配置了 AMAP_JS_KEY（Web端 JS API 类型）时，
 * 交互地图卡片才按需加载 SDK；未配置（jsconfig 404）或加载失败返回 null，
 * 卡片回退到静态地图图片。全站共享同一个加载 Promise，失败不缓存以便重试。
 */

/** 本项目用到的 AMap 命名空间最小类型面（完整声明由 SDK 自带，这里只约束我们调用的部分） */
export type AMapInstance = {
  add: (overlay: AMapOverlay | AMapOverlay[]) => void
  setFitView: (padding?: [number, number, number, number]) => void
  destroy: () => void
}

export type AMapOverlay = AMapMarker | AMapPolyline

export type AMapMarker = {
  position: [number, number]
  title?: string
  label?: { content: string; direction?: 'top' | 'right' | 'bottom' | 'left' }
}

export type AMapPolyline = {
  path: [number, number][]
}

type AMapNamespace = {
  Map: new (
    container: HTMLElement,
    options: { zoom?: number; center?: [number, number]; viewMode?: '2D' | '3D' }
  ) => AMapInstance
  Marker: new (options: AMapMarker) => AMapMarker
  Polyline: new (options: AMapPolyline & { strokeColor?: string; strokeWeight?: number; showDir?: boolean }) => AMapPolyline
}

declare global {
  interface Window {
    AMap?: AMapNamespace
    /** 安全密钥容器：必须在 SDK 脚本加载前注入（2021-12 之后创建的 JS Key 必需） */
    _AMapSecurityConfig?: { securityJsCode: string }
  }
}

type AmapJsConfig = { key: string; securityCode: string }

const SDK_VERSION = '2.0'
const SDK_LOAD_TIMEOUT = 15_000
/** bootstrap 校验 Key 通过后才会异步拉主模块并暴露 window.AMap；无效 Key 永不出现，超时即回退静态图 */
const SDK_READY_TIMEOUT = 10_000

let loadPromise: Promise<AMapNamespace | null> | null = null

export const loadAmapSdk = (): Promise<AMapNamespace | null> => {
  loadPromise ??= load()
    .catch(() => null)
    .then((sdk) => {
      if (!sdk) {
        loadPromise = null // 失败不缓存：下一张卡片挂载时重试
      }
      return sdk
    })
  return loadPromise
}

const load = async (): Promise<AMapNamespace | null> => {
  const config = await fetchJsConfig()
  if (!config) {
    return null
  }
  if (config.securityCode) {
    window._AMapSecurityConfig = { securityJsCode: config.securityCode }
  }
  await injectScript(`https://webapi.amap.com/maps?v=${SDK_VERSION}&key=${encodeURIComponent(config.key)}`)
  return await waitForAMap()
}

/** 轮询等待主模块就绪：脚本 load 事件只代表 bootstrap 到位，window.AMap 出现才算可用 */
const waitForAMap = (): Promise<AMapNamespace | null> =>
  new Promise((resolve) => {
    const deadline = Date.now() + SDK_READY_TIMEOUT
    const poll = () => {
      if (window.AMap) {
        resolve(window.AMap)
        return
      }
      if (Date.now() > deadline) {
        resolve(null)
        return
      }
      setTimeout(poll, 120)
    }
    poll()
  })

/** 读取服务端 JS API 配置：未配置（404）或请求失败都返回 null */
const fetchJsConfig = async (): Promise<AmapJsConfig | null> => {
  const headers = new Headers()
  const accessKey = getAccessKey()
  if (accessKey) {
    headers.set('x-access-key', accessKey)
  }
  const response = await fetch('/api/amap/jsconfig', { headers })
  if (!response.ok) {
    return null
  }
  const data = (await response.json()) as { key?: unknown; securityCode?: unknown }
  if (typeof data.key !== 'string' || !data.key) {
    return null
  }
  return { key: data.key, securityCode: typeof data.securityCode === 'string' ? data.securityCode : '' }
}

const injectScript = (src: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    const timer = setTimeout(() => {
      script.remove()
      reject(new Error('amap sdk load timeout'))
    }, SDK_LOAD_TIMEOUT)
    script.addEventListener('load', () => {
      clearTimeout(timer)
      resolve()
    })
    script.addEventListener('error', () => {
      clearTimeout(timer)
      script.remove()
      reject(new Error('amap sdk load failed'))
    })
    document.head.appendChild(script)
  })
