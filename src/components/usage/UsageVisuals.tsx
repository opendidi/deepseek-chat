/** 设置 → 统计与输入栏会话统计弹窗共用的纯展示图表 */
import { donutSlices, percent, sparklinePath } from '../../utils/usageChart.js'
import styles from './UsageVisuals.module.scss'

export type DonutItem = { key: string; label: string; value: number; color: string }

/** 环形图：pathLength=100 让分段直接用百分比，避免计算圆周长 */
export const DonutChart = ({
  items,
  size = 116,
  centerLabel,
  centerValue,
}: {
  items: readonly DonutItem[]
  size?: number
  centerLabel?: string
  centerValue?: string
}) => {
  const slices = donutSlices(items.map((item) => item.value))
  return (
    <div className={styles.donutWrap} style={{ width: size, height: size }}>
      <svg
        className={styles.donutSvg}
        viewBox="0 0 120 120"
        width={size}
        height={size}
        role="img"
        aria-label={centerLabel}
      >
        <circle
          cx="60"
          cy="60"
          r="46"
          fill="none"
          stroke="var(--dsw-alias-bg-skeleton)"
          strokeWidth="14"
        />
        {slices.map((slice, index) =>
          slice.length > 0 ? (
            <circle
              key={items[index].key}
              cx="60"
              cy="60"
              r="46"
              fill="none"
              stroke={items[index].color}
              strokeWidth="14"
              pathLength={100}
              strokeDasharray={`${slice.length} ${100 - slice.length}`}
              strokeDashoffset={-slice.offset}
              transform="rotate(-90 60 60)"
            />
          ) : null
        )}
      </svg>
      <div className={styles.donutCenter}>
        {centerValue ? <strong className={styles.donutCenterValue}>{centerValue}</strong> : null}
        {centerLabel ? <span className={styles.donutCenterLabel}>{centerLabel}</span> : null}
      </div>
    </div>
  )
}

/** 图例：每段带数值与占比 */
export const DonutLegend = ({
  items,
  formatValue,
}: {
  items: readonly DonutItem[]
  formatValue: (value: number) => string
}) => {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  return (
    <div className={styles.legend}>
      {items.map((item) => (
        <div key={item.key} className={styles.legendItem}>
          <span className={styles.legendDot} style={{ backgroundColor: item.color }} />
          <span className={styles.legendLabel}>{item.label}</span>
          <span className={styles.legendValue}>{formatValue(item.value)}</span>
          <span className={styles.legendShare}>{percent(item.value, total)}%</span>
        </div>
      ))}
    </div>
  )
}

/** 迷你折线：本次会话输出 token 趋势 */
export const Sparkline = ({
  values,
  width = 260,
  height = 64,
  color = 'var(--dsw-alias-brand-primary)',
}: {
  values: readonly number[]
  width?: number
  height?: number
  color?: string
}) => {
  const path = sparklinePath(values, width, height, 4)
  return (
    <svg
      className={styles.sparklineSvg}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
    >
      <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** 上下文压力表：当前占用、剩余窗口与压缩阈值刻度 */
export const PressureMeter = ({
  value,
  max,
  compressAt,
}: {
  value: number
  max: number
  compressAt: number
}) => {
  const used = Math.min(100, percent(value, max))
  const mark = Math.min(100, percent(compressAt, max))
  return (
    <div className={styles.meter}>
      <div className={styles.meterTrack}>
        <span className={styles.meterFill} style={{ width: `${used}%` }} />
        <span className={styles.meterMark} style={{ left: `${mark}%` }} />
      </div>
      <div className={styles.meterScale}>
        <span>0</span>
        <span>{Math.round(mark)}%</span>
        <span>100%</span>
      </div>
    </div>
  )
}
