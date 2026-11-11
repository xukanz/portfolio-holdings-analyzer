"""生成默认演示数据与对应的参考答案：python scripts/gen_sample.py [--seed 20261111]

输出：
    data/stock_info.csv              主数据：300 只虚构股票，12 个行业
    data/benchmarks/benchmark.csv    默认基准：150 只成分股，权重合计严格为 1
    data/portfolios/portfolio.csv    默认组合：120 只持仓，约一半与基准重合
    backend/tests/fixtures/expected_{metrics.json,industry.csv,active_weight.csv}
        由 gen_boundary_cases.reference()（fractions.Fraction 精确计算）生成，与被测引擎独立。

股票名称均为“示例股票NNN”，与任何真实证券无关。生成后可再运行 gen_portfolios.py 生成其余演示组合。"""
from __future__ import annotations

import argparse
import csv
import json
import random
import sys
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gen_boundary_cases import reference  # noqa: E402

PROJECT = Path(__file__).resolve().parents[2]
INDUSTRIES = ["银行", "非银金融", "食品饮料", "医药生物", "电子", "计算机",
              "通信", "电力设备", "汽车", "机械设备", "有色金属", "房地产"]
N_STOCKS, N_BENCH, N_PORT, N_OVERLAP = 300, 150, 120, 67
WEIGHT_UNIT = 10**6  # 基准权重以 1e-6 为最小单位，保证合计严格为 1


def write_csv(path: Path, header: list[str], rows: list[list[object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    print(f"  {path.relative_to(PROJECT)}（{len(rows)} 行）")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261111)
    args = ap.parse_args()
    rnd = random.Random(args.seed)
    data = PROJECT / "data"

    # 主数据：每个行业 25 只，打乱后分配代码
    inds = [INDUSTRIES[i % len(INDUSTRIES)] for i in range(N_STOCKS)]
    rnd.shuffle(inds)
    codes = [f"{600000 + i:06d}" for i in range(N_STOCKS)]
    master = {c: (f"示例股票{i + 1:03d}", ind) for i, (c, ind) in enumerate(zip(codes, inds))}
    write_csv(data / "stock_info.csv", ["stock_code", "stock_name", "industry"],
              [[c, n, ind] for c, (n, ind) in master.items()])

    # 基准：长尾分布的权重，整数化后把舍入差额补到最大成分上
    bench_codes = sorted(rnd.sample(codes, N_BENCH))
    raw = {c: rnd.paretovariate(1.2) for c in bench_codes}
    s = sum(raw.values())
    units = {c: max(1, round(v / s * WEIGHT_UNIT)) for c, v in raw.items()}
    units[max(units, key=units.get)] += WEIGHT_UNIT - sum(units.values())
    bench = [(c, f"{u / WEIGHT_UNIT:.6f}") for c, u in sorted(units.items(), key=lambda x: (-x[1], x[0]))]
    write_csv(data / "benchmarks" / "benchmark.csv", ["stock_code", "weight"], [list(r) for r in bench])

    # 组合：一部分取自基准（偏向权重股），其余为基准外个股；市值为整数元
    overlap = set()
    pool = dict(units)
    while len(overlap) < N_OVERLAP:
        c = rnd.choices(list(pool), weights=list(pool.values()))[0]
        overlap.add(c)
        pool.pop(c)
    outside = rnd.sample([c for c in codes if c not in units], N_PORT - N_OVERLAP)
    holdings = [(c, str(int(rnd.lognormvariate(17.5, 0.8)))) for c in sorted(overlap | set(outside))]
    holdings.sort(key=lambda r: -int(r[1]))
    write_csv(data / "portfolios" / "portfolio.csv", ["stock_code", "market_value"], [list(r) for r in holdings])

    # 参考答案
    ref = reference(master, holdings, bench)
    fx = PROJECT / "backend" / "tests" / "fixtures"
    fx.mkdir(parents=True, exist_ok=True)
    metrics = {k: v for k, v in ref["metrics"].items() if k != "overlap_plus_active_share"}
    (fx / "expected_metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  {(fx / 'expected_metrics.json').relative_to(PROJECT)}")

    ind_rows = sorted(ref["industries"].items(), key=lambda kv: (-kv[1]["portfolio_weight"], kv[0]))
    write_csv(fx / "expected_industry.csv", ["industry", "portfolio_weight", "benchmark_weight", "active_weight"],
              [[k, v["portfolio_weight"], v["benchmark_weight"], v["active_weight"]] for k, v in ind_rows])

    # 个股按精确主动权重降序、代码升序（与引擎口径一致，排序基于舍入前的值）
    mv = {c: Fraction(v) for c, v in holdings}
    total = sum(mv.values())
    bw = {c: Fraction(w) for c, w in bench}
    exact = {c: mv.get(c, Fraction(0)) / total - bw.get(c, Fraction(0)) for c in ref["stocks"]}
    order = sorted(ref["stocks"], key=lambda c: (-exact[c], c))
    write_csv(fx / "expected_active_weight.csv",
              ["stock_code", "industry", "portfolio_weight", "benchmark_weight", "active_weight"],
              [[c, master[c][1], ref["stocks"][c]["portfolio_weight"], ref["stocks"][c]["benchmark_weight"],
                ref["stocks"][c]["active_weight"]] for c in order])
    print(f"指标：{json.dumps(metrics, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
