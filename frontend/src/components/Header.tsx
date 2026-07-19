import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import type { OrgTree } from "../lib/types";
import { KhipuLogo } from "./Logo";
import { Select, SelectItem } from "./ui/select";

const AV: Record<string, [string, string]> = {
  elena: ["E", "#4a4740"],
  ana: ["A", "#d0392b"],
  bruno: ["B", "#d0392b"],
  carla: ["C", "#2b3ba0"],
  marco: ["M", "#2b3ba0"],
  diego: ["D", "#1f8a7a"],
  lucia: ["L", "#1f8a7a"],
  sofia: ["S", "#c58a24"],
  javier: ["J", "#c58a24"],
};

export function Header({ org }: { org?: OrgTree }) {
  const { profileId, setProfile } = useStore();
  const focusMemory = useStore((s) => s.focusMemoryInKhipu);
  const people = org?.people ?? [];
  const [, color] = AV[profileId] ?? ["?", "#4a4740"];

  const [q, setQ] = useState("");
  const mem = useQuery({ queryKey: ["memories", profileId], queryFn: () => api.memories(profileId) });
  const term = q.trim().toLowerCase();
  const results = term
    ? (mem.data ?? [])
        .filter((m) => (m.content ?? "").toLowerCase().includes(term))
        .slice(0, 6)
    : [];

  const pick = (id: string) => {
    focusMemory(id);
    setQ("");
  };

  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15000 });
  const h = health.data;

  return (
    <>
      <header>
        <div className="brand">
          <KhipuLogo />
          <span className="name">KHIPU</span>
          {h && (
            <span
              className="persistdot"
              title={
                (h.persistent ? "Persistent store" : "In-memory (fallback)") +
                ` - vector: ${h.vector_store} · sql: ${h.sql_store} · ${h.memories} memories`
              }
              style={{
                width: 9, height: 9, borderRadius: 999, marginLeft: 6, flex: "none",
                background: h.persistent ? "#3f9a5a" : "#c58a24",
                boxShadow: `0 0 0 3px ${h.persistent ? "#eaf5ee" : "#fbf1e6"}`,
              }}
            />
          )}
        </div>
        <div className="search" style={{ position: "relative" }}>
          <Search size={15} color="#a49e90" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && results[0] && pick(results[0].id)}
            placeholder="Search memory across the organization…"
          />
          {results.length > 0 && (
            <div
              style={{
                position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 50,
                background: "#fff", border: "1px solid #e6e3db", borderRadius: 10,
                boxShadow: "0 8px 24px rgba(0,0,0,0.08)", overflow: "hidden",
              }}
            >
              {results.map((m) => (
                <button
                  key={m.id}
                  onClick={() => pick(m.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "8px 10px", background: "none", border: "none",
                    borderBottom: "1px solid #f1efe9", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span className="lvltag">{m.scope.level}</span>
                  <span style={{ fontSize: 13, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.content}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="profile">
          <span className="lbl" style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#a49e90", textTransform: "uppercase" }}>
            view as
          </span>
          <Select
            value={profileId}
            onValueChange={setProfile}
            ariaLabel="View as"
            leading={
              <span
                className="avatar"
                style={{ background: color, width: 26, height: 26, fontSize: 12, flex: "none" }}
              >
                {AV[profileId]?.[0] ?? "?"}
              </span>
            }
          >
            {people.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} · {p.role}
              </SelectItem>
            ))}
          </Select>
        </div>
      </header>
      <div className="rule" />
    </>
  );
}
