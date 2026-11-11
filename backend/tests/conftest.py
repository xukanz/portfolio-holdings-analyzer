from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.service import bootstrap  # noqa: E402

PROJECT = BACKEND.parent
DATA = PROJECT / "data"
EXPECTED = BACKEND / "tests" / "fixtures"  # 由 scripts/gen_sample.py 用独立参考实现生成


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    d = tmp_path / "data"
    shutil.copytree(DATA, d)
    return d


@pytest.fixture
def make_client(tmp_path: Path):
    def _make(data_dir: Path) -> TestClient:
        settings = Settings(data_dir=data_dir, db_path=tmp_path / "h.db", frontend_dist=tmp_path / "none")
        return TestClient(create_app(bootstrap(settings), settings), raise_server_exceptions=False)
    return _make


@pytest.fixture
def client(data_dir: Path, make_client) -> TestClient:
    return make_client(data_dir)
