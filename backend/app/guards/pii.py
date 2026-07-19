import re

_PATTERNS = [
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),                      # email
    re.compile(r"\b(?:\d[ -]?){13,16}\b"),                        # card-like number
    re.compile(r"\b(?:\+?\d{1,3}[ -]?)?(?:\(\d{2,4}\)[ -]?)?\d{3}[ -]?\d{3,4}[ -]?\d{3,4}\b"),  # phone
    re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b"),              # IBAN-like
    re.compile(r"\b(?:sk|pk|api|key|token|secret)[-_][A-Za-z0-9_-]{16,}\b", re.I),  # api keys / secrets
    re.compile(r"\b(salary|compensation|medical|health|diagnos\w*|passport|ssn|dni|"
               r"pregnan\w*|disabilit\w*|therapy|visa status)\b", re.I),  # sensitive context
]


def detect_pii(text: str) -> bool:
    return any(p.search(text) for p in _PATTERNS)
