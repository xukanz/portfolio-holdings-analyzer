import type { StockRow } from './types'

export const isHeld = (s: StockRow) => s.is_held ?? s.market_value > 0
export const hasStockMetadata = (s: StockRow) =>
  s.is_benchmark_constituent !== undefined && s.active_side !== undefined && s.active_rank !== undefined

export const rankedStocks = (stocks: StockRow[], side: 'over' | 'under', n: number) =>
  stocks.filter((s) => s.active_side === side)
    .sort((a, b) => a.active_rank! - b.active_rank!)
    .slice(0, n)
