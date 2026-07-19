from app.domain.models import AuditEntry


class InMemoryAuditRepo:
    def __init__(self):
        self._items: list[AuditEntry] = []

    def append(self, entry: AuditEntry) -> None:
        self._items.append(entry)

    def list(self, limit: int = 100, actor_id: str | None = None) -> list[AuditEntry]:
        # source-capture rows are internal state - excluded before the limit so they
        # never crowd real governance actions out of the window.
        items = [
            e for e in self._items
            if e.action != "source-capture" and (actor_id is None or e.actor_id == actor_id)
        ]
        return list(reversed(items[-limit:]))

    def source_captures(self) -> dict[str, str]:
        """capture_key -> actor who captured it first (durable source-capture state)."""
        out: dict[str, str] = {}
        for e in self._items:  # chronological; first capture of a key wins
            if e.action == "source-capture" and e.detail and e.detail not in out:
                out[e.detail] = e.actor_id
        return out

    def try_capture(self, key: str, actor_id: str) -> bool:
        """Atomically claim a capture key; False if already claimed (first-wins)."""
        if any(e.action == "source-capture" and e.detail == key for e in self._items):
            return False
        self._items.append(AuditEntry(
            id=f"srccap:{key}", memory_id="-", actor_id=actor_id, action="source-capture", detail=key,
        ))
        return True

    def release_capture(self, key: str) -> None:
        """Undo a claim (used when the write ultimately stored nothing)."""
        self._items = [e for e in self._items if not (e.action == "source-capture" and e.detail == key)]

    def clear_source_captures(self) -> None:
        self._items = [e for e in self._items if e.action != "source-capture"]

    def clear(self) -> None:
        self._items = []
