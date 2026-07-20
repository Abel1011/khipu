import { Loader2, MessagesSquare, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useStore } from "../store";
import { api } from "../lib/api";

export function ChatList({ onPick }: { onPick?: () => void }) {
  const profileId = useStore((s) => s.profileId);
  const all = useStore((s) => s.conversations);
  const showToast = useStore((s) => s.showToast);
  const { activeChatId, newChat, selectChat, deleteChat } = useStore();
  const conversations = all.filter((c) => c.owner === profileId);
  const [removing, setRemoving] = useState<string | null>(null);

  // Delete server-side first, then locally - only if it actually succeeded.
  const remove = async (id: string) => {
    if (removing) return;
    setRemoving(id);
    try {
      const res = await api.deleteConversation(id, profileId);
      if (res.ok) deleteChat(id);
      else showToast("Couldn't delete - not your conversation", true);
    } catch {
      showToast("Couldn't delete the conversation", true);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="convpanel">
      <button
        className="newchat"
        onClick={() => {
          newChat();
          onPick?.();
        }}
      >
        <Plus size={15} /> New chat
      </button>
      <div className="navlbl" style={{ margin: "4px 4px 6px" }}>
        Conversations
      </div>
      {conversations.length === 0 && <div className="convempty">No conversations yet.</div>}
      <div className="convlist">
        {conversations.map((c) => {
          const last = c.msgs[c.msgs.length - 1];
          return (
            <div
              key={c.id}
              className={"convitem" + (c.id === activeChatId ? " active" : "")}
              onClick={() => {
                selectChat(c.id);
                onPick?.();
              }}
            >
              <MessagesSquare size={14} className="ico" />
              <div className="meta">
                <div className="title">{c.title}</div>
                {last && <div className="preview">{last.text || "…"}</div>}
              </div>
              <button
                className="del"
                title="Delete chat"
                disabled={!!removing}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(c.id);
                }}
              >
                {removing === c.id ? (
                  <Loader2 size={13} className="spin" />
                ) : (
                  <Trash2 size={13} />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
