import type {
  CaptureCandidate,
  Citation,
  Conversation,
  Health,
  HistoryEntry,
  MemoryView,
  OrgTree,
  Promotion,
  IngestResult,
  SourceContent,
} from "./types";

export type ChatEvent =
  | { type: "meta"; mode: string }
  | { type: "token"; text: string }
  | { type: "done"; citations: Citation[]; text?: string };

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<Health>("/health"),
  orgTree: () => req<OrgTree>("/org/tree"),
  memories: (profileId: string) =>
    req<{ items: MemoryView[] }>(`/memory?profile_id=${profileId}`).then((r) => r.items),
  privateHeld: (profileId: string) =>
    req<{ count: number }>(`/memory/private-held?profile_id=${profileId}`).then((r) => r.count),
  captureMemory: (text: string) =>
    req<{ candidates: CaptureCandidate[] }>("/chat/capture", {
      method: "POST",
      body: JSON.stringify({ text }),
    }).then((r) => r.candidates),
  saveMemory: (
    content: string, actorId: string, semanticKey: string | null, proposeTo?: string, team?: string,
  ) =>
    req<{ content: string; superseded: string[]; proposed_to: string | null; ingested_to: string | null }>(
      "/memory/save",
      {
        method: "POST",
        body: JSON.stringify({
          content, actor_id: actorId, semantic_key: semanticKey,
          propose_to: proposeTo ?? null, team: team ?? null,
        }),
      },
    ),
  chatStream: async (
    query: string,
    profileId: string,
    onEvent: (ev: ChatEvent) => void,
  ): Promise<void> => {
    const res = await fetch(BASE + "/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, profile_id: profileId }),
    });
    if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) onEvent(JSON.parse(line) as ChatEvent);
      }
    }
    const tail = buffer.trim(); // flush a final event if the stream had no trailing newline
    if (tail) onEvent(JSON.parse(tail) as ChatEvent);
  },
  edit: (id: string, content: string, actorId: string, semanticKey?: string) =>
    req(`/memory/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content, actor_id: actorId, semantic_key: semanticKey ?? null }),
    }),
  dismissLock: (id: string, actorId: string) =>
    req(`/memory/${id}/dismiss-lock?actor_id=${actorId}`, { method: "POST" }),
  forget: (id: string, actorId: string) =>
    req(`/memory/${id}?actor_id=${actorId}`, { method: "DELETE" }),
  pin: (id: string, actorId: string, value: boolean) =>
    req(`/memory/${id}/pin`, { method: "POST", body: JSON.stringify({ actor_id: actorId, value }) }),
  setConsent: (id: string, actorId: string, value: boolean) =>
    req(`/memory/${id}/consent`, { method: "POST", body: JSON.stringify({ actor_id: actorId, value }) }),
  history: (id: string, profileId: string) =>
    req<{ items: HistoryEntry[] }>(`/memory/${id}/history?profile_id=${profileId}`).then((r) => r.items),
  restore: (id: string, actorId: string, version: number) =>
    req(`/memory/${id}/restore`, {
      method: "POST",
      body: JSON.stringify({ actor_id: actorId, version }),
    }),
  authoritative: (id: string, actorId: string, value: boolean) =>
    req(`/memory/${id}/authoritative`, {
      method: "POST",
      body: JSON.stringify({ actor_id: actorId, value }),
    }),
  lockImpact: (id: string, profileId: string) =>
    req<{ items: { id: string; level: string; content: string }[] }>(
      `/memory/${id}/lock-impact?profile_id=${profileId}`,
    ).then((r) => r.items),
  setVisibility: (id: string, actorId: string, visibility: string) =>
    req(`/memory/${id}/visibility`, {
      method: "POST",
      body: JSON.stringify({ actor_id: actorId, visibility }),
    }),
  conversations: (profileId: string) =>
    req<{ items: Conversation[] }>(`/conversations?profile_id=${profileId}`).then((r) => r.items),
  saveConversation: (c: Conversation) =>
    req<{ ok: boolean }>(`/conversations/${c.id}`, {
      method: "PUT",
      body: JSON.stringify({ owner: c.owner, title: c.title, msgs: c.msgs }),
    }),
  deleteConversation: (id: string, profileId: string) =>
    req<{ ok: boolean }>(`/conversations/${id}?profile_id=${profileId}`, { method: "DELETE" }),
  sources: (profileId: string) =>
    req<{ items: SourceContent[] }>(`/sources?profile_id=${profileId}`).then((r) => r.items),
  ingestItem: (
    connector: string, actorId: string, itemId: string, scope?: string, team?: string,
  ) =>
    req<IngestResult>(`/sources/${connector}/ingest`, {
      method: "POST",
      body: JSON.stringify({
        actor_id: actorId, item_id: itemId, scope: scope ?? null, team: team ?? null,
      }),
    }),
  requestPromotion: (id: string, actorId: string, toLevel: string) =>
    req(`/memory/${id}/promote`, {
      method: "POST",
      body: JSON.stringify({ actor_id: actorId, to_level: toLevel }),
    }),
  promotions: (profileId: string) =>
    req<{ items: Promotion[] }>(`/promotions?profile_id=${profileId}`).then((r) => r.items),
  decidePromotion: (rid: string, actorId: string, approve: boolean) =>
    req<{ status: string }>(`/promotions/${rid}/decide`, {
      method: "POST",
      body: JSON.stringify({ actor_id: actorId, approve }),
    }),
  advanceTime: (profileId: string, daysAhead: number) =>
    req<{ updated: number; expired: number }>(
      `/admin/jobs/decay?profile_id=${profileId}&days_ahead=${daysAhead}`,
      { method: "POST" },
    ),
  consolidate: (profileId: string) =>
    req<{ merged: number; promoted: number }>(
      `/admin/jobs/consolidate?profile_id=${profileId}`,
      { method: "POST" },
    ),
  projection: (profileId: string, daysAhead: number) =>
    req<{ items: { id: string; strength: number; tier: string }[] }>(
      `/memory/projection?profile_id=${profileId}&days_ahead=${daysAhead}`,
    ).then((r) => r.items),
  redteam: (profileId: string) =>
    req<{ leak_rate: number; checks: number }>(`/admin/redteam?profile_id=${profileId}`, {
      method: "POST",
    }),
  audit: (profileId: string) =>
    req<{ items: { id: string; action: string; actor_id: string; at: string }[] }>(
      `/audit?profile_id=${profileId}`,
    ).then((r) => r.items),
};
