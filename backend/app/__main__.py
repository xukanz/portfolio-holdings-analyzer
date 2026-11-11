"""启动入口：python -m app [--host 127.0.0.1] [--port 8000]
主数据缺失或损坏时打印明确原因并以非 0 状态退出（拒绝启动）。"""
from __future__ import annotations

import argparse
import logging
import sys

import uvicorn

from app.config import Settings
from app.domain.errors import DomainError
from app.main import create_app
from app.service import bootstrap


def main() -> int:
    parser = argparse.ArgumentParser(description="投资组合持仓分析服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = Settings.from_env()
    try:
        service = bootstrap(settings)
    except DomainError as exc:
        print(f"[启动失败] 主数据不可用：{exc.message}", file=sys.stderr)
        for d in exc.details[:20]:
            print(f"    {d}", file=sys.stderr)
        return 1
    uvicorn.run(create_app(service, settings), host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
