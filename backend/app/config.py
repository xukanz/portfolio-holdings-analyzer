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

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            data_dir=Path(os.environ.get("PA_DATA_DIR", PROJECT_DIR / "data")),
            db_path=Path(os.environ.get("PA_DB_PATH", BACKEND_DIR / "var" / "history.db")),
            frontend_dist=Path(os.environ.get("PA_FRONTEND_DIST", PROJECT_DIR / "frontend" / "dist")),
        )
