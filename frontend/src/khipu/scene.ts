import * as THREE from "three";
import type { MemoryView, OrgTree } from "../lib/types";

const TEAM_COLORS = [0xd0392b, 0x2b3ba0, 0x1f8a7a, 0xc58a24];
const ORG_COLOR = 0x4a4740;
const GOLD = 0xc58a24;
const DORMANT = 0x8f8474;
const PRIV = 0x7a5c9e;
const COOLING = 0x4f7fa8;
const BG = 0xffffff;
const INTRO = 1.9;

/** Evenly distribute n knots along a cord segment [s, e] so any amount of data fits. */
function tAt(i: number, n: number, s: number, e: number): number {
  return n <= 1 ? (s + e) / 2 : s + ((i + 0.5) / n) * (e - s);
}

/** Point on a cord at a given x (the primary cord is monotonic in x), so hanging
 *  cords attach to the curve where it actually is, not a fixed height. */
function pointAtX(curve: THREE.CatmullRomCurve3, x: number): THREE.Vector3 {
  let best = curve.getPoint(0);
  let bestD = Infinity;
  for (let i = 0; i <= 200; i++) {
    const p = curve.getPoint(i / 200);
    const d = Math.abs(p.x - x);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export interface Focus {
  type: "all" | "team" | "user";
  team?: string;
  person?: string;
}

interface Knot {
  mesh: THREE.Mesh;
  memory: MemoryView;
  teamColor: number;
  level: string;
  team: string | null;
  person: string | null;
  intro: number;
  tColor: THREE.Color;
  tOpacity: number;
  projTier: string | null; // real lifecycle projection at the timeline position
  projStrength: number | null;
}

interface Cord {
  mesh: THREE.Mesh;
  idx: number;
  level: string;
  team: string | null;
  person: string | null;
  base: number;
  intro: number;
}

export class KhipuScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private group = new THREE.Group();
  private knots: Knot[] = [];
  private cords: Cord[] = [];
  private raf = 0;
  private dragging = false;
  private moved = false;
  private last = { x: 0, y: 0 };
  private ray = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private hoverEl: HTMLDivElement;
  private hover: THREE.Object3D | null = null;
  private onSelectCb: (m: MemoryView | null) => void = () => {};

  private focus: Focus = { type: "all" };
  private viewer = { id: "", team: null as string | null, admin: true };
  private t0 = 0;
  private ready = false;
  private highlighted: Knot | null = null;
  private highlightAt = 0;
  private ac = new AbortController(); // one signal for every listener -> removed on dispose

  constructor(private container: HTMLElement) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(BG, 1);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.scene.fog = new THREE.Fog(BG, 34, 64);
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    this.camera.position.set(0, 0.5, 21);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xe6e4dd, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(7, 12, 10);
    this.scene.add(key);
    this.group.position.y = -1.2;
    this.scene.add(this.group);

    this.hoverEl = document.createElement("div");
    this.hoverEl.className = "hovlab";
    container.appendChild(this.hoverEl);

    this.bindEvents();
    this.animate();
  }

  onSelect(cb: (m: MemoryView | null) => void) {
    this.onSelectCb = cb;
  }

  /** Colour knots by a real lifecycle projection (strength/tier at a future date). */
  applyProjection(items: { id: string; strength: number; tier: string }[]) {
    const map = new Map(items.map((x) => [x.id, x]));
    for (const k of this.knots) {
      const p = map.get(k.memory.id);
      k.projTier = p ? p.tier : null;
      k.projStrength = p ? p.strength : null;
    }
    this.refresh();
  }

  clearProjection() {
    for (const k of this.knots) {
      k.projTier = null;
      k.projStrength = null;
    }
    this.refresh();
  }

  /** Empty the scene (e.g. while a new viewer's data loads) to avoid showing stale knots. */
  reset() {
    this.clear();
    this.ready = false;
    this.highlighted = null;
  }

  setFocus(focus: Focus) {
    this.focus = focus;
    this.refresh();
  }

  /** Spotlight a specific memory's knot and open it in the inspector. */
  highlight(memoryId: string) {
    const k = this.knots.find((x) => x.memory.id === memoryId) ?? null;
    this.highlighted = k;
    this.highlightAt = performance.now();
    if (k) this.onSelectCb(k.memory);
  }

  setData(
    org: OrgTree,
    memories: MemoryView[],
    viewer: { id: string; team: string | null; admin: boolean },
  ) {
    this.clear();
    this.viewer = viewer;
    const teamX: Record<string, number> = {};
    const teamColor: Record<string, number> = {};
    // Space teams evenly and keep them within the org cord even as more are added.
    const gap = Math.min(7.5, 19 / Math.max(org.teams.length - 1, 1));
    const span = (org.teams.length - 1) * gap;
    org.teams.forEach((t, i) => {
      teamX[t.id] = -span / 2 + i * gap;
      teamColor[t.id] = TEAM_COLORS[i % TEAM_COLORS.length];
    });
    const personTeam: Record<string, string> = {};
    org.people.forEach((p) => p.team && (personTeam[p.id] = p.team));

    const byScope: Record<string, MemoryView[]> = {};
    for (const m of memories) (byScope[m.scope.id] ??= []).push(m);

    const primary = this.cord(
      [[-11, 6, 0], [-6, 5.5, 0], [0, 5.35, 0], [6, 5.5, 0], [11, 6, 0]],
      0.22, ORG_COLOR, { level: "org", team: null, person: null }, 0,
    );
    const orgMems = byScope[org.org] ?? [];
    orgMems.forEach((m, i) =>
      this.knot(primary.getPoint(tAt(i, orgMems.length, 0.3, 0.92)), m, ORG_COLOR, "org", null, null, 0.5 + i * 0.04),
    );

    org.teams.forEach((team, ti) => {
      const tx = teamX[team.id];
      const col = teamColor[team.id];
      const scope = { level: "team", team: team.id, person: null };
      const top = pointAtX(primary, tx); // hang from the primary cord's real curve, not a fixed y
      const trunk = this.cord(
        [[top.x, top.y, top.z], [tx - 0.2, 3, 0.4], [tx + 0.1, 1, 0.7], [tx - 0.1, -1, 0.5], [tx, -2.5, 0.25]],
        0.17, col, scope, 0.3 + ti * 0.05,
      );
      const teamMems = byScope[`${org.org}.${team.id}`] ?? [];
      teamMems.forEach((m, i) =>
        this.knot(trunk.getPoint(tAt(i, teamMems.length, 0.3, 0.94)), m, col, "team", team.id, null, 0.85 + i * 0.04),
      );

      org.people.filter((p) => p.team === team.id).forEach((p, pi) => {
        const dz = pi % 2 === 0 ? -1.9 : 1.9;
        const origin = trunk.getPoint(0.52);
        const pend = this.cord(
          [
            [origin.x, origin.y, origin.z],
            [origin.x + dz * 0.06, origin.y - 1.1, origin.z + dz * 0.4],
            [origin.x + dz * 0.11, origin.y - 2.3, origin.z + dz * 0.8],
            [origin.x + dz * 0.15, origin.y - 3.6, origin.z + dz],
          ],
          0.13, col, { level: "user", team: team.id, person: p.id }, 0.55,
        );
        const pMems = byScope[`${org.org}.${p.id}`] ?? [];
        pMems.forEach((m, i) =>
          this.knot(pend.getPoint(tAt(i, pMems.length, 0.36, 0.96)), m, col, "user", team.id, p.id, 1.1 + i * 0.04),
        );
      });
    });

    // Team-less people (e.g. the org admin) hang as pendants from the org cord's centre.
    const teamless = org.people.filter((p) => !p.team);
    teamless.forEach((p, pi) => {
      const px = (pi - (teamless.length - 1) / 2) * 2.6;
      const top = pointAtX(primary, px); // attach to the org cord where it actually curves
      const pend = this.cord(
        [[top.x, top.y, top.z], [px + 0.1, 3.7, 1.1], [px - 0.1, 2.0, 1.4], [px, 0.4, 1.15]],
        0.13, ORG_COLOR, { level: "user", team: null, person: p.id }, 0.5,
      );
      const pMems = byScope[`${org.org}.${p.id}`] ?? [];
      pMems.forEach((m, i) =>
        this.knot(pend.getPoint(tAt(i, pMems.length, 0.34, 0.96)), m, ORG_COLOR, "user", null, p.id, 1.0 + i * 0.04),
      );
    });

    this.t0 = performance.now();
    this.ready = false;
    this.refresh();
  }

  private cord(
    points: number[][], radius: number, color: number,
    scope: { level: string; team: string | null; person: string | null }, intro: number,
  ): THREE.CatmullRomCurve3 {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const geo = new THREE.TubeGeometry(curve, 80, radius, 12, false);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.78, transparent: true, opacity: 0.9 });
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    this.cords.push({ mesh, idx: geo.index?.count ?? 0, base: color, intro, ...scope });
    return curve;
  }

  private knot(
    pos: THREE.Vector3, m: MemoryView, teamColor: number,
    level: string, team: string | null, person: string | null, intro: number,
  ) {
    const geo = new THREE.TorusKnotGeometry(0.2, 0.085, 72, 12, 2, 3);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(0);
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    if (m.authoritative) {
      mesh.add(
        new THREE.Mesh(
          new THREE.TorusGeometry(0.42, 0.055, 14, 34),
          new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.3, roughness: 0.4 }),
        ),
      );
    }
    this.group.add(mesh);
    this.knots.push({
      mesh, memory: m, teamColor, level, team, person, intro,
      tColor: new THREE.Color(teamColor), tOpacity: 1, projTier: null, projStrength: null,
    });
  }

  private cordVisible(level: string, team: string | null, person: string | null): boolean {
    if (this.viewer.admin) return true;
    if (level === "org") return true;
    if (level === "team") return this.viewer.team === team;
    return this.viewer.id === person;
  }

  private focusDim(level: string, team: string | null, person: string | null): number {
    const f = this.focus;
    if (f.type === "all") return 1;
    if (f.type === "team") {
      if (team === f.team) return 1;
      if (level === "org") return 0.4;
      return 0.12;
    }
    if (person === f.person) return 1;
    if (team === f.team) return 0.4;
    if (level === "org") return 0.3;
    return 0.1;
  }

  private knotColor(k: Knot): THREE.Color {
    const m = k.memory;
    const tier = k.projTier ?? m.tier;
    if (m.state === "sealed" || m.visibility === "private") return new THREE.Color(PRIV);
    if (k.projTier && k.projTier !== m.tier) return new THREE.Color(COOLING);
    if (tier === "consolidated") return new THREE.Color(GOLD);
    if (tier === "dormant") return new THREE.Color(DORMANT);
    if (m.authoritative) return new THREE.Color(k.teamColor);
    const strength = k.projStrength ?? m.strength;
    const fade = Math.min(Math.max(1 - strength, 0), 0.75);
    return new THREE.Color(k.teamColor).lerp(new THREE.Color(DORMANT), fade);
  }

  private knotOpacity(k: Knot): number {
    const m = k.memory;
    if (k.projTier && k.projTier !== m.tier) return 1;
    const tier = k.projTier ?? m.tier;
    if (tier === "consolidated") return 1;
    if (tier === "dormant" || m.state === "sealed") return 0.75;
    if (m.authoritative) return 0.95;
    const strength = k.projStrength ?? m.strength;
    return 0.45 + 0.5 * Math.min(Math.max(strength, 0), 1);
  }

  private refresh() {
    for (const k of this.knots) {
      const dim = this.focusDim(k.level, k.team, k.person);
      k.tColor = this.knotColor(k);
      k.tOpacity = this.knotOpacity(k) * dim;
    }
  }

  private disposeTree(obj: THREE.Object3D) {
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x?.dispose());
      else (mat as THREE.Material | undefined)?.dispose();
    });
  }

  private clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      this.disposeTree(c); // geometry + material of the knot and its child meshes (locks)
    }
    this.knots = [];
    this.cords = [];
  }

  private bindEvents() {
    const el = this.renderer.domElement;
    const sig = { signal: this.ac.signal };
    el.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.moved = false;
      this.last = { x: e.clientX, y: e.clientY };
    }, sig);
    window.addEventListener("pointerup", (e) => {
      if (this.dragging && !this.moved && this.ready) this.pick(e);
      this.dragging = false;
    }, sig);
    window.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.last.x;
      const dy = e.clientY - this.last.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.moved = true;
      this.group.rotation.y += dx * 0.006;
      this.group.rotation.x = Math.max(-0.5, Math.min(0.6, this.group.rotation.x + dy * 0.004));
      this.last = { x: e.clientX, y: e.clientY };
    }, sig);
    el.addEventListener("pointermove", (e) => !this.dragging && this.doHover(e), sig);
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.camera.position.z = Math.max(12, Math.min(40, this.camera.position.z + e.deltaY * 0.02));
    }, { signal: this.ac.signal, passive: false });
  }

  private castKnot(e: MouseEvent): Knot | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.ray.setFromCamera(this.mouse, this.camera);
    const hit = this.ray.intersectObjects(this.knots.map((k) => k.mesh), false)[0];
    return hit ? this.knots.find((k) => k.mesh === hit.object) ?? null : null;
  }

  private pick(e: MouseEvent) {
    const k = this.castKnot(e);
    this.onSelectCb(k ? k.memory : null);
  }

  private doHover(e: MouseEvent) {
    if (!this.ready) return;
    const k = this.castKnot(e);
    this.hover = k ? k.mesh : null;
    if (!k) {
      this.hoverEl.style.display = "none";
      this.renderer.domElement.style.cursor = "default";
      return;
    }
    const r = this.container.getBoundingClientRect();
    this.hoverEl.style.display = "flex";
    this.hoverEl.style.left = e.clientX - r.left + "px";
    this.hoverEl.style.top = e.clientY - r.top + "px";
    // A private knot reveals nothing but that it is private (no owner, no scope).
    if (k.memory.state === "sealed" || k.memory.visibility === "private") {
      this.hoverEl.textContent = "Private";
    } else {
      const owner = k.level === "user" ? ` · ${k.memory.owner_id ?? ""}` : "";
      this.hoverEl.textContent = k.level === "org" ? "Organization" : (k.team ?? "") + owner;
    }
    this.renderer.domElement.style.cursor = "pointer";
  }

  private animate = () => {
    this.raf = requestAnimationFrame(this.animate);
    const el = (performance.now() - this.t0) / 1000;

    if (!this.ready && this.cords.length) {
      for (const c of this.cords) {
        const p = Math.max(0, Math.min(1, (el - c.intro) / 0.7));
        const base = this.cordVisible(c.level, c.team, c.person) ? (c.level === "user" ? 0.85 : 0.92) : 0.07;
        (c.mesh.material as THREE.MeshStandardMaterial).opacity = base;
        c.mesh.geometry.setDrawRange(0, Math.floor((c.idx * p) / 3) * 3);
      }
      for (const k of this.knots) {
        const p = Math.max(0, Math.min(1, (el - k.intro) / 0.45));
        k.mesh.scale.setScalar(p);
        (k.mesh.material as THREE.MeshStandardMaterial).color.copy(k.tColor);
        (k.mesh.material as THREE.MeshStandardMaterial).opacity = p * k.tOpacity;
      }
      if (el > INTRO + 0.4) {
        this.ready = true;
        for (const c of this.cords) c.mesh.geometry.setDrawRange(0, Infinity);
      }
    } else {
      this.group.rotation.y += 0.0006;
      const now = performance.now();
      if (this.highlighted && now - this.highlightAt > 6500) this.highlighted = null;
      for (const k of this.knots) {
        const mat = k.mesh.material as THREE.MeshStandardMaterial;
        mat.color.lerp(k.tColor, 0.12);
        const hi = this.highlighted === k;
        mat.opacity += ((hi ? 1 : k.tOpacity) - mat.opacity) * 0.12;
        const s = hi ? 1.6 + 0.12 * Math.sin(now * 0.011) : this.hover === k.mesh ? 1.28 : 1;
        k.mesh.scale.x += (s - k.mesh.scale.x) * 0.18;
        k.mesh.scale.y = k.mesh.scale.z = k.mesh.scale.x;
      }
      for (const c of this.cords) {
        const mat = c.mesh.material as THREE.MeshStandardMaterial;
        const dim = this.focusDim(c.level, c.team, c.person);
        const vis = this.cordVisible(c.level, c.team, c.person) ? (c.level === "user" ? 0.85 : 0.92) : 0.07;
        mat.opacity += (vis * dim - mat.opacity) * 0.1;
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.ac.abort(); // remove every window/canvas listener at once
    cancelAnimationFrame(this.raf);
    this.clear(); // free geometries + materials still on the GPU
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hoverEl.remove();
  }
}
