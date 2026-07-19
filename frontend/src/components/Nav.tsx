import {
  Network,
  MessagesSquare,
  Cable,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useStore, type View } from "../store";
import { useGovReview } from "../lib/useGovReview";

const ITEMS: { id: View; label: string; icon: typeof Network }[] = [
  { id: "khipu", label: "Khipu", icon: Network },
  { id: "chat", label: "Chat", icon: MessagesSquare },
  { id: "sources", label: "Sources", icon: Cable },
  { id: "governance", label: "Governance", icon: ShieldCheck },
];

export function Nav() {
  const { view, setView, navCollapsed, toggleNav } = useStore();
  const profileId = useStore((s) => s.profileId);
  const { reviewCount } = useGovReview(profileId); // pending items needing a decision

  return (
    <nav className="nav">
      <button className="navtoggle" onClick={toggleNav} title={navCollapsed ? "Expand" : "Collapse"}>
        {navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>
      {ITEMS.map(({ id, label, icon: Icon }) => {
        const badge = id === "governance" && reviewCount > 0 ? reviewCount : 0;
        return (
          <button
            key={id}
            className={"navitem" + (view === id ? " active" : "")}
            onClick={() => setView(id)}
            title={badge ? `${label} · ${badge} to review` : label}
          >
            <Icon size={16} />
            <span>{label}</span>
            {badge > 0 && <span className="navbadge">{badge}</span>}
          </button>
        );
      })}
    </nav>
  );
}
