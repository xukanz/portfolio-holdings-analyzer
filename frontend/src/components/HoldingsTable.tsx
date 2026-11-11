import { isHeld } from '../stockState'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StockTable } from './StockTables'
import type { SortKey, SortState } from './StockTables'
import { Panel, SegmentedControl } from './ui'
import { fmtMoney, fmtPct, fmtRaw } from '../utils/format'
import type { IndustryRow, StockRow } from '../types'

const PAGE_SIZE = 50

type Scope = 'held' | 'union'

/** 持仓明细：每只股票的组合权重，可搜索、按行业筛选、排序，并可切换到并集 */
export function HoldingsTable({ stocks, industries, exportUrl, industryHref }: {
  stocks: StockRow[]
  industries: IndustryRow[]
  exportUrl: string
  industryHref: (industry: string) => string
}) {
  const [scope, setScope] = useState<Scope>('held')
  const [query, setQuery] = useState('')
  const [industry, setIndustry] = useState('')
  const [sort, setSort] = useState<SortState>({ key: 'portfolio_weight', desc: true })
  const [page, setPage] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)

  const heldCount = useMemo(() => stocks.filter(isHeld).length, [stocks])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = stocks.filter((s) =>
      (scope === 'union' || isHeld(s))
      && (!industry || s.industry === industry)
      && (!q || s.stock_code.toLowerCase().includes(q) || s.stock_name.toLowerCase().includes(q)))
    const dir = sort.desc ? -1 : 1
    // 值相同时按代码升序，与后端排序口径一致
    return filtered.sort((a, b) => {
      if (sort.key === 'stock_code') return dir * a.stock_code.localeCompare(b.stock_code)
      return dir * (a[sort.key] - b[sort.key]) || a.stock_code.localeCompare(b.stock_code)
    })
  }, [stocks, scope, industry, query, sort])

  useEffect(() => setPage(0), [stocks, scope, industry, query, sort])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  // 合计仅为当前筛选结果的展示汇总，不参与任何指标计算
  const weightSum = rows.reduce((a, s) => a + s.portfolio_weight, 0)
  const mvSum = rows.reduce((a, s) => a + (isHeld(s) ? s.market_value : 0), 0)

  // 翻页后回到表格顶部，避免停留在新一页的末尾
  const goto = (p: number) => {
    setPage(p)
    cardRef.current?.scrollIntoView({ block: 'start' })
  }

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'stock_code' }))

  return (
    <div ref={cardRef} style={{ scrollMarginTop: 16 }}>
      <Panel
        label="持仓明细"
        title="持仓明细"
        subtitle="每只股票的组合权重 = 持仓市值 ÷ 组合总市值 · 点击表头排序"
        extra={<a className="btn small" href={exportUrl}>导出 CSV</a>}
      >
        <div className="toolbar">
          <SegmentedControl label="展示范围" value={scope} onChange={setScope} options={[
            { value: 'held', label: `组合持仓（${heldCount}）` },
            { value: 'union', label: `含未持有的基准成分（${stocks.length}）` },
          ]} />
          <label className="inline-field">
            搜索
            <input className="input" type="text" placeholder="代码或名称" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="inline-field">
            行业
            <select className="select" value={industry} onChange={(e) => setIndustry(e.target.value)}>
              <option value="">全部行业</option>
              {[...industries].sort((a, b) => a.industry.localeCompare(b.industry, 'zh-CN')).map((r) => (
                <option key={r.industry} value={r.industry}>{r.industry}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="summary-line">
          <span>当前 <b>{rows.length}</b> 只</span>
          <span>组合权重合计 <b title={fmtRaw(weightSum)}>{fmtPct(weightSum)}</b></span>
          <span>持仓市值合计 <b>{fmtMoney(mvSum)}</b></span>
        </div>
        <div style={{ paddingTop: 10 }}>
          {current.length ? (
            <StockTable rows={current} showMv showRank rankOffset={page * PAGE_SIZE} minWidth={720}
              sort={sort} onSort={onSort} industryHref={industryHref} />
          ) : <div className="state">没有符合条件的股票</div>}
        </div>
        {pages > 1 && (
          <div className="pager">
            <button className="btn small" disabled={page === 0} onClick={() => goto(page - 1)}>上一页</button>
            <span>第 {page + 1} / {pages} 页</span>
            <button className="btn small" disabled={page >= pages - 1} onClick={() => goto(page + 1)}>下一页</button>
          </div>
        )}
      </Panel>
    </div>
  )
}
