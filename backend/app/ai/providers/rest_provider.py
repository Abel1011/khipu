import json

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.ai.config import Endpoint
from app.ai.types import Message

_EMBED_BATCH = 10  # max input array size for DashScope embeddings


class RestLLMProvider:
    """Generic REST chat provider for any compatible endpoint."""

    def __init__(self, endpoint: Endpoint, model: str, *, enable_thinking: bool = False):
        self._ep = endpoint
        self._model = model
        self._thinking = enable_thinking
        self._client = httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0))

    def _body(self, messages: list[Message]) -> dict:
        body: dict = {
            "model": self._model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
        }
        if not self._thinking:
            body["enable_thinking"] = False
        return body

    def _headers(self) -> dict[str, str]:
        if self._ep.auth_style == "api_key":
            return {"api-key": self._ep.api_key}
        return {"Authorization": f"Bearer {self._ep.api_key}"}

    def _url(self, path: str) -> str:
        return self._ep.base_url.rstrip("/") + path

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
    def chat(
        self, messages: list[Message], *, temperature: float | None = None, json_mode: bool = False
    ) -> str:
        body = self._body(messages)
        # Some models only allow the default temperature; only send it when explicitly set.
        if temperature is not None:
            body["temperature"] = temperature
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        resp = self._client.post(
            self._url(self._ep.chat_path),
            headers=self._headers(),
            params=self._ep.query or None,
            json=body,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    def json(self, messages: list[Message]) -> dict:
        return json.loads(self.chat(messages, json_mode=True))

    def stream(self, messages: list[Message], *, temperature: float | None = None):
        """Yield answer text chunks from a Server-Sent-Events completion stream."""
        body = self._body(messages)
        body["stream"] = True
        if temperature is not None:
            body["temperature"] = temperature
        with self._client.stream(
            "POST", self._url(self._ep.chat_path),
            headers=self._headers(), params=self._ep.query or None, json=body,
        ) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[len("data:"):].strip()
                if payload == "[DONE]":
                    break
                try:
                    choices = json.loads(payload).get("choices") or []
                except json.JSONDecodeError:
                    continue
                delta = (choices[0].get("delta") or {}).get("content") if choices else None
                if delta:
                    yield delta


class RestEmbeddingProvider:
    """Generic REST embedding provider for any compatible endpoint."""

    def __init__(self, endpoint: Endpoint, model: str, dim: int):
        self._ep = endpoint
        self._model = model
        self.dim = dim
        self._client = httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0))

    def _headers(self) -> dict[str, str]:
        if self._ep.auth_style == "api_key":
            return {"api-key": self._ep.api_key}
        return {"Authorization": f"Bearer {self._ep.api_key}"}

    def _url(self) -> str:
        return self._ep.base_url.rstrip("/") + self._ep.embed_path

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        resp = self._client.post(
            self._url(),
            headers=self._headers(),
            params=self._ep.query or None,
            json={"model": self._model, "input": texts},
        )
        resp.raise_for_status()
        data = sorted(resp.json()["data"], key=lambda r: r.get("index", 0))  # keep input order
        return [row["embedding"] for row in data]

    def embed(self, texts: list[str]) -> list[list[float]]:
        # DashScope caps embedding input arrays at 10; chunk to stay within the limit.
        out: list[list[float]] = []
        for i in range(0, len(texts), _EMBED_BATCH):
            out.extend(self._embed_batch(texts[i : i + _EMBED_BATCH]))
        return out
