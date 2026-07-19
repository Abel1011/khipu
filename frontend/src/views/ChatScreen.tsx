import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Lock, Send, Zap, Search, Sparkles, Network, Lightbulb, Check, Save, ChevronsUp, MessagesSquare,
  ArrowRight, Users, Building2, User,
} from "lucide-react";
import type { Person } from "../lib/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../store";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { ChatList } from "../components/ChatList";
import type { CaptureCandidate, ChatMsg } from "../lib/types";

const SUGGESTIONS = [
  "Can I give a client a 30% discount?",
  "When do we deploy?",
  "How does client onboarding work?",
];

type Aud = "personal" | "team" | "org";
const SCOPE_OPTS: { id: Aud; label: string; ico: typeof User }[] = [
  { id: "personal", label: "Personal", ico: User },
  { id: "team", label: "Team", ico: Users },
  { id: "org", label: "Company", ico: Building2 },
];

// Same authority model as Sources: personal saves; team/org ingest if you govern
// (admin anywhere, or the chosen team's lead), else propose.
function governs(me: Person | undefined, aud: Aud, teamId?: string): boolean {
  if (aud === "org") return !!me?.admin;
  if (aud === "team") return !!me?.admin || (!!me?.lead && me?.team === teamId);
  return true;
}
function actionOf(me: Person | undefined, aud: Aud, teamId?: string): "save" | "ingest" | "propose" {
  if (aud === "personal") return "save";
  return governs(me, aud, teamId) ? "ingest" : "propose";
}

export function ChatScreen() {
  const profileId = useStore((s) => s.profileId);
  const conversations = useStore((s) => s.conversations);
  const activeChatId = useStore((s) => s.activeChatId);
  const loadedOwners = useStore((s) => s.loadedOwners);
  const focusMemoryInKhipu = useStore((s) => s.focusMemoryInKhipu);
  const showToast = useStore((s) => s.showToast);
  const autoSaveMemory = useStore((s) => s.autoSaveMemory);
  const toggleAutoSave = useStore((s) => s.toggleAutoSave);
  const autoPropose = useStore((s) => s.autoPropose);
  const toggleAutoPropose = useStore((s) => s.toggleAutoPropose);
  const { newChat, renameChat, pushMsgs, updateLastMsg, hydrate } = useStore();
  const qc = useQueryClient();

  const org = useQuery({ queryKey: ["org"], queryFn: api.orgTree });
  const me = org.data?.people.find((p) => p.id === profileId);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState(false); // conversation list as an overlay on tablet/mobile
  const [scopeOverride, setScopeOverride] = useState<Record<string, Aud>>({}); // per-candidate scope tweak
  const [teamOverride, setTeamOverride] = useState<Record<string, string>>({}); // per-candidate team (admin)
  const threadRef = useRef<HTMLDivElement>(null);

  const teams = org.data?.teams ?? [];
  const isAdmin = !!me?.admin;
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "team";
  // Keyed by a unique per-candidate id (message:index), so two candidates that share
  // a semantic_key or text in the same turn never drag each other's scope.
  const audOf = (uid: string, c: CaptureCandidate): Aud =>
    scopeOverride[uid] ?? ((c.audience as Aud) ?? "personal");
  const teamOf = (uid: string) => teamOverride[uid] ?? me?.team ?? teams[0]?.id ?? "";

  const active = conversations.find((c) => c.id === activeChatId && c.owner === profileId);
  const msgs = active?.msgs ?? [];

  // Load this user's saved conversations from Postgres (once per session).
  useEffect(() => {
    if (!loadedOwners.includes(profileId)) {
      api.conversations(profileId).then((convs) => hydrate(profileId, convs)).catch(() => {});
    }
  }, [profileId, loadedOwners, hydrate]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const persist = (id: string) => {
    const conv = useStore.getState().conversations.find((c) => c.id === id);
    if (!conv) return;
    api.saveConversation(conv)
      .then((res) => {
        if (!res.ok) showToast("Chat wasn't saved", true);
      })
      .catch(() => showToast("Chat wasn't saved - network error", true));
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const id = activeChatId ?? newChat();
    const isFirst = (conversations.find((c) => c.id === id)?.msgs.length ?? 0) === 0;
    if (isFirst) renameChat(id, question.slice(0, 42));
    setInput("");
    setBusy(true);
    pushMsgs(id, [
      { role: "user", text: question },
      { role: "assistant", text: "", streaming: true },
    ]);
    try {
      await api.chatStream(question, profileId, (ev) => {
        if (ev.type === "meta") updateLastMsg(id, (m) => ({ ...m, mode: ev.mode }));
        else if (ev.type === "token") updateLastMsg(id, (m) => ({ ...m, text: m.text + ev.text }));
        else if (ev.type === "done")
          updateLastMsg(id, (m) => ({
            ...m,
            text: ev.text ?? m.text, // swap in the renumbered final text (clean 1..N citations)
            citations: ev.citations,
          }));
      });
    } catch (e) {
      updateLastMsg(id, (m) => ({ ...m, text: m.text || String((e as Error).message) }));
    }
    updateLastMsg(id, (m) => ({ ...m, streaming: false })); // single place the stream closes
    persist(id); // save the completed turn to Postgres
    setBusy(false);
    // detect facts worth remembering; auto-save if enabled, else offer them as chips
    api.captureMemory(question)
      .then(async (cands) => {
        if (!cands.length) return;
        if (!useStore.getState().autoSaveMemory) {
          updateLastMsg(id, (m) => ({ ...m, captured: cands }));
          persist(id); // capture chips must survive a reload
          return;
        }
        let updated = 0;
        let proposed = 0;
        let ingested = 0;
        const autoPropose = useStore.getState().autoPropose;
        const canTeam = !!me?.team; // an admin has no own team; auto-save can't pick one
        const results: NonNullable<ChatMsg["autoResults"]> = [];
        for (const c of cands) {
          const aud = (c.audience as Aud) ?? "personal";
          // Auto mode can't ask which team, so only route team facts when the actor
          // has an own team; otherwise it stays personal (no doomed proposal).
          const routeTeam = aud === "team" && canTeam;
          const target = autoPropose && (aud === "org" || routeTeam) ? aud : undefined;
          try {
            const r = await api.saveMemory(c.content, profileId, c.semantic_key, target);
            if (r.superseded.length) updated += 1;
            if (r.proposed_to) proposed += 1;
            if (r.ingested_to) ingested += 1;
            // Record what ACTUALLY happened, so the card never re-derives a wrong label.
            const action = r.ingested_to ? "ingest" : r.proposed_to ? "propose" : "save";
            const dest = aud === "org" ? "company" : routeTeam ? teamName(me?.team ?? "") : "your memory";
            results.push({ action, dest });
          } catch {
            results.push({ action: "save", dest: "your memory" });
          }
        }
        qc.invalidateQueries({ queryKey: ["memories"] });
        if (proposed) qc.invalidateQueries({ queryKey: ["promotions"] });
        showToast(
          `Auto-saved ${cands.length} to memory` +
            (updated ? " · updated existing" : "") +
            (ingested ? ` · ${ingested} shared directly` : "") +
            (proposed ? ` · ${proposed} proposed (pending approval)` : ""),
        );
        updateLastMsg(id, (m) => ({ ...m, captured: cands, autoSaved: true, autoResults: results }));
        persist(id); // persist the auto-save badges too
      })
      .catch(() => {});
  };

  const saveCaptured = async (convId: string, idx: number, c: CaptureCandidate, aud: Aud, team?: string) => {
    try {
      const target = aud === "team" || aud === "org" ? aud : undefined;
      const res = await api.saveMemory(c.content, profileId, c.semantic_key, target, team);
      const dest = aud === "team" ? teamName(team ?? "") : aud === "org" ? "company" : "your memory";
      showToast(
        res.ingested_to
          ? `Ingested to ${dest}`
          : res.proposed_to
            ? `Proposed to ${dest} (pending approval)`
            : res.superseded.length
              ? "Saved - updated a prior note"
              : "Saved to your memory",
      );
      qc.invalidateQueries({ queryKey: ["memories"] });
      if (res.proposed_to) qc.invalidateQueries({ queryKey: ["promotions"] });
      // Mark saved in place (do NOT remove): removing shifts the other candidates'
      // indices, which would drop their per-candidate scope/team overrides on rerender.
      updateLastMsg(convId, (m) => ({
        ...m,
        captured: (m.captured ?? []).map((x, i) => (i === idx ? { ...x, saved: true } : x)),
      }));
      persist(convId); // the saved marker must survive a reload
    } catch (e) {
      showToast(String((e as Error).message), true);
    }
  };

  return (
    <div className={"content chat2col" + (drawer ? " drawer-open" : "")}>
      <div className="chat-backdrop" onClick={() => setDrawer(false)} />
      <ChatList onPick={() => setDrawer(false)} />
      <div className="screen chatscreen">
        <div className="chathead">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0 }}>
            <button
              className="chat-drawer-btn"
              onClick={() => setDrawer(true)}
              aria-label="Show conversations"
              title="Conversations"
            >
              <MessagesSquare size={17} />
            </button>
            <div style={{ minWidth: 0 }}>
              <h1>Chat</h1>
              <div className="sub">
                Answers are grounded only in memory you can see, resolved by precedence (org locks win).
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className={"autosave" + (autoSaveMemory ? " on" : "")}
              onClick={toggleAutoSave}
              title="Automatically save detected facts to your memory"
            >
              <Save size={13} /> Auto-save {autoSaveMemory ? "on" : "off"}
            </button>
            <button
              className={"autosave" + (autoPropose ? " on" : "")}
              onClick={toggleAutoPropose}
              title="Facts that concern your team/org are auto-proposed for sharing - approval stays manual"
            >
              <ChevronsUp size={13} /> Auto-propose {autoPropose ? "on" : "off"}
            </button>
          </div>
        </div>

        <div className="thread" ref={threadRef}>
          {msgs.length === 0 && (
            <div className="chatempty">
              <div className="badge">try it</div>
              <div className="prompts">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="promptchip" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="msg user">
                <div className="bubble">{m.text}</div>
              </div>
            ) : (
              <div key={i} className="msg assistant">
                <div className="bubble">
                  {m.text ? (
                    <div className="md">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                      {m.streaming && <span className="caret" />}
                    </div>
                  ) : (
                    <span className="typing">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}

                  {!m.streaming && m.mode && (
                    <div className="turnmeta">
                      {m.mode === "direct" ? (
                        <>
                          <Zap size={11} /> answered directly · memory not searched
                        </>
                      ) : (
                        <>
                          <Search size={11} /> grounded in retrieved memory
                        </>
                      )}
                    </div>
                  )}

                  {(m.citations ?? []).map((c, j) => (
                    <div key={j} className={"cite " + (c.level.includes("Company") ? "org" : "team")}>
                      <span className="citenum">{j + 1}</span>
                      <span className="pin">
                        {c.authoritative ? <Lock size={10} /> : <Sparkles size={10} />}
                        {c.level}
                      </span>
                      <span className="ctext">
                        {c.content}
                        {c.reason && c.reason !== "unique" && (
                          <span style={{ display: "block", fontSize: 10, color: "#a49e90", fontStyle: "italic", marginTop: 3 }}>
                            {c.reason === "authoritative-lock"
                              ? "Won as a locked policy - overrides lower scopes"
                              : "Won as the most-specific scope"}
                            {(c.overrode?.length ?? 0) > 0 &&
                              ` · overrode ${c.overrode!.length} (${c.overrode![0].slice(0, 40)}${c.overrode![0].length > 40 ? "…" : ""})`}
                          </span>
                        )}
                      </span>
                      <button
                        className="citebtn"
                        title="View this memory in the khipu"
                        onClick={() => focusMemoryInKhipu(c.memory_id)}
                      >
                        <Network size={13} />
                      </button>
                    </div>
                  ))}

                  {(m.captured?.length ?? 0) > 0 && (
                    <div className="capture">
                      <span className="clbl">
                        {m.autoSaved ? (
                          <>
                            <Check size={11} /> Saved to memory
                          </>
                        ) : (
                          <>
                            <Lightbulb size={11} /> Worth remembering?
                          </>
                        )}
                      </span>
                      {m.captured!.map((c, k) => {
                        const uid = `${i}:${k}`;
                        const aud = audOf(uid, c);
                        const teamId = teamOf(uid);
                        const act = actionOf(me, aud, teamId);
                        const dest =
                          aud === "team" ? teamName(teamId) : aud === "org" ? "company" : "your memory";
                        const actLabel =
                          act === "save"
                            ? "Save to my memory"
                            : act === "ingest"
                              ? `Ingest to ${dest}`
                              : `Propose to ${dest}`;
                        const done = m.autoSaved || !!c.saved; // auto-saved or manually saved
                        return (
                          <div className="capcard" key={k}>
                            <div className="cc-text">{c.content}</div>
                            <div className="cc-foot">
                              {/* pick where it goes; team/org changes the action */}
                              <div className="cc-scopes">
                                {SCOPE_OPTS.map((s) => (
                                  <button
                                    key={s.id}
                                    className={"cc-scope" + (aud === s.id ? " on" : "")}
                                    disabled={done}
                                    onClick={() => setScopeOverride((o) => ({ ...o, [uid]: s.id }))}
                                    title={`Send to ${s.label.toLowerCase()}`}
                                  >
                                    <s.ico size={11} /> {s.label}
                                  </button>
                                ))}
                              </div>
                              {aud === "team" && isAdmin && teams.length > 0 && !done && (
                                <select
                                  className="cc-team"
                                  value={teamId}
                                  onChange={(e) => setTeamOverride((o) => ({ ...o, [uid]: e.target.value }))}
                                >
                                  {teams.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {done ? (
                                (() => {
                                  // Auto-saved: show the stored result. Manually saved: derive from
                                  // the choice that was made (its override survives, indices are stable).
                                  const res = m.autoSaved
                                    ? (m.autoResults?.[k] ?? { action: "save", dest: "your memory" })
                                    : { action: act, dest };
                                  const label =
                                    res.action === "save"
                                      ? "In your memory"
                                      : res.action === "ingest"
                                        ? `Shared to ${res.dest}`
                                        : `Proposed to ${res.dest}`;
                                  return (
                                    <span className="cc-done">
                                      <Check size={12} /> {label}
                                    </span>
                                  );
                                })()
                              ) : (
                                <button
                                  className={"cc-go" + (act === "propose" ? " propose" : act === "ingest" ? " ingest" : "")}
                                  onClick={() =>
                                    active && saveCaptured(active.id, k, c, aud, aud === "team" ? teamId : undefined)
                                  }
                                >
                                  {actLabel}{" "}
                                  {act === "propose" ? <ChevronsUp size={12} /> : <ArrowRight size={12} />}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
        </div>

        <div className="composer">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            placeholder="Ask the assistant…"
          />
          <Button variant="primary" onClick={() => send(input)} disabled={busy}>
            <Send size={14} /> Send
          </Button>
        </div>
      </div>
    </div>
  );
}
