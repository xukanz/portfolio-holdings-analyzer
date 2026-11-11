export interface SourceSummary {
  id: string
  name: string
  kind: 'portfolio' | 'benchmark'
  source: 'preset' | 'upload'
  status: 'ok' | 'invalid'
  error: ApiErrorBody | null
  row_count: number
  sha256: string
  created_at: string
}

export interface Metrics {
  portfolio_stock_count: number
  benchmark_stock_count: number
  total_market_value: number
  top10_weight: number
  hhi: number
  active_share: number
  overlap_count: number
  overlap_weight: number
  overlap_plus_active_share: number
  benchmark_weight_sum: number
}

export interface IndustryRow {
  industry: string
  portfolio_weight: number
  benchmark_weight: number
  active_weight: number
  portfolio_count: number
  benchmark_count: number
}

export interface StockRow {
  is_held?: boolean
  is_benchmark_constituent?: boolean
  active_side?: 'over' | 'under' | 'neutral'
  active_rank?: number | null
  stock_code: string
  stock_name: string
  industry: string
  market_value: number
  portfolio_weight: number
  benchmark_weight: number
  active_weight: number
}

export interface SourceRef {
  id: string
  name: string
  sha256: string
  source: string
}

export interface AnalysisRun {
  id: string
  created_at: string
  status?: 'success' | 'failed'
  top_n?: number
  portfolio: SourceRef
  benchmark: SourceRef
  master_sha256: string
  duration_ms: number
  metrics: Metrics
  industries: IndustryRow[]
  stocks: StockRow[]
  top10: StockRow[]
  warnings: string[]
}

/** 失败的分析记录：只有输入标识与错误信息，没有结果 */
export interface FailedRun {
  id: string
  created_at: string
  status: 'failed'
  top_n?: number
  portfolio: SourceRef
  benchmark: SourceRef
  master_sha256: string
  error: ApiErrorBody
}

export interface ValidationOk {
  valid: true
  portfolio: { id: string; name: string; rows: number }
  benchmark: { id: string; name: string; rows: number }
}

export interface Meta {
  stock_count: number
  industry_count: number
  industries: string[]
  master_sha256: string
  default_benchmark_id: string | null
}

export interface ComparisonItem {
  analysis_id: string
  portfolio: SourceRef
  metrics: Metrics
  industries: IndustryRow[]
  top10: StockRow[]
  warnings: string[]
}

export interface Comparison {
  benchmark: SourceRef
  items: ComparisonItem[]
}

export interface HistoryItem {
  id: string
  created_at: string
  portfolio_id: string
  portfolio_name: string
  portfolio_sha256: string
  benchmark_id: string
  benchmark_name: string
  benchmark_sha256: string
  master_sha256: string
  duration_ms: number
  metrics: Metrics | null
  status: 'success' | 'failed'
  error_code: string | null
  error_message: string | null
}

export interface ApiErrorBody {
  code: string
  message: string
  details: Record<string, unknown>[]
}
