import type {
  AnalysisRun, ApiErrorBody, Comparison, FailedRun, HistoryItem, Meta, SourceSummary, StockRow, ValidationOk,
} from './types'

export class ApiError extends Error {
  code: string
  status: number
  details: Record<string, unknown>[]
  body: ApiErrorBody
  constructor(body: ApiErrorBody, status = 0) {
    super(body.message)
    this.code = body.code
    this.status = status
    this.details = body.details ?? []
    this.body = body
  }
  /** 网络不可达或 5xx：只显示通用文案 */
  get isUnavailable() {
    return this.code === 'NETWORK_ERROR' || this.status >= 500
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let resp: Response
  try {
    resp = await fetch(path, init)
  } catch {
    throw new ApiError({ code: 'NETWORK_ERROR', message: '服务暂时不可用，请稍后重试', details: [] })
  }
  const text = await resp.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // 非 JSON 响应
  }
  if (!resp.ok) {
    const err = (body as { error?: ApiErrorBody } | null)?.error
    throw new ApiError(
      err ?? { code: `HTTP_${resp.status}`, message: '服务暂时不可用，请稍后重试', details: [] }, resp.status)
  }
  return body as T
}

const json = (data: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})

// 分析结果不可变，按 id 缓存，页面间切换（体检 ↔ 穿透）不重复请求
const runCache = new Map<string, AnalysisRun | FailedRun>()

export const api = {
  meta: () => request<Meta>('/api/meta'),
  portfolios: () => request<SourceSummary[]>('/api/portfolios'),
  benchmarks: () => request<SourceSummary[]>('/api/benchmarks'),
  upload: (kind: 'portfolio' | 'benchmark', file: File, name: string) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('name', name)
    return request<SourceSummary>(`/api/${kind}s/upload`, { method: 'POST', body: fd })
  },
  analyze: async (portfolio_id: string, benchmark_id: string, top_n?: number) => {
    const run = await request<AnalysisRun>('/api/analyses', json({ portfolio_id, benchmark_id, top_n }))
    runCache.set(run.id, run)
    return run
  },
  validate: (portfolio_id: string, benchmark_id: string) =>
    request<ValidationOk>('/api/validations', json({ portfolio_id, benchmark_id })),
  getRun: async (id: string) => {
    const hit = runCache.get(id)
    if (hit) return hit
    const run = await request<AnalysisRun | FailedRun>(`/api/analyses/${encodeURIComponent(id)}`)
    runCache.set(id, run)
    return run
  },
  activeWeights: (id: string, side: 'over' | 'under', top: number) =>
    request<{ over?: StockRow[]; under?: StockRow[] }>(
      `/api/analyses/${encodeURIComponent(id)}/active-weights?side=${side}&top=${top}`),
  /** 对比已有的分析结果，不产生新的分析记录 */
  compareRuns: (analysis_ids: string[]) =>
    request<Comparison>('/api/comparisons', json({ analysis_ids })),
  history: (opts: { limit?: number; offset?: number; status?: string } = {}) => {
    const q = new URLSearchParams({ limit: String(opts.limit ?? 50), offset: String(opts.offset ?? 0) })
    if (opts.status) q.set('status', opts.status)
    return request<{ total: number; items: HistoryItem[] }>(`/api/history?${q}`)
  },
  exportUrl: (id: string, type: 'industry' | 'active') =>
    `/api/analyses/${encodeURIComponent(id)}/export?type=${type}`,
}

export const isFailedRun = (r: AnalysisRun | FailedRun): r is FailedRun => r.status === 'failed'

/** 在浏览器端生成并下载 CSV（数值为后端返回的 6 位小数原值） */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
