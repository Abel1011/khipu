import { create } from "zustand";
import type { ChatMsg, Conversation, MemoryView } from "./lib/types";

interface Focus {
  type: "all" | "team" | "user";
  team?: string;
  person?: string;
}

export type View = "khipu" | "chat" | "sources" | "governance";

export type { ChatMsg, Conversation } from "./lib/types";

interface AppState {
  profileId: string;
  view: View;
  navCollapsed: boolean;
  autoSaveMemory: boolean;
  autoPropose: boolean; // auto-file a promotion request for team/org-audience facts
  focus: Focus;
  selected: MemoryView | null;
  toast: { text: string; err?: boolean } | null;
  conversations: Conversation[];
  activeChatId: string | null;
  loadedOwners: string[];
  pendingFocusId: string | null;
  setProfile: (id: string) => void;
  setView: (v: View) => void;
  toggleNav: () => void;
  toggleAutoSave: () => void;
  toggleAutoPropose: () => void;
  focusMemoryInKhipu: (id: string) => void;
  clearPendingFocus: () => void;
  setFocus: (f: Focus) => void;
  select: (m: MemoryView | null) => void;
  showToast: (text: string, err?: boolean) => void;
  hydrate: (owner: string, convs: Conversation[]) => void;
  newChat: () => string;
  selectChat: (id: string) => void;
  deleteChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  pushMsgs: (id: string, msgs: ChatMsg[]) => void;
  updateLastMsg: (id: string, fn: (m: ChatMsg) => ChatMsg) => void;
}

const mapChat = (
  list: Conversation[],
  id: string,
  fn: (c: Conversation) => Conversation,
) => list.map((c) => (c.id === id ? fn(c) : c));

const firstOf = (list: Conversation[], owner: string) =>
  list.find((c) => c.owner === owner)?.id ?? null;

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<AppState>((set, get) => ({
  profileId: "elena",
  view: "khipu",
  navCollapsed: false,
  autoSaveMemory: localStorage.getItem("khipu.autosave") === "1",
  autoPropose: localStorage.getItem("khipu.autopropose") === "1",
  focus: { type: "all" },
  selected: null,
  toast: null,
  conversations: [],
  activeChatId: null,
  loadedOwners: [],
  pendingFocusId: null,
  setView: (view) => set({ view, selected: null }),
  toggleNav: () => set((s) => ({ navCollapsed: !s.navCollapsed })),
  toggleAutoSave: () =>
    set((s) => {
      const v = !s.autoSaveMemory;
      try {
        localStorage.setItem("khipu.autosave", v ? "1" : "0");
      } catch {
        /* ignore */
      }
      return { autoSaveMemory: v };
    }),
  toggleAutoPropose: () =>
    set((s) => {
      const v = !s.autoPropose;
      try {
        localStorage.setItem("khipu.autopropose", v ? "1" : "0");
      } catch {
        /* ignore */
      }
      return { autoPropose: v };
    }),
  // Jump from a chat citation to its knot in the khipu (spotlight it there).
  focusMemoryInKhipu: (id) =>
    set({ view: "khipu", pendingFocusId: id, focus: { type: "all" }, selected: null }),
  clearPendingFocus: () => set({ pendingFocusId: null }),
  setProfile: (id) =>
    set((s) => ({
      profileId: id,
      selected: null,
      focus: { type: "all" },
      activeChatId: firstOf(s.conversations, id), // switch to this user's own chats
    })),
  setFocus: (focus) => set({ focus }),
  select: (selected) => set({ selected }),
  showToast: (text, err) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { text, err } });
    toastTimer = setTimeout(() => set({ toast: null }), 3000);
  },
  hydrate: (owner, convs) =>
    set((s) => {
      if (s.loadedOwners.includes(owner)) return {}; // load once per session
      const known = new Set(s.conversations.map((c) => c.id));
      const merged = [...convs.filter((c) => !known.has(c.id)), ...s.conversations];
      return {
        conversations: merged,
        loadedOwners: [...s.loadedOwners, owner],
        activeChatId:
          s.profileId === owner && !s.activeChatId ? firstOf(merged, owner) : s.activeChatId,
      };
    }),
  newChat: () => {
    const id = crypto.randomUUID();
    const owner = get().profileId;
    set((s) => ({
      conversations: [{ id, owner, title: "New chat", msgs: [] }, ...s.conversations],
      activeChatId: id,
    }));
    return id;
  },
  selectChat: (id) => set({ activeChatId: id }),
  deleteChat: (id) =>
    set((s) => {
      const rest = s.conversations.filter((c) => c.id !== id);
      return {
        conversations: rest,
        activeChatId: s.activeChatId === id ? firstOf(rest, s.profileId) : s.activeChatId,
      };
    }),
  renameChat: (id, title) =>
    set((s) => ({ conversations: mapChat(s.conversations, id, (c) => ({ ...c, title })) })),
  pushMsgs: (id, msgs) =>
    set((s) => ({
      conversations: mapChat(s.conversations, id, (c) => ({ ...c, msgs: [...c.msgs, ...msgs] })),
    })),
  updateLastMsg: (id, fn) =>
    set((s) => ({
      conversations: mapChat(s.conversations, id, (c) => ({
        ...c,
        msgs: c.msgs.map((m, i) => (i === c.msgs.length - 1 ? fn(m) : m)),
      })),
    })),
}));
