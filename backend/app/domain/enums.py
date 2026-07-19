from enum import Enum


class ScopeLevel(str, Enum):
    USER = "user"
    TEAM = "team"
    ORG = "org"


class Tier(str, Enum):
    WORKING = "working"
    CONSOLIDATED = "consolidated"
    DORMANT = "dormant"


class Visibility(str, Enum):
    SHARED = "shared"      # team/org knowledge
    PERSONAL = "personal"  # owner + org admin (governance)
    PRIVATE = "private"    # owner only, hidden even from admins


class MemoryType(str, Enum):
    EPISODIC = "episodic"
    SEMANTIC = "semantic"
    PREFERENCE = "preference"
    PROCEDURAL = "procedural"


class Status(str, Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    DELETED = "deleted"


class SourceType(str, Enum):
    HANDBOOK = "handbook"
    SLACK = "slack"
    EMAIL = "email"
    KANBAN = "kanban"
    CALENDAR = "calendar"
    CHAT = "chat"
