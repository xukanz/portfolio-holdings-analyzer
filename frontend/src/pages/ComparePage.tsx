import { useEffect, useMemo, useRef, useState } from 'react'
import { api, downloadCsv } from '../api'
import { ErrorAlert } from '../components/ErrorAlert'
import { SourceSelect } from '../components/SourceSelect'
import { DirectionValue, DivergingBar, EmptyState, LoadingState, PageHeader, Panel, ProgressBar } from '../components/ui'
import { navigate, routes } from '../router'
import type { Route } from '../router'
import { useSources } from '../sources'
import type { Comparison, ComparisonItem, HistoryItem, IndustryRow } from '../types'
import { ceilTo, fmtHhi, fmtPct, fmtRaw, fmtSignedPct, fmtTime } from '../utils/format'

const MAX = 6
const LAST_KEY = 'compare.last'  // 记住上次的对比选择：切回本页时恢复，并供“分析记录 → 加入对比”追加

function loadLast(): { bench: string; runs: string[]; selected?: string } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(LAST_KEY) ?? 'null')
    return v && typeof v.bench === 'string' && Array.isArray(v.runs) ? v : null
  } catch {
    return null
  }
}

function saveLast(bench: string, runs: string[], selected?: string) {
  try {
    sessionStorage.setItem(LAST_KEY, JSON.stringify({ bench, runs, selected }))
  } catch {
    /* 存储不可用时忽略 */
  }
}

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
  const { benchmarks, meta, defaultBenchmark, loading: sourcesLoading } = useSources()
  const ids = (route.query.get('runs') ?? '').split(',').filter(Boolean)
  const add = route.query.get('add')
  const bench = route.query.get('bench') || defaultBenchmark
  const selected = route.query.get('selected') ?? ids[0] ?? ''
  const [data, setData] = useState<Comparison | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const [history, setHistory] = useState<HistoryItem[] | null>(null)

  const go = (next: { ids?: string[]; bench?: string; selected?: string }, replace = false) => {
    const nIds = next.ids ?? ids
    const nBench = next.bench ?? (route.query.get('bench') || bench || undefined)
    const nSel = nIds.includes(next.selected ?? selected) ? (next.selected ?? selected) : nIds[0]
    if (nBench) saveLast(nBench, nIds, nSel)
    navigate(routes.compare({ runs: nIds.join(',') || undefined, bench: nBench, selected: nSel }), replace)
  }

  // 从侧边栏等入口进入（地址里没有选择）：恢复本次会话中上次的对比
  useEffect(() => {
    if (add || ids.length > 0 || route.query.get('bench')) return
    const last = loadLast()
    if (last && last.runs.length > 0) go({ ids: last.runs, bench: last.bench, selected: last.selected }, true)
  }, [route]) // eslint-disable-line react-hooks/exhaustive-deps

  // 从“分析记录 → 加入对比”进入：追加到上次同一基准的选择中（基准不同则重新开始）
  useEffect(() => {
    if (!add) return
    const last = loadLast()
    const base = last && last.bench === bench ? last.runs.filter((r) => r !== add) : []
    go({ ids: [...base, add].slice(-MAX), bench, selected: add }, true)
  }, [add]) // eslint-disable-line react-hooks/exhaustive-deps

  // 可选项来自已有的成功分析记录
  useEffect(() => {
    let alive = true
    api.history({ limit: 500, status: 'success' })
      .then((r) => alive && setHistory(r.items))
      .catch((e) => alive && (setError(e), setHistory([])))
    return () => {
      alive = false
    }
  }, [pickerOpen])

  /** 可对比的记录：基准与主数据内容和当前一致（指纹相同）；每个组合只列一条——已选的那条，否则最近一次 */
  const benchSha = benchmarks.find((b) => b.id === bench)?.sha256
  const candidates = useMemo(() => {
    const usable = (history ?? []).filter((h) => h.benchmark_id === bench
      && (!benchSha || h.benchmark_sha256 === benchSha)
      && (!meta?.master_sha256 || h.master_sha256 === meta.master_sha256))
    const picked = new Set(usable.filter((h) => ids.includes(h.id)).map((h) => h.portfolio_id))
    const seen = new Set<string>()
    return usable.filter((h) => {
      if (ids.includes(h.id)) return true
      if (picked.has(h.portfolio_id) || seen.has(h.portfolio_id)) return false
      seen.add(h.portfolio_id)
      return true
    })
  }, [history, bench, benchSha, meta?.master_sha256, ids.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const key = ids.join(',')
  useEffect(() => {
    if (ids.length < 2) {
      setData(null)
      return
    }
    let alive = true
    setBusy(true)
    setError(null)
    api.compareRuns(ids)
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
  const sel = items.find((it) => it.analysis_id === selected) ?? items[0]
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
          <SourceSelect label="统一基准" items={benchmarks} value={bench} onChange={(b) => go({ bench: b, ids: [] })} />
          <div style={{ position: 'relative' }} ref={pickerRef}>
            <button className="btn" aria-expanded={pickerOpen} onClick={() => setPickerOpen((v) => !v)}>+ 添加组合（{ids.length}/{MAX}）</button>
            {pickerOpen && (
              <div className="popover" role="dialog" aria-label="选择对比组合">
                <div className="hint">从该基准下的分析记录中勾选 2~{MAX} 个（每个组合取最近一次）</div>
                {history === null && <div className="hint">加载中…</div>}
                {history !== null && candidates.length === 0 && (
                  <div className="hint">该基准下还没有分析记录，先去 <a href={routes.analysis()}>组合体检</a> 分析组合</div>
                )}
                {candidates.map((h) => {
                  const on = ids.includes(h.id)
                  return (
                    <label key={h.id}>
                      <input type="checkbox" checked={on} disabled={!on && ids.length >= MAX} onChange={() => toggle(h.id)} />
                      {h.portfolio_name}<span className="muted" style={{ marginLeft: 'auto', paddingLeft: 12, fontSize: 13, whiteSpace: 'nowrap' }}>{fmtTime(h.created_at)}</span>
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

      {ids.length < 2 && !sourcesLoading && history !== null && (
        <div className="panel"><EmptyState>
          {candidates.length < 2
            ? <>该基准下已分析的组合不足 2 个，先去 <a href={routes.analysis()}>组合体检</a> 分析组合，或在 <a href={routes.runsNew()}>分析记录</a> 中点击“加入对比”</>
            : `已选 ${ids.length} 个，请点击“+ 添加组合”，从分析记录中至少选择 2 个`}
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
                    const on = it.analysis_id === sel.analysis_id
                    const x = `${it.metrics.active_share * 100}%`
                    const y = `${100 - (it.metrics.hhi / yMax) * 100}%`
                    return (
                      <span key={it.analysis_id}>
                        <button className="dot" style={{ left: x, top: y }} aria-pressed={on}
                          aria-label={`${it.portfolio.name}：主动份额 ${fmtPct(it.metrics.active_share)}，HHI ${fmtHhi(it.metrics.hhi)}`}
                          onClick={() => go({ selected: it.analysis_id }, true)} />
                        <span className={`dot-label ${on ? 'on' : ''}`} style={{ left: x, top: y, ...labels[i] }}>{it.portfolio.name}</span>
                      </span>
                    )
                  })}
                </div>
                <div className="pos-xaxis" aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div>
                <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>主动份额 →</div>
                <div style={{ position: 'absolute', left: 62, top: 0, fontSize: 13, color: 'var(--text-secondary)' }}>HHI ↑</div>
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
                <div><div className="k">最大超配行业</div><div style={{ fontSize: 15 }}><IndustryText r={extremes(sel).over} /></div></div>
                <div><div className="k">最大低配行业</div><div style={{ fontSize: 15 }}><IndustryText r={extremes(sel).under} /></div></div>
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
                    const on = it.analysis_id === sel.analysis_id
                    const e = extremes(it)
                    return (
                      <tr key={it.analysis_id} className={on ? 'selected' : undefined}>
                        <td>
                          <button className="link-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}
                            aria-pressed={on} onClick={() => go({ selected: it.analysis_id }, true)}>
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
