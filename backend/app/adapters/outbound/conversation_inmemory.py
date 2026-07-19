from datetime import datetime


class InMemoryConversationRepo:
    """Dict-backed conversation store. For dev/tests without Postgres."""

    def __init__(self):
        self._c: dict[str, dict] = {}

    def upsert(self, cid: str, owner_id: str, title: str, data: str, updated_at: datetime) -> bool:
        existing = self._c.get(cid)
        if existing and existing["owner"] != owner_id:  # cannot overwrite another user's chat
            return False
        self._c[cid] = {
            "id": cid, "owner": owner_id, "title": title, "data": data, "updated_at": updated_at
        }
        return True

    def list(self, owner_id: str) -> list[dict]:
        rows = [v for v in self._c.values() if v["owner"] == owner_id]
        rows.sort(key=lambda r: r["updated_at"], reverse=True)
        return [{"id": r["id"], "owner": r["owner"], "title": r["title"], "data": r["data"]} for r in rows]

    def delete(self, cid: str, owner_id: str) -> bool:
        if self._c.get(cid, {}).get("owner") == owner_id:  # only the owner may delete
            self._c.pop(cid, None)
            return True
        return False
