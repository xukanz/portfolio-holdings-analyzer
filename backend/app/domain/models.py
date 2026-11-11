from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class StockInfo:
    stock_code: str
    stock_name: str
    industry: str


@dataclass(frozen=True, slots=True)
class Holding:
    stock_code: str
    market_value: float


@dataclass(frozen=True, slots=True)
class Constituent:
    stock_code: str
    weight: float


@dataclass(slots=True)
class Portfolio:
    holdings: list[Holding]


@dataclass(slots=True)
class Benchmark:
    constituents: list[Constituent]
    weight_sum: float


@dataclass(slots=True)
class StockRow:
    stock_code: str
    stock_name: str
    industry: str
    market_value: float
    portfolio_weight: float
    benchmark_weight: float
    active_weight: float
    is_held: bool
    is_benchmark_constituent: bool
    active_side: str = "neutral"
    active_rank: int | None = None


@dataclass(slots=True)
class IndustryRow:
    industry: str
    portfolio_weight: float
    benchmark_weight: float
    active_weight: float
    portfolio_count: int
    benchmark_count: int


@dataclass(slots=True)
class AnalysisResult:
    """引擎输出，所有数值均为未舍入的原始值；舍入只在序列化时进行。"""
    total_market_value: float
    portfolio_stock_count: int
    benchmark_stock_count: int
    top10_weight: float
    hhi: float
    active_share: float
    overlap_count: int
    overlap_weight: float
    benchmark_weight_sum: float
    stocks: list[StockRow]          # 并集，按主动权重降序、代码升序
    industries: list[IndustryRow]   # 按主动权重降序、行业名升序
    top10: list[StockRow]           # 前十大重仓
    warnings: list[str] = field(default_factory=list)
