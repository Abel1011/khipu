from datetime import datetime

from sqlmodel import Session, select

from app.adapters.outbound.db import ConversationRow, get_engine


class PgConversationRepo:
    def __init__(self, url: str):
        self._engine = get_engine(url)

    def upsert(self, cid: str, owner_id: str, title: str, data: str, updated_at: datetime) -> bool:
        with Session(self._engine) as s:
            row = s.get(ConversationRow, cid)
            if row:
                if row.owner_id != owner_id:  # cannot overwrite another user's conversation
                    return False
                row.title, row.data, row.updated_at = title, data, updated_at
            else:
                row = ConversationRow(
                    id=cid, owner_id=owner_id, title=title, data=data, updated_at=updated_at
                )
            s.add(row)
            s.commit()
            return True

    def list(self, owner_id: str) -> list[dict]:
        with Session(self._engine) as s:
            rows = s.exec(
                select(ConversationRow)
                .where(ConversationRow.owner_id == owner_id)
                .order_by(ConversationRow.updated_at.desc())
            ).all()
            return [{"id": r.id, "owner": r.owner_id, "title": r.title, "data": r.data} for r in rows]

    def delete(self, cid: str, owner_id: str) -> bool:
        with Session(self._engine) as s:
            row = s.get(ConversationRow, cid)
            if row and row.owner_id == owner_id:  # only the owner may delete
                s.delete(row)
                s.commit()
                return True
            return False
