"""CSV 数据加载与校验。只负责把原始字节解析成领域对象，不包含任何分析口径。"""
from __future__ import annotations

import csv
import io
import math
from decimal import Decimal
from pathlib import Path
from typing import Any

from app.domain import errors as E
from app.domain.errors import DomainError
from app.domain.models import Benchmark, Constituent, Holding, Portfolio, StockInfo

BENCHMARK_SUM_TOLERANCE = 0.01


def decode_bytes(raw: bytes, source: str) -> str:
    # Excel 另存的中文 CSV 常为 GBK，兼容之
    for enc in ("utf-8-sig", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise DomainError(E.INVALID_FILE, f"{source}：文件编码无法识别（需 UTF-8 或 GBK）")


def _read_rows(text: str, source: str, required: list[str]) -> list[tuple[int, dict[str, str]]]:
    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration:
        raise DomainError(E.INVALID_FILE, f"{source}：文件为空")
    except csv.Error as exc:
        raise DomainError(E.INVALID_FILE, f"{source}：CSV 格式错误（{exc}）")
    header = [h.strip().lstrip("﻿") for h in header]
    missing = [c for c in required if c not in header]
    if missing:
        raise DomainError(E.FIELD_MISSING, f"{source}：缺少字段 {', '.join(missing)}",
                          [{"field": c} for c in missing])
    idx = {c: header.index(c) for c in required}
    rows: list[tuple[int, dict[str, str]]] = []
    overflow: list[dict[str, Any]] = []
    try:
        for line_no, rec in enumerate(reader, start=2):
            if not any(cell.strip() for cell in rec):
                continue  # 跳过空行
            # 列数多于表头（如未加引号的千分位 1,000）会让数值被静默截断，必须拒绝；行尾空列可容忍
            if any(cell.strip() for cell in rec[len(header):]):
                overflow.append({"line": line_no, "reason": f"有 {len(rec)} 列，表头只有 {len(header)} 列",
                                 "value": ",".join(rec)})
                continue
            rows.append((line_no, {c: (rec[i].strip() if i < len(rec) else "") for c, i in idx.items()}))
    except csv.Error as exc:
        raise DomainError(E.INVALID_FILE, f"{source}：CSV 格式错误（{exc}）")
    _raise_if(overflow, E.INVALID_FILE, f"{source}：数据行列数多于表头（数值含逗号时请加引号）")
    return rows


def _parse_number(value: str) -> float | None:
    try:
        x = float(value)
    except ValueError:
        return None
    return x if math.isfinite(x) else None


def _raise_if(errs: list[dict[str, Any]], code: str, message: str) -> None:
    if errs:
        raise DomainError(code, f"{message}（共 {len(errs)} 处）", errs[:100])


def _check_codes(rows: list[tuple[int, dict[str, str]]], source: str) -> None:
    empty = [{"line": ln, "field": "stock_code", "reason": "为空"} for ln, r in rows if not r["stock_code"]]
    _raise_if(empty, E.INVALID_FILE, f"{source}：股票代码为空")
    seen: dict[str, int] = {}
    dups: list[dict[str, Any]] = []
    for ln, r in rows:
        code = r["stock_code"]
        if code in seen:
            dups.append({"line": ln, "stock_code": code, "first_line": seen[code]})
        else:
            seen[code] = ln
    _raise_if(dups, E.DUPLICATE_STOCK_CODE, f"{source}：股票代码重复")


def _parse_numeric_column(rows: list[tuple[int, dict[str, str]]], field: str, source: str) -> list[float]:
    values: list[float] = []
    bad: list[dict[str, Any]] = []
    for ln, r in rows:
        x = _parse_number(r[field])
        if x is None:
            bad.append({"line": ln, "stock_code": r["stock_code"], "field": field, "value": r[field]})
        else:
            values.append(x)
    _raise_if(bad, E.VALUE_UNPARSEABLE, f"{source}：字段 {field} 缺失或无法解析为数值")
    return values


def parse_master(raw: bytes, source: str = "stock_info.csv") -> dict[str, StockInfo]:
    rows = _read_rows(decode_bytes(raw, source), source, ["stock_code", "stock_name", "industry"])
    if not rows:
        raise DomainError(E.INVALID_FILE, f"{source}：没有任何数据行")
    _check_codes(rows, source)
    empty = [
        {"line": ln, "stock_code": r["stock_code"], "field": field}
        for ln, r in rows
        for field in ("stock_name", "industry")
        if not r[field]
    ]
    _raise_if(empty, E.INVALID_FILE, f"{source}：股票名称或行业字段为空")
    return {r["stock_code"]: StockInfo(r["stock_code"], r["stock_name"], r["industry"]) for _, r in rows}


def parse_portfolio(raw: bytes, source: str) -> Portfolio:
    rows = _read_rows(decode_bytes(raw, source), source, ["stock_code", "market_value"])
    return build_portfolio([(ln, r["stock_code"], r["market_value"]) for ln, r in rows], source)


def build_portfolio(items: list[tuple[int, str, str]], source: str) -> Portfolio:
    """items: (行号, 股票代码, 市值原始文本)。CSV 与 JSON 两种输入共用同一套校验。"""
    rows = [(ln, {"stock_code": code.strip(), "market_value": str(mv).strip()}) for ln, code, mv in items]
    if not rows:
        raise DomainError(E.EMPTY_PORTFOLIO, f"{source}：组合没有任何持仓")
    _check_codes(rows, source)
    values = _parse_numeric_column(rows, "market_value", source)
    non_pos = [{"line": ln, "stock_code": r["stock_code"], "market_value": v}
               for (ln, r), v in zip(rows, values) if v <= 0]
    _raise_if(non_pos, E.NON_POSITIVE_MARKET_VALUE, f"{source}：持仓市值必须为正数")
    return Portfolio([Holding(r["stock_code"], v) for (_, r), v in zip(rows, values)])


def parse_benchmark(raw: bytes, source: str) -> Benchmark:
    rows = _read_rows(decode_bytes(raw, source), source, ["stock_code", "weight"])
    if not rows:
        raise DomainError(E.INVALID_FILE, f"{source}：基准没有任何成分股")
    _check_codes(rows, source)
    values = _parse_numeric_column(rows, "weight", source)
    neg = [{"line": ln, "stock_code": r["stock_code"], "weight": v} for (ln, r), v in zip(rows, values) if v < 0]
    _raise_if(neg, E.NEGATIVE_BENCHMARK_WEIGHT, f"{source}：基准权重不能为负")
    # 从已校验的原始文本求和，避免浮点误差将 0.99 / 1.01 端点判为越界。
    exact_total = sum((Decimal(r["weight"]) for _, r in rows), Decimal("0"))
    total = math.fsum(values)
    if abs(exact_total - Decimal("1")) > Decimal(str(BENCHMARK_SUM_TOLERANCE)):
        raise DomainError(E.BENCHMARK_WEIGHT_SUM_INVALID,
                          f"{source}：基准权重合计为 {total:.6f}，偏离 1 超过 ±{BENCHMARK_SUM_TOLERANCE} 容差",
                          [{"weight_sum": total, "tolerance": BENCHMARK_SUM_TOLERANCE}])
    return Benchmark([Constituent(r["stock_code"], v) for (_, r), v in zip(rows, values)], total)


def check_known_stocks(codes: list[str], master: dict[str, StockInfo], source: str) -> None:
    missing = [c for c in codes if c not in master]
    if missing:
        raise DomainError(E.UNKNOWN_STOCK, f"{source}：{len(missing)} 只股票在主数据中不存在",
                          [{"stock_code": c} for c in missing[:100]])


def read_file(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except FileNotFoundError:
        raise DomainError(E.FILE_NOT_FOUND, f"数据文件不存在：{path}")
    except OSError as exc:
        raise DomainError(E.INVALID_FILE, f"数据文件无法读取：{path}（{exc.strerror}）")
