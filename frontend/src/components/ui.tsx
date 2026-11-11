import type { ReactNode } from 'react'
import { ApiError } from '../api'
import { fmtActive, fmtRaw, sideOf } from '../utils/format'
import type { Side } from '../utils/format'

export function PageHeader({ breadcrumb, title, actions }: {
  breadcrumb: ReactNode
  title: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="page-header">
      <div>
        <div className="breadcrumb">{breadcrumb}</div>
        <h1>{title}</h1>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  )
}

export function Panel({ title, subtitle, extra, footer, children, label, className }: {
  title?: ReactNode
  subtitle?: ReactNode
  extra?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  label?: string
  className?: string
}) {
  return (
    <section className={`panel ${className ?? ''}`} aria-label={label}>
      {(title || extra) && (
        <div className="panel-head">
          <div className="titles">
            {title && <h2>{title}</h2>}
            {subtitle && <span className="subtitle">{subtitle}</span>}
          </div>
          {extra}
        </div>
      )}
      {children}
      {footer && <div className="panel-foot">{footer}</div>}
    </section>
  )
}

export function KpiCard({ label, value, sub, size, children, title }: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  size?: 'md' | 'sm'
  children?: ReactNode
  title?: string
}) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`value ${size ?? ''}`} title={title}>{value}</div>
      {children}
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

/** ▲ +x.xx% / ▼ −x.xx%，方向色；0 显示灰色 0.00%。悬停显示 6 位小数原值 */
export function DirectionValue({ value, side, digits = 2, className }: {
  value: number
  side?: Side | null
  digits?: number
  className?: string
}) {
  const s = sideOf(value, side)
  const cls = s === 'over' ? 'up' : s === 'under' ? 'down' : 'zero'
  return <span className={`dir ${cls} ${className ?? ''}`} title={fmtRaw(value)}>{fmtActive(value, side, digits)}</span>
}

export function DualBar({ portfolio, benchmark, scaleMax }: { portfolio: number; benchmark: number; scaleMax: number }) {
  const w = (v: number) => `${Math.min(100, (v / scaleMax) * 100)}%`
  return (
    <span className="dual-bar" aria-hidden="true">
      <span className="p" style={{ width: w(portfolio) }} />
      <span className="b" style={{ width: w(benchmark) }} />
    </span>
  )
}

/** 发散条：zeroAt 为零线位置（0~1）；正向占 1−zeroAt，负向占 zeroAt */
export function DivergingBar({ value, scaleMax, zeroAt = 0.5, thin, side }: {
  value: number
  scaleMax: number
  zeroAt?: number
  thin?: boolean
  side?: Side | null
}) {
  const s = sideOf(value, side)
  const room = s === 'over' ? 1 - zeroAt : zeroAt
  const width = scaleMax > 0 ? Math.min(1, Math.abs(value) / scaleMax) * room * 100 : 0
  const left = s === 'over' ? zeroAt * 100 : zeroAt * 100 - width
  return (
    <span className={`div-bar ${thin ? 'thin' : ''}`} aria-hidden="true">
      <span className="zero" style={{ left: `${zeroAt * 100}%` }} />
      {s !== 'neutral' && <span className={`fill ${s === 'over' ? 'up' : 'down'}`} style={{ left: `${left}%`, width: `${width}%` }} />}
    </span>
  )
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  )
}

export type TagVariant = 'benchOnly' | 'portOnly' | 'both' | 'success' | 'error'
export function Tag({ variant, children }: { variant: TagVariant; children: ReactNode }) {
  return <span className={`tag ${variant}`}>{children}</span>
}

export function SegmentedControl<T extends string>({ options, value, onChange, label }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function SelfCheck({ overlapWeight, activeShare, sum }: { overlapWeight: number; activeShare: number; sum?: number }) {
  const total = sum ?? overlapWeight + activeShare
  const ok = Math.abs(total - 1) < 1e-6
  return ok ? (
    <div className="self-check ok" title={`重合权重 + 主动份额 = ${total.toFixed(6)}`}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5 L5 9 L10 3" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
      自检通过：合计 {total.toFixed(6)}
    </div>
  ) : (
    <div className="self-check bad">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M6 3 V6.5" stroke="currentColor" strokeWidth="1.4" /><circle cx="6" cy="8.6" r="0.8" fill="currentColor" /></svg>
      自检未通过：合计 {total.toFixed(6)}
    </div>
  )
}

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => <span key={i} style={{ width: `${90 - i * 12}%` }} />)}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>
}

/** 网络 / 服务端错误只显示通用文案 + 重试；业务错误显示 message */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null
  const message = !e || e.isUnavailable ? '服务暂时不可用，请稍后重试' : e.message
  return (
    <div className="state" role="alert">
      <div>{message}</div>
      {onRetry && <button className="btn" onClick={onRetry}>重试</button>}
    </div>
  )
}
