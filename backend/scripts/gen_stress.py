"""生成压测数据集：python scripts/gen_stress.py [--out ../data_stress] [--n 5000] [--seed 7]

主数据 2n 只股票 / 30 个行业；组合 n 只、基准 n 只，二者约一半重叠。
输出目录结构与 data/ 相同，可直接用 PA_DATA_DIR 指向它启动服务。"""
from __future__ import annotations

import argparse
import random
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[2] / "data_stress"))
    ap.add_argument("--n", type=int, default=5000)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    rnd = random.Random(args.seed)
    out = Path(args.out)
    (out / "portfolios").mkdir(parents=True, exist_ok=True)
    (out / "benchmarks").mkdir(parents=True, exist_ok=True)

    n = args.n
    codes = [f"{100000 + i:06d}" for i in range(2 * n)]
    industries = [f"行业{i:02d}" for i in range(30)]
    with open(out / "stock_info.csv", "w", encoding="utf-8") as f:
        f.write("stock_code,stock_name,industry\n")
        for c in codes:
            f.write(f"{c},压测证券{c},{rnd.choice(industries)}\n")

    port_codes = rnd.sample(codes[: int(1.5 * n)], n)
    bench_codes = rnd.sample(codes[n // 2:], n)
    with open(out / "portfolios" / "stress_portfolio.csv", "w", encoding="utf-8") as f:
        f.write("stock_code,market_value\n")
        for c in port_codes:
            f.write(f"{c},{rnd.randint(1_000_000, 500_000_000)}\n")

    raw = [rnd.paretovariate(1.5) for _ in bench_codes]
    total = sum(raw)
    with open(out / "benchmarks" / "stress_benchmark.csv", "w", encoding="utf-8") as f:
        f.write("stock_code,weight\n")
        for c, w in zip(bench_codes, raw):
            f.write(f"{c},{w / total!r}\n")
    print(f"已生成压测数据：{out}（主数据 {len(codes)}，组合 {n}，基准 {n}）")


if __name__ == "__main__":
    main()
