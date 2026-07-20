import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Trash2, Pin, PinOff, Lock, Unlock, ChevronsUp, Building2, Ban, Check, History, Pencil, X,
  BookText, MessageSquare, Mail, SquareKanban, Calendar, MessagesSquare, EyeOff, ShieldCheck,
  Sparkles, type LucideIcon,
} from "lucide-react";
import { useStore } from "../store";
import { api } from "../lib/api";
import type { HistoryEntry, Person, Scope } from "../lib/types";

const LEVEL: Record<string, string> = { org: "Organization", team: "Team", user: "Personal" };
const LEVEL_COLOR: Record<string, string> = { org: "#d0392b", team: "#2b3ba0", user: "#1f8a7a" };
const SRC_ICON: Record<string, LucideIcon> = {
  handbook: BookText, slack: MessageSquare, email: Mail,
  kanban: SquareKanban, calendar: Calendar, chat: MessagesSquare,
};

function canGovern(me: Person | undefined, orgId: string, scope: Scope): boolean {
  if (!me) return false;
  if (me.admin) return true;
  if (scope.level === "team") return me.team === scope.id.split(".").slice(1).join(".") && !!me.lead;
  if (scope.level === "user") return scope.id === `${orgId}.${me.id}`;
  return false;
}

export function Inspector() {
  const { selected: m, profileId, showToast, select } = useStore();
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ["org"], queryFn: api.orgTree });
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [draft, setDraft] = useState<string | null>(null); // non-null while editing
  useEffect(() => {
    setHistory(null);
    setDraft(null);
  }, [m?.id]);

  if (!m) {
    return (
      <div className="memwrap">
        <div className="insp-empty">
          <div className="insp-empty-ico"><Sparkles size={20} /></div>
          Select a <b>knot</b> on the khipu to inspect a memory -<br />
          its level, lifecycle, strength, provenance and keeper actions.
        </div>
      </div>
    );
  }

  const sealed = m.state === "sealed";
  const accent = m.visibility === "private" ? "#7a5c9e" : LEVEL_COLOR[m.scope.level] ?? "#8f8474";
  const run = async (p: Promise<unknown>, msg: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await p;
      showToast(msg);
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["promotions"] });
      select(null);
    } catch (e) {
      showToast(String((e as Error).message ?? e), true);
    } finally {
      setBusy(false);
    }
  };

  const canPromote = !sealed && m.visibility !== "private";
  const me = org.data?.people.find((p) => p.id === profileId);
  const canGov = canGovern(me, org.data?.org ?? "", m.scope);
  const owns = m.owner_id === profileId;
  const ownPersonal = m.scope.level === "user" && owns;
  const canKeep = canGov && (m.scope.level !== "user" || owns);
  const canPromoteOrg = canPromote && (ownPersonal || m.scope.level === "team");
  const hasActions = canKeep || ownPersonal || canPromoteOrg;

  const owner = org.data?.people.find((p) => p.id === m.owner_id);
  const SrcIcon = SRC_ICON[m.source?.type ?? "chat"] ?? MessagesSquare;
  const pct = Math.round(m.strength * 100);

  const loadHistory = () =>
    api.history(m.id, profileId).then(setHistory).catch(() => showToast("Couldn't load history", true));
  const restore = (version: number) =>
    run(api.restore(m.id, profileId, version), `Restored to v${version}`);

  return (
    <div className="memwrap">
      <div className="mem-lvl">
        <span className="d" style={{ background: accent }} />
        {LEVEL[m.scope.level]} memory
      </div>

      {draft !== null ? (
        <div>
          <textarea
            className="mem-edit"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
          />
          <div className={"actgroup" + (busy ? " busy" : "")} style={{ marginTop: 8 }}>
            <div className="row">
              <button
                className="mbtn primary"
                onClick={() => {
                  const next = (draft ?? "").trim();
                  if (!next || next === m.content) return setDraft(null);
                  run(api.edit(m.id, next, profileId), "Memory corrected - new version saved");
                }}
              >
                <Check size={14} /> Save correction
              </button>
              <button className="mbtn" onClick={() => setDraft(null)}>
                <X size={14} /> Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mem-fact" style={{ ["--accent" as string]: accent }}>
          {sealed ? (
            <span className="mem-sealed"><EyeOff size={14} /> Private - owner-only</span>
          ) : (
            m.content
          )}
        </div>
      )}

      <div className="mem-pills">
        <span className="pill" style={{ color: accent, borderColor: accent, background: `${accent}12` }}>
          {LEVEL[m.scope.level]}
        </span>
        <span className={"pill" + (m.tier === "dormant" ? " off" : "")}>{m.tier}</span>
        <span className="pill">{m.type}</span>
        {m.authoritative && <span className="pill lock"><Lock size={10} /> locked</span>}
        {m.lock_suggested && !m.authoritative && <span className="pill warn"><Sparkles size={10} /> lock suggested</span>}
        {m.pinned && <span className="pill warn"><Pin size={10} /> pinned</span>}
        {m.visibility === "private" && <span className="pill priv">private</span>}
        {!m.consent && <span className="pill off">consent withdrawn</span>}
      </div>

      {sealed ? (
        <div className="mem-note">
          <ShieldCheck size={14} />
          <span>This memory is <b>private</b> - hidden even from org admins. Only its owner can read it.</span>
        </div>
      ) : (
        <>
          <div className="mem-sec">Strength &amp; lifecycle</div>
          <div className="mem-strength">
            <span className="bar"><i style={{ width: `${pct}%` }} /></span>
            <span className="pct">{pct}%</span>
          </div>
          <div className="mem-cap">Reinforced on recall · currently <b>{m.tier}</b></div>

          <div className="mem-sec">Provenance</div>
          <div className="mem-prov">
            <span className="ico"><SrcIcon size={16} /></span>
            <div className="prov-info">
              <div className="prov-src">{m.source?.type ?? "chat"}</div>
              {owner && (
                <div className="prov-owner">
                  <span className="av" style={{ background: accent }}>{owner.name[0]}</span>
                  <span>{owner.name} · {owner.role}</span>
                </div>
              )}
            </div>
          </div>

          {hasActions ? (
            <>
              {canKeep && (
                <div className={"actgroup" + (busy ? " busy" : "")}>
                  <div className="lbl">Curate</div>
                  <div className="row">
                    {draft === null && (
                      <button className="mbtn" onClick={() => setDraft(m.content ?? "")}>
                        <Pencil size={14} /> Edit
                      </button>
                    )}
                    <button
                      className="mbtn"
                      onClick={() => run(api.pin(m.id, profileId, !m.pinned), m.pinned ? "Unpinned" : "Pinned")}
                    >
                      {m.pinned ? <PinOff size={14} /> : <Pin size={14} />} {m.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      className="mbtn danger wide"
                      onClick={() => run(api.forget(m.id, profileId), "Memory forgotten")}
                    >
                      <Trash2 size={14} /> Forget (delete + audit)
                    </button>
                  </div>
                </div>
              )}

              {ownPersonal && (
                <div className={"actgroup" + (busy ? " busy" : "")}>
                  <div className="lbl">Your sovereignty</div>
                  <div className="row">
                    {m.visibility === "private" ? (
                      <button
                        className="mbtn"
                        onClick={() => run(api.setVisibility(m.id, profileId, "personal"), "Now visible to org admin")}
                      >
                        <Unlock size={14} /> Make shared
                      </button>
                    ) : (
                      <button
                        className="mbtn"
                        onClick={() => run(api.setVisibility(m.id, profileId, "private"), "Set to private - owner-only")}
                      >
                        <Lock size={14} /> Make private
                      </button>
                    )}
                    <button
                      className="mbtn"
                      onClick={() =>
                        run(
                          api.setConsent(m.id, profileId, !m.consent),
                          m.consent ? "Consent withdrawn - won't ground answers" : "Consent restored",
                        )
                      }
                    >
                      {m.consent ? <Ban size={14} /> : <Check size={14} />}{" "}
                      {m.consent ? "Withdraw" : "Allow"}
                    </button>
                  </div>
                </div>
              )}

              {(canPromoteOrg || (canPromote && ownPersonal)) && (
                <div className={"actgroup" + (busy ? " busy" : "")}>
                  <div className="lbl">Share - needs approval</div>
                  <div className="row">
                    {canPromote && ownPersonal && (
                      <button
                        className="mbtn"
                        onClick={() =>
                          run(api.requestPromotion(m.id, profileId, "team"), "Requested - pending approval")
                        }
                      >
                        <ChevronsUp size={14} /> To team
                      </button>
                    )}
                    {canPromoteOrg && (
                      <button
                        className="mbtn"
                        onClick={() =>
                          run(api.requestPromotion(m.id, profileId, "org"), "Requested - pending approval")
                        }
                      >
                        <Building2 size={14} /> To org
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="mem-note subtle">Read-only for you - no keeper actions on this memory.</div>
          )}

          {m.version > 1 && (
            <>
              <div className="mem-sec">Version history · v{m.version}</div>
              {history === null ? (
                <button className="mbtn wide" onClick={loadHistory}>
                  <History size={14} /> View {m.version - 1} previous version{m.version > 2 ? "s" : ""}
                </button>
              ) : (
                <div className="histlist">
                  {history.map((h) => (
                    <div className="histrow" key={h.id}>
                      <div className="hmeta">v{h.version} · {h.actor_id} · {h.at?.slice(0, 10)}</div>
                      <div className="hcontent">{h.content}</div>
                      {canKeep && (
                        <button className="hbtn" onClick={() => restore(h.version)}>Restore this version</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
