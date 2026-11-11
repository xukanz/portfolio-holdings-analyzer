import { useEffect, useMemo, useState } from 'react'
import { api, downloadCsv, isFailedRun } from '../api'
import { HoldTag, holdState } from '../components/StockTables'
import { DirectionValue, EmptyState, ErrorState, KpiCard, LoadingState, PageHeader, Panel } from '../components/ui'
import { navigate, routes } from '../router'
import type { AnalysisRun, FailedRun, StockRow } from '../types'
import { fmtPct, fmtRaw, fmtSignedPct } from '../utils/format'

const CHIP_COUNT = 7          // 行业较多时只展示偏离最大的几个胶囊，其余在下拉框中
const ALL_CHIPS_MAX = 15       // 行业数不超过该值时全部以胶囊展示
const BENCH_ONLY_VISIBLE = 3   // 仅基准成分超过 5 只时，只单列权重最大的 3 只，其余合并
const BENCH_ONLY_MERGE_OVER = 5

/** 贡献条：零线在 30% 处；两侧使用同一单位长度，保证正负可比 */
function ContributionBar({ share, unit, side }: { share: number; unit: number; side: 'over' | 'under' | 'neutral' }) {
  const w = Math.abs(share) * unit * 100
  return (
    <span className="div-bar thin" aria-hidden="true">
      <span className="zero" style={{ left: '30%' }} />
      {side !== 'neutral' && share !== 0 && (
        <span className={`fill ${side === 'over' ? 'up' : 'down'}`}
          style={{ left: share > 0 ? '30%' : `${30 - w}%`, width: `${w}%` }} />
      )}
    </span>
  )
}

export function IndustryPage({ runId, industry, onRunLoaded }: {
  runId: string
  industry: string
  onRunLoaded: (r: AnalysisRun) => void
}) {
  const [run, setRun] = useState<AnalysisRun | FailedRun | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [reload, setReload] = useState(0)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let alive = true
    setError(null)
    api.getRun(runId).then((r) => {
      if (!alive) return
      setRun(r)
      if (!isFailedRun(r)) onRunLoaded(r)
    }).catch((e) => alive && setError(e))
    return () => {
      alive = false
    }
  }, [runId, reload]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setExpanded(false), [industry])

  const data = useMemo(() => {
    if (!run || isFailedRun(run)) return null
    const ind = run.industries.find((r) => r.industry === industry) ?? null
    const stocks = run.stocks.filter((s) => s.industry === industry)  // 后端已按主动权重降序、代码升序
    return { ind, stocks }
  }, [run, industry])

  const head = (title: string, actions?: React.ReactNode) => (
    <PageHeader breadcrumb={<><a href={routes.analysis(runId)}>组合体检</a> › 行业穿透</>} title={title} actions={actions} />
  )

  if (error) return <>{head('行业穿透')}<div className="panel"><ErrorState error={error} onRetry={() => setReload((x) => x + 1)} /></div></>
  if (!run) return <>{head(`行业穿透：${industry}`)}<div className="panel"><LoadingState rows={8} /></div></>
  if (isFailedRun(run)) {
    return <>{head('行业穿透')}<div className="panel"><EmptyState>该次分析未通过校验，没有结果。<a href={routes.runsNew(run.id)}>查看校验详情</a></EmptyState></div></>
  }
  if (!data?.ind) {
    return <>{head('行业穿透')}<div className="panel"><EmptyState>本次分析中没有行业“{industry}”，<a href={routes.analysis(runId)}>返回体检</a></EmptyState></div></>
  }

  const { ind, stocks } = data
  const A = ind.active_weight
  // 贡献占比 = 个股主动权重 ÷ 行业主动权重：前端纯展示派生值；行业主动权重为 0 时不计算
  const share = (a: number) => (A !== 0 ? a / A : null)
  const indSide = A > 0 ? 'over' : A < 0 ? 'under' : 'neutral'

  const benchOnly = stocks.filter((s) => holdState(s) === 'benchOnly')
  const merge = !expanded && benchOnly.length > BENCH_ONLY_MERGE_OVER
  const keep = new Set([...benchOnly].sort((a, b) => b.benchmark_weight - a.benchmark_weight)
    .slice(0, BENCH_ONLY_VISIBLE).map((s) => s.stock_code))
  const visible = merge ? stocks.filter((s) => holdState(s) !== 'benchOnly' || keep.has(s.stock_code)) : stocks
  const merged = merge ? benchOnly.filter((s) => !keep.has(s.stock_code)) : []
  // 合并行只是把已返回的个股数值相加用于展示
  const mergedBench = merged.reduce((x, s) => x + s.benchmark_weight, 0)
  const mergedActive = merged.reduce((x, s) => x + s.active_weight, 0)

  const shares = [...stocks.map((s) => share(s.active_weight) ?? 0), merge ? (share(mergedActive) ?? 0) : 0]
  const maxPos = Math.max(0, ...shares)
  const maxNeg = Math.max(0, ...shares.map((c) => -c))
  const unit = Math.min(maxPos > 0 ? 0.7 / maxPos : Infinity, maxNeg > 0 ? 0.3 / maxNeg : Infinity)
  const barUnit = Number.isFinite(unit) ? unit : 0

  const top = indSide === 'neutral' ? null
    : [...stocks].sort((a, b) => (share(b.active_weight) ?? 0) - (share(a.active_weight) ?? 0))[0]

  // 行业按主动权重从超配到低配排序（并列按行业名）
  const byActive = [...run.industries].sort((a, b) => b.active_weight - a.active_weight || a.industry.localeCompare(b.industry, 'zh-CN'))
  let chips = byActive
  if (byActive.length > ALL_CHIPS_MAX) {
    const shown = new Set([...byActive].sort((a, b) => Math.abs(b.active_weight) - Math.abs(a.active_weight))
      .slice(0, CHIP_COUNT).map((r) => r.industry))
    shown.add(industry)
    chips = byActive.filter((r) => shown.has(r.industry))
  }

  const exportCsv = () => downloadCsv(`${run.portfolio.name}_${industry}_行业穿透_${run.id.slice(0, 8)}.csv`, [
    ['stock_code', 'stock_name', 'hold_state', 'portfolio_weight', 'benchmark_weight', 'active_weight'],
    ...stocks.map((s: StockRow) => [s.stock_code, s.stock_name, holdState(s), fmtRaw(s.portfolio_weight),
      fmtRaw(s.benchmark_weight), fmtRaw(s.active_weight)]),
  ])

  return (
    <>
      {head(`行业穿透：${industry}`, (
        <>
          <a className="btn" href={routes.analysis(runId)}>返回体检</a>
          <button className="btn" onClick={exportCsv}>导出本行业明细 CSV</button>
        </>
      ))}

      <div className="chips" role="group" aria-label="切换行业">
        {chips.map((c) => (
          <button key={c.industry} className="chip" aria-pressed={c.industry === industry}
            onClick={() => navigate(routes.industry(runId, c.industry))}>
            {c.industry} <DirectionValue value={c.active_weight} />
          </button>
        ))}
        {byActive.length > ALL_CHIPS_MAX && <select className="chip" aria-label="全部行业" value=""
          onChange={(e) => e.target.value && navigate(routes.industry(runId, e.target.value))}>
          <option value="">全部 {run.industries.length} 个行业 ▾</option>
          {byActive.map((r) => (
            <option key={r.industry} value={r.industry}>{r.industry}（{fmtSignedPct(r.active_weight)}）</option>
          ))}
        </select>}
      </div>

      <section className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }} aria-label="行业概览">
        <KpiCard label="行业组合权重" size="md" value={fmtPct(ind.portfolio_weight)} title={fmtRaw(ind.portfolio_weight)} />
        <KpiCard label="行业基准权重" size="md" value={fmtPct(ind.benchmark_weight)} title={fmtRaw(ind.benchmark_weight)} />
        <KpiCard label="行业主动权重" size="md" value={<DirectionValue value={A} />} />
        <KpiCard label="组合持有 / 基准成分" size="md"
          value={<>{ind.portfolio_count} <span className="unit">/ {ind.benchmark_count} 只</span></>} />
        <KpiCard label={indSide === 'under' ? '低配主要来源' : '超配主要来源'} size="sm"
          value={top ? `${top.stock_name} ${(share(top.active_weight)! * 100).toFixed(1)}%` : '—'} />
      </section>

      <Panel
        label="行业内个股明细"
        title="行业内个股明细（组合 ∪ 基准）"
        extra={<span className="subtitle">贡献占比 = 个股主动权重 ÷ 行业主动权重，合计 100%</span>}
      >
        <div className="scroll-x">
          <table className="data" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>代码</th><th>名称</th><th>持有状态</th>
                <th className="r">组合权重</th><th className="r">基准权重</th><th className="r">主动权重</th>
                <th style={{ width: 220 }}>对行业{indSide === 'under' ? '低配' : '超配'}的贡献</th>
                <th className="r">贡献占比</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => {
                const c = share(s.active_weight)
                return (
                  <tr key={s.stock_code}>
                    <td className="mono">{s.stock_code}</td>
                    <td style={{ fontWeight: 500 }}>{s.stock_name}</td>
                    <td><HoldTag s={s} showBoth /></td>
                    <td className="r" title={fmtRaw(s.portfolio_weight)}>{fmtPct(s.portfolio_weight)}</td>
                    <td className="r muted" title={fmtRaw(s.benchmark_weight)}>{fmtPct(s.benchmark_weight)}</td>
                    <td className="r"><DirectionValue value={s.active_weight} side={s.active_side} /></td>
                    <td><ContributionBar share={c ?? 0} unit={barUnit} side={s.active_side ?? 'neutral'} /></td>
                    <td className="r">{c === null ? '—' : `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c * 100).toFixed(1)}%`}</td>
                  </tr>
                )
              })}
              {merge && (
                <tr className="group">
                  <td className="mono">—</td>
                  <td>
                    <button className="link-btn" onClick={() => setExpanded(true)}>其余基准成分（展开 {merged.length} 只）</button>
                  </td>
                  <td><span className="tag benchOnly">仅基准 · {merged.length} 只合并</span></td>
                  <td className="r">{fmtPct(0)}</td>
                  <td className="r muted">{fmtPct(mergedBench)}</td>
                  <td className="r"><DirectionValue value={mergedActive} /></td>
                  <td><ContributionBar share={share(mergedActive) ?? 0} unit={barUnit} side="under" /></td>
                  <td className="r">{A === 0 ? '—' : `${mergedActive / A > 0 ? '+' : '−'}${Math.abs(mergedActive / A * 100).toFixed(1)}%`}</td>
                </tr>
              )}
              <tr className="total">
                <td colSpan={3}>行业合计</td>
                <td className="r">{fmtPct(ind.portfolio_weight)}</td>
                <td className="r">{fmtPct(ind.benchmark_weight)}</td>
                <td className="r"><DirectionValue value={A} /></td>
                <td />
                <td className="r">{A === 0 ? '—' : '100.0%'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}
