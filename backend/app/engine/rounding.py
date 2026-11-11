"""结果序列化：仅在此处统一舍入到 6 位小数（四舍五入）。"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.domain.models import AnalysisResult, IndustryRow, StockRow

_Q = Decimal("0.000001")


def r6(x: float) -> float:
    # 用 repr 取最短十进制表示，避免二进制误差导致 0.0000005 类边界被错误舍入
    v = float(Decimal(repr(x)).quantize(_Q, rounding=ROUND_HALF_UP))
    return v + 0.0  # 消除 -0.0


def _money(x: float) -> float | int:
    return int(x) if float(x).is_integer() else x


def stock_to_dict(s: StockRow) -> dict[str, Any]:
    return {
        "stock_code": s.stock_code, "stock_name": s.stock_name, "industry": s.industry,
        "market_value": _money(s.market_value),
        "portfolio_weight": r6(s.portfolio_weight), "benchmark_weight": r6(s.benchmark_weight),
        "active_weight": r6(s.active_weight),
        "is_held": s.is_held, "is_benchmark_constituent": s.is_benchmark_constituent,
        "active_side": s.active_side, "active_rank": s.active_rank,
    }


def industry_to_dict(r: IndustryRow) -> dict[str, Any]:
    return {
        "industry": r.industry, "portfolio_weight": r6(r.portfolio_weight),
        "benchmark_weight": r6(r.benchmark_weight), "active_weight": r6(r.active_weight),
        "portfolio_count": r.portfolio_count, "benchmark_count": r.benchmark_count,
    }


def result_to_dict(res: AnalysisResult) -> dict[str, Any]:
    return {
        "metrics": {
            "portfolio_stock_count": res.portfolio_stock_count,
            "benchmark_stock_count": res.benchmark_stock_count,
            "total_market_value": _money(res.total_market_value),
            "top10_weight": r6(res.top10_weight),
            "hhi": r6(res.hhi),
            "active_share": r6(res.active_share),
            "overlap_count": res.overlap_count,
            "overlap_weight": r6(res.overlap_weight),
            "overlap_plus_active_share": r6(res.overlap_weight + res.active_share),
            "benchmark_weight_sum": r6(res.benchmark_weight_sum),
        },
        "industries": [industry_to_dict(r) for r in res.industries],
        "stocks": [stock_to_dict(s) for s in res.stocks],
        "top10": [stock_to_dict(s) for s in res.top10],
        "warnings": res.warnings,
    }
