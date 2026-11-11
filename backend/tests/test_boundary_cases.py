"""边界条件场景：数据由 scripts/gen_boundary_cases.py 生成于 samples/boundary/。

每个场景都用真实的启动流程（bootstrap）加载其数据目录，然后：
- 合法场景：引擎结果与精确分数参考实现（expected.json）逐项比对，并核对场景中人工写明的断言；
- 非法组合 / 基准：该数据源被标记为不合规，分析与校验均被拒绝，且失败的分析留痕；
- 非法主数据：服务拒绝启动。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.config import Settings
from app.domain.errors import DomainError
from app.service import bootstrap
from tests.conftest import PROJECT

CASES_DIR = PROJECT / "samples" / "boundary"
CASES = sorted(p for p in CASES_DIR.glob("*") if (p / "expected.json").is_file())
TOL = 1e-9


def _load(case: Path) -> dict:
    return json.loads((case / "expected.json").read_text(encoding="utf-8"))


def test_cases_exist():
    assert len(CASES) >= 30, "请先运行 scripts/gen_boundary_cases.py 生成边界数据"


@pytest.mark.parametrize("case", CASES, ids=[c.name for c in CASES])
def test_boundary_case(case: Path, tmp_path: Path):
    exp = _load(case)
    settings = Settings(case, tmp_path / "h.db", tmp_path)

    if exp.get("startup_refused"):
        with pytest.raises(DomainError):
            bootstrap(settings)
        return

    svc = bootstrap(settings)
    try:
        if "invalid" in exp:
            kind = exp["invalid"]
            entry = svc.registry.get(kind, "p" if kind == "portfolio" else "b")
            assert entry.status == "invalid"
            assert entry.error["code"] == exp["rule"], entry.error
            for call in (lambda: svc.validate("p", "b"), lambda: svc.run_analysis("p", "b")):
                with pytest.raises(DomainError) as ei:
                    call()
                assert ei.value.code == "VALIDATION_FAILED"
                assert {d["rule"] for d in ei.value.details} == {exp["rule"]}
                assert all(d["source"] == kind for d in ei.value.details)
            total, items = svc.history.list_runs(10, 0, status="failed")
            assert total == 1 and items[0]["error_code"] == "VALIDATION_FAILED"
            return

        run = svc.run_analysis("p", "b")
        m = run["metrics"]
        for k, v in exp["metrics"].items():
            if k == "total_market_value":
                assert m[k] == pytest.approx(v, rel=1e-12), k
            else:
                assert m[k] == pytest.approx(v, abs=TOL), (k, m[k], v)

        got_ind = {r["industry"]: r for r in run["industries"]}
        assert set(got_ind) == set(exp["industries"])
        for ind, e in exp["industries"].items():
            for k, v in e.items():
                assert got_ind[ind][k] == pytest.approx(v, abs=TOL), (ind, k)

        got_stocks = {s["stock_code"]: s for s in run["stocks"]}
        assert set(got_stocks) == set(exp["stocks"]), "并集不一致"
        for code, e in exp["stocks"].items():
            for k, v in e.items():
                if isinstance(v, float):
                    assert got_stocks[code][k] == pytest.approx(v, abs=TOL), (code, k)
                else:
                    assert got_stocks[code][k] == v, (code, k, got_stocks[code][k], v)

        assert [s["stock_code"] for s in run["top10"]] == exp["top10_codes"]
        assert bool(run["warnings"]) == exp["has_warning"]
        _check_hand_written(exp, run)
    finally:
        svc.history.close()


def _check_hand_written(exp: dict, run: dict) -> None:
    """场景里人工写明的断言：同时校验参考实现本身没有算错。"""
    m = run["metrics"]
    stocks = {s["stock_code"]: s for s in run["stocks"]}
    for k, v in exp["checks"].items():
        if k in ("active_share", "overlap_count", "overlap_weight", "hhi", "top10_weight"):
            assert m[k] == pytest.approx(v, abs=TOL), k
            assert exp["metrics"][k] == pytest.approx(v, abs=TOL), f"参考实现 {k}"
        elif k == "union":
            assert len(stocks) == v
        elif k == "top10_last_two":
            assert [s["stock_code"] for s in run["top10"]][-2:] == v
        elif k == "stock_weights":
            for code, w in v.items():
                assert stocks[code]["portfolio_weight"] == w, code
        elif k == "warning":
            assert bool(run["warnings"]) is v
            assert m["benchmark_weight_sum"] != 1.0
        elif k == "industry_only_in_benchmark":
            r = next(r for r in run["industries"] if r["industry"] == v)
            assert r["portfolio_weight"] == 0 and r["benchmark_weight"] > 0 and r["portfolio_count"] == 0
        elif k == "tiny_display_zero":
            assert stocks[v]["portfolio_weight"] == 0 and stocks[v]["is_held"] is True
        elif k == "leading_zero_kept":
            assert v in stocks
        else:
            raise AssertionError(f"未知断言 {k}")
