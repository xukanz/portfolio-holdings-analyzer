"""组合 / 基准注册表：预置文件与用户上传统一登记，记录可用状态与输入指纹。"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from app.domain import errors as E
from app.domain.errors import DomainError
from app.domain.models import Benchmark, Portfolio

Kind = Literal["portfolio", "benchmark"]
KIND_LABEL = {"portfolio": "组合", "benchmark": "基准"}


@dataclass(slots=True)
class Entry:
    id: str
    kind: Kind
    name: str
    source: Literal["preset", "upload"]
    sha256: str
    created_at: str
    data: Portfolio | Benchmark | None = None
    error: dict[str, Any] | None = None

    @property
    def status(self) -> str:
        return "ok" if self.error is None else "invalid"

    @property
    def row_count(self) -> int:
        if isinstance(self.data, Portfolio):
            return len(self.data.holdings)
        if isinstance(self.data, Benchmark):
            return len(self.data.constituents)
        return 0

    def issues(self) -> list[dict[str, Any]]:
        """把登记时的校验错误展开为逐条问题，供校验面板逐项展示。"""
        if self.error is None:
            return []
        base = {"rule": self.error["code"], "source": self.kind, "file": self.name, "message": self.error["message"]}
        details = [d for d in self.error.get("details") or [] if isinstance(d, dict)]
        return [{**base, **d} for d in details] or [base]

    def summary(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "kind": self.kind, "source": self.source,
                "status": self.status, "error": self.error, "row_count": self.row_count,
                "sha256": self.sha256, "created_at": self.created_at}


class Registry:
    def __init__(self) -> None:
        self._items: dict[Kind, dict[str, Entry]] = {"portfolio": {}, "benchmark": {}}

    def add(self, entry: Entry) -> None:
        self._items[entry.kind][entry.id] = entry

    def contains(self, kind: Kind, entry_id: str) -> bool:
        return entry_id in self._items[kind]

    def list(self, kind: Kind) -> list[Entry]:
        return list(self._items[kind].values())

    def get(self, kind: Kind, entry_id: str) -> Entry:
        entry = self._items[kind].get(entry_id)
        if entry is None:
            raise DomainError(E.NOT_FOUND, f"{KIND_LABEL[kind]} '{entry_id}' 不存在", http_status=404)
        return entry

    def get_valid(self, kind: Kind, entry_id: str) -> Entry:
        """取出可用于分析的数据源；数据文件损坏时拒绝分析并带出逐条问题。"""
        entry = self.get(kind, entry_id)
        if entry.error is not None:
            raise DomainError(E.VALIDATION_FAILED,
                              f"{KIND_LABEL[kind]} '{entry.name}' 数据不合规，已拒绝分析：{entry.error['message']}",
                              entry.issues())
        return entry
