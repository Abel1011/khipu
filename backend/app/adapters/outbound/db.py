from datetime import datetime

from sqlmodel import Field, SQLModel, create_engine


class AuditRow(SQLModel, table=True):
    __tablename__ = "audit_log"
    id: str = Field(primary_key=True)
    memory_id: str
    actor_id: str
    action: str
    detail: str | None = None
    at: datetime


class HistoryRow(SQLModel, table=True):
    __tablename__ = "memory_history"
    id: str = Field(primary_key=True)
    memory_id: str
    version: int
    content: str
    actor_id: str
    at: datetime


class ConversationRow(SQLModel, table=True):
    __tablename__ = "conversations"
    id: str = Field(primary_key=True)
    owner_id: str = Field(index=True)  # profileId - private to each user
    title: str
    data: str  # JSON-serialized message list
    updated_at: datetime


class PromotionRow(SQLModel, table=True):
    __tablename__ = "promotions"
    id: str = Field(primary_key=True)
    memory_id: str
    content_preview: str
    from_scope_id: str
    to_level: str
    to_scope_id: str
    requested_by: str
    status: str = Field(index=True)
    created_at: datetime
    decided_by: str | None = None
    decided_at: datetime | None = None


_engine = None


def get_engine(url: str):
    """Lazily create the engine and tables. Raises if the DB is unreachable."""
    global _engine
    if _engine is None:
        engine = create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 3})
        SQLModel.metadata.create_all(engine)  # fails fast if unreachable
        _engine = engine
    return _engine
