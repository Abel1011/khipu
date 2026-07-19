import math

from app.domain.models import Memory
from app.domain.enums import Status


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


class InMemoryMemoryRepo:
    """Dict-backed repo with cosine ranking. For dev/tests without Qdrant."""

    def __init__(self):
        self._mem: dict[str, Memory] = {}
        self._vec: dict[str, list[float]] = {}

    def upsert(self, memory: Memory, vector: list[float]) -> None:
        self._mem[memory.id] = memory
        self._vec[memory.id] = vector

    def count(self) -> int:
        return len(self._mem)

    def clear(self) -> None:
        self._mem.clear()
        self._vec.clear()

    def patch(self, memory: Memory) -> None:
        if memory.id in self._mem:  # update only - never resurrect a deleted memory
            self._mem[memory.id] = memory  # vector unchanged

    def get(self, memory_id: str) -> Memory | None:
        return self._mem.get(memory_id)

    def delete(self, memory_id: str) -> None:
        self._mem.pop(memory_id, None)
        self._vec.pop(memory_id, None)

    def _active_in_scope(self, scope_ids: set[str]) -> list[Memory]:
        return [
            m for m in self._mem.values()
            if m.scope.id in scope_ids and m.status == Status.ACTIVE
        ]

    def search(self, dense, text, scope_ids, top_k) -> list[Memory]:
        allowed = set(scope_ids)
        scored = [
            (m, _cosine(dense, self._vec.get(m.id, [])))
            for m in self._active_in_scope(allowed)
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [m for m, _ in scored[:top_k]]

    def neighbors(self, dense, scope_ids, k: int = 5) -> list[tuple[Memory, float]]:
        scored = [
            (m, _cosine(dense, self._vec.get(m.id, [])))
            for m in self._active_in_scope(set(scope_ids))
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:k]

    def list_by_scope(self, scope_ids) -> list[Memory]:
        return self._active_in_scope(set(scope_ids))

    def by_semantic_key(self, key, scope_ids) -> list[Memory]:
        allowed = set(scope_ids)
        return [
            m for m in self._mem.values()
            if m.semantic_key == key and m.scope.id in allowed and m.status == Status.ACTIVE
        ]
