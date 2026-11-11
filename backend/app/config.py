from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    db_path: Path
    frontend_dist: Path
    # 公开演示站的防滥用限制（默认不限制，本地运行行为不变）
    max_upload_bytes: int = 20 * 1024 * 1024
    max_runs: int = 0       # >0 时只保留最近 N 条分析记录
    max_uploads: int = 0    # >0 时上传数据源最多 N 个

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            data_dir=Path(os.environ.get("PA_DATA_DIR", PROJECT_DIR / "data")),
            db_path=Path(os.environ.get("PA_DB_PATH", BACKEND_DIR / "var" / "history.db")),
            frontend_dist=Path(os.environ.get("PA_FRONTEND_DIST", PROJECT_DIR / "frontend" / "dist")),
            max_upload_bytes=int(float(os.environ.get("PA_MAX_UPLOAD_MB", "20")) * 1024 * 1024),
            max_runs=int(os.environ.get("PA_MAX_RUNS", "0")),
            max_uploads=int(os.environ.get("PA_MAX_UPLOADS", "0")),
        )
