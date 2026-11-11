"""统一的业务异常：所有可预期的错误都以 DomainError 抛出，由 API 层转换为统一格式响应。"""
from __future__ import annotations

from typing import Any


class DomainError(Exception):
    def __init__(self, code: str, message: str, details: list[dict[str, Any]] | None = None,
                 http_status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or []
        self.http_status = http_status

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "details": self.details}


# 错误码
INVALID_FILE = "INVALID_FILE"
FIELD_MISSING = "FIELD_MISSING"
VALUE_UNPARSEABLE = "VALUE_UNPARSEABLE"
FILE_NOT_FOUND = "FILE_NOT_FOUND"
EMPTY_PORTFOLIO = "EMPTY_PORTFOLIO"
NON_POSITIVE_MARKET_VALUE = "NON_POSITIVE_MARKET_VALUE"
DUPLICATE_STOCK_CODE = "DUPLICATE_STOCK_CODE"
UNKNOWN_STOCK = "UNKNOWN_STOCK"
NEGATIVE_BENCHMARK_WEIGHT = "NEGATIVE_BENCHMARK_WEIGHT"
BENCHMARK_WEIGHT_SUM_INVALID = "BENCHMARK_WEIGHT_SUM_INVALID"
VALIDATION_FAILED = "VALIDATION_FAILED"
NOT_FOUND = "NOT_FOUND"
METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
BAD_REQUEST = "BAD_REQUEST"
INTERNAL_ERROR = "INTERNAL_ERROR"
