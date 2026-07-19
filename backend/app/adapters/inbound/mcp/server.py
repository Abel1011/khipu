"""Expose the memory layer as an MCP server so any agent can use it.

Run with:  python -m app.adapters.inbound.mcp.server
"""

from mcp.server.fastmcp import FastMCP

from app.container import get_container

mcp = FastMCP("khipu")


@mcp.tool()
def memory_search(query: str, profile_id: str) -> dict:
    """Answer a question grounded in the caller's governed, isolated memory."""
    res = get_container().memory.answer(query, profile_id)
    return {"text": res.text, "citations": [c.__dict__ for c in res.citations]}


@mcp.tool()
def memory_write(content: str, profile_id: str) -> dict:
    """Remember a new fact in the caller's own memory (dedup + conflict-aware)."""
    from app.domain.enums import ScopeLevel
    from app.domain.models import Scope
    from app.seed import ORG_ID

    scope = Scope(level=ScopeLevel.USER, id=f"{ORG_ID}.{profile_id}")
    mem, superseded = get_container().memory.save_fact(content, profile_id, scope)
    return {"id": mem.id, "content": mem.content, "superseded": [m.id for m in superseded]}


@mcp.tool()
def memory_govern(memory_id: str, action: str, profile_id: str) -> dict:
    """Govern a memory the caller owns: forget (delete), pin, or unpin."""
    from app.application.governance_service import GovernanceError

    gov = get_container().governance
    try:
        if action == "forget":
            gov.forget(memory_id, profile_id)
            return {"action": "forget", "done": True}
        if action in ("pin", "unpin"):
            m = gov.set_pin(memory_id, profile_id, action == "pin")
            return {"action": action, "pinned": m.pinned}
    except GovernanceError as e:
        raise ValueError(str(e)) from e  # surface as a real MCP tool error
    raise ValueError(f"unknown action '{action}'; use forget, pin, or unpin")


@mcp.tool()
def memory_stats(profile_id: str) -> dict:
    """How many memories are visible to this profile."""
    return {"visible": len(get_container().governance.list_memories(profile_id))}


if __name__ == "__main__":
    mcp.run()
