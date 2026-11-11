import { useEffect, useRef, useState } from 'react'
import { api, ApiError, isFailedRun } from '../api'
import { RunHistoryTable } from '../components/RunHistoryTable'
import { SourceSelect } from '../components/SourceSelect'
import { UploadButton } from '../components/UploadPanel'
import { ValidationPanel } from '../components/ValidationPanel'
import type { ValidationState } from '../components/ValidationPanel'
import { PageHeader, Panel } from '../components/ui'
import { navigate, routes } from '../router'
import type { Route } from '../router'
import { useSources } from '../sources'
import type { SourceSummary } from '../types'
import { fmtInt, fmtTime, shortId } from '../utils/format'

const DEFAULT_PORTFOLIO = 'portfolio'  // 默认示例组合优先
const TOP_MIN = 1
const TOP_MAX = 100

function topNError(v: string): string | null {
  return /^\d+$/.test(v.trim()) && Number(v) >= TOP_MIN && Number(v) <= TOP_MAX ? null : `请输入 ${TOP_MIN}–${TOP_MAX} 之间的整数`
}

export function RunsPage({ route, mode }: { route: Route; mode: 'new' | 'list' }) {
  if (mode === 'list') {
    return (
      <>
        <PageHeader breadcrumb="管理 › 分析记录" title="分析记录" actions={<a className="btn primary" href={routes.runsNew()}>数据与校验</a>} />
        <RunHistoryTable highlight={route.query.get('highlight')} />
      </>
    )
  }
  return (
    <NewRun failedRunId={route.query.get('run')} presetPortfolio={route.query.get('portfolio')}
      presetBenchmark={route.query.get('benchmark')} autoCheck={route.query.get('check') === '1'} />
  )
}

function NewRun({ failedRunId, presetPortfolio, presetBenchmark, autoCheck }: {
  failedRunId: string | null
  presetPortfolio: string | null
  presetBenchmark: string | null
  autoCheck: boolean
}) {
  const { portfolios, benchmarks, meta, defaultBenchmark, reload } = useSources()
  const [pid, setPid] = useState(presetPortfolio ?? '')
  const [bid, setBid] = useState(presetBenchmark ?? '')
  const [topN, setTopN] = useState('10')
  const [busy, setBusy] = useState<'' | 'analyze' | 'validate'>('')
  const [vstate, setVstate] = useState<ValidationState>({ kind: 'idle' })
  const [refreshKey, setRefreshKey] = useState(0)

  // 默认选中第一个可用组合与默认基准
  useEffect(() => {
    if (!pid && portfolios.length && !failedRunId) {
      const ok = portfolios.filter((p) => p.status === 'ok')
      setPid((ok.find((p) => p.id === DEFAULT_PORTFOLIO) ?? ok[0] ?? portfolios[0]).id)
    }
  }, [portfolios]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!bid && defaultBenchmark && !failedRunId) setBid(defaultBenchmark)
  }, [defaultBenchmark]) // eslint-disable-line react-hooks/exhaustive-deps

  // 从分析记录点“查看原因”进入：回显该次失败的输入与错误
  useEffect(() => {
    if (!failedRunId) return
    api.getRun(failedRunId).then((r) => {
      setPid(r.portfolio.id)
      setBid(r.benchmark.id)
      if (r.top_n) setTopN(String(r.top_n))
      if (isFailedRun(r)) {
        setVstate({ kind: 'fail', error: new ApiError(r.error, 422),
          context: `分析记录 ${shortId(r.id)}（${fmtTime(r.created_at)}）未通过校验，已拒绝分析：` })
      } else {
        setVstate({ kind: 'idle', note: `分析记录 ${shortId(r.id)} 已成功完成` })
      }
    }).catch((e) => setVstate({ kind: 'fail', error: e }))
  }, [failedRunId])

  // 从组合体检“查看校验详情”进入：预选数据后自动校验一次，问题统一在本页展示
  const autoChecked = useRef(false)
  useEffect(() => {
    if (autoCheck && !autoChecked.current && pid && bid) {
      autoChecked.current = true
      validate()
    }
  }, [autoCheck, pid, bid]) // eslint-disable-line react-hooks/exhaustive-deps

  const nErr = topNError(topN)
  const formValid = !nErr && !!pid && !!bid

  const analyze = async () => {
    if (!formValid || busy) return
    setBusy('analyze')
    try {
      const r = await api.analyze(pid, bid, Number(topN))
      navigate(routes.analysis(r.id))
    } catch (e) {
      setVstate({ kind: 'fail', error: e })
      setRefreshKey((x) => x + 1)  // 失败的分析也会留痕
    } finally {
      setBusy('')
    }
  }

  const validate = async () => {
    if (!pid || !bid || busy) return
    setBusy('validate')
    try {
      setVstate({ kind: 'pass', info: await api.validate(pid, bid) })
    } catch (e) {
      setVstate({ kind: 'fail', error: e })
    } finally {
      setBusy('')
    }
  }

  const onUploaded = async (s: SourceSummary) => {
    await reload()
    if (s.kind === 'portfolio') setPid(s.id)
    else setBid(s.id)
    setVstate({ kind: 'idle', note: `已上传${s.kind === 'portfolio' ? '组合' : '基准'}「${s.name}」（${s.row_count} 只），校验已通过，可直接开始分析` })
  }

  const bad = [...portfolios, ...benchmarks].filter((s) => s.status !== 'ok')

  return (
    <>
      <PageHeader breadcrumb="管理 › 数据与校验" title="数据与校验" />
      <div className="grid-auto" style={{ ['--min' as string]: '440px' }}>
        <Panel label="分析参数" title="分析参数">
          <form className="form" onSubmit={(e) => { e.preventDefault(); analyze() }} noValidate>
            <SourceSelect id="f-portfolio" label="组合持仓文件" items={portfolios} value={pid} onChange={setPid} allowInvalid stacked />
            <SourceSelect id="f-benchmark" label="业绩基准文件" items={benchmarks} value={bid} onChange={setBid} allowInvalid stacked />
            <div className="actions">
              <UploadButton kind="portfolio" onUploaded={onUploaded} onError={(e) => setVstate({ kind: 'fail', error: e, context: '上传未通过校验，文件未入库：' })} />
              <UploadButton kind="benchmark" onUploaded={onUploaded} onError={(e) => setVstate({ kind: 'fail', error: e, context: '上传未通过校验，文件未入库：' })} />
            </div>
            <div className="stack-field">
              <label htmlFor="topn">个股排行 Top N</label>
              <input id="topn" className="input" inputMode="numeric" value={topN} onChange={(e) => setTopN(e.target.value)}
                aria-invalid={!!nErr} aria-describedby="topn-msg" />
              <span id="topn-msg" className={`field-msg ${nErr ? 'error' : ''}`}>
                {nErr ?? `将展示超配、低配各前 ${Number(topN)} 只`}
              </span>
            </div>
            <div className="info-box">
              主数据：stock_info.csv · 已加载 {meta ? fmtInt(meta.stock_count) : '—'} 只 · {meta ? (meta.industry_count ?? meta.industries.length) : '—'} 个行业<br />
              启动自检：{bad.length === 0
                ? '全部数据文件字段完整、数值可解析'
                : `${bad.length} 个数据文件不合规（${bad.map((s) => s.name).join('、')}），选中后点击“仅校验”查看明细`}
            </div>
            <div className="actions">
              <button type="submit" className="btn primary large" disabled={!formValid || !!busy}>{busy === 'analyze' ? '分析中…' : '开始分析'}</button>
              <button type="button" className="btn large" disabled={!pid || !bid || !!busy} onClick={validate}>{busy === 'validate' ? '校验中…' : '仅校验'}</button>
            </div>
          </form>
        </Panel>
        <ValidationPanel state={vstate} />
      </div>
      <RunHistoryTable refreshKey={refreshKey} highlight={failedRunId} />
    </>
  )
}
