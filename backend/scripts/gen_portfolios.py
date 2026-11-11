"""生成用于演示 / 对比 / 容错测试的组合 CSV：python scripts/gen_portfolios.py [--data ../data] [--seed 2026]

内置组合（6 个）写入 <data>/portfolios/（服务启动即预加载）；
上传测试组合（6 个风格组合）写入 <项目>/samples/portfolios/，非法样例写入 <项目>/samples/invalid/，均用于界面上传测试。
股票代码全部取自 <data>/stock_info.csv 与基准文件，行业由数据决定，不写死。"""
from __future__ import annotations

import argparse
import csv
import random
from collections import defaultdict
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]


def read_csv(path: Path) -> list[dict[str, str]]:
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def write(path: Path, rows: list[tuple[str, object]], header: tuple[str, str] = ("stock_code", "market_value")) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    print(f"  {path.relative_to(PROJECT)}（{len(rows)} 行）")


def to_mv(weights: dict[str, float], total: int, rnd: random.Random) -> list[tuple[str, int]]:
    """按目标权重分配市值（元），按市值降序输出。"""
    s = sum(weights.values())
    rows = [(c, max(1, round(total * w / s * rnd.uniform(0.995, 1.005)))) for c, w in weights.items()]
    return sorted(rows, key=lambda r: (-r[1], r[0]))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(PROJECT / "data"))
    ap.add_argument("--seed", type=int, default=2026)
    args = ap.parse_args()
    data = Path(args.data)
    rnd = random.Random(args.seed)

    master = read_csv(data / "stock_info.csv")
    bench = {r["stock_code"]: float(r["weight"]) for r in read_csv(data / "benchmarks" / "benchmark.csv")}
    by_ind: dict[str, list[str]] = defaultdict(list)
    for r in master:
        by_ind[r["industry"]].append(r["stock_code"])
    industries = sorted(by_ind)
    all_codes = [r["stock_code"] for r in master]
    out = data / "portfolios"
    print("合法组合：")

    # 1) 指数增强：持有全部基准成分，权重在基准上小幅倾斜，并少量配置基准外个股 → 主动份额低
    w = {c: bw * rnd.uniform(0.7, 1.3) for c, bw in bench.items()}
    for c in rnd.sample([c for c in all_codes if c not in bench], 10):
        w[c] = 0.002
    write(out / "index_enhanced.csv", to_mv(w, 8_000_000_000, rnd))

    # 2) 高集中度：12 只，头部权重很高 → 前十大接近 100%，HHI 高
    picks = rnd.sample(all_codes, 12)
    w = {c: 0.8 ** i for i, c in enumerate(picks)}
    write(out / "concentrated.csv", to_mv(w, 1_500_000_000, rnd))

    # 3) 行业主题：集中在两个行业（按数据中的行业清单选取） → 行业大幅超配
    theme = rnd.sample(industries, 2)
    w = {c: rnd.uniform(0.5, 1.5) for ind in theme for c in rnd.sample(by_ind[ind], 15)}
    for c in rnd.sample([c for c in all_codes if c not in w], 10):
        w[c] = 0.3
    write(out / "sector_theme.csv", to_mv(w, 3_000_000_000, rnd))
    print(f"    主题行业：{'、'.join(theme)}")

    # 4) 等权分散：每个行业 10 只、市值相同 → HHI = 1/N
    codes = [c for ind in industries for c in sorted(by_ind[ind])[:10]]
    write(out / "equal_weight.csv", [(c, 50_000_000) for c in codes])

    # 5) 前十大并列边界：前 8 只权重各异，之后 4 只市值完全相同，第 9、10 名须按代码升序取
    picks = sorted(rnd.sample(all_codes, 20))
    rows = [(c, 300_000_000 - i * 20_000_000) for i, c in enumerate(picks[:8])]
    tie = picks[8:12]
    rows += [(c, 100_000_000) for c in reversed(tie)]   # 故意倒序写入，验证排序不依赖文件顺序
    rows += [(c, 50_000_000 - i * 1_000_000) for i, c in enumerate(picks[12:])]
    write(out / "top10_tie.csv", rows)
    print(f"    并列股票：{', '.join(tie)}（第 9、10 名应为 {tie[0]}、{tie[1]}）")

    # 6) 与基准完全一致：市值严格按基准权重 → 主动份额 0、重合权重 1
    write(out / "benchmark_replica.csv", [(c, round(bw * 10_000_000_000)) for c, bw in bench.items()])

    # ---------- 上传测试组合：风格组合（不放入 data/，供用户上传体验；行业按名称挑选，数据中不存在的行业自动跳过） ----------
    extra = PROJECT / "samples" / "portfolios"
    print("上传测试组合：")
    def style(names: list[str], per: int, extra: int, total: int) -> list[tuple[str, int]]:
        inds = [i for i in names if i in by_ind] or rnd.sample(industries, 2)
        w = {c: rnd.uniform(0.6, 1.6) for ind in inds for c in rnd.sample(by_ind[ind], min(per, len(by_ind[ind])))}
        for c in rnd.sample([c for c in all_codes if c not in w], extra):
            w[c] = rnd.uniform(0.1, 0.4)
        return to_mv(w, total, rnd)

    # 7~9) 行业风格：价值金融 / 科技成长 / 大消费
    write(extra / "value_financials.csv", style(["银行", "非银金融", "房地产"], 14, 12, 4_000_000_000))
    write(extra / "tech_growth.csv", style(["电子", "计算机", "通信"], 14, 12, 3_500_000_000))
    write(extra / "consumer_health.csv", style(["食品饮料", "医药生物"], 18, 10, 2_500_000_000))

    # 10) 调仓后：在默认组合基础上卖出最小的 10 只、买入 10 只基准权重股、其余小幅调整 → 与 portfolio 对比看调仓效果
    base = {r["stock_code"]: float(r["market_value"]) for r in read_csv(out / "portfolio.csv")}
    keep = sorted(base, key=lambda c: (base[c], c))[10:]
    w = {c: base[c] * rnd.uniform(0.85, 1.15) for c in keep}
    top_bench = [c for c in sorted(bench, key=lambda c: (-bench[c], c)) if c not in w][:10]
    total_mv = sum(base.values())
    for c in top_bench:
        w[c] = bench[c] * total_mv
    write(extra / "portfolio_rebalanced.csv", to_mv(w, round(total_mv), rnd))

    # 11) 小盘偏好：几乎全部持有基准外个股 → 主动份额接近 1、重合度很低
    outside = [c for c in all_codes if c not in bench]
    w = {c: rnd.uniform(0.5, 1.5) for c in rnd.sample(outside, min(60, len(outside)))}
    write(extra / "small_cap.csv", to_mv(w, 1_200_000_000, rnd))

    # 12) 逆向配置：只在基准权重最低的三分之一行业中选股 → 行业超低配方向与基准相反
    ind_bw = defaultdict(float)
    code_ind = {r["stock_code"]: r["industry"] for r in master}
    for c, bw in bench.items():
        ind_bw[code_ind[c]] += bw
    light = sorted(industries, key=lambda i: (ind_bw[i], i))[: max(1, len(industries) // 3)]
    write(extra / "contrarian.csv", style(light, 12, 0, 2_000_000_000))
    print(f"    逆向配置行业：{'、'.join(light)}")

    # ---------- 非法样例（不放入 data/，避免干扰预置列表；用于上传测试） ----------
    bad = PROJECT / "samples" / "invalid"
    c = all_codes
    print("非法样例（上传测试用）：")
    write(bad / "non_positive_mv.csv", [(c[0], 1_000_000), (c[1], 0), (c[2], -500_000)])
    write(bad / "duplicate_code.csv", [(c[0], 1_000_000), (c[1], 2_000_000), (c[0], 3_000_000)])
    write(bad / "unknown_stock.csv", [(c[0], 1_000_000), ("999999", 2_000_000)])
    write(bad / "unparseable_mv.csv", [(c[0], 1_000_000), (c[1], "abc"), (c[2], "")])
    write(bad / "missing_column.csv", [(c[0], "")], header=("stock_code", "value"))
    write(bad / "benchmark_sum_invalid.csv", [(c[0], 0.5), (c[1], 0.3)], header=("stock_code", "weight"))


if __name__ == "__main__":
    main()
