import { useState } from "react";
import { Lock, Search, ChevronDown } from "lucide-react";
import { useStore } from "../store";
import type { OrgTree as Org } from "../lib/types";

const TEAM_CSS = ["#d0392b", "#2b3ba0", "#1f8a7a", "#c58a24"];

export function OrgTree({ org }: { org?: Org }) {
  const { profileId, focus, setFocus } = useStore();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  if (!org) return <div className="orgpanel" />;

  const me = org.people.find((p) => p.id === profileId);
  const admin = !!me?.admin;
  const q = query.trim().toLowerCase();
  const teamColor = (i: number) => TEAM_CSS[i % TEAM_CSS.length];
  const teamLocked = (t: string) => !admin && me?.team !== t;
  const personLocked = (pid: string) => !admin && pid !== profileId;
  const matches = (s: string) => s.toLowerCase().includes(q);
  const toggle = (t: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });

  return (
    <div className="orgpanel">
      <div className="navlbl" style={{ marginTop: 2 }}>
        Organization
        {focus.type !== "all" && <a onClick={() => setFocus({ type: "all" })}>reset focus</a>}
      </div>
      <div className="orgsearch">
        <Search size={13} color="#a49e90" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search team or person…"
        />
      </div>

      <div
        className={"trow org" + (focus.type === "all" ? " active" : "")}
        onClick={() => setFocus({ type: "all" })}
      >
        <span className="dotc" style={{ background: "#4a4740" }} />
        {org.org.charAt(0).toUpperCase() + org.org.slice(1)}
        <span className="role">org</span>
      </div>

      {org.teams.map((team, i) => {
        const people = org.people.filter((p) => p.team === team.id);
        const teamMatch = matches(team.name);
        const shown = q ? people.filter((p) => matches(p.name) || teamMatch) : people;
        if (q && !teamMatch && shown.length === 0) return null;
        const isCollapsed = collapsed.has(team.id) && !q;
        return (
          <div key={team.id}>
            <div
              className={
                "trow team" +
                (teamLocked(team.id) ? " locked" : "") +
                (focus.type === "team" && focus.team === team.id ? " active" : "")
              }
              onClick={() => !teamLocked(team.id) && setFocus({ type: "team", team: team.id })}
            >
              <ChevronDown
                size={13}
                style={{ transform: isCollapsed ? "rotate(-90deg)" : "none", color: "#a49e90", flex: "none" }}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(team.id);
                }}
              />
              <span className="dotc" style={{ background: teamColor(i) }} />
              {team.name}
              {teamLocked(team.id) && <Lock size={11} style={{ marginLeft: "auto" }} />}
            </div>
            {!isCollapsed &&
              shown.map((p) => (
                <div
                  key={p.id}
                  className={
                    "trow member" +
                    (personLocked(p.id) ? " locked" : "") +
                    (focus.type === "user" && focus.person === p.id ? " active" : "")
                  }
                  onClick={() => !personLocked(p.id) && setFocus({ type: "user", team: team.id, person: p.id })}
                >
                  <span className="dotc" style={{ background: teamColor(i) }} />
                  {p.name}
                  {personLocked(p.id) ? (
                    <Lock size={10} style={{ marginLeft: "auto" }} />
                  ) : (
                    <span className="role">{p.role}</span>
                  )}
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
