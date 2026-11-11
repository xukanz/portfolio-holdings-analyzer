"""统一错误响应：{"error": {"code", "message", "details"}}，任何情况下不返回堆栈。"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.domain import errors as E
from app.domain.errors import DomainError

log = logging.getLogger("portfolio_analyzer")


def error_response(status: int, code: str, message: str, details: list | None = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message,
                                                               "details": details or []}})


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain(_: Request, exc: DomainError) -> JSONResponse:
        return error_response(exc.http_status, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [{"field": ".".join(str(x) for x in e.get("loc", ())), "reason": e.get("msg", "")}
                   for e in exc.errors()]
        return error_response(400, E.BAD_REQUEST, "请求参数不合法", details)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: E.NOT_FOUND, 405: E.METHOD_NOT_ALLOWED}.get(exc.status_code, E.BAD_REQUEST)
        message = {404: "资源不存在", 405: "接口不支持该请求方法（若刚升级过版本，请重启后端服务）"}.get(
            exc.status_code, str(exc.detail))
        return error_response(exc.status_code, code, message)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("未处理的异常")  # 堆栈只进服务端日志
        return error_response(500, E.INTERNAL_ERROR, "服务内部错误，请联系管理员")
