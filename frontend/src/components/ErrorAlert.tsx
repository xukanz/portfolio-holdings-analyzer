import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { ApiError } from '../api'

const FIELD_LABEL: Record<string, string> = {
  line: '行', stock_code: '代码', field: '字段', value: '值', market_value: '市值', weight: '权重',
  weight_sum: '权重合计', first_line: '首次出现于行', reason: '原因', tolerance: '容差', file: '文件',
}
const SKIP = new Set(['rule', 'source', 'message'])

export function describeDetail(d: Record<string, unknown>): string {
  return Object.entries(d)
    .filter(([k]) => !SKIP.has(k))
    .map(([k, v]) => `${FIELD_LABEL[k] ?? k}：${v === '' ? '（空）' : String(v)}`)
    .join('，')
}

/** 页面顶部红色提示条：显示业务错误 message，可展开 details；不显示任何堆栈 */
export function ErrorAlert({ error, onClose, action }: { error: unknown; onClose?: () => void; action?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // 出错时滚动到提示处，避免用户在页面下方操作时看不到报错
  useEffect(() => {
    if (error) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])
  if (!error) return null
  const e = error instanceof ApiError ? error : new ApiError({ code: 'CLIENT_ERROR', message: String((error as Error)?.message ?? error), details: [] })
  const message = e.isUnavailable ? '服务暂时不可用，请稍后重试' : e.message
  const lines = e.isUnavailable ? [] : e.details.map(describeDetail).filter(Boolean)
  return (
    <div className="alert" role="alert" ref={ref}>
      <div className="title">
        <span>{message}</span>
        {!e.isUnavailable && <span className="code">{e.code}</span>}
        {onClose && <button className="alert-close" onClick={onClose} aria-label="关闭提示">×</button>}
      </div>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
      {lines.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 14, color: 'var(--text-link)', marginTop: 4 }}>查看明细（{lines.length} 处）</summary>
          <ul>
            {lines.slice(0, 20).map((l, i) => <li key={i}>{l}</li>)}
            {lines.length > 20 && <li>…… 另有 {lines.length - 20} 处</li>}
          </ul>
        </details>
      )}
    </div>
  )
}
