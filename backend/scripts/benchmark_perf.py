"""性能测试：python scripts/benchmark_perf.py [--data ../data_stress] [--repeat 20]

分别计时：
  1) 纯引擎 analyze()（含结果序列化/舍入）
  2) 端到端 HTTP：POST /api/analyses（含参数校验、计算、序列化、SQLite 落库），经 TestClient 调用
数据加载（CSV 解析）在服务启动时完成，单独计时。"""
from __future__ import annotations

import argparse
import statistics
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.engine.analyzer import analyze  # noqa: E402
from app.engine.rounding import result_to_dict  # noqa: E402
from app.main import create_app  # noqa: E402
from app.service import bootstrap  # noqa: E402


def _stats(xs: list[float]) -> str:
    return f"中位数 {statistics.median(xs):.1f} ms / 最大 {max(xs):.1f} ms"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(Path(__file__).resolve().parents[2] / "data_stress"))
    ap.add_argument("--portfolio", default="stress_portfolio")
    ap.add_argument("--benchmark", default="stress_benchmark")
    ap.add_argument("--repeat", type=int, default=20)
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        t0 = time.perf_counter()
        svc = bootstrap(Settings(Path(args.data), Path(tmp) / "h.db", Path(tmp)))
        load_ms = (time.perf_counter() - t0) * 1000
        p = svc.registry.get_valid("portfolio", args.portfolio).data
        b = svc.registry.get_valid("benchmark", args.benchmark).data
        print(f"数据规模：主数据 {len(svc.master)}，组合 {len(p.holdings)}，基准 {len(b.constituents)}")
        print(f"启动加载 + 校验 CSV：{load_ms:.1f} ms")

        engine = []
        for _ in range(args.repeat):
            t = time.perf_counter()
            result_to_dict(analyze(p, b, svc.master))
            engine.append((time.perf_counter() - t) * 1000)
        print(f"引擎 analyze() x{args.repeat}：{_stats(engine)}")

        client = TestClient(create_app(svc))
        e2e = []
        for _ in range(args.repeat):
            t = time.perf_counter()
            r = client.post("/api/analyses", json={"portfolio_id": args.portfolio, "benchmark_id": args.benchmark})
            e2e.append((time.perf_counter() - t) * 1000)
            assert r.status_code == 201, r.text
        m = r.json()["metrics"]
        print(f"端到端 POST /api/analyses x{args.repeat}：{_stats(e2e)}")
        print(f"结果自检：主动份额 {m['active_share']} + 重合权重 {m['overlap_weight']} = "
              f"{m['overlap_plus_active_share']}，并集 {len(r.json()['stocks'])} 只")
        ok = max(e2e) < 2000
        print("结论：" + ("通过（< 2 秒）" if ok else "未通过"))
        svc.history.close()
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
