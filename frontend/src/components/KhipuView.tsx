import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { KhipuScene } from "../khipu/scene";
import { useStore } from "../store";
import { api } from "../lib/api";
import type { MemoryView, OrgTree } from "../lib/types";
import { Slider } from "./ui/slider";
import { Button } from "./ui/button";

const MAX_DAYS = 120;

function ageLabel(a: number): string {
  const days = Math.round(a * MAX_DAYS);
  if (days < 4) return "now";
  if (days < 42) return `+${Math.round(days / 7)}w`;
  return `+${Math.round(days / 30)}mo`;
}

export function KhipuView({ org, memories }: { org?: OrgTree; memories?: MemoryView[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const scene = useRef<KhipuScene | null>(null);
  const select = useStore((s) => s.select);
  const focus = useStore((s) => s.focus);
  const profileId = useStore((s) => s.profileId);
  const showToast = useStore((s) => s.showToast);
  const pendingFocusId = useStore((s) => s.pendingFocusId);
  const clearPendingFocus = useStore((s) => s.clearPendingFocus);
  const [age, setAge] = useState(0);
  const projTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!ref.current) return;
    const s = new KhipuScene(ref.current);
    s.onSelect(select);
    scene.current = s;
    const onResize = () => s.resize();
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize); // also react to layout changes (mobile/tablet)
    ro.observe(ref.current);
    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      s.dispose();
      scene.current = null;
    };
  }, [select]);

  useEffect(() => {
    if (!scene.current) return;
    if (org && memories) {
      const me = org.people.find((p) => p.id === profileId);
      scene.current.setData(org, memories, {
        id: profileId,
        team: me?.team ?? null,
        admin: !!me?.admin,
      });
    } else {
      scene.current.reset(); // clear stale knots while the new profile's data loads
    }
  }, [org, memories, profileId]);

  useEffect(() => {
    scene.current?.setFocus(focus);
  }, [focus]);

  // A chat citation asked to spotlight a knot - do it once data is loaded.
  useEffect(() => {
    if (pendingFocusId && scene.current && memories) {
      scene.current.highlight(pendingFocusId);
      clearPendingFocus();
    }
  }, [pendingFocusId, memories, clearPendingFocus]);

  // Timeline drives a real, read-only lifecycle projection (not a cosmetic fade).
  const onAge = (v: number) => {
    setAge(v);
    const days = Math.round(v * MAX_DAYS);
    window.clearTimeout(projTimer.current);
    projTimer.current = window.setTimeout(() => {
      if (days === 0) {
        scene.current?.clearProjection();
        return;
      }
      api.projection(profileId, days).then((items) => scene.current?.applyProjection(items)).catch(() => {});
    }, 180);
  };

  const isAdmin = !!org?.people.find((p) => p.id === profileId)?.admin;
  // Real leak-rate metric from the adversarial suite (admins only; "-" otherwise).
  const rt = useQuery({
    queryKey: ["redteam", profileId],
    queryFn: () => api.redteam(profileId),
    enabled: isAdmin,
  });

  const redteam = () => {
    rt.refetch()
      .then((r) => {
        if (r.data) {
          showToast(
            `Cross-user leak attempt blocked · leak rate ${Math.round(r.data.leak_rate * 100)}% over ${r.data.checks} checks`,
          );
        } else {
          showToast(String(r.error ?? "Red-team check failed"), true);
        }
      })
      .catch((e) => showToast(String((e as Error)?.message ?? e), true));
  };

  return (
    <>
      <div className="stage" ref={ref}>
        <div className="legend">
          <span><span className="dot" style={{ background: "#c58a24" }} />Consolidated</span>
          <span><span className="dot" style={{ background: "#d0392b" }} />Working</span>
          <span><span className="dot" style={{ background: "#8f8474" }} />Dormant</span>
          <span><span className="dot" style={{ background: "#7a5c9e" }} />Private</span>
          <span>
            <span className="dot" style={{ background: "#fff", boxShadow: "0 0 0 2px #2a2a2a" }} />
            Locked policy
          </span>
          {age > 0 && (
            <span>
              <span className="dot" style={{ background: "#4f7fa8" }} />
              Changing tier
            </span>
          )}
        </div>
      </div>

      <div className="toolbar">
        <span className="tl">Today</span>
        <div style={{ flex: 1, display: "flex" }}>
          <Slider value={age * 100} onValueChange={(v) => onAge(v / 100)} />
        </div>
        <span className="tl" style={{ minWidth: 34, color: "var(--ink)" }}>
          {ageLabel(age)}
        </span>
        {isAdmin && (
          <Button variant="danger" size="sm" onClick={redteam}>
            <ShieldAlert size={14} /> Red-team
          </Button>
        )}
      </div>
    </>
  );
}
