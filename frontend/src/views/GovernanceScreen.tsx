import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Lock, EyeOff, Sparkles, ShieldCheck, ShieldAlert, Check, X, ChevronsUp, Search, Clock, Users,
  User, AlertTriangle, Eye, Pencil, Split, Trash2, Save, Layers, Pin, PinOff,
} from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { Button } from "../components/ui/button";
import { canGovern, useGovReview } from "../lib/useGovReview";
import type { MemoryView } from "../lib/types";

const SCOPE_WORD: Record<string, string> = { org: "company", team: "team", user: "personal" };

const VIS: Record<string, { ico: typeof User; label: string }> = {
  shared: { ico: Users, label: "Shared" },
  personal: { ico: User, label: "Personal" },
  private: { ico: EyeOff, label: "Private" },
};

function expiry(iso: string | null): { date: string; past: boolean } | null {
  if (!iso) return null;
  return { date: iso.slice(0, 10), past: new Date(iso).getTime() < Date.now() };
}

// "policy.max_discount" -> "Max discount"
function humanKey(key: string): string {
  const last = key.split(".").pop() ?? key;
  const s = last.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface Group {
  key: string;
  contenders: MemoryView[]; // top-scope versions that actually disagree
  overrides: MemoryView[]; // lower-scope, intentionally stricter rules
}

function LockImpact({ memoryId, profileId }: { memoryId: string; profileId: string }) {
  const q = useQuery({
    queryKey: ["lockImpact", memoryId, profileId],
    queryFn: () => api.lockImpact(memoryId, profileId),
  });
  const items = q.data ?? [];
  if (items.length === 0)
    return <div className="cft-impact none">Locking this supersedes no other shared version.</div>;
  return (
    <div className="cft-impact">
      <b>Choosing this supersedes {items.length}:</b>
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <span className="lvltag">{it.level}</span> {it.content}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Shared inline editor. "edit" rewords in place; "separate" re-scopes to its own
// topic so both versions coexist (the keep-both resolution) - visibly distinct.
function EditorBox({
  editing, setEditing, onSave,
}: {
  editing: EditState;
  setEditing: (e: EditState | null) => void;
  onSave: () => void;
}) {
  const sep = editing.mode === "separate";
  return (
    <div className={"cft-edit" + (sep ? " sep" : "")}>
      <div className="cft-edithd">
        {sep ? (
          <>
            <Split size={12} /> Split into its own rule
          </>
        ) : (
          <>
            <Pencil size={12} /> Edit wording
          </>
        )}
      </div>
      {sep && (
        <div className="cft-editnote">
          Both versions are kept - this one gets its own topic and stops conflicting.
        </div>
      )}
      <textarea
        value={editing.text}
        onChange={(e) => setEditing({ ...editing, text: e.target.value })}
        rows={2}
        autoFocus
      />
      <div className="cft-editact">
        <Button size="sm" onClick={onSave}>
          {sep ? (
            <>
              <Check size={13} /> Keep both
            </>
          ) : (
            <>
              <Save size={13} /> Save
            </>
          )}
        </Button>
        <button className="cft-tbtn" onClick={() => setEditing(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const SCOPES = ["all", "org", "team", "user"] as const;
const TIERS = ["all", "working", "consolidated", "dormant"] as const;
type EditState = { id: string; mode: "edit" | "separate"; text: string };

export function GovernanceScreen() {
  const profileId = useStore((s) => s.profileId);
  const showToast = useStore((s) => s.showToast);
  const qc = useQueryClient();
  const audit = useQuery({ queryKey: ["audit", profileId], queryFn: () => api.audit(profileId) });
  const privateHeld = useQuery({
    queryKey: ["privateHeld", profileId],
    queryFn: () => api.privateHeld(profileId),
  });
  const { me, orgId, memories: mem, groups, inGroup, soloLocks, promos, reviewCount } =
    useGovReview(profileId);

  const [tab, setTab] = useState<"review" | "memories" | "audit">("review");
  const [query, setQuery] = useState("");
  const [scopeF, setScopeF] = useState<(typeof SCOPES)[number]>("all");
  const [tierF, setTierF] = useState<(typeof TIERS)[number]>("all");
  const [preview, setPreview] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (mem.data ?? []).filter((m) => {
      const isSealed = m.state === "sealed"; // no readable tier/content to filter on
      if (scopeF !== "all" && m.scope.level !== scopeF) return false;
      if (tierF !== "all" && (isSealed || m.tier !== tierF)) return false;
      if (q && (isSealed || !(m.content ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [mem.data, query, scopeF, tierF]);

  const refetchGov = () => {
    qc.invalidateQueries({ queryKey: ["memories"] });
    qc.invalidateQueries({ queryKey: ["audit"] });
    qc.invalidateQueries({ queryKey: ["lockImpact"] });
  };

  const decide = async (id: string, approve: boolean) => {
    try {
      const r = await api.decidePromotion(id, profileId, approve);
      showToast(
        !approve
          ? "Promotion rejected"
          : r.status === "approved"
            ? "Approved - scope widened"
            : r.status === "redundant"
              ? "Already shared from the same source - not duplicated"
              : "Couldn't approve - the memory no longer exists",
      );
      qc.invalidateQueries({ queryKey: ["promotions"] });
      refetchGov();
    } catch (e) {
      showToast(String((e as Error).message), true);
    }
  };

  const chooseWinner = async (id: string) => {
    try {
      const res = (await api.authoritative(id, profileId, true)) as { cascade?: { invalidated: number } };
      const n = res?.cascade?.invalidated ?? 0;
      showToast(n ? `Set as policy - superseded ${n} version${n === 1 ? "" : "s"}` : "Set as the authoritative policy");
      setPreview(null);
      refetchGov();
    } catch (e) {
      showToast(String((e as Error).message), true);
    }
  };

  const unlock = async (id: string) => {
    try {
      await api.authoritative(id, profileId, false);
      showToast("Lock removed - no longer authoritative");
      refetchGov();
    } catch (e) {
      showToast(String((e as Error).message), true);
    }
  };

  const dismiss = async (id: string) => {
    try {
      await api.dismissLock(id, profileId);
      showToast("Suggestion dismissed");
      refetchGov();
    } catch (e) {
      showToast(String((e as Error).message), true);
    }
  };

  const forgetMem = async (id: string) => {
    try {
      await api.forget(id, profileId);
      showToast("Version deleted");
      refetchGov();
    } catch (e) {
      showToast(String((e as Error).message), true);
    }
  };

  const togglePin = async (m: MemoryView) => {
    try {
      await api.pin(m.id, profileId, !m.pinned);
      showToast(m.pinned ? "Unpinned" : "Pinned - protected from decay");
      refetchGov();
    } catch (e) {
      showToast(String((e as Error).message), true);
    }
  };

  const saveEdit = async (m: MemoryView) => {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) return;
    try {
      if (editing.mode === "separate") {
        await api.edit(m.id, text, profileId, `${m.semantic_key}.${m.id.slice(0, 6)}`);
        showToast("Kept as a separate rule - both versions retained");
      } else {
        await api.edit(m.id, text, profileId);
        showToast("Wording updated");
      }
      setEditing(null);
      refetchGov();
    } catch (e) {
      showToast(String((e as Error).message), true);
    }
  };

  const renderMember = (m: MemoryView, contender: boolean) => {
    const gov = canGovern(me, orgId, m.scope);
    const isEditing = editing?.id === m.id;
    return (
      <div
        className={
          "cft-m" +
          (m.authoritative ? " current" : "") +
          (m.lock_suggested && !m.authoritative ? " rec" : "") +
          (contender ? "" : " override")
        }
        key={m.id}
      >
        <div className="cft-row">
          <span className="lvltag">{m.scope.level}</span>
          <span className="cft-c">{m.content}</span>
          {m.authoritative && (
            <span className="cft-badge cur">
              <Lock size={11} /> Current policy
            </span>
          )}
          {m.lock_suggested && !m.authoritative && (
            <span className="cft-badge rec">
              <Sparkles size={11} /> AI recommends
            </span>
          )}
          {!contender && (
            <span className="cft-badge ov">
              <Layers size={11} /> {SCOPE_WORD[m.scope.level]} override
            </span>
          )}
        </div>

        {gov && !isEditing && (
          <div className="cft-actions">
            {contender && !m.authoritative && (
              <Button size="sm" onClick={() => chooseWinner(m.id)}>
                <ShieldCheck size={13} /> Make it the policy
              </Button>
            )}
            {m.authoritative && (
              <Button size="sm" variant="ghost" onClick={() => unlock(m.id)}>
                <X size={12} /> Unlock
              </Button>
            )}
            <button className="cft-tbtn" onClick={() => setEditing({ id: m.id, mode: "edit", text: m.content ?? "" })}>
              <Pencil size={12} /> Edit
            </button>
            <button className="cft-tbtn" onClick={() => setEditing({ id: m.id, mode: "separate", text: m.content ?? "" })}>
              <Split size={12} /> Separate rule
            </button>
            <button className="cft-tbtn danger" onClick={() => forgetMem(m.id)}>
              <Trash2 size={12} /> Delete
            </button>
            {contender && !m.authoritative && (
              <button className="cft-prev" onClick={() => setPreview((p) => (p === m.id ? null : m.id))}>
                <Eye size={12} /> Impact
              </button>
            )}
          </div>
        )}
        {!gov && (
          <span className="cft-nogov">
            <Lock size={10} /> not your scope
          </span>
        )}

        {isEditing && editing && <EditorBox editing={editing} setEditing={setEditing} onSave={() => saveEdit(m)} />}

        {preview === m.id && <LockImpact memoryId={m.id} profileId={profileId} />}
      </div>
    );
  };

  return (
    <div className="screen">
      <h1>Governance</h1>
      <div className="sub">
        Oversight for everything the assistant remembers within your jurisdiction.
      </div>

      <div className="gov-tabs">
        <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>
          Review {reviewCount > 0 && <span className="tabcount">{reviewCount}</span>}
        </button>
        <button className={tab === "memories" ? "on" : ""} onClick={() => setTab("memories")}>
          Memories
        </button>
        <button className={tab === "audit" ? "on" : ""} onClick={() => setTab("audit")}>
          Audit
        </button>
      </div>

      {tab === "review" && (
        <div className="gov-panel">
          {reviewCount === 0 && (
            <div className="rvw-empty">
              <Check size={22} />
              <span>Nothing needs your attention right now.</span>
            </div>
          )}

          {promos.length > 0 && (
            <>
              <div className="navlbl rvw-lbl">
                <ChevronsUp size={12} /> Approval queue ({promos.length})
              </div>
              <div className="queue">
                {promos.map((p) => (
                  <div className="qrow card" key={p.id}>
                    <div className="qmeta">
                      <div className="qcontent">{p.content}</div>
                      <div className="qmove">
                        requested by <b>{p.requested_by}</b> · promote to <span className="qtag">{p.to_level}</span>
                      </div>
                    </div>
                    <div className="qactions">
                      <Button size="sm" onClick={() => decide(p.id, true)}>
                        <Check size={13} /> Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => decide(p.id, false)}>
                        <X size={13} /> Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {groups.length > 0 && (
            <>
              <div className="navlbl rvw-lbl">
                <AlertTriangle size={12} /> Policy conflicts ({groups.length})
              </div>
              {groups.map((g) => (
                <div className="cft card" key={g.key}>
                  <div className="cft-hd">
                    <span className="cft-key">{humanKey(g.key)}</span>
                    <span className="cft-n">
                      {g.contenders.length} versions disagree at {SCOPE_WORD[g.contenders[0].scope.level]} level ·
                      resolve it
                    </span>
                  </div>
                  <div className="cft-members">{g.contenders.map((m) => renderMember(m, true))}</div>
                  {g.overrides.length > 0 && (
                    <>
                      <div className="cft-sub">
                        <Layers size={11} /> Scope overrides — kept intentionally, not a conflict
                      </div>
                      <div className="cft-members">{g.overrides.map((m) => renderMember(m, false))}</div>
                    </>
                  )}
                </div>
              ))}
            </>
          )}

          {soloLocks.length > 0 && (
            <>
              <div className="navlbl rvw-lbl">
                <Sparkles size={12} /> Suggested policies ({soloLocks.length})
              </div>
              {soloLocks.map((m) => {
                const gov = canGovern(me, orgId, m.scope);
                const isEditing = editing?.id === m.id;
                return (
                  <div className="cft card" key={m.id}>
                    <div className="cft-m rec">
                      <div className="cft-row">
                        <span className="lvltag">{m.scope.level}</span>
                        <span className="cft-c">{m.content}</span>
                        <span className="cft-badge rec">
                          <Sparkles size={11} /> AI recommends locking
                        </span>
                      </div>
                      {gov && !isEditing && (
                        <div className="cft-actions">
                          <Button size="sm" onClick={() => chooseWinner(m.id)}>
                            <ShieldCheck size={13} /> Confirm lock
                          </Button>
                          <button className="cft-tbtn" onClick={() => setEditing({ id: m.id, mode: "edit", text: m.content ?? "" })}>
                            <Pencil size={12} /> Edit
                          </button>
                          <button className="cft-tbtn danger" onClick={() => dismiss(m.id)}>
                            <X size={12} /> Dismiss
                          </button>
                        </div>
                      )}
                      {isEditing && editing && (
                        <EditorBox editing={editing} setEditing={setEditing} onSave={() => saveEdit(m)} />
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {tab === "memories" && (
        <div className="gov-panel">
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
                  {s === "all" ? "All scopes" : s === "org" ? "Company" : s === "team" ? "Team" : "Personal"}
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

          <div className="navlbl" style={{ margin: "4px 0 10px" }}>
            {filtered.length}
            {filtered.length !== (mem.data?.length ?? 0) ? ` of ${mem.data?.length ?? 0}` : ""} memories
          </div>

          {(privateHeld.data ?? 0) > 0 && (
            <div className="khlist-private" style={{ marginBottom: 10 }}>
              <EyeOff size={13} /> {privateHeld.data} private{" "}
              {privateHeld.data === 1 ? "memory" : "memories"} in your jurisdiction · owner-only, not
              accessible even to you
            </div>
          )}

          <div className="memlist">
            {filtered.map((m) => {
              const vis = VIS[m.visibility];
              const exp = expiry(m.invalid_at);
              const conflicted = inGroup.has(m.id);
              const gov = canGovern(me, orgId, m.scope);
              const isEditing = editing?.id === m.id;
              return (
                <div className={"card memrow" + (conflicted ? " conflicted" : "")} key={m.id}>
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
                    {m.state !== "sealed" && gov && !isEditing && (
                      <div className="mr-actions">
                        <button
                          className="mr-icon"
                          title={m.pinned ? "Unpin" : "Pin (protect from decay)"}
                          onClick={() => togglePin(m)}
                        >
                          {m.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                        </button>
                        <button
                          className="mr-icon"
                          title="Edit wording"
                          onClick={() => setEditing({ id: m.id, mode: "edit", text: m.content ?? "" })}
                        >
                          <Pencil size={14} />
                        </button>
                        <button className="mr-icon danger" title="Forget" onClick={() => forgetMem(m.id)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  {isEditing && editing && (
                    <EditorBox editing={editing} setEditing={setEditing} onSave={() => saveEdit(m)} />
                  )}
                  {/* Sealed (others' private): scope only - its metadata is confidential too. */}
                  {m.state !== "sealed" && (
                    <div className="mr-meta">
                      <span className="mm type">{m.type}</span>
                      {vis && (
                        <span className="mm">
                          <vis.ico size={10} /> {vis.label}
                        </span>
                      )}
                      <span className="mm">{m.tier}</span>
                      <span className="mm strength" title="Memory strength">
                        {Math.round(m.strength * 100)}%
                      </span>
                      {m.version > 1 && <span className="mm">v{m.version}</span>}
                      {exp && (
                        <span className={"mm exp" + (exp.past ? " past" : "")}>
                          <Clock size={10} /> {exp.past ? "expired" : "expires"} {exp.date}
                        </span>
                      )}
                      {m.pii && (
                        <span className="mm pii">
                          <ShieldAlert size={10} /> PII
                        </span>
                      )}
                      {conflicted && (
                        <button className="mm conflict" onClick={() => setTab("review")} title="Resolve in Review">
                          <AlertTriangle size={10} /> In conflict
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="stub" style={{ height: 120 }}>
                <div>No memories match these filters.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "audit" && (
        <div className="gov-panel">
          <div className="navlbl" style={{ margin: "4px 0 10px" }}>
            Audit trail
          </div>
          <div className="auditgrid">
            {(audit.data ?? []).map((a) => (
              <div className="card auditrow" key={a.id}>
                <b>{a.action}</b> · {a.actor_id}
                <span className="mono">{a.at?.slice(0, 10)}</span>
              </div>
            ))}
            {(!audit.data || audit.data.length === 0) && (
              <div className="stub" style={{ height: 120 }}>
                <div>No actions yet - resolve a conflict or edit a memory to see it here.</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
