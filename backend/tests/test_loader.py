from __future__ import annotations

import pytest

from app.domain.errors import DomainError
from app.loaders.csv_loader import parse_benchmark, parse_master, parse_portfolio, read_file


def _code(fn, text: str | bytes) -> str:
    raw = text.encode("utf-8") if isinstance(text, str) else text
    with pytest.raises(DomainError) as ei:
        fn(raw, "f.csv")
    return ei.value.code


@pytest.mark.parametrize("text,code", [
    ("", "INVALID_FILE"),
    ("stock_code\n600000\n", "FIELD_MISSING"),                       # 缺字段
    ("stock_code,market_value\n", "EMPTY_PORTFOLIO"),
    ("stock_code,market_value\n600000,abc\n", "VALUE_UNPARSEABLE"),  # 无法解析
    ("stock_code,market_value\n600000,\n", "VALUE_UNPARSEABLE"),     # 数值缺失
    ("stock_code,market_value\n600000,nan\n", "VALUE_UNPARSEABLE"),
    ("stock_code,market_value\n,100\n", "INVALID_FILE"),             # 代码缺失
    ("stock_code,market_value\n600000,0\n", "NON_POSITIVE_MARKET_VALUE"),
    ("stock_code,market_value\n600000,-5\n", "NON_POSITIVE_MARKET_VALUE"),
    ("stock_code,market_value\n600000,1\n600000,2\n", "DUPLICATE_STOCK_CODE"),
])
def test_portfolio_errors(text, code):
    assert _code(parse_portfolio, text) == code


def test_portfolio_error_reports_line_numbers():
    with pytest.raises(DomainError) as ei:
        parse_portfolio(b"stock_code,market_value\n600000,1\n600001,-1\n600002,0\n", "f.csv")
    assert [d["line"] for d in ei.value.details] == [3, 4]


@pytest.mark.parametrize("text,code", [
    ("stock_code,weight\n600000,0.5\n600001,0.4\n", "BENCHMARK_WEIGHT_SUM_INVALID"),
    ("stock_code,weight\n600000,1.2\n600001,-0.2\n", "NEGATIVE_BENCHMARK_WEIGHT"),
    ("stock_code,weight\n600000,x\n", "VALUE_UNPARSEABLE"),
    ("stock_code,weight\n600000,0.5\n600000,0.5\n", "DUPLICATE_STOCK_CODE"),
    ("stock_code,weight\n", "INVALID_FILE"),
])
def test_benchmark_errors(text, code):
    assert _code(parse_benchmark, text) == code


def test_benchmark_within_tolerance_kept_as_is():
    b = parse_benchmark(b"stock_code,weight\n600000,0.5\n600001,0.495\n", "f.csv")
    assert b.weight_sum == pytest.approx(0.995)
    assert [c.weight for c in b.constituents] == [0.5, 0.495]


@pytest.mark.parametrize("weights", [("0.99",), ("1.01",), ("0.5", "0.49"), ("0.5", "0.51")])
def test_benchmark_tolerance_endpoints_accepted(weights):
    raw = "stock_code,weight\n" + "".join(f"{i},{w}\n" for i, w in enumerate(weights))
    b = parse_benchmark(raw.encode(), "b.csv")
    assert [c.weight for c in b.constituents] == [float(w) for w in weights]


@pytest.mark.parametrize("weight", ["0.989999", "1.010001"])
def test_benchmark_outside_tolerance_rejected(weight):
    raw = f"stock_code,weight\n600000,{weight}\n"
    assert _code(parse_benchmark, raw) == "BENCHMARK_WEIGHT_SUM_INVALID"


def test_master_errors():
    assert _code(parse_master, "stock_code,stock_name\n1,a\n") == "FIELD_MISSING"
    assert _code(parse_master, "stock_code,stock_name,industry\n1,a,\n") == "INVALID_FILE"


@pytest.mark.parametrize("row,fields", [
    ("A,,X", ["stock_name"]),
    ("A,   ,X", ["stock_name"]),
    ("A,,", ["stock_name", "industry"]),
])
def test_master_empty_values_report_fields(row, fields):
    with pytest.raises(DomainError) as exc:
        parse_master(f"stock_code,stock_name,industry\n{row}\n".encode())
    assert exc.value.code == "INVALID_FILE"
    assert exc.value.details == [
        {"line": 2, "stock_code": "A", "field": field} for field in fields
    ]


def test_master_valid_name_and_industry():
    master = parse_master("stock_code,stock_name,industry\nA,股票A,X\n".encode())
    assert master["A"].stock_name == "股票A"
    assert master["A"].industry == "X"


def test_gbk_and_bom_supported():
    gbk = "stock_code,stock_name,industry\n600000,浦发,银行\n".encode("gbk")
    assert parse_master(gbk)["600000"].industry == "银行"
    bom = "﻿stock_code,market_value\n000001,10\n".encode("utf-8")
    assert parse_portfolio(bom, "f").holdings[0].stock_code == "000001"  # 前导 0 保留


def test_missing_file_reported(tmp_path):
    with pytest.raises(DomainError) as exc:
        read_file(tmp_path / "nope.csv")
    assert exc.value.code == "FILE_NOT_FOUND"
