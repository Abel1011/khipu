from app.domain.models import HistoryEntry


class InMemoryHistoryRepo:
    def __init__(self):
        self._items: list[HistoryEntry] = []

    def append(self, entry: HistoryEntry) -> None:
        self._items.append(entry)

    def clear(self) -> None:
        self._items = []

    def list(self, memory_id: str) -> list[HistoryEntry]:
        items = [e for e in self._items if e.memory_id == memory_id]
        return sorted(items, key=lambda e: e.version, reverse=True)
