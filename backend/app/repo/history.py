"""SQLite 持久化：分析留痕（analysis_runs）与用户上传的数据源（uploads）。"""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS analysis_runs (
    id                TEXT PRIMARY KEY,
    created_at        TEXT NOT NULL,
    portfolio_id      TEXT NOT NULL,
    portfolio_name    TEXT NOT NULL,
    portfolio_sha256  TEXT NOT NULL,
    benchmark_id      TEXT NOT NULL,
    benchmark_name    TEXT NOT NULL,
    benchmark_sha256  TEXT NOT NULL,
    master_sha256     TEXT NOT NULL,
    duration_ms       REAL NOT NULL,
    metrics_json      TEXT NOT NULL,
    result_json       TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'success',
    error_code        TEXT,
    error_message     TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_created ON analysis_runs(created_at DESC);
CREATE TABLE IF NOT EXISTS uploads (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    name        TEXT NOT NULL,
    content     BLOB NOT NULL,
    sha256      TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
"""

# 早期版本的库没有这些列，启动时补齐，保证旧留痕可继续查询
_ADDED_COLUMNS = {
    "status": "TEXT NOT NULL DEFAULT 'success'",
    "error_code": "TEXT",
    "error_message": "TEXT",
}

_SUMMARY_COLS = ("id, created_at, portfolio_id, portfolio_name, portfolio_sha256, benchmark_id, "
                 "benchmark_name, benchmark_sha256, master_sha256, duration_ms, metrics_json, "
                 "status, error_code, error_message")


class HistoryStore:
    def __init__(self, db_path: Path, max_runs: int = 0) -> None:
        self._max_runs = max_runs
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock, self._conn:
            self._conn.executescript(_SCHEMA)
            existing = {r["name"] for r in self._conn.execute("PRAGMA table_info(analysis_runs)")}
            for col, ddl in _ADDED_COLUMNS.items():
                if col not in existing:
                    self._conn.execute(f"ALTER TABLE analysis_runs ADD COLUMN {col} {ddl}")

    def save_run(self, run: dict[str, Any]) -> None:
        error = run.get("error") or {}
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO analysis_runs (id, created_at, portfolio_id, portfolio_name, portfolio_sha256, "
                "benchmark_id, benchmark_name, benchmark_sha256, master_sha256, duration_ms, metrics_json, "
                "result_json, status, error_code, error_message) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (run["id"], run["created_at"], run["portfolio"]["id"], run["portfolio"]["name"],
                 run["portfolio"]["sha256"], run["benchmark"]["id"], run["benchmark"]["name"],
                 run["benchmark"]["sha256"], run["master_sha256"], run["duration_ms"],
                 json.dumps(run.get("metrics"), ensure_ascii=False), json.dumps(run, ensure_ascii=False),
                 run.get("status", "success"), error.get("code"), error.get("message")))
            if self._max_runs > 0:
                self._conn.execute(
                    "DELETE FROM analysis_runs WHERE id NOT IN "
                    "(SELECT id FROM analysis_runs ORDER BY created_at DESC LIMIT ?)", (self._max_runs,))

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT result_json FROM analysis_runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            return None
        run = json.loads(row["result_json"])
        run.setdefault("status", "success")
        return run

    def list_runs(self, limit: int, offset: int, portfolio_id: str | None = None,
                  status: str | None = None) -> tuple[int, list[dict[str, Any]]]:
        conds, args = [], []
        if portfolio_id:
            conds.append("portfolio_id=?")
            args.append(portfolio_id)
        if status:
            conds.append("status=?")
            args.append(status)
        where = f"WHERE {' AND '.join(conds)}" if conds else ""
        with self._lock:
            total = self._conn.execute(f"SELECT COUNT(*) FROM analysis_runs {where}", args).fetchone()[0]
            rows = self._conn.execute(
                f"SELECT {_SUMMARY_COLS} FROM analysis_runs {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
                [*args, limit, offset]).fetchall()
        items = []
        for r in rows:
            d = dict(r)
            d["metrics"] = json.loads(d.pop("metrics_json"))
            items.append(d)
        return total, items

    def save_upload(self, rec: dict[str, Any]) -> None:
        with self._lock, self._conn:
            self._conn.execute("INSERT INTO uploads VALUES (?,?,?,?,?,?)",
                               (rec["id"], rec["kind"], rec["name"], rec["content"], rec["sha256"],
                                rec["created_at"]))

    def list_uploads(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._conn.execute("SELECT * FROM uploads ORDER BY created_at")]

    def close(self) -> None:
        self._conn.close()
