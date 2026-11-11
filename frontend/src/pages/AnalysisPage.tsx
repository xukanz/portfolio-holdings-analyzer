import { useEffect, useState } from 'react'
import { api, ApiError, isFailedRun } from '../api'
import { ErrorAlert } from '../components/ErrorAlert'
import { HoldingsTable } from '../components/HoldingsTable'
import { IndustryComparePanel } from '../components/IndustryComparePanel'
import { SourceSelect } from '../components/SourceSelect'
import { ActiveWeightTable } from '../components/StockTables'
import { EmptyState, ErrorState, KpiCard, LoadingState, PageHeader, ProgressBar, SelfCheck } from '../components/ui'
import { navigate, routes } from '../router'
import { useSources } from '../sources'
import type { AnalysisRun, FailedRun } from '../types'
import { fmtHhi, fmtInt, fmtMoney, fmtPct, fmtRaw, fmtTime, shortId } from '../utils/format'

export function AnalysisPage({ runId, onRunLoaded }: { runId?: string; onRunLoaded: (r: AnalysisRun) => void }) {
  const { portfolios, benchmarks } = useSources()
  const [run, setRun] = useState<AnalysisRun | FailedRun | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [empty, setEmpty] = useState(false)
  const [reload, setReload] = useState(0)
  const [pid, setPid] = useState('')
  const [bid, setBid] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)

  useEffect(() => {
    let alive = true
    setLoadError(null)
    setEmpty(false)
    if (!runId) {
      // 未指定分析编号：打开最近一次成功的分析
      api.history({ limit: 1, status: 'success' }).then((h) => {
        if (!alive) return
        if (h.items[0]) navigate(routes.analysis(h.items[0].id), true)
        else setEmpty(true)
      }).catch((e) => alive && setLoadError(e))
      return () => {
        alive = false
      }
    }
    setRun(null)
    api.getRun(runId).then((r) => {
      if (!alive) return
      setRun(r)
      setPid(r.portfolio.id)
      setBid(r.benchmark.id)
      if (!isFailedRun(r)) onRunLoaded(r)
    }).catch((e) => alive && setLoadError(e))
    return () => {
      alive = false
    }
  }, [runId, reload]) // eslint-disable-line react-hooks/exhaustive-deps

  const rerun = async () => {
    setBusy(true)
    setActionError(null)
    try {
      const r = await api.analyze(pid, bid, run?.top_n)
      navigate(routes.analysis(r.id))
    } catch (e) {
      setActionError(e)
    } finally {
      setBusy(false)
    }
  }

  const header = (actions?: React.ReactNode) => (
    <PageHeader breadcrumb="分析 › 组合体检" title="组合体检" actions={actions} />
  )

  if (empty) {
    return (
      <>
        {header()}
        <div className="panel"><EmptyState>暂无分析记录，去 <a href={routes.runsNew()}>数据与校验</a> 发起第一次分析</EmptyState></div>
      </>
    )
  }
  if (loadError) {
    const notFound = loadError instanceof ApiError && loadError.status === 404
    return (
      <>
        {header()}
        <div className="panel">
          {notFound
            ? <EmptyState>分析记录不存在，去 <a href={routes.runs()}>分析记录</a> 查看</EmptyState>
            : <ErrorState error={loadError} onRetry={() => setReload((x) => x + 1)} />}
        </div>
      </>
    )
  }
  if (!run) {
    return (
      <>
        {header()}
        <div className="kpi-grid">{Array.from({ length: 5 }, (_, i) => <KpiCard key={i} label="加载中" value="—" />)}</div>
        <div className="panel"><LoadingState rows={8} /></div>
      </>
    )
  }
  if (isFailedRun(run)) {
    return (
      <>
        {header()}
        <div className="panel">
          <EmptyState>
            分析 {shortId(run.id)} 未通过数据校验，没有结果：{run.error.message}
            <div><a className="btn" href={routes.runsNew(run.id)}>查看校验详情</a></div>
          </EmptyState>
        </div>
      </>
    )
  }

  const m = run.metrics
  const maxStock = run.top10[0]
  const industryHref = (ind: string) => routes.industry(run.id, ind)
  const changed = pid !== run.portfolio.id || bid !== run.benchmark.id

  return (
    <>
      {header(
        <>
          <a className="btn" href={api.exportUrl(run.id, 'industry')}>导出行业 CSV</a>
          <a className="btn" href={api.exportUrl(run.id, 'active')}>导出个股 CSV</a>
          <button className="btn primary" onClick={rerun} disabled={busy || !pid || !bid}>
            {busy ? '分析中…' : changed ? '按所选数据分析' : '重新分析'}
          </button>
        </>,
      )}
      <section className="context-bar" aria-label="分析上下文">
        <SourceSelect label="组合" items={portfolios} value={pid} onChange={setPid} />
        <SourceSelect label="业绩基准" items={benchmarks} value={bid} onChange={setBid} />
        <a href={routes.dataCheck({ portfolio: pid, benchmark: bid })} style={{ fontSize: 14 }}>上传 / 校验数据</a>
        <span className="muted">分析编号 <a href={routes.runs(run.id)} className="mono" style={{ fontWeight: 500 }}>{shortId(run.id)}</a></span>
        <span className="muted">{fmtTime(run.created_at)} · 总市值 {fmtMoney(m.total_market_value)}</span>
        <span className="counts">组合 {fmtInt(m.portfolio_stock_count)} 只 · 基准 {fmtInt(m.benchmark_stock_count)} 只 · 并集 {fmtInt(run.stocks.length)} 只</span>
      </section>
      <ErrorAlert error={actionError} onClose={() => setActionError(null)} action={
        actionError instanceof ApiError && actionError.code === 'VALIDATION_FAILED' && (
          <a className="btn small" href={routes.dataCheck({ portfolio: pid, benchmark: bid, check: true })}>查看校验详情</a>
        )} />
      {run.warnings.map((w) => <div key={w} className="alert warn"><div className="title">{w}</div></div>)}

      <section className="kpi-grid" aria-label="集中度与整体偏离">
        <KpiCard label="前十大重仓权重" value={fmtPct(m.top10_weight)} title={fmtRaw(m.top10_weight)}
          sub={maxStock && `最大单票 ${fmtPct(maxStock.portfolio_weight)}（${maxStock.stock_name}）`} />
        <KpiCard label="赫芬达尔指数 HHI" value={fmtHhi(m.hhi)}
          sub={`等效持股数 1/HHI ≈ ${(1 / m.hhi).toFixed(1)} 只`} />{/* 等效持股数为纯展示派生值 */}
        <KpiCard label="主动份额 Active Share" value={fmtPct(m.active_share)} title={fmtRaw(m.active_share)}>
          <div style={{ marginTop: 10 }}><ProgressBar value={m.active_share} /></div>
          <div className="progress-ends"><span>贴近基准 0</span><span>1 完全偏离</span></div>
        </KpiCard>
        <KpiCard label="重合股票数" value={<>{fmtInt(m.overlap_count)} <span className="unit">只</span></>}
          sub="两边权重均 > 0 的股票" />
        <KpiCard label="重合权重" value={fmtPct(m.overlap_weight)} title={fmtRaw(m.overlap_weight)}>
          <SelfCheck overlapWeight={m.overlap_weight} activeShare={m.active_share} sum={m.overlap_plus_active_share} />
        </KpiCard>
      </section>

      <IndustryComparePanel runId={run.id} industries={run.industries} />

      <div className="grid-auto" style={{ ['--min' as string]: '420px' }}>
        <ActiveWeightTable runId={run.id} side="over" defaultTop={run.top_n ?? 10} industryHref={industryHref} />
        <ActiveWeightTable runId={run.id} side="under" defaultTop={run.top_n ?? 10} industryHref={industryHref} />
      </div>

      <HoldingsTable stocks={run.stocks} industries={run.industries} exportUrl={api.exportUrl(run.id, 'active')}
        industryHref={industryHref} />
    </>
  )
}
