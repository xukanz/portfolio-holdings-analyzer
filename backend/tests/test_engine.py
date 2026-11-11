"""引擎口径：对照默认数据的参考答案（tests/fixtures）+ 口径边界场景。"""
from __future__ import annotations

import csv
import json

import pytest

from app.domain.models import Benchmark, Constituent, Holding, Portfolio, StockInfo
from app.engine.analyzer import analyze
from app.engine.rounding import r6, result_to_dict
from app.loaders.csv_loader import parse_benchmark, parse_master, parse_portfolio
from tests.conftest import DATA, EXPECTED

TOL = 1e-6 + 1e-12


def _read_expected(name: str) -> list[dict]:
    with open(EXPECTED / name, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


@pytest.fixture(scope="module")
def sample():
    master = parse_master((DATA / "stock_info.csv").read_bytes())
    p = parse_portfolio((DATA / "portfolios/portfolio.csv").read_bytes(), "portfolio.csv")
    b = parse_benchmark((DATA / "benchmarks/benchmark.csv").read_bytes(), "benchmark.csv")
    return result_to_dict(analyze(p, b, master))


def test_metrics_match_expected(sample):
    expected = json.loads((EXPECTED / "expected_metrics.json").read_text(encoding="utf-8"))
    for key, value in expected.items():
        assert sample["metrics"][key] == pytest.approx(value, abs=TOL), key


def test_industries_match_expected(sample):
    got = {r["industry"]: r for r in sample["industries"]}
    exp = _read_expected("expected_industry.csv")
    assert set(got) == {r["industry"] for r in exp}
    for r in exp:
        for col in ("portfolio_weight", "benchmark_weight", "active_weight"):
            assert got[r["industry"]][col] == pytest.approx(float(r[col]), abs=TOL)


def test_active_weights_match_expected_including_order(sample):
    exp = _read_expected("expected_active_weight.csv")
    got = sample["stocks"]
    assert [s["stock_code"] for s in got] == [r["stock_code"] for r in exp]
    for s, r in zip(got, exp):
        assert s["industry"] == r["industry"]
        for col in ("portfolio_weight", "benchmark_weight", "active_weight"):
            assert s[col] == pytest.approx(float(r[col]), abs=TOL)


def _mk(holdings: dict[str, float], bench: dict[str, float], industries: dict[str, str] | None = None):
    codes = set(holdings) | set(bench)
    industries = industries or {}
    master = {c: StockInfo(c, f"名称{c}", industries.get(c, "行业X")) for c in codes}
    p = Portfolio([Holding(c, v) for c, v in holdings.items()])
    b = Benchmark([Constituent(c, w) for c, w in bench.items()], sum(bench.values()))
    return analyze(p, b, master)


def test_document_example():
    res = _mk({"A": 60, "B": 40}, {"A": 0.5, "C": 0.5})
    assert res.active_share == pytest.approx(0.5)
    assert {s.stock_code for s in res.stocks} == {"A", "B", "C"}
    assert res.overlap_count == 1
    assert res.overlap_weight == pytest.approx(0.5)


def test_benchmark_only_stock_in_union():
    res = _mk({"A": 100}, {"A": 0.4, "C": 0.6}, {"A": "银行", "C": "电子"})
    c = next(s for s in res.stocks if s.stock_code == "C")
    assert (c.portfolio_weight, c.benchmark_weight, c.active_weight) == (0.0, 0.6, -0.6)
    ind = {r.industry: r for r in res.industries}
    assert ind["电子"].portfolio_weight == 0 and ind["电子"].active_weight == pytest.approx(-0.6)
    assert res.active_share == pytest.approx(0.6)


def test_top10_tie_breaks_by_code_ascending():
    # 12 只股票：前 9 只权重各异且较大，其余 3 只并列；第 10 名应取代码最小者
    holdings = {f"S{i:02d}": 100 - i for i in range(9)}
    holdings.update({"Z03": 10, "Z01": 10, "Z02": 10})
    res = _mk(holdings, {"S00": 1.0})
    assert [s.stock_code for s in res.top10][-1] == "Z01"
    total = sum(holdings.values())
    assert res.top10_weight == pytest.approx((sum(100 - i for i in range(9)) + 10) / total)


def test_top10_with_fewer_than_ten_stocks():
    res = _mk({"A": 1, "B": 3}, {"A": 1.0})
    assert res.top10_weight == pytest.approx(1.0)


def test_overlap_plus_active_share_equals_one(sample):
    assert sample["metrics"]["overlap_plus_active_share"] == pytest.approx(1.0, abs=TOL)


def test_identical_portfolio_and_benchmark():
    res = _mk({"A": 30, "B": 70}, {"A": 0.3, "B": 0.7})
    assert res.active_share == pytest.approx(0.0, abs=1e-15)
    assert res.overlap_weight == pytest.approx(1.0)
    assert res.overlap_count == 2


def test_hhi_single_stock_is_one():
    assert _mk({"A": 5}, {"A": 1.0}).hhi == pytest.approx(1.0)


def test_industry_list_is_data_driven():
    res = _mk({"A": 1, "B": 1}, {"C": 1.0}, {"A": "自定义行业甲", "B": "自定义行业乙", "C": "自定义行业丙"})
    assert {r.industry for r in res.industries} == {"自定义行业甲", "自定义行业乙", "自定义行业丙"}


def test_rounding_half_up_only_at_output():
    assert r6(0.0000005) == 0.000001
    assert r6(0.1234565) == 0.123457
    assert r6(-0.0000004) == 0.0
    # 中间不舍入：三只各 1/3 的 HHI 应为 0.333333，而不是 3*0.333333^2
    assert r6(_mk({"A": 1, "B": 1, "C": 1}, {"A": 1.0}).hhi) == 0.333333
