import { useCallback, useState } from 'react'
import { AppShell } from './components/AppShell'
import type { NavKey } from './components/AppShell'
import { ErrorState, PageHeader } from './components/ui'
import { DirectionProvider } from './direction'
import { AnalysisPage } from './pages/AnalysisPage'
import { ComparePage } from './pages/ComparePage'
import { IndustryPage } from './pages/IndustryPage'
import { RunsPage } from './pages/RunsPage'
import { routes, useRoute } from './router'
import { SourcesProvider, useSources } from './sources'
import type { AnalysisRun } from './types'

function Routes() {
  const route = useRoute()
  const { error, reload } = useSources()
  // 最近查看的分析，供侧栏“行业穿透”直接跳转（默认打开偏离最大的行业）
  const [lastRun, setLastRun] = useState<AnalysisRun | null>(null)
  const onRunLoaded = useCallback((r: AnalysisRun) => setLastRun(r), [])
  const [p0, p1, p2, p3] = route.path

  let active: NavKey | null = null
  let page: React.ReactNode
  if (!p0 || (p0 === 'analysis' && !p2)) {
    active = 'analysis'
    page = <AnalysisPage key={p1 ?? ''} runId={p1} onRunLoaded={onRunLoaded} />
  } else if (p0 === 'analysis' && p2 === 'industry' && p1 && p3) {
    active = 'industry'
    page = <IndustryPage runId={p1} industry={p3} onRunLoaded={onRunLoaded} />
  } else if (p0 === 'compare') {
    active = 'compare'
    page = <ComparePage route={route} />
  } else if (p0 === 'runs' && p1 === 'new') {
    active = 'runsNew'
    page = <RunsPage key={route.query.toString()} route={route} mode="new" />
  } else if (p0 === 'runs') {
    active = 'runs'
    page = <RunsPage route={route} mode="list" />
  } else {
    page = <><PageHeader breadcrumb="" title="页面不存在" /><div className="panel"><div className="state"><a href="#/analysis">返回组合体检</a></div></div></>
  }

  const topIndustry = lastRun && [...lastRun.industries].sort((a, b) => Math.abs(b.active_weight) - Math.abs(a.active_weight))[0]
  const industryHref = lastRun && topIndustry ? routes.industry(lastRun.id, topIndustry.industry) : routes.analysis()

  return (
    <AppShell active={active} industryHref={industryHref}>
      {error ? <div className="panel"><ErrorState error={error} onRetry={reload} /></div> : page}
    </AppShell>
  )
}

export default function App() {
  return (
    <DirectionProvider>
      <SourcesProvider>
        <Routes />
      </SourcesProvider>
    </DirectionProvider>
  )
}
