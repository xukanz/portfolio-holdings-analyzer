import { useEffect, useState } from 'react'
import { api } from '../api'
import { routes } from '../router'
import type { HistoryItem } from '../types'
import { fmtHash, fmtPct, fmtTime, shortId } from '../utils/format'
import { EmptyState, ErrorState, LoadingState, Panel, Tag } from './ui'

const PAGE = 50

export function RunHistoryTable({ refreshKey = 0, highlight }: { refreshKey?: number; highlight?: string | null }) {
  const [status, setStatus] = useState('')
  const [items, setItems] = useState<HistoryItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)

  const load = async (offset: number) => {
    setLoading(true)
    try {
      const r = await api.history({ limit: PAGE, offset, status: status || undefined })
      setTotal(r.total)
      setItems((prev) => (offset === 0 ? r.items : [...(prev ?? []), ...r.items]))
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(0)
  }, [status, refreshKey, retry]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Panel
      label="分析记录"
      title="分析记录（计算留痕）"
      subtitle={`每次分析持久化：输入文件指纹 + 参数 + 完整结果，可复现 · 共 ${total} 条`}
      extra={
        <label className="inline-field" style={{ fontSize: 14 }}>
          筛选
          <select className="select" style={{ height: 30 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
          </select>
        </label>
      }
    >
      {error ? <ErrorState error={error} onRetry={() => setRetry((x) => x + 1)} />
        : items === null ? <LoadingState rows={6} />
          : items.length === 0 ? <EmptyState>暂无分析记录，去 <a href={routes.runsNew()}>数据与校验</a> 发起第一次分析</EmptyState>
            : (
              <div className="scroll-x">
                <table className="data" style={{ minWidth: 980 }}>
                  <thead>
                    <tr>
                      <th>分析编号</th><th>时间</th><th>组合 / 基准</th><th>输入指纹（SHA-256）</th>
                      <th className="r">主动份额</th><th className="r">耗时</th><th>状态</th><th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((h) => {
                      const ok = h.status !== 'failed'
                      return (
                        <tr key={h.id} className={h.id === highlight ? 'selected' : undefined}>
                          <td className="mono">{shortId(h.id)}</td>
                          <td>{fmtTime(h.created_at)}</td>
                          <td>{h.portfolio_name}<div className="stock-code">{h.benchmark_name}</div></td>
                          <td className="mono" title={`组合 ${h.portfolio_sha256}\n基准 ${h.benchmark_sha256}\n主数据 ${h.master_sha256}`}>
                            {fmtHash(h.portfolio_sha256)} / {fmtHash(h.benchmark_sha256)}
                          </td>
                          <td className="r">{ok && h.metrics ? fmtPct(h.metrics.active_share) : '—'}</td>
                          <td className="r">{ok ? `${h.duration_ms.toFixed(1)} ms` : '—'}</td>
                          <td style={{ maxWidth: 260 }}>
                            <Tag variant={ok ? 'success' : 'error'}>{ok ? '成功' : '失败'}</Tag>
                            {!ok && h.error_message && (
                              <div className="stock-code" title={h.error_message}
                                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.error_message}</div>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <a href={ok ? routes.analysis(h.id) : routes.runsNew(h.id)}>{ok ? '查看' : '查看原因'}</a>
                            {ok && <a href={routes.compare({ ids: h.portfolio_id, bench: h.benchmark_id })} style={{ marginLeft: 12 }}>加入对比</a>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
      {items && items.length < total && (
        <div className="pager"><button className="btn small" disabled={loading} onClick={() => load(items.length)}>加载更多</button></div>
      )}
    </Panel>
  )
}
