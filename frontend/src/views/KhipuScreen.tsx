import { useState } from "react";
import { X, Network, List } from "lucide-react";
import type { MemoryView, OrgTree as Org } from "../lib/types";
import { KhipuView } from "../components/KhipuView";
import { KhipuListView } from "../components/KhipuListView";
import { Inspector } from "../components/Inspector";
import { OrgTree } from "../components/OrgTree";
import { useStore } from "../store";

export function KhipuScreen({ org, memories }: { org?: Org; memories?: MemoryView[] }) {
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const [mode, setMode] = useState<"khipu" | "list">("khipu");
  const count = memories?.length ?? 0;

  return (
    <div className="content khipu">
      <OrgTree org={org} />
      <section className="center">
        <div className="exhibit">
          <div className="kh-tabs">
            <button className={mode === "khipu" ? "on" : ""} onClick={() => setMode("khipu")}>
              <Network size={14} /> Khipu
            </button>
            <button className={mode === "list" ? "on" : ""} onClick={() => setMode("list")}>
              <List size={14} /> List
            </button>
          </div>
          <span className="m">
            {count} memories{mode === "khipu" ? " · hierarchy × lifecycle" : ""}
          </span>
        </div>
        {mode === "khipu" ? (
          <KhipuView org={org} memories={memories} />
        ) : (
          <KhipuListView org={org} memories={memories} />
        )}
      </section>
      {/* Backdrop only matters on mobile, where the inspector is a bottom sheet. */}
      <div
        className={"inspector-backdrop" + (selected ? " show" : "")}
        onClick={() => select(null)}
      />
      <div className={"inspector" + (selected ? " open" : "")}>
        <button className="sheet-close" onClick={() => select(null)} aria-label="Close">
          <X size={18} />
        </button>
        <Inspector />
      </div>
    </div>
  );
}
