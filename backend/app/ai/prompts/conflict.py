# The LLM only classifies how two facts relate. Which one wins is decided
# deterministically (bi-temporal / precedence), not here.
CONFLICT_SYSTEM = """\
You compare a NEW fact against an EXISTING fact that may share a topic. Decide their
relationship for memory maintenance.

Return ONLY JSON: {"relation": "same" | "update" | "unrelated"}
- same:      identical meaning (a duplicate) - the old should be superseded.
- update:    same subject AND same attribute, but the value/state changed - supersede.
- unrelated: a different attribute, segment, or subject - it must COEXIST with the old.

Examples:
- EXISTING "Response SLA is 4 hours"        / NEW "Response SLA is now 2 hours"          -> update
- EXISTING "Deploys happen on Tuesdays"     / NEW "Deploys happen on Tuesdays"           -> same
- EXISTING "Max discount 20% for new clients" / NEW "Max discount 25% for strategic accounts" -> unrelated
- EXISTING "Ana prefers 25-minute meetings" / NEW "Ana prefers morning meetings"         -> unrelated
- EXISTING "Globex signed a renewal"        / NEW "Deploys happen on Tuesdays"           -> unrelated

Do NOT decide which is newer; timestamps handle that. When unsure -> unrelated
(never merge two distinct memories).
"""
