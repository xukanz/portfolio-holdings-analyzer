"""性能：5000 x 5000 规模全部指标分析 < 2 秒。"""
from __future__ import annotations

import random
import time

from app.domain.models import Benchmark, Constituent, Holding, Portfolio, StockInfo
from app.engine.analyzer import analyze
from app.engine.rounding import result_to_dict


def test_5000_by_5000_under_two_seconds():
    rnd = random.Random(1)
    codes = [f"{i:06d}" for i in range(10000)]
    master = {c: StockInfo(c, c, f"行业{rnd.randrange(30)}") for c in codes}
    p = Portfolio([Holding(c, rnd.randint(1, 10**9)) for c in rnd.sample(codes[:7500], 5000)])
    bcodes = rnd.sample(codes[2500:], 5000)
    b = Benchmark([Constituent(c, 1 / 5000) for c in bcodes], 1.0)
    t = time.perf_counter()
    out = result_to_dict(analyze(p, b, master))
    elapsed = time.perf_counter() - t
    assert elapsed < 2.0, elapsed
    assert abs(out["metrics"]["overlap_plus_active_share"] - 1) < 1e-6
