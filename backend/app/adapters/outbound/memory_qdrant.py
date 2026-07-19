from qdrant_client import QdrantClient
from qdrant_client.http.exceptions import UnexpectedResponse
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchAny,
    MatchValue,
    PointStruct,
    VectorParams,
)

from app.domain.models import Memory


class QdrantMemoryRepo:
    def __init__(self, url: str, collection: str, dim: int):
        self._c = QdrantClient(url=url)
        self._col = collection
        self._dim = dim
        self._ensure()

    def _ensure(self) -> None:
        names = {c.name for c in self._c.get_collections().collections}
        if self._col not in names:
            self._c.create_collection(
                self._col,
                vectors_config=VectorParams(size=self._dim, distance=Distance.COSINE),
            )

    def _scope_filter(self, scope_ids: list[str], active_only: bool = True) -> Filter:
        must = [FieldCondition(key="scope.id", match=MatchAny(any=scope_ids))]
        if active_only:
            must.append(FieldCondition(key="status", match=MatchValue(value="active")))
        return Filter(must=must)

    def upsert(self, memory: Memory, vector: list[float]) -> None:
        self._c.upsert(
            self._col,
            [PointStruct(id=memory.id, vector=vector, payload=memory.model_dump(mode="json"))],
        )

    def count(self) -> int:
        return self._c.count(self._col).count

    def clear(self) -> None:
        # Drop every point (used by a forced re-seed to avoid stale content-id orphans).
        self._c.delete_collection(self._col)
        self._ensure()

    def patch(self, memory: Memory) -> None:
        try:
            self._c.set_payload(self._col, payload=memory.model_dump(mode="json"), points=[memory.id])
        except UnexpectedResponse as e:  # deleted concurrently → no-op (never resurrect, never crash)
            if getattr(e, "status_code", None) != 404:
                raise

    def get(self, memory_id: str) -> Memory | None:
        res = self._c.retrieve(self._col, ids=[memory_id], with_payload=True)
        return Memory(**res[0].payload) if res else None

    def delete(self, memory_id: str) -> None:
        self._c.delete(self._col, points_selector=[memory_id])

    def search(self, dense, text, scope_ids, top_k) -> list[Memory]:
        res = self._c.query_points(
            self._col, query=dense, query_filter=self._scope_filter(scope_ids),
            limit=top_k, with_payload=True,
        ).points
        return [Memory(**p.payload) for p in res]

    def neighbors(self, dense, scope_ids, k: int = 5) -> list[tuple[Memory, float]]:
        res = self._c.query_points(
            self._col, query=dense, query_filter=self._scope_filter(scope_ids),
            limit=k, with_payload=True,
        ).points
        return [(Memory(**p.payload), p.score) for p in res]

    def list_by_scope(self, scope_ids) -> list[Memory]:
        # Page through the whole scope; scroll returns one page + a next offset, so we
        # must follow it or the store silently truncates past the first page.
        out: list[Memory] = []
        offset = None
        while True:
            res, offset = self._c.scroll(
                self._col, scroll_filter=self._scope_filter(scope_ids),
                limit=256, offset=offset, with_payload=True,
            )
            out.extend(Memory(**p.payload) for p in res)
            if offset is None:
                break
        return out

    def by_semantic_key(self, key, scope_ids) -> list[Memory]:
        f = Filter(must=[
            FieldCondition(key="semantic_key", match=MatchValue(value=key)),
            FieldCondition(key="scope.id", match=MatchAny(any=scope_ids)),
            FieldCondition(key="status", match=MatchValue(value="active")),
        ])
        # Page through every active version; the supersede logic must see all of them,
        # otherwise old versions past the first page stay active forever.
        out: list[Memory] = []
        offset = None
        while True:
            res, offset = self._c.scroll(
                self._col, scroll_filter=f, limit=256, offset=offset, with_payload=True,
            )
            out.extend(Memory(**p.payload) for p in res)
            if offset is None:
                break
        return out
