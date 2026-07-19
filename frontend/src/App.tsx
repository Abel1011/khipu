import { useQuery } from "@tanstack/react-query";
import { api } from "./lib/api";
import { useStore } from "./store";
import { TooltipProvider } from "./components/ui/tooltip";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { KhipuScreen } from "./views/KhipuScreen";
import { ChatScreen } from "./views/ChatScreen";
import { SourcesScreen } from "./views/SourcesScreen";
import { GovernanceScreen } from "./views/GovernanceScreen";

export function App() {
  const profileId = useStore((s) => s.profileId);
  const view = useStore((s) => s.view);
  const navCollapsed = useStore((s) => s.navCollapsed);
  const toast = useStore((s) => s.toast);

  const org = useQuery({ queryKey: ["org"], queryFn: api.orgTree });
  const mem = useQuery({ queryKey: ["memories", profileId], queryFn: () => api.memories(profileId) });

  return (
    <TooltipProvider>
      <div className={"app" + (navCollapsed ? " navcollapsed" : "")}>
        <Header org={org.data} />
        <main>
          <Sidebar />
          {view === "khipu" && <KhipuScreen org={org.data} memories={mem.data} />}
          {view === "chat" && <ChatScreen />}
          {view === "sources" && <SourcesScreen />}
          {view === "governance" && <GovernanceScreen />}
        </main>
        {toast && <div className={"toast" + (toast.err ? " err" : "")}>{toast.text}</div>}
      </div>
    </TooltipProvider>
  );
}
