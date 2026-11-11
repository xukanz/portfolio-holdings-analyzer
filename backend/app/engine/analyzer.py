"""分析引擎：口径见 docs/METHODOLOGY.md。纯计算，不做任何 I/O，不做中间舍入。"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Mapping

from app.domain import errors as E
from app.domain.errors import DomainError
from app.domain.models import AnalysisResult, Benchmark, IndustryRow, Portfolio, StockInfo, StockRow

TOP_N_CONCENTRATION = 10


def analyze(portfolio: Portfolio, benchmark: Benchmark, master: Mapping[str, StockInfo]) -> AnalysisResult:
    if not portfolio.holdings:
        raise DomainError(E.EMPTY_PORTFOLIO, "组合没有任何持仓")
    missing = sorted({h.stock_code for h in portfolio.holdings if h.stock_code not in master}
                     | {c.stock_code for c in benchmark.constituents if c.stock_code not in master})
    if missing:
        raise DomainError(E.UNKNOWN_STOCK, f"{len(missing)} 只股票在主数据中不存在",
                          [{"stock_code": c} for c in missing[:100]])

    total = math.fsum(h.market_value for h in portfolio.holdings)
    mv = {h.stock_code: h.market_value for h in portfolio.holdings}
    pw = {code: v / total for code, v in mv.items()}
    bw = {c.stock_code: c.weight for c in benchmark.constituents}

    # 并集上单次遍历：同时完成个股主动权重、行业汇总、主动份额与重合度的累计
    ind_p: dict[str, list[float]] = defaultdict(list)
    ind_b: dict[str, list[float]] = defaultdict(list)
    abs_diffs: list[float] = []
    mins: list[float] = []
    overlap_count = 0
    stocks: list[StockRow] = []
    for code in pw.keys() | bw.keys():
        wp = pw.get(code, 0.0)
        wb = bw.get(code, 0.0)
        info = master[code]
        stocks.append(StockRow(code, info.stock_name, info.industry, mv.get(code, 0.0), wp, wb, wp - wb,
                               is_held=code in pw, is_benchmark_constituent=code in bw,
                               active_side="over" if wp > wb else "under" if wp < wb else "neutral"))
        if code in pw:
            ind_p[info.industry].append(wp)
        if code in bw:
            ind_b[info.industry].append(wb)
        abs_diffs.append(abs(wp - wb))
        mins.append(min(wp, wb))
        if wp > 0 and wb > 0:
            overlap_count += 1
    stocks.sort(key=lambda s: (-s.active_weight, s.stock_code))
    for side, direction in (("over", -1), ("under", 1)):
        ranked = sorted((s for s in stocks if s.active_side == side),
                        key=lambda s: (direction * s.active_weight, s.stock_code))
        for rank, stock in enumerate(ranked, start=1):
            stock.active_rank = rank

    industries: list[IndustryRow] = []
    for ind in ind_p.keys() | ind_b.keys():
        p = math.fsum(ind_p.get(ind, ()))
        b = math.fsum(ind_b.get(ind, ()))
        industries.append(IndustryRow(ind, p, b, p - b, len(ind_p.get(ind, ())), len(ind_b.get(ind, ()))))
    industries.sort(key=lambda r: (-r.active_weight, r.industry))

    by_code = {s.stock_code: s for s in stocks}
    top10_codes = sorted(pw, key=lambda c: (-pw[c], c))[:TOP_N_CONCENTRATION]
    top10 = [by_code[c] for c in top10_codes]

    warnings: list[str] = []
    if abs(benchmark.weight_sum - 1.0) > 1e-9:
        warnings.append(f"基准权重合计为 {benchmark.weight_sum:.6f}（在 ±0.01 容差内，按原值计算，未归一化），"
                        "因此“重合权重 + 主动份额”可能不严格等于 1")

    return AnalysisResult(
        total_market_value=total,
        portfolio_stock_count=len(pw),
        benchmark_stock_count=len(bw),
        top10_weight=math.fsum(pw[c] for c in top10_codes),
        hhi=math.fsum(w * w for w in pw.values()),
        active_share=0.5 * math.fsum(abs_diffs),
        overlap_count=overlap_count,
        overlap_weight=math.fsum(mins),
        benchmark_weight_sum=benchmark.weight_sum,
        stocks=stocks,
        industries=industries,
        top10=top10,
        warnings=warnings,
    )
