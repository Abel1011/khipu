from dataclasses import dataclass


@dataclass
class Message:
    role: str  # "system" | "user" | "assistant"
    content: str


@dataclass
class RerankHit:
    index: int
    score: float
