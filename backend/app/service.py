"""应用服务：编排数据源加载、分析引擎与留痕存储。"""
from __future__ import annotations

import csv
import hashlib
import io
import logging
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import Settings
from app.domain import errors as E
from app.domain.errors import DomainError
from app.domain.models import Benchmark, Portfolio, StockInfo
from app.engine.analyzer import analyze
from app.engine.rounding import result_to_dict
from app.loaders.csv_loader import (check_known_stocks, parse_benchmark, parse_master, parse_portfolio,
                                    read_file)
from app.repo.history import HistoryStore
from app.repo.registry import Entry, Kind, Registry

log = logging.getLogger("portfolio_analyzer")
DEFAULT_BENCHMARK_ID = "benchmark"
MAX_COMPARE = 10
DEFAULT_TOP_N = 10


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _issues_error(issues: list[dict[str, Any]], prefix: str) -> DomainError:
    # 汇总消息带上去重后的具体原因，只看 message 的调用方也能知道错在哪
    reasons = "；".join(dict.fromkeys(i["message"] for i in issues))
    return DomainError(E.VALIDATION_FAILED, f"{prefix}，共 {len(issues)} 处问题：{reasons}", issues)


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


@dataclass(slots=True)
class AnalysisService:
    master: dict[str, StockInfo]
    master_sha256: str
    registry: Registry
    history: HistoryStore

    # ---------- 数据源 ----------
    def _parse(self, kind: Kind, raw: bytes, source: str) -> Portfolio | Benchmark:
        if kind == "portfolio":
            data: Portfolio | Benchmark = parse_portfolio(raw, source)
            codes = [h.stock_code for h in data.holdings]
        else:
            data = parse_benchmark(raw, source)
            codes = [c.stock_code for c in data.constituents]
        check_known_stocks(codes, self.master, source)
        return data

    def load_preset(self, kind: Kind, path: Path) -> Entry:
        """预置文件损坏时不中断启动，而是登记为 invalid，分析时拒绝。"""
        entry = Entry(id=path.stem, kind=kind, name=path.stem, source="preset", sha256="", created_at=_now())
        try:
            raw = read_file(path)
            entry.sha256 = _sha256(raw)
            entry.data = self._parse(kind, raw, path.name)
        except DomainError as exc:
            entry.error = exc.to_dict()
            log.warning("数据文件 %s 不合规，已标记为不可用：%s", path, exc.message)
        self.registry.add(entry)
        return entry

    def register_upload(self, kind: Kind, name: str, raw: bytes, persist: bool = True,
                        entry_id: str | None = None, created_at: str | None = None) -> Entry:
        name = (name or "").strip()[:64] or f"未命名{'组合' if kind == 'portfolio' else '基准'}"
        data = self._parse(kind, raw, name)  # 上传数据不合规直接拒绝，不入库
        entry = Entry(id=entry_id or f"u-{uuid.uuid4().hex[:8]}", kind=kind, name=name, source="upload",
                      sha256=_sha256(raw), created_at=created_at or _now(), data=data)
        if persist:
            self.history.save_upload({"id": entry.id, "kind": kind, "name": name, "content": raw,
                                      "sha256": entry.sha256, "created_at": entry.created_at})
        self.registry.add(entry)
        return entry

    def register_json_portfolio(self, name: str, holdings: list[dict[str, Any]]) -> Entry:
        # 规整为标准 CSV 后走同一条解析/校验链路，保证口径一致且可按原文留痕
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(["stock_code", "market_value"])
        for h in holdings:
            w.writerow([h.get("stock_code", ""), h.get("market_value", "")])
        return self.register_upload("portfolio", name, buf.getvalue().encode("utf-8"))

    # ---------- 校验 ----------
    def validate(self, portfolio_id: str, benchmark_id: str | None) -> dict[str, Any]:
        """同时检查组合与基准，汇总全部问题；不存在的 id 直接 404。"""
        p = self.registry.get("portfolio", portfolio_id)
        b = self.registry.get("benchmark", benchmark_id or self.default_benchmark_id())
        issues = p.issues() + b.issues()
        if issues:
            raise _issues_error(issues, "输入数据校验未通过")
        return {"valid": True,
                "portfolio": {"id": p.id, "name": p.name, "rows": p.row_count},
                "benchmark": {"id": b.id, "name": b.name, "rows": b.row_count}}

    # ---------- 分析 ----------
    @staticmethod
    def _ref(e: Entry) -> dict[str, Any]:
        return {"id": e.id, "name": e.name, "sha256": e.sha256, "source": e.source}

    def _run(self, portfolio_id: str, benchmark_id: str, top_n: int = DEFAULT_TOP_N) -> dict[str, Any]:
        p = self.registry.get("portfolio", portfolio_id)
        b = self.registry.get("benchmark", benchmark_id)
        base = {
            "id": uuid.uuid4().hex,
            "created_at": _now(),
            "portfolio": self._ref(p),
            "benchmark": self._ref(b),
            "master_sha256": self.master_sha256,
            "top_n": top_n,
        }
        t0 = time.perf_counter()
        try:
            issues = p.issues() + b.issues()
            if issues:
                raise _issues_error(issues, "输入数据校验未通过，已拒绝分析")
            body = result_to_dict(analyze(p.data, b.data, self.master))  # type: ignore[arg-type]
        except DomainError as exc:
            # 失败的分析同样留痕：记录输入指纹与拒绝原因，便于追溯
            self.history.save_run({**base, "status": "failed", "duration_ms": 0.0, "metrics": None,
                                   "error": exc.to_dict()})
            raise
        run = {**base, "status": "success",
               "duration_ms": round((time.perf_counter() - t0) * 1000, 3), **body}
        self.history.save_run(run)
        return run

    def run_analysis(self, portfolio_id: str, benchmark_id: str | None,
                     top_n: int = DEFAULT_TOP_N) -> dict[str, Any]:
        return self._run(portfolio_id, benchmark_id or self.default_benchmark_id(), top_n)

    def compare(self, portfolio_ids: list[str], benchmark_id: str | None) -> dict[str, Any]:
        if not 2 <= len(portfolio_ids) <= MAX_COMPARE:
            raise DomainError(E.BAD_REQUEST, f"多组合对比需要 2~{MAX_COMPARE} 个组合", http_status=400)
        if len(set(portfolio_ids)) != len(portfolio_ids):
            raise DomainError(E.BAD_REQUEST, "对比的组合不能重复", http_status=400)
        bid = benchmark_id or self.default_benchmark_id()
        # 先整体校验，任一组合不可用则整体拒绝，避免产生半截留痕
        entries = [self.registry.get("portfolio", pid) for pid in portfolio_ids]
        bench = self.registry.get("benchmark", bid)
        issues = [i for e in [*entries, bench] for i in e.issues()]
        if issues:
            raise _issues_error(issues, "对比数据校验未通过")
        runs = [self._run(pid, bid) for pid in portfolio_ids]
        return {
            "benchmark": runs[0]["benchmark"],
            "items": [{"analysis_id": r["id"], "portfolio": r["portfolio"], "metrics": r["metrics"],
                       "industries": r["industries"], "top10": r["top10"], "warnings": r["warnings"]}
                      for r in runs],
        }

    def get_run(self, run_id: str) -> dict[str, Any]:
        run = self.history.get_run(run_id)
        if run is None:
            raise DomainError(E.NOT_FOUND, f"分析记录 '{run_id}' 不存在", http_status=404)
        return run

    def get_success_run(self, run_id: str) -> dict[str, Any]:
        """行业 / 排行 / 导出等子资源只对成功的分析有意义。"""
        run = self.get_run(run_id)
        if run.get("status") == "failed":
            raise DomainError(E.VALIDATION_FAILED, "该次分析未通过校验，没有可用结果",
                              (run.get("error") or {}).get("details", []), http_status=409)
        return run

    def default_benchmark_id(self) -> str:
        if self.registry.contains("benchmark", DEFAULT_BENCHMARK_ID):
            return DEFAULT_BENCHMARK_ID
        ok = [e for e in self.registry.list("benchmark") if e.status == "ok"]
        if not ok:
            raise DomainError(E.NOT_FOUND, "没有可用的基准，请先上传基准", http_status=404)
        return ok[0].id


_SAFE_ID = re.compile(r"^[\w\-.]+$")


def bootstrap(settings: Settings) -> AnalysisService:
    """加载全部数据。主数据缺失或损坏时抛出 DomainError，调用方据此拒绝启动。"""
    master_raw = read_file(settings.data_dir / "stock_info.csv")
    master = parse_master(master_raw, "stock_info.csv")
    svc = AnalysisService(master, _sha256(master_raw), Registry(), HistoryStore(settings.db_path))
    for kind, sub in (("portfolio", "portfolios"), ("benchmark", "benchmarks")):
        folder = settings.data_dir / sub
        files = sorted(folder.glob("*.csv")) if folder.is_dir() else []
        if not files:
            log.warning("目录 %s 下没有预置%s文件", folder, "组合" if kind == "portfolio" else "基准")
        for path in files:
            if _SAFE_ID.match(path.stem):
                svc.load_preset(kind, path)  # type: ignore[arg-type]
    for rec in svc.history.list_uploads():
        try:
            svc.register_upload(rec["kind"], rec["name"], rec["content"], persist=False,
                                entry_id=rec["id"], created_at=rec["created_at"])
        except DomainError as exc:  # 主数据变化可能使历史上传失效，保留登记但标记不可用
            log.warning("历史上传 %s 已不合规：%s", rec["id"], exc.message)
            svc.registry.add(Entry(id=rec["id"], kind=rec["kind"], name=rec["name"], source="upload",
                                   sha256=rec["sha256"], created_at=rec["created_at"], error=exc.to_dict()))
    log.info("主数据 %d 只股票；组合 %d 个；基准 %d 个", len(master),
             len(svc.registry.list("portfolio")), len(svc.registry.list("benchmark")))
    return svc
