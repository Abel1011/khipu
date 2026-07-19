from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.adapters.outbound.db import AuditRow, get_engine
from app.domain.models import AuditEntry


class PgAuditRepo:
    def __init__(self, url: str):
        self._engine = get_engine(url)

    def append(self, entry: AuditEntry) -> None:
        with Session(self._engine) as s:
            s.add(AuditRow(**entry.model_dump()))
            s.commit()

    def list(self, limit: int = 100, actor_id: str | None = None) -> list[AuditEntry]:
        with Session(self._engine) as s:
            # exclude internal source-capture rows before the limit is applied
            q = select(AuditRow).where(AuditRow.action != "source-capture").order_by(AuditRow.at.desc())
            if actor_id is not None:
                q = q.where(AuditRow.actor_id == actor_id)
            rows = s.exec(q.limit(limit)).all()
            return [AuditEntry(**r.model_dump()) for r in rows]

    def source_captures(self) -> dict[str, str]:
        """capture_key -> actor who captured it first (durable source-capture state)."""
        with Session(self._engine) as s:
            rows = s.exec(
                select(AuditRow).where(AuditRow.action == "source-capture").order_by(AuditRow.at.asc())
            ).all()
        out: dict[str, str] = {}
        for r in rows:
            if r.detail and r.detail not in out:  # earliest wins
                out[r.detail] = r.actor_id
        return out

    def try_capture(self, key: str, actor_id: str) -> bool:
        """Atomically claim a capture key. The deterministic primary key makes a
        second concurrent insert fail on the PK, so first-wins holds across instances."""
        entry = AuditEntry(
            id=f"srccap:{key}", memory_id="-", actor_id=actor_id, action="source-capture", detail=key,
        )
        with Session(self._engine) as s:
            s.add(AuditRow(**entry.model_dump()))
            try:
                s.commit()
                return True
            except IntegrityError:
                s.rollback()
                return False

    def release_capture(self, key: str) -> None:
        """Undo a claim (used when the write ultimately stored nothing)."""
        with Session(self._engine) as s:
            row = s.get(AuditRow, f"srccap:{key}")
            if row is not None:
                s.delete(row)
                s.commit()

    def clear_source_captures(self) -> None:
        with Session(self._engine) as s:
            for r in s.exec(select(AuditRow).where(AuditRow.action == "source-capture")).all():
                s.delete(r)
            s.commit()

    def clear(self) -> None:
        with Session(self._engine) as s:
            for r in s.exec(select(AuditRow)).all():
                s.delete(r)
            s.commit()
