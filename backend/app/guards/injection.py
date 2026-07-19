import re

# Isolation is enforced at the data layer, so these never actually work.
# The guard just flags attempts for the audit log / red-team reporting.
_INJECTION = re.compile(
    r"(ignore|bypass|override).{0,20}(permission|scope|isolation|policy|rule)",
    re.I,
)


def looks_like_injection(text: str) -> bool:
    return bool(_INJECTION.search(text))
