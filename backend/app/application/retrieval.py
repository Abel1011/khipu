from rank_bm25 import BM25Okapi

from app.domain.models import Memory

_RRF_K = 60


def hybrid_rank(query: str, dense_ordered: list[Memory]) -> list[Memory]:
    """Fuse the dense order with a BM25 (lexical) order via Reciprocal Rank Fusion."""
    if len(dense_ordered) < 2:
        return dense_ordered

    dense_rank = {m.id: i for i, m in enumerate(dense_ordered)}

    corpus = [m.content.lower().split() for m in dense_ordered]
    bm25 = BM25Okapi(corpus)
    scores = bm25.get_scores(query.lower().split())
    order = sorted(range(len(dense_ordered)), key=lambda i: scores[i], reverse=True)
    bm_rank = {dense_ordered[i].id: r for r, i in enumerate(order)}

    def rrf(m: Memory) -> float:
        return 1 / (_RRF_K + dense_rank[m.id]) + 1 / (_RRF_K + bm_rank[m.id])

    return sorted(dense_ordered, key=rrf, reverse=True)
