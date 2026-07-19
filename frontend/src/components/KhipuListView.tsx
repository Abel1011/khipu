import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, Lock, Pin, EyeOff, Users, User, Building2, Clock } from "lucide-react";
import { useStore } from "../store";
import { api } from "../lib/api";
import type { MemoryView, OrgTree } from "../lib/types";

const VIS: Record<string, { ico: typeof User; label: string }> = {
  shared: { ico: Users, label: "Shared" },
  personal: { ico: User, label: "Personal" },
  private: { ico: EyeOff, label: "Private" },
};

function expiry(iso: string | null): { date: string; past: boolean } | null {
  if (!iso) return null;
  return { date: iso.slice(0, 10), past: new Date(iso).getTime() < Date.now() };
}

const SCOPES = ["all", "org", "team", "user"] as const;
const TIERS = ["all", "working", "consolidated", "dormant"] as const;

/** A flat, filterable list of the same memories as the khipu, for quick navigation. */
export function KhipuListView({ memories }: { org?: OrgTree; memories?: MemoryView[] }) {
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const profileId = useStore((s) => s.profileId);
  const privateHeld = useQuery({
    queryKey: ["privateHeld", profileId],
    queryFn: () => api.privateHeld(profileId),
  });
  const [query, setQuery] = useState("");
  const [scopeF, setScopeF] = useState<(typeof SCOPES)[number]>("all");
  const [tierF, setTierF] = useState<(typeof TIERS)[number]>("all");

  // Others' private memories are never sent to you at all - only counted, so the
  // list shows what you can actually access plus how many private ones exist.
  const heldCount = privateHeld.data ?? 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (memories ?? []).filter((m) => {
      if (m.state === "sealed") return false; // never list a sealed row (its metadata is synthetic)
      if (scopeF !== "all" && m.scope.level !== scopeF) return false;
      if (tierF !== "all" && m.tier !== tierF) return false;
      if (q && !(m.content ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [memories, query, scopeF, tierF]);

  return (
    <div className="khlist">
      <div className="govfilters">
        <div className="gf-search">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search memory text…" />
          {query && (
            <button className="gf-clear" onClick={() => setQuery("")} aria-label="Clear">
              <X size={13} />
            </button>
          )}
        </div>
        <div className="gf-seg">
          {SCOPES.map((s) => (
            <button key={s} className={scopeF === s ? "on" : ""} onClick={() => setScopeF(s)}>
              {s === "all" ? "All" : s === "org" ? "Company" : s === "team" ? "Team" : "Personal"}
            </button>
          ))}
        </div>
        <div className="gf-seg">
          {TIERS.map((t) => (
            <button key={t} className={tierF === t ? "on" : ""} onClick={() => setTierF(t)}>
              {t === "all" ? "All tiers" : t}
            </button>
          ))}
        </div>
      </div>

      <div className="khlist-scroll">
        {heldCount > 0 && (
          <div className="khlist-private">
            <EyeOff size={13} /> {heldCount} private {heldCount === 1 ? "memory" : "memories"} held ·
            owner-only, not shown to you
          </div>
        )}
        {filtered.map((m) => {
          const vis = VIS[m.visibility];
          const exp = expiry(m.invalid_at);
          const sel = selected?.id === m.id;
          return (
            <div
              className={"card memrow khrow" + (sel ? " sel" : "")}
              key={m.id}
              onClick={() => select(m)}
            >
              <div className="mr-top">
                <span className="lvltag">{m.scope.level}</span>
                <span className="content">
                  {m.state === "sealed" ? (
                    <span className="sealed">
                      <EyeOff size={12} /> Private - owner-only
                    </span>
                  ) : (
                    m.content
                  )}
                </span>
                {m.pinned && <Pin size={13} color="#c58a24" />}
                {m.authoritative && <Lock size={13} color="#2a2a2a" />}
              </div>
              <div className="mr-meta">
                <span className="mm type">{m.type}</span>
                {vis && (
                  <span className="mm">
                    <vis.ico size={10} /> {vis.label}
                  </span>
                )}
                <span className="mm">{m.tier}</span>
                <span className="mm strength">{Math.round(m.strength * 100)}%</span>
                {exp && (
                  <span className={"mm exp" + (exp.past ? " past" : "")}>
                    <Clock size={10} /> {exp.past ? "expired" : "expires"} {exp.date}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="stub" style={{ height: 160 }}>
            <div>No memories match these filters.</div>
          </div>
        )}
      </div>
    </div>
  );
}
