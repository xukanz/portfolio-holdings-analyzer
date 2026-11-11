import { useEffect, useState } from 'react'

/** 极简哈希路由：#/path/seg?query。无需服务端回退配置 */
export interface Route {
  path: string[]
  query: URLSearchParams
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [p, q = ''] = raw.split('?')
  return {
    path: p.split('/').filter(Boolean).map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    }),
    query: new URLSearchParams(q),
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const h = () => setRoute(parse())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return route
}

export function href(segments: string[], query?: Record<string, string | undefined | null>): string {
  const path = '/' + segments.map(encodeURIComponent).join('/')
  const qs = new URLSearchParams()
  Object.entries(query ?? {}).forEach(([k, v]) => {
    if (v) qs.set(k, v)
  })
  const s = qs.toString()
  return `#${path}${s ? `?${s}` : ''}`
}

export function navigate(to: string, replace = false) {
  if (replace) {
    window.history.replaceState(null, '', to)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = to.replace(/^#/, '')
  }
}

export const routes = {
  analysis: (runId?: string) => href(runId ? ['analysis', runId] : ['analysis']),
  industry: (runId: string, industry: string) => href(['analysis', runId, 'industry', industry]),
  /** runs：要对比的分析记录 id（逗号分隔）；add：把这条记录追加到上次的对比选择中 */
  compare: (q?: { runs?: string; add?: string; selected?: string; bench?: string }) => href(['compare'], q),
  runsNew: (run?: string) => href(['runs', 'new'], { run }),
  /** 数据与校验页：预选组合 / 基准；check=1 时进入后自动“仅校验” */
  dataCheck: (q: { portfolio?: string; benchmark?: string; check?: boolean }) =>
    href(['runs', 'new'], { portfolio: q.portfolio, benchmark: q.benchmark, check: q.check ? '1' : undefined }),
  runs: (highlight?: string) => href(['runs'], { highlight }),
}
