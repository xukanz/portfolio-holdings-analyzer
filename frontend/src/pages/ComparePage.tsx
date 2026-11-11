import { useEffect, useMemo, useRef, useState } from 'react'
import { api, downloadCsv } from '../api'
import { ErrorAlert } from '../components/ErrorAlert'
import { SourceSelect } from '../components/SourceSelect'
import { DirectionValue, DivergingBar, EmptyState, LoadingState, PageHeader, Panel, ProgressBar } from '../components/ui'
import { navigate, routes } from '../router'
import type { Route } from '../router'
import { useSources } from '../sources'
import type { Comparison, ComparisonItem, IndustryRow } from '../types'
import { ceilTo, fmtHhi, fmtPct, fmtRaw, fmtSignedPct } from '../utils/format'

const MAX = 6
const DEFAULT_COUNT = 4

/** 最大超配 / 最大低配行业（从已返回的行业列表中挑选，不做计算） */
function extremes(item: ComparisonItem): { over: IndustryRow | null; under: IndustryRow | null } {
  const sorted = [...item.industries].sort((a, b) => b.active_weight - a.active_weight)
  const over = sorted[0] && sorted[0].active_weight > 0 ? sorted[0] : null
  const last = sorted[sorted.length - 1]
  return { over, under: last && last.active_weight < 0 ? last : null }
}

const IndustryText = ({ r }: { r: IndustryRow | null }) =>
  r ? <span>{r.industry} <DirectionValue value={r.active_weight} /></span> : <span className="muted">—</span>

export function ComparePage({ route }: { route: Route }) {
  const { portfolios, benchmarks, defaultBenchmark, loading: sourcesLoading } = useSources()
  const ids = (route.query.get('ids') ?? '').split(',').filter(Boolean)
  const bench = route.query.get('bench') || defaultBenchmark
  const selected = route.query.get('selected') ?? ids[0] ?? ''
  const [data, setData] = useState<Comparison | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const ok = portfolios.filter((p) => p.status === 'ok')

  const go = (next: { ids?: string[]; bench?: string; selected?: string }, replace = false) => {
    const nIds = next.ids ?? ids
    navigate(routes.compare({
      ids: nIds.join(','), bench: next.bench ?? route.query.get('bench') ?? undefined,
      selected: nIds.includes(next.selected ?? selected) ? (next.selected ?? selected) : nIds[0],
    }), replace)
  }

  // 首次进入：默认选前 4 个可用组合
  useEffect(() => {
    if (!sourcesLoading && ids.length === 0 && ok.length >= 2) {
      const ordered = [...ok.filter((p) => p.id === 'portfolio'), ...ok.filter((p) => p.id !== 'portfolio')]
      go({ ids: ordered.slice(0, DEFAULT_COUNT).map((p) => p.id) }, true)
    }
  }, [sourcesLoading, ids.length, ok.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const key = `${ids.join(',')}|${bench}`
  useEffect(() => {
    if (ids.length < 2 || !bench) {
      setData(null)
      return
    }
    let alive = true
    setBusy(true)
    setError(null)
    api.compare(ids, bench)
      .then((d) => alive && setData(d))
      .catch((e) => alive && (setError(e), setData(null)))
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pickerOpen) return
    const close = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [pickerOpen])

  const toggle = (id: string) => go({ ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] })

  const items = data?.items ?? []
  const sel = items.find((it) => it.portfolio.id === selected) ?? items[0]
  // Y 轴上限由数据决定：最大 HHI 向上取整到 0.02
  const yMax = ceilTo(Math.max(0, ...items.map((it) => it.metrics.hhi)), 0.02)

  // 定位图标签布局（纯展示）：靠右的点标签放在左侧；与已放置的点过近时改放下方，避免重叠
  const labels = useMemo(() => {
    const placed: { x: number; y: number }[] = []
    return items.map((it) => {
      const x = it.metrics.active_share
      const y = it.metrics.hhi / yMax
      const near = placed.filter((p) => Math.abs(p.x - x) < 0.25 && Math.abs(p.y - y) < 0.12).length
      placed.push({ x, y })
      const dx = x > 0.7 ? 'calc(-100% - 12px)' : '12px'
      const dy = near % 2 === 1 ? '10px' : y > 0.85 ? '8px' : '-26px'
      return { transform: `translate(${dx}, ${dy})` }
    })
  }, [items, yMax])

  const industries = useMemo(() => {
    const set = new Set<string>()
    items.forEach((it) => it.industries.forEach((r) => set.add(r.industry)))
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [items])
  const lookup = useMemo(() => items.map((it) => new Map(it.industries.map((r) => [r.industry, r]))), [items])
  const activeMax = ceilTo(Math.max(0, ...items.flatMap((it) => it.industries.map((r) => Math.abs(r.active_weight)))), 0.02)

  const exportCsv = () => downloadCsv(`多组合对比_${data?.benchmark.name ?? ''}.csv`, [
    ['portfolio', 'top10_weight', 'hhi', 'active_share', 'overlap_count', 'overlap_weight', 'max_over_industry', 'max_under_industry'],
    ...items.map((it) => {
      const e = extremes(it)
      return [it.portfolio.name, fmtRaw(it.metrics.top10_weight), fmtRaw(it.metrics.hhi), fmtRaw(it.metrics.active_share),
        it.metrics.overlap_count, fmtRaw(it.metrics.overlap_weight),
        e.over ? `${e.over.industry} ${fmtRaw(e.over.active_weight)}` : '', e.under ? `${e.under.industry} ${fmtRaw(e.under.active_weight)}` : '']
    }),
  ])

  return (
    <>
      <PageHeader breadcrumb="分析 › 多组合对比" title="多组合横向对比" actions={
        <>
          <SourceSelect label="统一基准" items={benchmarks} value={bench} onChange={(b) => go({ bench: b })} />
          <div style={{ position: 'relative' }} ref={pickerRef}>
            <button className="btn" aria-expanded={pickerOpen} onClick={() => setPickerOpen((v) => !v)}>+ 添加组合（{ids.length}/{MAX}）</button>
            {pickerOpen && (
              <div className="popover" role="dialog" aria-label="选择对比组合">
                <div className="hint">勾选 2~{MAX} 个组合</div>
                {ok.map((p) => {
                  const on = ids.includes(p.id)
                  return (
                    <label key={p.id}>
                      <input type="checkbox" checked={on} disabled={!on && ids.length >= MAX} onChange={() => toggle(p.id)} />
                      {p.name}{p.source === 'upload' ? '（上传）' : ''}<span className="muted" style={{ marginLeft: 'auto', fontSize: 14 }}>{p.row_count} 只</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
          <button className="btn" onClick={exportCsv} disabled={!items.length}>导出 CSV</button>
        </>
      } />
      <ErrorAlert error={error} onClose={() => setError(null)} />

      {ids.length < 2 && !sourcesLoading && (
        <div className="panel"><EmptyState>
          {ok.length < 2 ? <>可用组合不足 2 个，去 <a href={routes.runsNew()}>数据与校验</a> 上传组合</> : '请点击“+ 添加组合”，至少选择 2 个组合'}
        </EmptyState></div>
      )}
      {busy && !data && <div className="panel"><LoadingState rows={8} /></div>}

      {data && sel && (
        <>
          <div className="grid-auto" style={{ ['--min' as string]: '460px' }}>
            <Panel label="定位图" title="偏离 × 集中 定位图" extra={<span className="subtitle">点击圆点或表格行高亮组合</span>}>
              <div className="pos-chart">
                <div className="pos-plot">
                  <div className="pos-yaxis" aria-hidden="true"><span>{yMax.toFixed(2)}</span><span>{(yMax / 2).toFixed(2)}</span><span>0</span></div>
                  <div className="vline" />
                  <div className="hline" />
                  <span className="quad" style={{ right: 8, bottom: 'calc(100% - 22px)', color: 'var(--text-quadrant)' }}>高偏离 · 高集中</span>
                  <span className="quad muted" style={{ left: 8, top: 'calc(100% - 22px)' }}>贴近基准 · 分散</span>
                  {items.map((it, i) => {
                    const on = it.portfolio.id === sel.portfolio.id
                    const x = `${it.metrics.active_share * 100}%`
                    const y = `${100 - (it.metrics.hhi / yMax) * 100}%`
                    return (
                      <span key={it.analysis_id}>
                        <button className="dot" style={{ left: x, top: y }} aria-pressed={on}
                          aria-label={`${it.portfolio.name}：主动份额 ${fmtPct(it.metrics.active_share)}，HHI ${fmtHhi(it.metrics.hhi)}`}
                          onClick={() => go({ selected: it.portfolio.id }, true)} />
                        <span className={`dot-label ${on ? 'on' : ''}`} style={{ left: x, top: y, ...labels[i] }}>{it.portfolio.name}</span>
                      </span>
                    )
                  })}
                </div>
                <div className="pos-xaxis" aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div>
                <div style={{ textAlign: 'center', fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>主动份额 →</div>
                <div style={{ position: 'absolute', left: 62, top: 0, fontSize: 14, color: 'var(--text-secondary)' }}>HHI ↑</div>
              </div>
            </Panel>

            <Panel label="对比解读" title={`选中组合：${sel.portfolio.name}`}
              footer={<a className="btn primary" href={routes.analysis(sel.analysis_id)}>打开该组合体检</a>}>
              <div className="sel-grid">
                <div><div className="k">主动份额</div><div className="v" title={fmtRaw(sel.metrics.active_share)}>{fmtPct(sel.metrics.active_share)}</div></div>
                <div><div className="k">重合权重</div><div className="v" title={fmtRaw(sel.metrics.overlap_weight)}>{fmtPct(sel.metrics.overlap_weight)}</div></div>
                <div>
                  <div className="k">HHI / 等效持股数</div><div className="v">{fmtHhi(sel.metrics.hhi)}</div>
                  <div className="k">≈ {(1 / sel.metrics.hhi).toFixed(1)} 只</div>
                </div>
                <div><div className="k">前十大权重</div><div className="v" title={fmtRaw(sel.metrics.top10_weight)}>{fmtPct(sel.metrics.top10_weight)}</div></div>
                <div><div className="k">最大超配行业</div><div style={{ fontSize: 17 }}><IndustryText r={extremes(sel).over} /></div></div>
                <div><div className="k">最大低配行业</div><div style={{ fontSize: 17 }}><IndustryText r={extremes(sel).under} /></div></div>
              </div>
            </Panel>
          </div>

          <Panel label="对比明细" title={`指标对比（同一基准：${data.benchmark.name}）`}
            extra={<span className="subtitle">每行均满足 重合权重 + 主动份额 = 100%</span>}>
            <div className="scroll-x">
              <table className="data" style={{ minWidth: 980 }}>
                <thead>
                  <tr>
                    <th>组合</th><th className="r">前十大权重</th><th className="r">HHI</th><th className="r">等效持股数</th>
                    <th style={{ width: 200 }}>主动份额</th><th className="r">重合股票数</th><th className="r">重合权重</th>
                    <th>最大超配</th><th>最大低配</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const on = it.portfolio.id === sel.portfolio.id
                    const e = extremes(it)
                    return (
                      <tr key={it.analysis_id} className={on ? 'selected' : undefined}>
                        <td>
                          <button className="link-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}
                            aria-pressed={on} onClick={() => go({ selected: it.portfolio.id }, true)}>
                            <span className={`color-dot ${on ? 'on' : ''}`} />{it.portfolio.name}
                          </button>
                        </td>
                        <td className="r" title={fmtRaw(it.metrics.top10_weight)}>{fmtPct(it.metrics.top10_weight)}</td>
                        <td className="r">{fmtHhi(it.metrics.hhi)}</td>
                        <td className="r muted">{(1 / it.metrics.hhi).toFixed(1)}</td>
                        <td>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ flex: 1 }}><ProgressBar value={it.metrics.active_share} /></span>
                            <span style={{ width: 58, textAlign: 'right' }} title={fmtRaw(it.metrics.active_share)}>{fmtPct(it.metrics.active_share)}</span>
                          </span>
                        </td>
                        <td className="r">{it.metrics.overlap_count}</td>
                        <td className="r" title={fmtRaw(it.metrics.overlap_weight)}>{fmtPct(it.metrics.overlap_weight)}</td>
                        <td><IndustryText r={e.over} /></td>
                        <td><IndustryText r={e.under} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel label="行业主动权重对照" title="行业主动权重对照" subtitle={`同一行业在各组合中的超低配 · 发散条满刻度 ±${fmtPct(activeMax, 0)}`}>
            <div className="scroll-x">
              <table className="data" style={{ minWidth: 200 + items.length * 180 }}>
                <thead>
                  <tr><th>行业</th>{items.map((it) => <th key={it.analysis_id}>{it.portfolio.name}</th>)}</tr>
                </thead>
                <tbody>
                  {industries.map((ind) => (
                    <tr key={ind}>
                      <td style={{ fontWeight: 500 }}>{ind}</td>
                      {lookup.map((m, i) => {
                        const r = m.get(ind)
                        return (
                          <td key={i}>
                            {r ? (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }} title={`组合 ${fmtPct(r.portfolio_weight)} / 基准 ${fmtPct(r.benchmark_weight)} / 主动 ${fmtSignedPct(r.active_weight)}`}>
                                <span style={{ width: 80, flex: 'none' }}><DivergingBar value={r.active_weight} scaleMax={activeMax} thin /></span>
                                <DirectionValue value={r.active_weight} />
                              </span>
                            ) : <span className="muted">—</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </>
  )
}
