from __future__ import annotations

import csv
import io
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, File, Form, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.domain import errors as E
from app.domain.errors import DomainError
from app.service import AnalysisService

router = APIRouter(prefix="/api")


def svc(request: Request) -> AnalysisService:
    return request.app.state.service


class HoldingIn(BaseModel):
    stock_code: str | int
    market_value: float | str | None = None


class PortfolioIn(BaseModel):
    name: str = Field(default="", max_length=64)
    holdings: list[HoldingIn]


class AnalysisIn(BaseModel):
    portfolio_id: str
    benchmark_id: str | None = None
    top_n: int = Field(default=10, ge=1, le=100)


class ValidationIn(BaseModel):
    portfolio_id: str
    benchmark_id: str | None = None


class ComparisonIn(BaseModel):
    portfolio_ids: list[str]
    benchmark_id: str | None = None


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/meta")
def meta(request: Request) -> dict:
    s = svc(request)
    return {"stock_count": len(s.master), "master_sha256": s.master_sha256,
            "industries": sorted({i.industry for i in s.master.values()}),
            "industry_count": len({i.industry for i in s.master.values()}),
            "default_benchmark_id": s.default_benchmark_id() if s.registry.list("benchmark") else None}


# ---------- 数据源 ----------
@router.get("/portfolios")
def list_portfolios(request: Request) -> list[dict]:
    return [e.summary() for e in svc(request).registry.list("portfolio")]


@router.get("/benchmarks")
def list_benchmarks(request: Request) -> list[dict]:
    return [e.summary() for e in svc(request).registry.list("benchmark")]


@router.post("/portfolios", status_code=201)
def create_portfolio(request: Request, body: PortfolioIn) -> dict:
    items = [{"stock_code": str(h.stock_code), "market_value": "" if h.market_value is None else h.market_value}
             for h in body.holdings]
    return svc(request).register_json_portfolio(body.name, items).summary()


async def _read_upload(request: Request, file: UploadFile) -> bytes:
    limit = svc(request).max_upload_bytes
    raw = await file.read(limit + 1)
    if len(raw) > limit:
        raise DomainError(E.BAD_REQUEST, f"文件过大（上限 {limit / 1024 / 1024:g}MB）", http_status=413)
    return raw


@router.post("/portfolios/upload", status_code=201)
async def upload_portfolio(request: Request, file: UploadFile = File(...), name: str = Form("")) -> dict:
    raw = await _read_upload(request, file)
    return svc(request).register_upload("portfolio", name or _stem(file.filename), raw).summary()


@router.post("/benchmarks/upload", status_code=201)
async def upload_benchmark(request: Request, file: UploadFile = File(...), name: str = Form("")) -> dict:
    raw = await _read_upload(request, file)
    return svc(request).register_upload("benchmark", name or _stem(file.filename), raw).summary()


def _stem(filename: str | None) -> str:
    return (filename or "").rsplit("/", 1)[-1].removesuffix(".csv")


# ---------- 分析 ----------
@router.post("/analyses", status_code=201)
def create_analysis(request: Request, body: AnalysisIn) -> dict:
    return svc(request).run_analysis(body.portfolio_id, body.benchmark_id, body.top_n)


@router.post("/validations")
def validate(request: Request, body: ValidationIn) -> dict:
    return svc(request).validate(body.portfolio_id, body.benchmark_id)


@router.get("/analyses/{run_id}")
def get_analysis(request: Request, run_id: str) -> dict:
    return svc(request).get_run(run_id)


@router.get("/analyses/{run_id}/industries")
def get_industries(request: Request, run_id: str) -> dict:
    run = svc(request).get_success_run(run_id)
    return {"analysis_id": run_id, "industries": run["industries"]}


@router.get("/analyses/{run_id}/active-weights")
def get_active_weights(request: Request, run_id: str,
                       side: Literal["over", "under", "all"] = "all",
                       top: int = Query(10, ge=1, le=10000),
                       industry: str | None = None) -> dict:
    stocks = svc(request).get_success_run(run_id)["stocks"]  # 已按主动权重降序、代码升序
    if any("active_side" not in s or "active_rank" not in s for s in stocks):
        raise DomainError(E.BAD_REQUEST, "旧版结果缺少原始精度排名，请重新分析", http_status=409)
    if industry:
        stocks = [s for s in stocks if s["industry"] == industry]
    over = sorted((s for s in stocks if s["active_side"] == "over"),
                  key=lambda s: s["active_rank"])[:top]
    # 低配按主动权重升序（低配最多的在前），并列时代码升序
    under = sorted((s for s in stocks if s["active_side"] == "under"),
                   key=lambda s: s["active_rank"])[:top]
    if side == "over":
        return {"analysis_id": run_id, "over": over}
    if side == "under":
        return {"analysis_id": run_id, "under": under}
    return {"analysis_id": run_id, "over": over, "under": under}


@router.get("/analyses/{run_id}/export")
def export_csv(request: Request, run_id: str, type: Literal["industry", "active"] = "industry") -> Response:
    run = svc(request).get_success_run(run_id)
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    if type == "industry":
        w.writerow(["industry", "portfolio_weight", "benchmark_weight", "active_weight"])
        for r in run["industries"]:
            w.writerow([r["industry"], r["portfolio_weight"], r["benchmark_weight"], r["active_weight"]])
    else:
        w.writerow(["stock_code", "stock_name", "industry", "portfolio_weight", "benchmark_weight", "active_weight"])
        for s in run["stocks"]:
            w.writerow([s["stock_code"], s["stock_name"], s["industry"], s["portfolio_weight"],
                        s["benchmark_weight"], s["active_weight"]])
    filename = f"{run['portfolio']['name']}_{'行业分布' if type == 'industry' else '个股主动权重'}_{run_id[:8]}.csv"
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"})


@router.post("/comparisons")
def create_comparison(request: Request, body: ComparisonIn) -> dict:
    return svc(request).compare(body.portfolio_ids, body.benchmark_id)


# ---------- 留痕 ----------
@router.get("/history")
def list_history(request: Request, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                 portfolio_id: str | None = None,
                 status: Literal["success", "failed"] | None = None) -> dict:
    total, items = svc(request).history.list_runs(limit, offset, portfolio_id, status)
    return {"total": total, "items": items}
