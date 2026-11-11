"""公开演示站的防滥用限制：上传大小、上传数量、分析记录保留条数。"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.service import bootstrap


def _client(data_dir, tmp_path, **limits) -> TestClient:
    settings = Settings(data_dir=data_dir, db_path=tmp_path / "h.db", frontend_dist=tmp_path / "none", **limits)
    return TestClient(create_app(bootstrap(settings), settings), raise_server_exceptions=False)


CSV = b"stock_code,market_value\n600000,100\n600001,200\n"


def test_upload_size_limit(data_dir, tmp_path):
    c = _client(data_dir, tmp_path, max_upload_bytes=30)
    r = c.post("/api/portfolios/upload", files={"file": ("p.csv", CSV, "text/csv")})
    assert r.status_code == 413 and "Traceback" not in r.text


def test_upload_count_limit(data_dir, tmp_path):
    c = _client(data_dir, tmp_path, max_uploads=2)
    for _ in range(2):
        assert c.post("/api/portfolios/upload", files={"file": ("p.csv", CSV, "text/csv")}).status_code == 201
    r = c.post("/api/portfolios/upload", files={"file": ("p.csv", CSV, "text/csv")})
    assert r.status_code == 429 and r.json()["error"]["code"] == "BAD_REQUEST"


def test_history_retention(data_dir, tmp_path):
    c = _client(data_dir, tmp_path, max_runs=3)
    ids = [c.post("/api/analyses", json={"portfolio_id": "portfolio"}).json()["id"] for _ in range(5)]
    hist = c.get("/api/history").json()
    assert hist["total"] == 3
    assert c.get(f"/api/analyses/{ids[-1]}").status_code == 200


def test_defaults_unlimited(data_dir, tmp_path):
    c = _client(data_dir, tmp_path)
    for _ in range(3):
        c.post("/api/analyses", json={"portfolio_id": "portfolio"})
    assert c.get("/api/history").json()["total"] == 3
