import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import type { Meta, SourceSummary } from './types'

interface Sources {
  portfolios: SourceSummary[]
  benchmarks: SourceSummary[]
  meta: Meta | null
  loading: boolean
  error: unknown
  reload: () => Promise<void>
  defaultBenchmark: string
}

const Ctx = createContext<Sources | null>(null)

/** 组合 / 基准 / 主数据信息，全站共享；上传后调用 reload 刷新 */
export function SourcesProvider({ children }: { children: ReactNode }) {
  const [portfolios, setPortfolios] = useState<SourceSummary[]>([])
  const [benchmarks, setBenchmarks] = useState<SourceSummary[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [p, b, m] = await Promise.all([api.portfolios(), api.benchmarks(), api.meta()])
      setPortfolios(p)
      setBenchmarks(b)
      setMeta(m)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const ok = benchmarks.filter((b) => b.status === 'ok')
  const defaultBenchmark = meta?.default_benchmark_id && ok.some((b) => b.id === meta.default_benchmark_id)
    ? meta.default_benchmark_id
    : ok[0]?.id ?? ''

  return (
    <Ctx.Provider value={{ portfolios, benchmarks, meta, loading, error, reload, defaultBenchmark }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSources(): Sources {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSources 必须在 SourcesProvider 内使用')
  return v
}
