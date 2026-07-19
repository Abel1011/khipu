from app.domain.models import PromotionRequest


class InMemoryPromotionRepo:
    """Dict-backed promotion queue. For dev/tests without Postgres."""

    def __init__(self):
        self._r: dict[str, PromotionRequest] = {}

    def add(self, req: PromotionRequest) -> None:
        self._r[req.id] = req

    def clear(self) -> None:
        self._r = {}

    def get(self, rid: str) -> PromotionRequest | None:
        return self._r.get(rid)

    def list_pending(self) -> list[PromotionRequest]:
        rows = [r for r in self._r.values() if r.status == "pending"]
        rows.sort(key=lambda r: r.created_at, reverse=True)
        return rows

    def update(self, req: PromotionRequest) -> None:
        self._r[req.id] = req
