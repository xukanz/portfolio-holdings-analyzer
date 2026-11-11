from __future__ import annotations

import csv
import json
import subprocess
import sys

import pytest

from app.config import Settings
from app.domain.errors import DomainError
from app.service import bootstrap
from tests.conftest import BACKEND, EXPECTED

EXPECTED_ACTIVE_SHARE = json.loads((EXPECTED / "expected_metrics.json").read_text(encoding="utf-8"))["active_share"]
with open(EXPECTED / "expected_active_weight.csv", encoding="utf-8-sig") as _f:
    TOP_OVER_CODE = next(csv.DictReader(_f))["stock_code"]


def _assert_error(resp, status: int, code: str):
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert set(body) == {"error"} and body["error"]["code"] == code
    assert "Traceback" not in resp.text
    return body["error"]


def _analyze(client, pid="portfolio", bid=None):
    return client.post("/api/analyses", json={"portfolio_id": pid, "benchmark_id": bid})


def test_analysis_and_subresources(client):
    r = _analyze(client)
    assert r.status_code == 201
    run = r.json()
    assert run["metrics"]["active_share"] == EXPECTED_ACTIVE_SHARE
    rid = run["id"]
    inds = client.get(f"/api/analyses/{rid}/industries").json()["industries"]
    assert len(inds) == 12
    aw = client.get(f"/api/analyses/{rid}/active-weights", params={"top": 5}).json()
    assert len(aw["over"]) == 5 and len(aw["under"]) == 5
    assert aw["over"][0]["stock_code"] == TOP_OVER_CODE
    assert all(a["active_weight"] <= b["active_weight"] for a, b in zip(aw["under"], aw["under"][1:]))
    only = client.get(f"/api/analyses/{rid}/active-weights", params={"side": "over", "top": 3}).json()
    assert set(only) == {"analysis_id", "over"}


def test_history_is_persisted(client, make_client, data_dir):
    rid = _analyze(client).json()["id"]
    hist = client.get("/api/history").json()
    assert hist["total"] == 1 and hist["items"][0]["id"] == rid
    assert hist["items"][0]["portfolio_sha256"]
    # 重启后仍可查询
    again = make_client(data_dir)
    assert again.get(f"/api/analyses/{rid}").json()["id"] == rid


def test_export_csv(client):
    rid = _analyze(client).json()["id"]
    r = client.get(f"/api/analyses/{rid}/export", params={"type": "active"})
    assert r.status_code == 200 and r.text.startswith("﻿stock_code,")
    r = client.get(f"/api/analyses/{rid}/export", params={"type": "industry"})
    assert len(r.text.strip().splitlines()) == 13


def test_upload_json_and_csv_portfolio(client):
    r = client.post("/api/portfolios", json={"name": "测试组合",
                                             "holdings": [{"stock_code": "600000", "market_value": 100},
                                                          {"stock_code": "600001", "market_value": "300"}]})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert _analyze(client, pid).json()["metrics"]["hhi"] == 0.625
    r = client.post("/api/portfolios/upload", files={"file": ("p2.csv", b"stock_code,market_value\n600000,1\n")})
    assert r.status_code == 201 and r.json()["name"] == "p2"


def test_uploaded_portfolio_survives_restart(client, make_client, data_dir):
    pid = client.post("/api/portfolios/upload",
                      files={"file": ("x.csv", b"stock_code,market_value\n600000,1\n")}).json()["id"]
    assert make_client(data_dir).post("/api/analyses", json={"portfolio_id": pid}).status_code == 201


@pytest.mark.parametrize("holdings,code", [
    ([{"stock_code": "600000", "market_value": 0}], "NON_POSITIVE_MARKET_VALUE"),
    ([{"stock_code": "600000", "market_value": -1}], "NON_POSITIVE_MARKET_VALUE"),
    ([{"stock_code": "600000", "market_value": 1}, {"stock_code": "600000", "market_value": 2}],
     "DUPLICATE_STOCK_CODE"),
    ([{"stock_code": "999999", "market_value": 1}], "UNKNOWN_STOCK"),
    ([{"stock_code": "600000", "market_value": "abc"}], "VALUE_UNPARSEABLE"),
    ([{"stock_code": "600000"}], "VALUE_UNPARSEABLE"),
    ([], "EMPTY_PORTFOLIO"),
])
def test_portfolio_validation_errors(client, holdings, code):
    _assert_error(client.post("/api/portfolios", json={"name": "x", "holdings": holdings}), 422, code)


def test_benchmark_upload_errors(client):
    r = client.post("/api/benchmarks/upload", files={"file": ("b.csv", b"stock_code,weight\n600000,0.9\n")})
    _assert_error(r, 422, "BENCHMARK_WEIGHT_SUM_INVALID")
    r = client.post("/api/benchmarks/upload", files={"file": ("b.csv", b"stock_code,weight\n600000,0.995\n")})
    assert r.status_code == 201
    run = _analyze(client, bid=r.json()["id"]).json()
    assert run["warnings"] and run["metrics"]["benchmark_weight_sum"] == 0.995


def test_not_found_and_bad_request(client):
    _assert_error(_analyze(client, "nope"), 404, "NOT_FOUND")
    _assert_error(_analyze(client, bid="nope"), 404, "NOT_FOUND")
    _assert_error(client.get("/api/analyses/xxx"), 404, "NOT_FOUND")
    _assert_error(client.get("/api/unknown"), 404, "NOT_FOUND")
    _assert_error(client.put("/api/analyses"), 405, "METHOD_NOT_ALLOWED")
    _assert_error(client.post("/api/analyses", content=b"{bad json"), 400, "BAD_REQUEST")
    _assert_error(client.post("/api/analyses", json={}), 400, "BAD_REQUEST")
    _assert_error(client.get("/api/history", params={"limit": -1}), 400, "BAD_REQUEST")


def test_corrupted_preset_files_refuse_analysis(data_dir, make_client):
    (data_dir / "portfolios" / "broken.csv").write_text("stock_code,market_value\n600000,abc\n")
    (data_dir / "portfolios" / "nocol.csv").write_text("stock_code\n600000\n")
    (data_dir / "benchmarks" / "badsum.csv").write_text("stock_code,weight\n600000,0.5\n")
    client = make_client(data_dir)
    status = {p["id"]: p["status"] for p in client.get("/api/portfolios").json()}
    assert (status["portfolio"], status["broken"], status["nocol"]) == ("ok", "invalid", "invalid")
    err = _assert_error(_analyze(client, "broken"), 422, "VALIDATION_FAILED")
    assert "market_value" in err["message"]
    assert err["details"][0] == {"rule": "VALUE_UNPARSEABLE", "source": "portfolio", "file": "broken",
                                 "message": err["details"][0]["message"], "line": 2, "stock_code": "600000",
                                 "field": "market_value", "value": "abc"}
    _assert_error(_analyze(client, bid="badsum"), 422, "VALIDATION_FAILED")
    assert _analyze(client).status_code == 201  # 其他数据源不受影响


def test_validation_endpoint_collects_issues_from_both_sources(data_dir, make_client):
    (data_dir / "portfolios" / "nocol.csv").write_text("stock_code\n600000\n")
    (data_dir / "benchmarks" / "badsum.csv").write_text("stock_code,weight\n600000,0.5\n")
    client = make_client(data_dir)
    ok = client.post("/api/validations", json={"portfolio_id": "portfolio"})
    assert ok.status_code == 200 and ok.json()["valid"] is True and ok.json()["portfolio"]["rows"] == 120
    err = _assert_error(client.post("/api/validations", json={"portfolio_id": "nocol", "benchmark_id": "badsum"}),
                        422, "VALIDATION_FAILED")
    assert [(d["source"], d["rule"]) for d in err["details"]] == [
        ("portfolio", "FIELD_MISSING"), ("benchmark", "BENCHMARK_WEIGHT_SUM_INVALID")]
    _assert_error(client.post("/api/validations", json={"portfolio_id": "nope"}), 404, "NOT_FOUND")
    assert client.get("/api/history").json()["total"] == 0  # 仅校验不留痕


def test_failed_analysis_is_recorded(data_dir, make_client):
    (data_dir / "portfolios" / "broken.csv").write_text("stock_code,market_value\n600000,-1\n")
    client = make_client(data_dir)
    _assert_error(_analyze(client, "broken"), 422, "VALIDATION_FAILED")
    ok_id = client.post("/api/analyses", json={"portfolio_id": "portfolio", "top_n": 20}).json()["id"]
    _assert_error(_analyze(client, "nope"), 404, "NOT_FOUND")  # id 不存在不留痕
    hist = client.get("/api/history").json()
    assert hist["total"] == 2
    failed = client.get("/api/history", params={"status": "failed"}).json()["items"]
    assert len(failed) == 1 and failed[0]["error_code"] == "VALIDATION_FAILED" and failed[0]["metrics"] is None
    assert client.get("/api/history", params={"status": "success"}).json()["items"][0]["id"] == ok_id
    run = client.get(f"/api/analyses/{failed[0]['id']}").json()
    assert run["status"] == "failed" and run["error"]["details"][0]["rule"] == "NON_POSITIVE_MARKET_VALUE"
    _assert_error(client.get(f"/api/analyses/{failed[0]['id']}/industries"), 409, "VALIDATION_FAILED")
    assert client.get(f"/api/analyses/{ok_id}").json()["top_n"] == 20
    _assert_error(client.post("/api/analyses", json={"portfolio_id": "portfolio", "top_n": 101}), 400, "BAD_REQUEST")


def test_old_history_db_is_migrated(tmp_path):
    import sqlite3
    from app.repo.history import HistoryStore
    db = tmp_path / "old.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE analysis_runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, portfolio_id TEXT NOT NULL, "
                "portfolio_name TEXT NOT NULL, portfolio_sha256 TEXT NOT NULL, benchmark_id TEXT NOT NULL, "
                "benchmark_name TEXT NOT NULL, benchmark_sha256 TEXT NOT NULL, master_sha256 TEXT NOT NULL, "
                "duration_ms REAL NOT NULL, metrics_json TEXT NOT NULL, result_json TEXT NOT NULL)")
    con.execute("INSERT INTO analysis_runs VALUES ('r1','2026-01-01','p','p','h','b','b','h','m',1,'{}','{\"id\":\"r1\"}')")
    con.commit()
    con.close()
    store = HistoryStore(db)
    total, items = store.list_runs(10, 0, status="success")
    assert total == 1 and items[0]["status"] == "success"
    assert store.get_run("r1")["status"] == "success"
    store.close()


def test_comparison(client):
    pid = client.post("/api/portfolios", json={"name": "b", "holdings": [
        {"stock_code": "600050", "market_value": 1}]}).json()["id"]
    r = client.post("/api/comparisons", json={"portfolio_ids": ["portfolio", pid]})
    assert r.status_code == 200
    items = r.json()["items"]
    assert [i["portfolio"]["id"] for i in items] == ["portfolio", pid]
    assert items[0]["metrics"]["active_share"] == EXPECTED_ACTIVE_SHARE
    _assert_error(client.post("/api/comparisons", json={"portfolio_ids": ["portfolio"]}), 400, "BAD_REQUEST")
    _assert_error(client.post("/api/comparisons", json={"portfolio_ids": ["portfolio", "x"]}), 404, "NOT_FOUND")


def test_unexpected_exception_returns_no_stack(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret internal detail")
    monkeypatch.setattr("app.service.analyze", boom)
    err = _assert_error(_analyze(client), 500, "INTERNAL_ERROR")
    assert "secret" not in err["message"]


def test_missing_master_refuses_startup(data_dir, tmp_path):
    (data_dir / "stock_info.csv").unlink()
    with pytest.raises(DomainError):
        bootstrap(Settings(data_dir, tmp_path / "h.db", tmp_path))
    proc = subprocess.run([sys.executable, "-m", "app", "--port", "0"], cwd=BACKEND, capture_output=True,
                          text=True, timeout=30, env={"PA_DATA_DIR": str(data_dir),
                                                      "PA_DB_PATH": str(tmp_path / "h2.db"), "PATH": ""})
    assert proc.returncode == 1
    assert "启动失败" in proc.stderr and "Traceback" not in proc.stderr


def test_corrupted_master_refuses_startup(data_dir, tmp_path):
    (data_dir / "stock_info.csv").write_text("stock_code,stock_name,industry\n600000,a,\n")
    with pytest.raises(DomainError) as ei:
        bootstrap(Settings(data_dir, tmp_path / "h.db", tmp_path))
    assert ei.value.details[0]["line"] == 2


def test_empty_master_name_refuses_startup(data_dir, tmp_path):
    (data_dir / "stock_info.csv").write_text(
        "stock_code,stock_name,industry\n600000,,银行\n", encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, "-m", "app", "--port", "0"], cwd=BACKEND,
        capture_output=True, text=True, timeout=30,
        env={"PA_DATA_DIR": str(data_dir), "PA_DB_PATH": str(tmp_path / "h.db"), "PATH": ""},
    )
    assert proc.returncode == 1
    assert "启动失败" in proc.stderr
    assert "stock_name" in proc.stderr and "'line': 2" in proc.stderr
    assert "Traceback" not in proc.stderr
