from sqlmodel import Session, select

from app.adapters.outbound.db import HistoryRow, get_engine
from app.domain.models import HistoryEntry


class PgHistoryRepo:
    def __init__(self, url: str):
        self._engine = get_engine(url)

    def append(self, entry: HistoryEntry) -> None:
        with Session(self._engine) as s:
            s.add(HistoryRow(**entry.model_dump()))
            s.commit()

    def clear(self) -> None:
        with Session(self._engine) as s:
            for r in s.exec(select(HistoryRow)).all():
                s.delete(r)
            s.commit()

    def list(self, memory_id: str) -> list[HistoryEntry]:
        with Session(self._engine) as s:
            rows = s.exec(
                select(HistoryRow)
                .where(HistoryRow.memory_id == memory_id)
                .order_by(HistoryRow.version.desc())
            ).all()
            return [HistoryEntry(**r.model_dump()) for r in rows]
