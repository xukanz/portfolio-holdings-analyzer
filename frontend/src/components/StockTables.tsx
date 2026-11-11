import { useEffect, useState } from 'react'
import { api } from '../api'
import { isHeld } from '../stockState'
import { fmtMoney, fmtPct, fmtRaw } from '../utils/format'
import type { StockRow } from '../types'
import { ErrorAlert } from './ErrorAlert'
import { DirectionValue, LoadingState, Panel, Tag } from './ui'

/** 持有状态：共同持有 / 仅组合 / 仅基准（依据后端按原始精度给出的标志，而非舍入后的权重） */
export type HoldState = 'both' | 'portOnly' | 'benchOnly'
export const holdState = (s: StockRow): HoldState =>
  !isHeld(s) ? 'benchOnly' : s.is_benchmark_constituent === false ? 'portOnly' : 'both'
export const HOLD_LABEL: Record<HoldState, string> = { both: '共同持有', portOnly: '仅组合', benchOnly: '仅基准' }

export function HoldTag({ s, showBoth = false }: { s: StockRow; showBoth?: boolean }) {
  const st = holdState(s)
  if (st === 'both' && !showBoth) return null
  return <Tag variant={st}>{HOLD_LABEL[st]}</Tag>
}

export type SortKey = 'stock_code' | 'market_value' | 'portfolio_weight' | 'benchmark_weight' | 'active_weight'
export interface SortState {
  key: SortKey
  desc: boolean
}

export function StockTable({ rows, showIndustry = true, showRank = false, showMv = false, industryHref,
  rankOffset = 0, sort, onSort, minWidth = 460 }: {
  rows: StockRow[]
  showIndustry?: boolean
  showRank?: boolean
  showMv?: boolean
  industryHref?: (industry: string) => string
  rankOffset?: number
  sort?: SortState
  onSort?: (key: SortKey) => void
  minWidth?: number
}) {
  // 传入 onSort 时表头可点击排序，并显示当前排序方向
  const head = (key: SortKey, label: string, right = true) => {
    const cls = [right ? 'r' : '', onSort ? 'sortable' : ''].join(' ').trim() || undefined
    if (!onSort) return <th className={cls}>{label}</th>
    const active = sort?.key === key
    return (
      <th className={cls} onClick={() => onSort(key)} aria-sort={active ? (sort!.desc ? 'descending' : 'ascending') : 'none'}>
        <button type="button" className="link-btn" style={{ color: 'inherit', fontWeight: 500 }}>
          {label}{active ? (sort!.desc ? ' ↓' : ' ↑') : ''}
        </button>
      </th>
    )
  }
  return (
    <div className="scroll-x">
      <table className="data" style={{ minWidth }}>
        <thead>
          <tr>
            {showRank && <th>#</th>}
            {head('stock_code', '股票', false)}
            {showIndustry && <th>行业</th>}
            {showMv && head('market_value', '持仓市值')}
            {head('portfolio_weight', '组合')}{head('benchmark_weight', '基准')}{head('active_weight', '主动权重')}
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={s.stock_code}>
              {showRank && <td className="muted">{rankOffset + i + 1}</td>}
              <td>
                <div className="stock-name">{s.stock_name}<HoldTag s={s} /></div>
                <div className="stock-code">{s.stock_code}</div>
              </td>
              {showIndustry && (
                <td>{industryHref ? <a href={industryHref(s.industry)} style={{ color: 'var(--text-secondary)' }}>{s.industry}</a> : s.industry}</td>
              )}
              {showMv && <td className="r">{isHeld(s) ? fmtMoney(s.market_value) : '—'}</td>}
              <td className="r" title={fmtRaw(s.portfolio_weight)}>{fmtPct(s.portfolio_weight)}</td>
              <td className="r muted" title={fmtRaw(s.benchmark_weight)}>{fmtPct(s.benchmark_weight)}</td>
              <td className="r"><DirectionValue value={s.active_weight} side={s.active_side} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const TOP_OPTIONS = [5, 10, 20]

/** 个股超配 / 低配 Top N：切换 N 时请求 /active-weights（后端按原始精度排名） */
export function ActiveWeightTable({ runId, side, defaultTop, industryHref }: {
  runId: string
  side: 'over' | 'under'
  defaultTop: number
  industryHref: (industry: string) => string
}) {
  const options = [...new Set([...TOP_OPTIONS, defaultTop])].sort((a, b) => a - b)
  const [top, setTop] = useState(defaultTop)
  const [rows, setRows] = useState<StockRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let alive = true
    setRows(null)
    setError(null)
    api.activeWeights(runId, side, top)
      .then((r) => alive && setRows(r[side] ?? []))
      .catch((e) => alive && setError(e))
    return () => {
      alive = false
    }
  }, [runId, side, top])

  const over = side === 'over'
  return (
    <Panel
      label={over ? '超配排行' : '低配排行'}
      title={`个股${over ? '超配' : '低配'} Top ${top}`}
      extra={
        <label className="inline-field" style={{ fontSize: 14 }}>
          显示
          <select className="select" style={{ height: 28 }} value={top} onChange={(e) => setTop(Number(e.target.value))}>
            {options.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      }
      footer={over ? undefined : '仅基准：组合未持有，组合权重记 0，仍计入并集与主动份额。'}
    >
      {error ? <div style={{ padding: 16 }}><ErrorAlert error={error} /></div>
        : rows === null ? <LoadingState rows={5} />
          : rows.length === 0 ? <div className="state">没有{over ? '超配' : '低配'}的股票</div>
            : <StockTable rows={rows} industryHref={industryHref} />}
    </Panel>
  )
}
