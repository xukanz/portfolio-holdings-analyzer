import { useRef, useState } from 'react'
import { api, ApiError } from '../api'
import type { SourceSummary } from '../types'

const MAX_BYTES = 20 * 1024 * 1024
const REQUIRED = { portfolio: ['stock_code', 'market_value'], benchmark: ['stock_code', 'weight'] }

/** 前端预检：只拦截明显的格式问题，业务校验以后端为准 */
async function precheck(kind: 'portfolio' | 'benchmark', file: File): Promise<string | null> {
  if (!file.name.toLowerCase().endsWith('.csv')) return '请选择 .csv 文件'
  if (file.size === 0) return '文件为空'
  if (file.size > MAX_BYTES) return '文件过大（上限 20MB）'
  const head = (await file.slice(0, 4096).text()).replace(/^﻿/, '').split(/\r?\n/)[0] ?? ''
  const cols = head.split(',').map((c) => c.trim())
  const missing = REQUIRED[kind].filter((c) => !cols.includes(c))
  if (missing.length) return `表头缺少字段：${missing.join(", ")}（需要 ${REQUIRED[kind].join(", ")}）`
  return null
}

interface Props {
  kind: 'portfolio' | 'benchmark'
  onUploaded: (s: SourceSummary) => void
  onError: (e: unknown) => void
}

export function UploadButton({ kind, onUploaded, onError }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const label = kind === 'portfolio' ? '上传组合 CSV' : '上传基准 CSV'

  const onPick = async (file: File | undefined) => {
    if (!file) return
    try {
      const problem = await precheck(kind, file)
      if (problem) throw new ApiError({ code: 'INVALID_INPUT', message: `${file.name}：${problem}`, details: [] })
      setBusy(true)
      onUploaded(await api.upload(kind, file, file.name.replace(/\.csv$/i, '')))
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <>
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => onPick(e.target.files?.[0])} />
      <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}
        title={kind === 'portfolio' ? '字段：stock_code, market_value' : '字段：stock_code, weight（合计为 1）'}>
        {busy ? '上传中…' : label}
      </button>
    </>
  )
}
