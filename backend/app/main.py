from __future__ import annotations

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.errors import install_error_handlers
from app.api.routes import router
from app.config import Settings
from app.service import AnalysisService, bootstrap


def create_app(service: AnalysisService, settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="投资组合持仓分析工具", version="1.0.0")
    app.state.service = service
    install_error_handlers(app)
    app.include_router(router)
    if settings and (settings.frontend_dist / "index.html").is_file():
        app.mount("/", StaticFiles(directory=settings.frontend_dist, html=True), name="web")
    return app


def app_factory() -> FastAPI:
    """供 `uvicorn --factory app.main:app_factory` 使用。"""
    settings = Settings.from_env()
    return create_app(bootstrap(settings), settings)
