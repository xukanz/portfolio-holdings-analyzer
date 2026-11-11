import { useMemo, useState } from 'react'
import { routes } from '../router'
import { ceilTo, fmtPct, fmtRaw } from '../utils/format'
import type { IndustryRow } from '../types'
import { DirectionValue, DivergingBar, DualBar, Panel, SegmentedControl } from './ui'

type SortBy = 'active' | 'portfolio'

/** 行业分布对比：双条（组合 vs 基准）+ 发散条（主动权重），整行可点击进入穿透 */
export function IndustryComparePanel({ runId, industries }: { runId: string; industries: IndustryRow[] }) {
  const [sortBy, setSortBy] = useState<SortBy>('active')
  const rows = useMemo(() => [...industries].sort((a, b) =>
    (sortBy === 'active' ? b.active_weight - a.active_weight : b.portfolio_weight - a.portfolio_weight)
    || a.industry.localeCompare(b.industry)), [industries, sortBy])
  // 比例尺由数据决定（纯展示）：双条取最大权重向上取整到 5%，发散条取最大 |主动权重| 向上取整到 2%
  const scaleMax = ceilTo(Math.max(0, ...industries.flatMap((r) => [r.portfolio_weight, r.benchmark_weight])), 0.05)
  const activeMax = ceilTo(Math.max(0, ...industries.map((r) => Math.abs(r.active_weight))), 0.02)

  return (
    <Panel
      label="行业分布对比"
      title="行业分布对比"
      subtitle={`共 ${industries.length} 个行业（由主数据 industry 字段生成）· 点击行业查看穿透明细`}
      extra={
        <div className="legend">
          <span><i style={{ background: 'var(--chart-portfolio)' }} />组合权重</span>
          <span><i style={{ background: 'var(--chart-benchmark)' }} />基准权重</span>
          <span><i style={{ background: 'var(--up)' }} />▲ 超配</span>
          <span><i style={{ background: 'var(--down)' }} />▼ 低配</span>
          <SegmentedControl label="排序" value={sortBy} onChange={setSortBy}
            options={[{ value: 'active', label: '按主动权重' }, { value: 'portfolio', label: '按组合权重' }]} />
        </div>
      }
      footer="界面百分比保留 2 位；明细悬停与 CSV 导出保留 6 位小数原始口径。主动权重 = 行业组合权重 − 行业基准权重。"
    >
      <div className="scroll-x">
        <div className="ind-grid" role="table" aria-label="行业分布">
          <div className="ind-row head" role="row">
            <span role="columnheader">行业</span>
            <span role="columnheader">组合 vs 基准（满刻度 {fmtPct(scaleMax, 0)}）</span>
            <span role="columnheader" className="r">组合</span>
            <span role="columnheader" className="r">基准</span>
            <span role="columnheader" style={{ textAlign: 'center' }}>低配 ← 主动权重 → 超配（±{fmtPct(activeMax, 0)}）</span>
            <span role="columnheader" className="r">主动权重</span>
          </div>
          {rows.map((r) => (
            <a key={r.industry} role="row" className="ind-row" href={routes.industry(runId, r.industry)}
              aria-label={`${r.industry}：组合 ${fmtPct(r.portfolio_weight)}，基准 ${fmtPct(r.benchmark_weight)}，查看穿透明细`}>
              <span className="name" role="cell">{r.industry}</span>
              <span role="cell"><DualBar portfolio={r.portfolio_weight} benchmark={r.benchmark_weight} scaleMax={scaleMax} /></span>
              <span role="cell" className="r" title={fmtRaw(r.portfolio_weight)}>{fmtPct(r.portfolio_weight)}</span>
              <span role="cell" className="r muted" title={fmtRaw(r.benchmark_weight)}>{fmtPct(r.benchmark_weight)}</span>
              <span role="cell"><DivergingBar value={r.active_weight} scaleMax={activeMax} /></span>
              <span role="cell" className="r"><DirectionValue value={r.active_weight} /></span>
            </a>
          ))}
        </div>
      </div>
    </Panel>
  )
}
