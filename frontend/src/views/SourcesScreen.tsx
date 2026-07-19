import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText, MessagesSquare, Mail, Kanban, Calendar, Lock, FastForward, Inbox, X, Check, ArrowRight,
  Hash, Star, Send, Archive, Plus, CalendarDays, Sparkles, CornerDownRight, ScanText, Users,
  Building2, User, ChevronsUp, Zap, Moon,
} from "lucide-react";
import { useStore } from "../store";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import type { CaptureCandidate, Person, SourceContent, SourceItem } from "../lib/types";

interface SourceDef {
  key: string;
  icon: typeof FileText;
  name: string;
  note: string;
  accent: string;
}

const SOURCE_DEF: Record<string, SourceDef> = {
  slack: { key: "slack", icon: MessagesSquare, name: "Slack", note: "Channels & DMs", accent: "#611f69" },
  email: { key: "email", icon: Mail, name: "Email", note: "Your inbox", accent: "#1f6feb" },
  calendar: { key: "calendar", icon: Calendar, name: "Calendar", note: "Meetings & blocks", accent: "#d1495b" },
  kanban: { key: "kanban", icon: Kanban, name: "Kanban", note: "Boards & tasks", accent: "#2e8b6f" },
  handbook: { key: "handbook", icon: FileText, name: "Handbook", note: "Company policies", accent: "#5b6472" },
};

const SCOPE_LABEL: Record<string, string> = { user: "Personal", team: "Team", org: "Company" };
const SCOPE_OPTS: { id: string; label: string; ico: typeof User }[] = [
  { id: "user", label: "Personal", ico: User },
  { id: "team", label: "Team", ico: Users },
  { id: "org", label: "Company", ico: Building2 },
];

// Do you govern this target? (personal always; team if admin or its lead; org if admin)
function governs(me: Person | undefined, scope: string, teamId: string): boolean {
  if (scope === "user") return true;
  if (scope === "org") return !!me?.admin;
  return !!me?.admin || (!!me?.lead && me?.team === teamId);
}

const AV_COLORS = ["#611f69", "#2e8b6f", "#1f6feb", "#d1495b", "#b45309"];
function initials(name: string) {
  const clean = name.replace(/\(.*?\)/g, "").replace(/[@<].*/g, "").trim();
  const parts = clean.split(/[\s.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}
function avColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

interface Done {
  item: SourceItem;
  action: string;
}

export function SourcesScreen() {
  const profileId = useStore((s) => s.profileId);
  const showToast = useStore((s) => s.showToast);
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ["org"], queryFn: api.orgTree });
  const me = org.data?.people.find((p) => p.id === profileId);
  const isAdmin = !!me?.admin;
  const contents = useQuery({ queryKey: ["sources", profileId], queryFn: () => api.sources(profileId) });
  const [feed, setFeed] = useState<Done[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [pasteResult, setPasteResult] = useState<CaptureCandidate[] | null>(null);
  const [scopeOv, setScopeOv] = useState<Record<string, string>>({}); // per-item scope override
  const [teamOv, setTeamOv] = useState<Record<string, string>>({}); // per-item team override (admin)

  const teams = org.data?.teams ?? [];
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "team";
  const scopeOf = (it: SourceItem) => scopeOv[it.id] ?? it.scope;
  const teamOf = (it: SourceItem) => teamOv[it.id] ?? it.team ?? me?.team ?? teams[0]?.id ?? "";

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["memories"] });
    qc.invalidateQueries({ queryKey: ["audit"] });
    qc.invalidateQueries({ queryKey: ["promotions"] });
    qc.invalidateQueries({ queryKey: ["sources", profileId] });
  };

  const capture = async (item: SourceItem) => {
    const scope = scopeOf(item);
    const team = scope === "team" ? teamOf(item) : undefined;
    setBusy(item.id);
    try {
      const r = await api.ingestItem(item.connector, profileId, item.id, scope, team);
      if (r.already) {
        showToast(`Already captured by ${r.captured_by}`);
      } else {
        const dest = scope === "org" ? "company" : scope === "team" ? teamName(team ?? "") : "your memory";
        if (!r.created?.length) {
          // Pipeline judged it low-value: nothing stored, item stays available.
          showToast("Nothing memory-worthy extracted - item left as is");
        } else {
          const verb =
            r.action === "propose"
              ? `Proposed to ${dest} (needs approval)`
              : r.action === "ingest"
                ? `Ingested to ${dest}`
                : "Saved to your memory";
          showToast(`${verb} · learned ${r.created.length}`);
          setFeed((f) => [{ item, action: r.action ?? "save" }, ...f].slice(0, 6));
        }
      }
      invalidateAll();
    } catch (e) {
      showToast(String((e as Error).message), true);
    }
    setBusy(null);
  };

  // Capture every not-yet-taken candidate of a connector, each to its default scope.
  const captureAll = async (c: SourceContent) => {
    const pending = c.items.filter((i) => i.candidate && !i.captured);
    if (!pending.length) return;
    setBusy(c.connector);
    try {
      let n = 0;
      for (const it of pending) {
        const r = await api.ingestItem(it.connector, profileId, it.id);
        if (!r.already) n += 1;
      }
      showToast(`Captured ${n} item${n === 1 ? "" : "s"} from ${SOURCE_DEF[c.connector]?.name ?? c.connector}`);
      invalidateAll();
    } catch (e) {
      showToast(String((e as Error).message), true);
    }
    setBusy(null);
  };

  const analyze = async () => {
    const text = paste.trim();
    if (!text || analyzing) return;
    setAnalyzing(true);
    try {
      setPasteResult(await api.captureMemory(text));
    } catch (e) {
      showToast(String((e as Error).message), true);
    }
    setAnalyzing(false);
  };

  const advance = async (days: number) => {
    try {
      const r = await api.advanceTime(profileId, days);
      showToast(`Aged ${days} days - ${r.expired} expired, ${r.updated} updated`);
      qc.invalidateQueries({ queryKey: ["memories"] });
    } catch (e) {
      showToast(String((e as Error).message), true);
    }
  };

  // Manually run the nightly consolidation pass (dedup + promote stable to consolidated).
  const consolidate = async () => {
    try {
      const r = await api.consolidate(profileId);
      showToast(`Consolidation ran - merged ${r.merged}, promoted ${r.promoted}`);
      qc.invalidateQueries({ queryKey: ["memories"] });
    } catch (e) {
      showToast(String((e as Error).message), true);
    }
  };

  const items = contents.data ?? [];
  const integrations = items.filter((c) => c.kind === "integration");
  const references = items.filter((c) => c.kind === "reference");
  const openContent = open ? items.find((c) => c.connector === open) : undefined;
  const openDef = open ? SOURCE_DEF[open] : undefined;

  // Controls per capturable item: pick a scope (and team, as admin); the action
  // then adapts to your authority - Save / Ingest / Propose.
  const ctl = (item: SourceItem): ReactNode => {
    if (item.captured)
      return (
        <span className="ing-done">
          <Check size={12} /> In memory{item.captured_by ? ` · ${item.captured_by}` : ""}
        </span>
      );
    // A private item stays owner-only: no one-click escalation to team/org (you'd
    // make it shared first, via the Inspector). So it only offers Personal.
    const priv = item.visibility === "private";
    const scope = priv ? "user" : scopeOf(item);
    const teamId = teamOf(item);
    const act = scope === "user" ? "save" : governs(me, scope, teamId) ? "ingest" : "propose";
    const dest = scope === "org" ? "company" : scope === "team" ? teamName(teamId) : "";
    const label =
      act === "save" ? "Save to my memory" : act === "ingest" ? `Ingest to ${dest}` : `Propose to ${dest}`;
    const opts = priv ? SCOPE_OPTS.filter((s) => s.id === "user") : SCOPE_OPTS;
    return (
      <div className="src-ctl">
        <div className="cc-scopes">
          {opts.map((s) => (
            <button
              key={s.id}
              className={"cc-scope" + (scope === s.id ? " on" : "")}
              disabled={busy === item.id}
              onClick={() => setScopeOv((o) => ({ ...o, [item.id]: s.id }))}
            >
              <s.ico size={11} /> {s.label}
            </button>
          ))}
          {priv && <span className="cc-privnote">private — owner-only</span>}
        </div>
        {scope === "team" && isAdmin && teams.length > 0 && (
          <select
            className="src-team"
            value={teamId}
            disabled={busy === item.id}
            onChange={(e) => setTeamOv((o) => ({ ...o, [item.id]: e.target.value }))}
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <button
          className={"ing-btn" + (act !== "save" ? " next" : "")}
          disabled={busy === item.id}
          onClick={() => capture(item)}
        >
          {busy === item.id ? (
            "Working…"
          ) : (
            <>
              {label} {act === "propose" ? <ChevronsUp size={12} /> : <ArrowRight size={12} />}
            </>
          )}
        </button>
      </div>
    );
  };

  const card = (c: SourceContent) => {
    const def = SOURCE_DEF[c.connector];
    if (!def) return null;
    const pending = c.items.filter((i) => i.candidate && !i.captured).length;
    return (
      <div className="card sourcecard" key={c.connector} style={{ ["--src-accent" as string]: def.accent }}>
        <div className="head">
          <div className="ico">
            <def.icon size={18} />
          </div>
          <div className="meta">
            <div className="nm">{def.name}</div>
            <div className="nt">{def.note}</div>
          </div>
          <div className="tags">
            <span className="ok">Connected</span>
          </div>
        </div>
        <div className="srcstat">
          <Sparkles size={12} /> {c.candidate_count} candidate{c.candidate_count === 1 ? "" : "s"}
          {c.captured_count > 0 && (
            <span className="donepill">
              <Check size={10} /> {c.captured_count} captured
            </span>
          )}
        </div>
        <div className="srcbtns">
          <Button size="sm" variant="ghost" onClick={() => setOpen(c.connector)}>
            <def.icon size={13} /> Open {def.name}
          </Button>
          <Button size="sm" onClick={() => captureAll(c)} disabled={busy === c.connector || pending === 0}>
            <Zap size={13} />{" "}
            {busy === c.connector ? "Capturing…" : pending ? "Capture all" : "All captured"}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="screen">
      <h1>Sources</h1>
      <div className="sub">
        Your connected accounts feed memory. Each item carries its own scope: personal items save to
        your memory, team/org items you govern ingest directly, and the rest you propose for approval.
        The first person to capture a shared message wins; everyone else sees it as already captured.
      </div>

      {isAdmin && (
        <div className="timectl">
          <span className="lbl">
            <FastForward size={13} /> Autonomous lifecycle (runs on a schedule) — trigger now:
          </span>
          <Button size="sm" variant="ghost" onClick={() => advance(7)}>
            Decay +7d
          </Button>
          <Button size="sm" variant="ghost" onClick={() => advance(30)}>
            Decay +30d
          </Button>
          <Button size="sm" variant="ghost" onClick={consolidate}>
            <Moon size={13} /> Consolidate
          </Button>
        </div>
      )}

      <div className="navlbl" style={{ margin: "20px 0 10px" }}>
        <User size={12} style={{ verticalAlign: "middle" }} /> Your integrations
      </div>
      <div className="sourcegrid">{integrations.map(card)}</div>

      <div className="navlbl" style={{ margin: "26px 0 10px" }}>
        <Building2 size={12} style={{ verticalAlign: "middle" }} /> Company references
      </div>
      <div className="sourcegrid">{references.map(card)}</div>

      <div className="navlbl" style={{ margin: "28px 0 10px" }}>
        Extract memories from plain text
      </div>
      <div className="card pastebox">
        <div className="paste-hd">
          <ScanText size={16} />
          <div>
            <div className="paste-t">Extract memories from plain text</div>
            <div className="paste-s">
              Paste any message or note and the extractor identifies which parts become memory and how
              they are phrased. Read-only.
            </div>
          </div>
        </div>
        <textarea
          className="paste-ta"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="Paste any message or note here…"
          rows={4}
        />
        <div className="paste-actions">
          <div className="paste-ex">
            <span className="paste-exlbl">Examples:</span>
            <button onClick={() => setPaste("Heads up team: going forward all enterprise refunds have a 60-day window, standard stays at 30 days.")}>
              a decision
            </button>
            <button onClick={() => setPaste("haha did you see the game last night? crazy finish. lunch at 1?")}>
              small talk
            </button>
          </div>
          <Button size="sm" onClick={analyze} disabled={!paste.trim() || analyzing}>
            <Sparkles size={13} /> {analyzing ? "Analyzing…" : "Analyze"}
          </Button>
        </div>
        {pasteResult !== null && (
          <div className="paste-results">
            {pasteResult.length === 0 ? (
              <div className="paste-none">
                <Check size={14} /> No memory candidates - this reads as noise, nothing would be stored.
              </div>
            ) : (
              <>
                <div className="paste-rlbl">
                  <Sparkles size={12} /> {pasteResult.length} memory candidate
                  {pasteResult.length === 1 ? "" : "s"} identified
                </div>
                {pasteResult.map((c, i) => {
                  const AudIco = c.audience === "org" ? Building2 : c.audience === "team" ? Users : User;
                  return (
                    <div className="paste-cand" key={i}>
                      <div className="pc-mem">
                        <CornerDownRight size={13} />
                        <span>{c.content}</span>
                      </div>
                      <div className="pc-tags">
                        <span className="pc-tag type">{c.type}</span>
                        <span className="pc-tag aud">
                          <AudIco size={10} /> {c.audience ?? "personal"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

      {feed.length > 0 && (
        <>
          <div className="navlbl" style={{ margin: "26px 0 10px" }}>
            Recent captures
          </div>
          <div className="eventfeed">
            {feed.map((d, i) => (
              <div className="eventrow" key={i}>
                <div className="raw">
                  <span className="src">{d.action}</span>
                  {d.item.text}
                </div>
                <div className="factline">
                  <span className={"lvltag " + d.item.scope}>{SCOPE_LABEL[d.item.scope]}</span>
                  <span className="fc">{d.item.memory}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {openDef && (
        <div className="srcmodal-backdrop" onClick={() => setOpen(null)}>
          <div
            className={"srcviewer sv-" + openDef.key}
            style={{ ["--src-accent" as string]: openDef.accent }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sv-chrome">
              <span className="dot r" />
              <span className="dot y" />
              <span className="dot g" />
              <div className="sv-title">
                <openDef.icon size={13} /> {openDef.name}
                <span className="sv-url">{openContent?.kind === "reference" ? "company reference" : "your account"}</span>
              </div>
              <button className="sv-close" onClick={() => setOpen(null)} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            <div className="sv-legend">
              <span className="lg-noise">
                <span className="lgdot noise" /> Regular content
              </span>
              <span className="lg-cand">
                <span className="lgdot cand" /> Memory candidate — save / ingest / propose by scope
              </span>
            </div>
            <div className="sv-stage">
              <SourceViewer kind={openDef.key} content={openContent} ctl={ctl} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- shared candidate treatment ------------------------------------------ */

function CandStrip({ item, action }: { item: SourceItem; action: ReactNode }) {
  return (
    <div className="candstrip">
      <div className="cand-top">
        <span className="cand-lbl">
          <Sparkles size={12} /> Memory candidate
        </span>
        {item.visibility === "private" && <span className="cand-vis">private</span>}
      </div>
      {item.memory && (
        <div className="cand-mem">
          <CornerDownRight size={13} />
          <span>
            <span className="cand-memlbl">Will be saved as</span> “{item.memory}”
          </span>
        </div>
      )}
      <div className="cand-ctl">{action}</div>
    </div>
  );
}

function tailFor(item: SourceItem, action: ReactNode): ReactNode {
  return item.candidate ? (
    <CandStrip item={item} action={action} />
  ) : (
    <div className="skip-note">Not memory-worthy - skipped</div>
  );
}

/* ---- per-source viewers -------------------------------------------------- */

function SourceViewer({
  kind, content, ctl,
}: {
  kind: string;
  content?: SourceContent;
  ctl: (item: SourceItem) => ReactNode;
}) {
  if (!content) return <div className="none" style={{ padding: 24 }}>Loading…</div>;
  const items = content.items;
  const tail = (it: SourceItem) => tailFor(it, ctl(it));
  if (kind === "slack") return <SlackView items={items} tail={tail} />;
  if (kind === "email") return <EmailView items={items} tail={tail} />;
  if (kind === "kanban") return <KanbanView items={items} tail={tail} />;
  if (kind === "calendar") return <CalendarView items={items} tail={tail} />;
  return <HandbookView items={items} tail={tail} />;
}

type ViewProps = { items: SourceItem[]; tail: (it: SourceItem) => ReactNode };

function SlackView({ items, tail }: ViewProps) {
  const channels = [...new Set(items.map((i) => i.channel))];
  return (
    <div className="slackview">
      <div className="sk-rail">
        <div className="sk-ws">Lumina</div>
        <div className="sk-chgrp">Channels</div>
        {channels.map((c) => (
          <div key={c} className="sk-ch">
            <Hash size={13} /> {c.replace(/^#/, "")}
          </div>
        ))}
      </div>
      <div className="sk-conv">
        <div className="sk-topbar">
          <Hash size={15} /> <b>your workspace</b> <span className="sk-topsub">Slack</span>
        </div>
        <div className="sk-stream">
          <div className="sk-day">Today</div>
          {items.map((it) => (
            <div key={it.id} className={"sk-line" + (it.candidate ? " cand" : " noise") + (it.captured ? " done" : "")}>
              <div className="sk-av" style={{ background: avColor(it.sender) }}>{initials(it.sender)}</div>
              <div className="sk-body">
                <div className="sk-meta">
                  <span className="sk-name">{it.sender}</span>
                  <span className="sk-chtag">{it.channel}</span>
                  <span className="sk-time">{it.at}</span>
                </div>
                <div className="sk-text">{it.text}</div>
                {tail(it)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmailView({ items, tail }: ViewProps) {
  return (
    <div className="mailview">
      <div className="mail-rail">
        <button className="mail-compose">
          <Plus size={13} /> Compose
        </button>
        <div className="mail-folder active">
          <Inbox size={14} /> Inbox <span className="mail-count">{items.length}</span>
        </div>
        <div className="mail-folder"><Star size={14} /> Starred</div>
        <div className="mail-folder"><Send size={14} /> Sent</div>
        <div className="mail-folder"><Archive size={14} /> Archive</div>
      </div>
      <div className="mail-list">
        <div className="mail-listhd">Inbox</div>
        {items.map((it) => (
          <div key={it.id} className={"mail-item" + (it.candidate ? " cand" : " noise") + (it.captured ? " done" : "")}>
            <div className="mail-av" style={{ background: avColor(it.sender) }}>{initials(it.sender)}</div>
            <div className="mail-main">
              <div className="mail-row1">
                <span className="mail-from">{it.sender}</span>
                <span className="mail-time">{it.at}</span>
              </div>
              <div className="mail-subj">{it.text}</div>
              {tail(it)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KanbanView({ items, tail }: ViewProps) {
  const cols = [...new Set(items.map((i) => i.channel))];
  return (
    <div className="kanbanview">
      {cols.map((col) => (
        <div className="kb-col" key={col}>
          <div className="kb-colhd">
            {col} <span className="kb-n">{items.filter((i) => i.channel === col).length}</span>
          </div>
          {items
            .filter((i) => i.channel === col)
            .map((it) => (
              <div key={it.id} className={"kb-card" + (it.candidate ? " live" : " ctx") + (it.captured ? " done" : "")}>
                <div className="kb-t">{it.text}</div>
                {tail(it)}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function CalendarView({ items, tail }: ViewProps) {
  return (
    <div className="calview">
      <div className="cal-hd">
        <CalendarDays size={15} /> This week
      </div>
      <div className="cal-agenda">
        {items.map((it) => (
          <div key={it.id} className="cal-slot">
            <div className="cal-time">{it.at}</div>
            <div className={"cal-block" + (it.candidate ? " live" : " ctx") + (it.captured ? " done" : "")}>
              <div className="cal-evt">{it.text}</div>
              {tail(it)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HandbookView({ items, tail }: ViewProps) {
  return (
    <div className="hbview">
      <div className="hb-toc">
        <div className="hb-toclbl">Employee Handbook</div>
        {items.map((it) => (
          <div key={it.id} className={"hb-tocitem" + (it.candidate ? " cand" : "")}>
            <span className="hb-toctxt">{it.title ?? it.sender}</span>
            {it.candidate && <span className="hb-tocflag">Policy</span>}
          </div>
        ))}
      </div>
      <div className="hb-page">
        <div className="hb-crumb">Employee Handbook · v4.2</div>
        {items.map((it) => (
          <div key={it.id} className={"hb-section" + (it.candidate ? " cand" : "") + (it.captured ? " done" : "")}>
            <h3 className="hb-h">{it.title ?? it.sender}</h3>
            <div className="hb-by">
              {it.sender} · {it.at}
            </div>
            <p className="hb-p">{it.text}</p>
            {tail(it)}
          </div>
        ))}
      </div>
    </div>
  );
}
