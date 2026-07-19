export type Level = "user" | "team" | "org";
export type Tier = "working" | "consolidated" | "dormant";
export type Visibility = "shared" | "personal" | "private";
export type ViewState = "full" | "sealed";

export interface Scope {
  level: Level;
  id: string;
}

export interface MemoryView {
  id: string;
  content: string | null;
  semantic_key: string | null;
  scope: Scope;
  authoritative: boolean;
  lock_suggested: boolean;
  tier: Tier;
  type: string;
  visibility: Visibility;
  owner_id: string | null;
  strength: number;
  pinned: boolean;
  consent: boolean;
  version: number;
  source: { type: string } | null;
  invalid_at: string | null; // expiry (bi-temporal); null = durable
  created_at: string | null;
  pii: boolean;
  state: ViewState;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  team: string | null;
  admin?: boolean;
  lead?: boolean;
}

export interface Team {
  id: string;
  name: string;
}

export interface OrgTree {
  org: string;
  teams: Team[];
  people: Person[];
}

export interface Citation {
  memory_id: string;
  level: string;
  content: string;
  authoritative: boolean;
  reason?: string; // authoritative-lock | most-specific | unique
  overrode?: string[]; // same-key facts this one beat
}

export interface Health {
  ok: boolean;
  vector_store: string;
  sql_store: string;
  persistent: boolean;
  memories: number;
}

export interface CaptureCandidate {
  content: string;
  type: string;
  semantic_key: string | null;
  audience?: "personal" | "team" | "org"; // who the fact concerns (from extraction)
  saved?: boolean; // this candidate was manually saved (kept in place so indices stay stable)
}

export interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  mode?: string;
  citations?: Citation[];
  streaming?: boolean;
  captured?: CaptureCandidate[];
  autoSaved?: boolean;
  autoResults?: { action: "save" | "ingest" | "propose"; dest: string }[]; // what auto-save actually did
}

export interface Conversation {
  id: string;
  owner: string; // profileId - conversations are private to each user
  title: string;
  msgs: ChatMsg[];
}

export interface SimFact {
  content: string;
  level: string;
  tier: string;
  type: string;
  lock_suggested: boolean;
  expires: string | null;
  updated: boolean;
}

export interface SimResult {
  event: string;
  source: string;
  created: SimFact[];
}

export type SourceAction = "save" | "ingest" | "propose";

export interface SourceItem {
  id: string;
  connector: string;
  channel: string;
  title: string | null; // handbook section title
  sender: string;
  at: string;
  text: string;
  scope: string; // user | team | org (content scope)
  team: string | null; // which team, for team-scoped items
  visibility: string;
  candidate: boolean; // memory-worthy
  memory: string | null; // preview of how it will be distilled
  action: SourceAction | null; // save | ingest | propose, given the viewer's authority
  captured: boolean;
  captured_by: string | null; // who captured a shared item first
}

export interface SourceContent {
  connector: string;
  kind: "integration" | "reference";
  candidate_count: number;
  captured_count: number;
  items: SourceItem[];
}

export interface IngestResult {
  action?: SourceAction;
  connector?: string;
  proposed_to?: string | null;
  created?: { content: string; level: string; type: string; updated: boolean }[];
  already?: boolean;
  captured_by?: string | null;
}

export interface HistoryEntry {
  id: string;
  memory_id: string;
  version: number;
  content: string;
  actor_id: string;
  at: string;
}

export interface Promotion {
  id: string;
  memory_id: string;
  content: string;
  from: string;
  to_level: string;
  to: string;
  requested_by: string;
}
