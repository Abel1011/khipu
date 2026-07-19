from sqlmodel import Session, select

from app.adapters.outbound.db import PromotionRow, get_engine
from app.domain.models import PromotionRequest


class PgPromotionRepo:
    def __init__(self, url: str):
        self._engine = get_engine(url)

    def add(self, req: PromotionRequest) -> None:
        with Session(self._engine) as s:
            s.add(PromotionRow(**req.model_dump()))
            s.commit()

    def clear(self) -> None:
        with Session(self._engine) as s:
            for r in s.exec(select(PromotionRow)).all():
                s.delete(r)
            s.commit()

    def get(self, rid: str) -> PromotionRequest | None:
        with Session(self._engine) as s:
            r = s.get(PromotionRow, rid)
            return PromotionRequest(**r.model_dump()) if r else None

    def list_pending(self) -> list[PromotionRequest]:
        with Session(self._engine) as s:
            rows = s.exec(
                select(PromotionRow)
                .where(PromotionRow.status == "pending")
                .order_by(PromotionRow.created_at.desc())
            ).all()
            return [PromotionRequest(**r.model_dump()) for r in rows]

    def update(self, req: PromotionRequest) -> None:
        with Session(self._engine) as s:
            r = s.get(PromotionRow, req.id)
            if r:
                r.status, r.decided_by, r.decided_at = req.status, req.decided_by, req.decided_at
                s.add(r)
                s.commit()
