import { create } from 'zustand'

/** 灯箱展示的图片：src 为本地 blob: 地址，name 用于下载与无障碍描述 */
export type LightboxImage = {
  src: string
  name: string
}

/** 图片灯箱：消息里的缩略图点击后全屏查看 */
export const useLightbox = create<{ image: LightboxImage | null }>(() => ({ image: null }))

export const openLightbox = (image: LightboxImage) => useLightbox.setState({ image })

export const closeLightbox = () => useLightbox.setState({ image: null })
