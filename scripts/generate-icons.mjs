// 生成 PWA 图标（PNG）：4x 超采样绘制「圆角方底 + 白色圆形 + 三个对话点」，手写 PNG 编码，无外部依赖。
// 运行：node scripts/generate-icons.mjs；产物写入 public/icons/。
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const BG = [77, 107, 254] // DeepSeek 品牌蓝
const WHITE = [255, 255, 255]

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return c
})

const crc32 = (buffer) => {
  let c = 0xffffffff
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, crc])
}

const encodePng = (size, rgba) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  const view = Buffer.from(rgba.buffer, 0, size * size * 4)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    view.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 圆角矩形 SDF（坐标与半径同单位） */
const roundedRectSdf = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - hw + r
  const qy = Math.abs(py - cy) - hh + r
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - r
}

const circleSdf = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r

/** coverage：1 在内部，0 在外部，边缘按距离过渡 */
const coverage = (dist) => Math.max(0, Math.min(1, 0.5 - dist))

/**
 * 画一枚图标。rounded 时背景为圆角方块，否则全出血（maskable 专用）。
 * SS 为每边超采样倍数，取平均得到平滑边缘。
 */
const drawIcon = (size, { rounded, ss = 4 }) => {
  const rgba = new Uint8Array(size * size * 4)
  const half = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          // 采样点中心（像素坐标）
          const px = x + (sx + 0.5) / ss
          const py = y + (sy + 0.5) / ss
          let cr = 0
          let cg = 0
          let cb = 0
          let ca = 0
          const bgCover = rounded
            ? coverage(roundedRectSdf(px, py, half, half, half, half, size * 0.22))
            : 1
          if (bgCover > 0) {
            cr = BG[0]
            cg = BG[1]
            cb = BG[2]
            ca = bgCover
          }
          // 白色圆：中心，半径 0.30
          const circle = coverage(circleSdf(px, py, half, half, size * 0.3))
          if (circle > 0) {
            const m = circle
            cr = cr * (1 - m) + WHITE[0] * m
            cg = cg * (1 - m) + WHITE[1] * m
            cb = cb * (1 - m) + WHITE[2] * m
            ca = Math.max(ca, m)
          }
          // 三个对话点：品牌蓝，半径 0.055，水平间距 0.105
          for (const dx of [-0.105, 0, 0.105]) {
            const dot = coverage(circleSdf(px, py, half + dx * size, half, size * 0.055))
            if (dot > 0) {
              const m = dot
              cr = cr * (1 - m) + BG[0] * m
              cg = cg * (1 - m) + BG[1] * m
              cb = cb * (1 - m) + BG[2] * m
              ca = Math.max(ca, m)
            }
          }
          r += cr
          g += cg
          b += cb
          a += ca
        }
      }
      const count = ss * ss
      const index = (y * size + x) * 4
      rgba[index] = Math.round(r / count)
      rgba[index + 1] = Math.round(g / count)
      rgba[index + 2] = Math.round(b / count)
      rgba[index + 3] = Math.round((a / count) * 255)
    }
  }
  return rgba
}

const files = [
  { name: 'icon-192.png', size: 192, rounded: true },
  { name: 'icon-512.png', size: 512, rounded: true },
  { name: 'maskable-512.png', size: 512, rounded: false },
  { name: 'icon-180.png', size: 180, rounded: true },
]

for (const file of files) {
  const rgba = drawIcon(file.size, { rounded: file.rounded })
  writeFileSync(path.join(outDir, file.name), encodePng(file.size, rgba))
  console.log(`written ${file.name}`)
}
