from app.ai.prompts.rerank import RERANK_SYSTEM
from app.ai.types import Message, RerankHit


def _passthrough(docs: list[str], top_n: int) -> list[RerankHit]:
    n = min(top_n, len(docs))
    return [RerankHit(index=i, score=1.0 - i / max(len(docs), 1)) for i in range(n)]


class RrfReranker:
    """No-op neural reranker: trusts the upstream RRF fusion order.

    Used as the default so the app runs without heavy model dependencies.
    """

    def rerank(self, query: str, docs: list[str], top_n: int) -> list[RerankHit]:
        return _passthrough(docs, top_n)


class LLMReranker:
    """Reranks candidates with a chat LLM. Runs on the OpenAI-compatible endpoint, so it
    is Qwen-native (uses the reasoner model) with no separate rerank endpoint needed.
    Falls back to the upstream order if the model returns nothing usable."""

    def __init__(self, llm):
        self._llm = llm

    def rerank(self, query: str, docs: list[str], top_n: int) -> list[RerankHit]:
        if not docs:
            return []
        listing = "\n".join(f"{i}. {d}" for i, d in enumerate(docs))
        try:
            data = self._llm.json([
                Message("system", RERANK_SYSTEM),
                Message("user", f"Query: {query}\n\nPassages:\n{listing}"),
            ])
            order = data.get("ranking") or []
        except Exception:
            order = []
        seen: set[int] = set()
        hits: list[RerankHit] = []
        for rank, idx in enumerate(order):
            try:
                i = int(idx)
            except (ValueError, TypeError):
                continue
            if 0 <= i < len(docs) and i not in seen:
                seen.add(i)
                hits.append(RerankHit(index=i, score=1.0 - rank / max(len(order), 1)))
                if len(hits) >= top_n:
                    break
        return hits or _passthrough(docs, top_n)


class LocalReranker:
    """Cross-encoder reranker (bge-reranker-v2-m3). Requires the 'local' extra."""

    def __init__(self, model_name: str = "BAAI/bge-reranker-v2-m3"):
        from sentence_transformers import CrossEncoder

        self._model = CrossEncoder(model_name)

    def rerank(self, query: str, docs: list[str], top_n: int) -> list[RerankHit]:
        scores = self._model.predict([(query, d) for d in docs])
        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)[:top_n]
        return [RerankHit(index=i, score=float(s)) for i, s in ranked]
