"""舍入后的展示值不参与持仓判断和排行；直接调用路由验证历史查询。"""
from types import SimpleNamespace

import pytest

from app.api.routes import get_active_weights
from app.config import Settings
from app.domain.errors import DomainError
from app.service import bootstrap


def test_metadata_and_ranking_survive_restart(data_dir, tmp_path):
    settings = Settings(data_dir, tmp_path / "history.db", tmp_path)
    service = bootstrap(settings)
    codes = ["600000", "600001", "600002", "600003", "600004"]
    # 前两只真实低配不同、显示均为 0；后两只超配并列；最后一只中性。
    values = [1999999, 1999996, 2000004, 2000004, 1999997]
    weights = ["0.2", "0.2", "0.2", "0.2", "0.1999997"]
    p = service.register_json_portfolio("p", [dict(stock_code=c, market_value=v) for c, v in zip(codes, values)])
    b = service.register_upload("benchmark", "b", (
        "stock_code,weight\n" + "".join(f"{c},{w}\n" for c, w in zip(codes, weights))
    ).encode())
    run = service.run_analysis(p.id, b.id)
    assert all(s["active_weight"] == 0 for s in run["stocks"])
    assert next(s for s in run["stocks"] if s["stock_code"] == codes[4])["active_rank"] is None
    service.history.close()

    service = bootstrap(settings)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(service=service)))
    ranking = get_active_weights(request, run["id"], side="all", top=10, industry=None)
    assert [s["stock_code"] for s in ranking["under"]] == [codes[1], codes[0]]
    assert [s["stock_code"] for s in ranking["over"]] == [codes[2], codes[3]]
    filtered = get_active_weights(request, run["id"], side="under", top=1, industry=None)
    assert filtered["under"][0]["stock_code"] == codes[1]
    service.history.close()


def test_tiny_holding_and_zero_weight_benchmark_membership(data_dir, tmp_path):
    service = bootstrap(Settings(data_dir, tmp_path / "history.db", tmp_path))
    p = service.register_json_portfolio("p", [
        {"stock_code": "600000", "market_value": 1},
        {"stock_code": "600001", "market_value": 10000000},
    ])
    b = service.register_upload("benchmark", "b", b"stock_code,weight\n600001,1\n600002,0\n")
    run = service.run_analysis(p.id, b.id)
    stocks = {s["stock_code"]: s for s in run["stocks"]}
    assert stocks["600000"]["portfolio_weight"] == 0
    assert stocks["600000"]["is_held"] is True
    assert stocks["600000"]["is_benchmark_constituent"] is False
    assert stocks["600002"]["is_held"] is False
    assert stocks["600002"]["is_benchmark_constituent"] is True
    assert sum(s["is_held"] for s in run["stocks"]) == 2
    assert run["metrics"]["overlap_count"] == 1
    service.history.close()


def test_legacy_ranking_requires_reanalysis():
    service = SimpleNamespace(get_success_run=lambda _: {"stocks": [{"active_weight": 0}]})
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(service=service)))
    with pytest.raises(DomainError, match="请重新分析") as exc:
        get_active_weights(request, "old", side="all", top=10, industry=None)
    assert exc.value.http_status == 409
