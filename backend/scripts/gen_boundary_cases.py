"""生成边界条件测试数据：python scripts/gen_boundary_cases.py [--out ../samples/boundary]

每个场景一个目录，结构与 data/ 相同（可直接 PA_DATA_DIR=<目录> 启动服务查看）：
    <case>/stock_info.csv, portfolios/p.csv, benchmarks/b.csv, expected.json

expected.json 由本脚本内的“参考实现”生成：全程使用 fractions.Fraction 精确计算，
只在最后按四舍五入保留 6 位，与被测引擎（浮点 + math.fsum）完全独立。"""
from __future__ import annotations

import argparse
import json
import math
import shutil
from dataclasses import dataclass, field
from decimal import Decimal
from fractions import Fraction
from pathlib import Path
from typing import Any

PROJECT = Path(__file__).resolve().parents[2]


def r6(x: Fraction) -> float:
    """精确有理数 → 四舍五入（HALF_UP，远离 0）保留 6 位，全程无浮点。"""
    q = abs(x) * 10**6
    n = math.floor(q + Fraction(1, 2))
    v = Decimal(n).scaleb(-6)
    return float(-v if x < 0 else v) + 0.0


# ---------------------------------------------------------------- 参考实现
def reference(master: dict[str, tuple[str, str]], holdings: list[tuple[str, str]],
              bench: list[tuple[str, str]]) -> dict[str, Any]:
    mv = {c: Fraction(v) for c, v in holdings}
    total = sum(mv.values(), Fraction(0))
    pw = {c: v / total for c, v in mv.items()}
    bw = {c: Fraction(w) for c, w in bench}
    union = sorted(set(pw) | set(bw))
    stocks, ind_p, ind_b = {}, {}, {}
    for c in union:
        p, b = pw.get(c, Fraction(0)), bw.get(c, Fraction(0))
        ind = master[c][1]
        stocks[c] = {"portfolio_weight": r6(p), "benchmark_weight": r6(b), "active_weight": r6(p - b),
                     "is_held": c in pw, "is_benchmark_constituent": c in bw,
                     "active_side": "over" if p > b else "under" if p < b else "neutral"}
        if c in pw:
            ind_p[ind] = ind_p.get(ind, Fraction(0)) + p
        if c in bw:
            ind_b[ind] = ind_b.get(ind, Fraction(0)) + b
    industries = {}
    for ind in sorted(set(ind_p) | set(ind_b)):
        p, b = ind_p.get(ind, Fraction(0)), ind_b.get(ind, Fraction(0))
        industries[ind] = {"portfolio_weight": r6(p), "benchmark_weight": r6(b), "active_weight": r6(p - b)}
    top10 = sorted(pw, key=lambda c: (-pw[c], c))[:10]
    active_share = Fraction(1, 2) * sum((abs(pw.get(c, 0) - bw.get(c, 0)) for c in union), Fraction(0))
    overlap_weight = sum((min(pw.get(c, Fraction(0)), bw.get(c, Fraction(0))) for c in union), Fraction(0))
    total_out: float | int = int(total) if total.denominator == 1 else float(total)
    return {
        "metrics": {
            "portfolio_stock_count": len(pw), "benchmark_stock_count": len(bw), "total_market_value": total_out,
            "top10_weight": r6(sum((pw[c] for c in top10), Fraction(0))),
            "hhi": r6(sum((w * w for w in pw.values()), Fraction(0))),
            "active_share": r6(active_share),
            "overlap_count": sum(1 for c in union if pw.get(c, 0) > 0 and bw.get(c, 0) > 0),
            "overlap_weight": r6(overlap_weight),
            "overlap_plus_active_share": r6(overlap_weight + active_share),
        },
        "industries": industries,
        "stocks": stocks,
        "top10_codes": top10,
        "has_warning": sum(bw.values(), Fraction(0)) != 1,
    }


# ---------------------------------------------------------------- 场景定义
@dataclass
class Case:
    name: str
    title: str
    master: list[tuple[str, str, str]]              # (code, name, industry)
    holdings: list[tuple[str, str]] | None = None   # (code, market_value 原文)
    bench: list[tuple[str, str]] | None = None      # (code, weight 原文)
    raw_files: dict[str, bytes] = field(default_factory=dict)  # 覆盖写入的原始文件（格式 / 非法场景）
    expect: dict[str, Any] | None = None            # 非法场景的预期
    checks: dict[str, Any] = field(default_factory=dict)       # 额外的人工断言，便于读者理解


def M(n: int, industries: list[str], prefix: str = "6000") -> list[tuple[str, str, str]]:
    return [(f"{prefix}{i:02d}", f"边界股{i:02d}", industries[i % len(industries)]) for i in range(n)]


def csv_bytes(header: str, rows: list[tuple[str, ...]], enc: str = "utf-8", nl: str = "\n") -> bytes:
    return (nl.join([header, *[",".join(r) for r in rows]]) + nl).encode(enc)


IND = ["银行", "电子", "医药"]
BASE = M(20, IND)
C = [m[0] for m in BASE]


def build_cases() -> list[Case]:
    cases: list[Case] = []
    add = cases.append

    # ---------- 合法：口径边界 ----------
    add(Case("01_doc_example", "文档示例：A、B 只在组合 / C 只在基准，主动份额 0.5",
             M(3, ["行业甲", "行业乙", "行业丙"]),
             [("600000", "60"), ("600001", "40")], [("600000", "0.5"), ("600002", "0.5")],
             checks={"active_share": 0.5, "overlap_count": 1, "union": 3}))
    add(Case("02_benchmark_only_stock_and_industry", "只在基准里的股票计入并集；某行业组合完全未持有",
             M(6, ["银行", "电子", "医药"]),
             [("600000", "100"), ("600001", "100")],
             [("600000", "0.3"), ("600001", "0.2"), ("600002", "0.25"), ("600005", "0.25")],
             checks={"industry_only_in_benchmark": "医药"}))
    add(Case("03_top10_tie_at_boundary", "第 9~12 名市值完全相同且倒序写入：第 9、10 名应按代码升序取",
             BASE[:12],
             [(C[i], str(1000 - i * 10)) for i in range(8)] + [(C[i], "500") for i in (11, 10, 9, 8)],
             [(C[0], "1")],
             checks={"top10_last_two": [C[8], C[9]]}))
    add(Case("04_all_equal_weights", "15 只等权：前十大取代码最小的 10 只，权重 10/15",
             BASE[:15], [(c, "100") for c in reversed(C[:15])], [(C[0], "0.5"), (C[14], "0.5")],
             checks={"top10_weight": round(10 / 15, 6)}))
    add(Case("05_fewer_than_10", "只有 3 只持仓：前十大权重 = 1", BASE[:5],
             [(C[0], "1"), (C[1], "2"), (C[2], "3")], [(C[3], "1")], checks={"top10_weight": 1.0}))
    add(Case("06_single_holding", "单只持仓：HHI = 1", BASE[:3], [(C[0], "12345")], [(C[0], "0.4"), (C[1], "0.6")],
             checks={"hhi": 1.0}))
    add(Case("07_identical_to_benchmark", "组合与基准完全一致：主动份额 0，重合权重 1", BASE[:4],
             [(C[0], "40"), (C[1], "30"), (C[2], "20"), (C[3], "10")],
             [(C[0], "0.4"), (C[1], "0.3"), (C[2], "0.2"), (C[3], "0.1")],
             checks={"active_share": 0.0, "overlap_weight": 1.0}))
    add(Case("08_disjoint", "组合与基准没有交集：主动份额 1，重合 0", BASE[:4],
             [(C[0], "1"), (C[1], "1")], [(C[2], "0.5"), (C[3], "0.5")],
             checks={"active_share": 1.0, "overlap_count": 0, "overlap_weight": 0.0}))
    add(Case("09_round_half_up", "四舍五入边界：0.0000005 → 0.000001，0.9999995 → 1.000000", BASE[:3],
             [(C[0], "1"), (C[1], "1999999")], [(C[2], "1")],
             checks={"stock_weights": {C[0]: 0.000001, C[1]: 1.0}}))
    add(Case("10_tiny_weight_still_held", "权重舍入为 0 的持仓仍算“持有”、仍计入重合股票数", BASE[:3],
             [(C[0], "1"), (C[1], "1000000000")], [(C[0], "0.5"), (C[1], "0.5")],
             checks={"overlap_count": 2, "tiny_display_zero": C[0]}))
    add(Case("11_zero_weight_constituent", "基准里权重为 0 的成分：计入并集，但不算重合（两边须 > 0）", BASE[:4],
             [(C[0], "50"), (C[1], "50")], [(C[0], "1"), (C[1], "0"), (C[2], "0")],
             checks={"overlap_count": 1, "union": 3}))
    add(Case("12_bench_sum_low_edge", "基准权重合计 0.99（容差下边界）：接受、不归一化、给出提示", BASE[:3],
             [(C[0], "1")], [(C[0], "0.49"), (C[1], "0.5")], checks={"warning": True}))
    add(Case("13_bench_sum_high_edge", "基准权重合计 1.01（容差上边界）：接受、不归一化、给出提示", BASE[:3],
             [(C[0], "1")], [(C[0], "0.51"), (C[1], "0.5")], checks={"warning": True}))
    add(Case("14_large_and_decimal_values", "超大市值、小数市值、科学计数法", BASE[:4],
             [(C[0], "1000000000000000"), (C[1], "0.5"), (C[2], "2.5e14"), (C[3], "123456789.123")],
             [(C[0], "0.7"), (C[3], "0.3")]))

    # ---------- 合法：文件格式边界 ----------
    fmt_master = [("000001", "平安银行", "银行"), ("000002", "万科Ａ", "房地产"), ("600519", "贵州茅台", "食品饮料")]
    add(Case("15_format_variants", "格式：主数据 GBK；组合带 BOM/CRLF/空行/多余列/列顺序颠倒/空格；代码前导 0",
             fmt_master,
             [("000001", "300"), ("000002", "200"), ("600519", "500")],
             [("000001", "0.5"), ("600519", "0.5")],
             raw_files={
                 "stock_info.csv": csv_bytes("stock_code,stock_name,industry",
                                             [tuple(r) for r in fmt_master], enc="gbk"),
                 "portfolios/p.csv": "﻿note,market_value,stock_code\r\n x , 300 , 000001 \r\n\r\n"
                                     "y,200,000002\r\n,500,600519\r\n".encode("utf-8"),
             },
             checks={"leading_zero_kept": "000001"}))

    # ---------- 非法：组合 / 基准（服务可启动，该数据源被拒绝分析） ----------
    def bad_p(name: str, title: str, body: bytes, rule: str) -> None:
        add(Case(name, title, BASE[:5], [(C[0], "1")], [(C[0], "1")],
                 raw_files={"portfolios/p.csv": body}, expect={"invalid": "portfolio", "rule": rule}))

    def bad_b(name: str, title: str, body: bytes, rule: str) -> None:
        add(Case(name, title, BASE[:5], [(C[0], "1")], [(C[0], "1")],
                 raw_files={"benchmarks/b.csv": body}, expect={"invalid": "benchmark", "rule": rule}))

    P = "stock_code,market_value"
    bad_p("20_mv_zero", "市值为 0", csv_bytes(P, [(C[0], "100"), (C[1], "0")]), "NON_POSITIVE_MARKET_VALUE")
    bad_p("21_mv_negative", "市值为负", csv_bytes(P, [(C[0], "100"), (C[1], "-0.01")]), "NON_POSITIVE_MARKET_VALUE")
    bad_p("22_duplicate_code", "组合内代码重复", csv_bytes(P, [(C[0], "1"), (C[1], "1"), (C[0], "2")]), "DUPLICATE_STOCK_CODE")
    bad_p("23_unknown_stock", "股票不在主数据中", csv_bytes(P, [(C[0], "1"), ("999999", "1")]), "UNKNOWN_STOCK")
    bad_p("24_missing_field", "缺少 market_value 列", csv_bytes("stock_code,value", [(C[0], "1")]), "FIELD_MISSING")
    bad_p("25_unparseable", "市值无法解析（带引号的千分位 \"1,000\"）", csv_bytes(P, [(C[0], '"1,000"')]), "VALUE_UNPARSEABLE")
    bad_p("25b_extra_columns", "列数多于表头（未加引号的千分位 1,000 会被拆成两列）",
          csv_bytes(P, [(C[0], "100"), (C[1], "1,000")]), "INVALID_FILE")
    bad_p("26_empty_value", "市值为空", csv_bytes(P, [(C[0], "")]), "VALUE_UNPARSEABLE")
    bad_p("27_nan", "市值为 NaN", csv_bytes(P, [(C[0], "nan")]), "VALUE_UNPARSEABLE")
    bad_p("28_inf", "市值为 inf", csv_bytes(P, [(C[0], "inf")]), "VALUE_UNPARSEABLE")
    bad_p("29_header_only", "只有表头没有持仓", csv_bytes(P, []), "EMPTY_PORTFOLIO")
    bad_p("30_empty_file", "空文件", b"", "INVALID_FILE")
    bad_p("31_empty_code", "股票代码为空", csv_bytes(P, [("", "1")]), "INVALID_FILE")
    B = "stock_code,weight"
    bad_b("32_bench_sum_below", "基准合计 0.989999（刚超下限）", csv_bytes(B, [(C[0], "0.989999")]), "BENCHMARK_WEIGHT_SUM_INVALID")
    bad_b("33_bench_sum_above", "基准合计 1.010001（刚超上限）", csv_bytes(B, [(C[0], "1.010001")]), "BENCHMARK_WEIGHT_SUM_INVALID")
    bad_b("34_bench_negative", "基准权重为负", csv_bytes(B, [(C[0], "1.2"), (C[1], "-0.2")]), "NEGATIVE_BENCHMARK_WEIGHT")
    bad_b("35_bench_duplicate", "基准内代码重复", csv_bytes(B, [(C[0], "0.5"), (C[0], "0.5")]), "DUPLICATE_STOCK_CODE")
    bad_b("36_bench_unknown", "基准成分不在主数据中", csv_bytes(B, [(C[0], "0.5"), ("999999", "0.5")]), "UNKNOWN_STOCK")

    # ---------- 非法：主数据（服务应拒绝启动） ----------
    def bad_master(name: str, title: str, body: bytes | None) -> None:
        raw = {"stock_info.csv": body} if body is not None else {}
        add(Case(name, title, BASE[:3], [(C[0], "1")], [(C[0], "1")], raw_files=raw,
                 expect={"startup_refused": True, "drop_master": body is None}))

    S = "stock_code,stock_name,industry"
    bad_master("40_master_missing", "主数据文件缺失", None)
    bad_master("41_master_empty_industry", "主数据行业字段为空", csv_bytes(S, [(C[0], "甲", "")]))
    bad_master("42_master_duplicate", "主数据代码重复", csv_bytes(S, [(C[0], "甲", "银行"), (C[0], "乙", "电子")]))
    bad_master("43_master_missing_column", "主数据缺少 industry 列", csv_bytes("stock_code,stock_name", [(C[0], "甲")]))
    return cases


def write_case(root: Path, case: Case) -> None:
    d = root / case.name
    if d.exists():
        shutil.rmtree(d)
    (d / "portfolios").mkdir(parents=True)
    (d / "benchmarks").mkdir(parents=True)
    files = {
        "stock_info.csv": csv_bytes("stock_code,stock_name,industry", [tuple(m) for m in case.master]),
        "portfolios/p.csv": csv_bytes("stock_code,market_value", case.holdings or []),
        "benchmarks/b.csv": csv_bytes("stock_code,weight", case.bench or []),
        **case.raw_files,
    }
    if case.expect and case.expect.get("drop_master"):
        files.pop("stock_info.csv")
    for rel, body in files.items():
        (d / rel).write_bytes(body)
    expected: dict[str, Any] = {"case": case.name, "title": case.title, "checks": case.checks}
    if case.expect:
        expected.update(case.expect)
    else:
        master = {m[0]: (m[1], m[2]) for m in case.master}
        expected["valid"] = True
        expected.update(reference(master, case.holdings or [], case.bench or []))
    (d / "expected.json").write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(PROJECT / "samples" / "boundary"))
    args = ap.parse_args()
    root = Path(args.out)
    root.mkdir(parents=True, exist_ok=True)
    cases = build_cases()
    for c in cases:
        write_case(root, c)
        tag = "合法" if not c.expect else ("拒绝启动" if c.expect.get("startup_refused") else f"拒绝{c.expect['invalid']}")
        print(f"  {c.name:38} [{tag}] {c.title}")
    print(f"共 {len(cases)} 个场景 → {root}")


if __name__ == "__main__":
    main()
