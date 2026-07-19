import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { MemoryView, Person, Scope } from "./types";

export const RANK: Record<string, number> = { org: 0, team: 1, user: 2 };

export function canGovern(me: Person | undefined, org: string, scope: Scope): boolean {
  if (!me) return false;
  if (me.admin) return true;
  if (scope.level === "team") return me.team === scope.id.split(".").slice(1).join(".") && !!me.lead;
  if (scope.level === "user") return scope.id === `${org}.${me.id}`;
  return false;
}

export interface Group {
  key: string;
  contenders: MemoryView[];
  overrides: MemoryView[];
}

// Single source of truth for "what needs review": conflicts + suggested locks +
// approvals the profile can actually act on. Shared by the nav badge and the screen.
export function useGovReview(profileId: string) {
  const org = useQuery({ queryKey: ["org"], queryFn: api.orgTree });
  const memories = useQuery({ queryKey: ["memories", profileId], queryFn: () => api.memories(profileId) });
  const promos = useQuery({ queryKey: ["promotions", profileId], queryFn: () => api.promotions(profileId) });

  const me = org.data?.people.find((p) => p.id === profileId);
  const orgId = org.data?.org ?? "";

  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, MemoryView[]>();
    for (const m of memories.data ?? []) {
      if (!m.semantic_key || m.state === "sealed") continue;
      const arr = byKey.get(m.semantic_key) ?? [];
      arr.push(m);
      byKey.set(m.semantic_key, arr);
    }
    const out: Group[] = [];
    for (const [key, ms] of byKey) {
      // A real conflict is divergence within the SAME concrete scope (by scope.id,
      // not level - two different teams sharing a key are separate, not a conflict).
      // Cross-scope is intentional layering; the engine resolves by most-specific.
      const scopeIds = new Set(ms.map((m) => m.scope.id));
      const conflictScopes = new Set(
        [...scopeIds].filter((sid) => {
          const at = ms.filter((m) => m.scope.id === sid);
          return new Set(at.map((m) => m.content)).size > 1;
        }),
      );
      if (conflictScopes.size === 0) continue;
      const sorted = ms.slice().sort((a, b) => RANK[a.scope.level] - RANK[b.scope.level]);
      const contenders = sorted.filter((m) => conflictScopes.has(m.scope.id));
      const overrides = sorted.filter((m) => !conflictScopes.has(m.scope.id));
      if (!contenders.some((m) => canGovern(me, orgId, m.scope))) continue;
      out.push({ key, contenders, overrides });
    }
    return out;
  }, [memories.data, me, orgId]);

  const inGroup = useMemo(
    () => new Set(groups.flatMap((g) => [...g.contenders, ...g.overrides].map((m) => m.id))),
    [groups],
  );

  const soloLocks = useMemo(
    () =>
      (memories.data ?? []).filter(
        (m) =>
          m.lock_suggested && !m.authoritative && !inGroup.has(m.id) && m.state !== "sealed" &&
          canGovern(me, orgId, m.scope),
      ),
    [memories.data, inGroup, me, orgId],
  );

  const promoList = promos.data ?? [];
  const reviewCount = groups.length + soloLocks.length + promoList.length;

  return { me, orgId, memories, groups, inGroup, soloLocks, promos: promoList, reviewCount };
}
