import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type Progress3DPlugin from "./main";
import { TYPE_COLOR, GraphNode } from "./graph";
import { PromptModal } from "./prompt-modal";
import { GrpoScene } from "./grpo-scene";

export const VIEW_TYPE = "progress3d-map";

export class ResearchMapView extends ItemView {
  plugin: Progress3DPlugin;
  private host: HTMLElement;
  private mapSel: HTMLSelectElement | null = null;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private controls: OrbitControls;
  private root: THREE.Group;
  private nodeMeshes: THREE.Object3D[] = [];
  private pickMeshes: THREE.Mesh[] = [];
  private meshById = new Map<string, THREE.Object3D>();
  private selected: THREE.Object3D | null = null;
  private readonly T = 6;
  private readonly H = 3;
  private raf = 0;
  private disposed = false;
  private ro: ResizeObserver | null = null;
  private clock = new THREE.Clock();
  private pulses: THREE.Points | null = null;
  private pseed: number[] = [];
  private path: THREE.Vector3[] = [];
  private haloTex: THREE.Texture | null = null;
  private pulseMeta: { from: string; to: string; skip: boolean; t: number; speed: number }[] = [];
  private ray = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private downXY: [number, number] | null = null;
  private edges: { from: string; to: string; skip: boolean; line: THREE.Line }[] = [];
  private downButton = 0;
  private dragMesh: THREE.Object3D | null = null;
  private dragMoved = false;
  private dragPlane = new THREE.Plane();
  private linkSource: string | null = null;
  // bespoke animated renderer for the `grpo` map (replaces the generic node-graph)
  private grpo: GrpoScene | null = null;
  private grpoModeForced: number | null = null; // null = auto-toggle, 0 = GRPO, 1 = Dr.GRPO
  private grpoModeBtn: HTMLButtonElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: Progress3DPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "3D Research Map"; }
  getIcon() { return "box"; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("p3d-content");
    this.host = this.contentEl.createDiv({ cls: "p3d-host" });

    const bar = this.host.createDiv({ cls: "p3d-toolbar" });
    bar.createSpan({ text: "🗺", cls: "p3d-title" });
    this.mapSel = bar.createEl("select", { cls: "p3d-mapsel" }) as HTMLSelectElement;
    this.mapSel.onchange = () => this.plugin.switchMap(this.mapSel!.value);
    const newMapBtn = bar.createEl("button", { text: "＋ Map" });
    newMapBtn.onclick = () =>
      new PromptModal(
        this.app,
        async (name) => { await this.plugin.newMap(name); await this.refreshMapList(); },
        { title: "Name the new research map", desc: "Then use the Claude Code chat to fill it in.", placeholder: "e.g. diffusion-unet", cta: "Create map", rows: 1 }
      ).open();
    const reload = bar.createEl("button", { text: "⟲ Reload" });
    reload.onclick = async () => { await this.plugin.loadGraph(); this.rebuild(); };
    const fit = bar.createEl("button", { text: "⤢ Frame" });
    fit.onclick = () => this.frameAll();
    const addBtn = bar.createEl("button", { text: "＋ Node" });
    addBtn.onclick = async () => {
      const t = this.controls.target;
      const id = await this.plugin.addNode({ pos: [+t.x.toFixed(2), +(t.y + 1).toFixed(2), +t.z.toFixed(2)] });
      new Notice(`Added node "${id}" — drag it (✎ Edit), shift-click two nodes to connect.`);
    };
    const delBtn = bar.createEl("button", { text: "🗑 Node" });
    delBtn.onclick = async () => {
      const id = (this.selected as any)?.p3d?.node?.id as string | undefined;
      if (!id) { new Notice("Click a node to select it first."); return; }
      await this.plugin.deleteNode(id);
      new Notice(`Deleted node "${id}".`);
    };
    // mode toggle — only shown for animated maps (e.g. grpo). Cycles Auto → GRPO → Dr.GRPO.
    this.grpoModeBtn = bar.createEl("button", { text: "mode: Auto ⇄" });
    this.grpoModeBtn.style.display = "none";
    this.grpoModeBtn.onclick = () => {
      this.grpoModeForced = this.grpoModeForced === null ? 0 : this.grpoModeForced === 0 ? 1 : null;
      this.updateGrpoBtn();
    };

    const hint = this.host.createDiv({ cls: "p3d-hint" });
    hint.setText("left-drag = rotate · right-drag = pan · scroll = zoom · middle-drag a node = move it · click = open note · shift-click two = connect");

    await this.refreshMapList();
    this.initThree();
    this.buildScene();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host);
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncActiveFile()));
    this.animate();
  }

  async onClose() {
    this.disposed = true; // stop the loop before tearing down GL objects
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.disposeScene();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss?.();
    this.host?.empty();
  }

  // ── three.js setup ─────────────────────────────────────────────────────
  private initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#03040a");
    this.scene.fog = new THREE.FogExp2("#03040a", 0.02);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
    this.camera.position.set(0, 9, 32);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.domElement.addClass("p3d-canvas");
    this.host.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(1, 1), 1.0, 0.6, 0.12)
    );

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.target.set(1, 0, 0);
    this.controls.minDistance = 6;
    this.controls.maxDistance = 80;
    // Left = rotate, right = pan, scroll = zoom. Middle is disabled here so our
    // own handler can use middle-drag to MOVE a node.
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: -1 as any, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.autoRotate = true; // slow idle rotation
    this.controls.autoRotateSpeed = 0.5;

    this.scene.add(new THREE.HemisphereLight("#8fb4ff", "#05060d", 0.5));
    const pl = new THREE.PointLight("#88aaff", 26, 100);
    pl.position.set(0, 10, 8);
    this.scene.add(pl);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    el.addEventListener("pointermove", (e) => this.onPointerMove(e));
    el.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.resize();
  }

  private label(text: string, x: number, y: number, z: number, col = "#cdd8ff", size = 30) {
    const c = document.createElement("canvas");
    const g = c.getContext("2d")!;
    g.font = `600 ${size}px Inter, sans-serif`;
    const w = g.measureText(text).width;
    c.width = w + 30; c.height = size + 16;
    g.font = `600 ${size}px Inter, sans-serif`;
    g.fillStyle = col; g.textBaseline = "middle";
    g.fillText(text, 15, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
    );
    sp.scale.set((c.width / c.height) * 0.7, 0.7, 1);
    sp.position.set(x, y, z);
    sp.renderOrder = 3;
    this.root.add(sp);
    return sp;
  }

  private makeHaloTexture(): THREE.Texture {
    const s = 128;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(0.22, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }

  private edgePoints(a: THREE.Vector3, b: THREE.Vector3, skip: boolean): THREE.Vector3[] {
    if (skip) {
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      mid.y += 4.2;
      return new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone()).getPoints(24);
    }
    return [a.clone(), b.clone()];
  }

  // Build an Attempt-2-style cluster for a node, by type: token columns,
  // per-head softmax grids for attention, expand bands for FFN.
  private buildCluster(n: GraphNode, col: string): THREE.Object3D {
    const g = new THREE.Group();
    g.position.set(n.pos[0], n.pos[1], n.pos[2]);
    const sg = new THREE.IcosahedronGeometry(0.16, 2);
    const T = this.T, H = this.H;
    const addSphere = (x: number, y: number, z: number, c: string, sc = 1) => {
      const m = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.4, roughness: 0.3 }));
      m.position.set(x, y, z); m.scale.setScalar(sc); m.userData.nodeId = n.id;
      g.add(m); this.pickMeshes.push(m);
    };
    if (n.type === "attn") {
      const cg = new THREE.BoxGeometry(0.28, 0.28, 0.05);
      const grids: THREE.Mesh[][][] = [];
      for (let h = 0; h < H; h++) {
        const z = (h - (H - 1) / 2) * 2.4;
        const grid: THREE.Mesh[][] = [];
        for (let qi = 0; qi < T; qi++) {
          grid[qi] = [];
          for (let ki = 0; ki < T; ki++) {
            const cell = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ color: "#ffd27a", emissive: "#ffd27a", emissiveIntensity: 0.3, roughness: 0.4, transparent: true, opacity: 0.85 }));
            cell.position.set((ki - (T - 1) / 2) * 0.36, (qi - (T - 1) / 2) * 0.36, z);
            cell.userData.nodeId = n.id; cell.userData.cell = true;
            (cell as any).logit = ((qi * 7 + ki * 13 + h * 5) % 10) / 3;
            g.add(cell); this.pickMeshes.push(cell); grid[qi][ki] = cell;
          }
        }
        grids.push(grid);
        this.label(`head ${h + 1}`, n.pos[0], n.pos[1] + (T / 2) * 0.36 + 0.5, n.pos[2] + z, "#ffe0a0", 22);
      }
      (g as any).attn = grids;
    } else if (n.type === "ffn") {
      const FW = 4;
      for (let i = 0; i < T; i++) for (let k = 0; k < FW; k++) addSphere((k - (FW - 1) / 2) * 0.5, (i - (T - 1) / 2) * 0.5, 0, "#ff9a5c", 0.72);
    } else {
      for (let i = 0; i < T; i++) addSphere(0, (i - (T - 1) / 2) * 0.55, 0, col, 1);
    }
    return g;
  }

  // ── build / rebuild from the graph ─────────────────────────────────────
  private buildScene() {
    const isGrpo = this.plugin.settings.activeMap === "grpo";
    if (this.grpoModeBtn) this.grpoModeBtn.style.display = isGrpo ? "" : "none";
    if (isGrpo) { this.buildGrpo(); return; }

    const graph = this.plugin.graph;
    this.pickMeshes = [];

    // Stagger label heights by left-to-right rank so wide labels on adjacent
    // nodes never collide (one sits high, the next low). Generalizes to any graph.
    const ranked = [...graph.nodes].sort((a, b) => a.pos[0] - b.pos[0]);
    const rank = new Map<string, number>();
    ranked.forEach((n, i) => rank.set(n.id, i));

    for (const n of graph.nodes) {
      const col = TYPE_COLOR[n.type] ?? "#9fb8ff";
      const g = this.buildCluster(n, col);
      (g as any).p3d = { node: n, base: 1, emi: 1.7, cur: 1.4 };
      this.root.add(g);
      this.meshById.set(n.id, g);
      this.nodeMeshes.push(g);
      const yOff = (rank.get(n.id)! % 2 === 0) ? 2.2 : 3.0;
      const sprite = this.label(n.label, n.pos[0], n.pos[1] + yOff, n.pos[2], "#eef4ff", 30);
      (g as any).p3d.label = sprite;
      (g as any).p3d.yOff = yOff;
    }

    for (const e of graph.edges) {
      const a = this.meshById.get(e.from), b = this.meshById.get(e.to);
      if (!a || !b) continue;
      const skip = e.kind === "skip";
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(this.edgePoints(a.position, b.position, skip)),
        new THREE.LineBasicMaterial({
          color: skip ? "#4a5a9a" : "#7d97ff",
          transparent: true,
          opacity: skip ? 0.35 : 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      this.root.add(line);
      this.edges.push({ from: e.from, to: e.to, skip, line });
    }

    // pulses streaming along EVERY edge — the "alive" data-flow look (Attempt 2).
    this.pulseMeta = [];
    const per = 3;
    for (const e of this.edges) {
      for (let k = 0; k < per; k++) this.pulseMeta.push({ from: e.from, to: e.to, skip: e.skip, t: k / per, speed: 0.5 + Math.random() * 0.4 });
    }
    if (this.pulseMeta.length) {
      const ppos = new Float32Array(this.pulseMeta.length * 3);
      const pgeo = new THREE.BufferGeometry();
      pgeo.setAttribute("position", new THREE.BufferAttribute(ppos, 3));
      this.pulses = new THREE.Points(
        pgeo,
        new THREE.PointsMaterial({
          color: "#eafaff", size: 0.22, transparent: true, opacity: 0.95,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      this.root.add(this.pulses);
    }
  }

  private async refreshMapList() {
    if (!this.mapSel) return;
    this.mapSel.empty();
    const maps = await this.plugin.listMaps();
    for (const m of maps) {
      const o = this.mapSel.createEl("option", { text: m }) as HTMLOptionElement;
      o.value = m;
    }
    this.mapSel.value = this.plugin.settings.activeMap;
  }

  rebuild() {
    this.disposeScene();
    this.buildScene();
    this.syncActiveFile();
    void this.refreshMapList();
  }

  // ── the bespoke grpo renderer ──────────────────────────────────────────────
  private buildGrpo() {
    this.grpo = new GrpoScene(this.root, this.host);
    this.grpo.build(this.camera, this.controls);
    this.grpo.setMode(this.grpoModeForced);
    this.updateGrpoBtn();
  }

  private updateGrpoBtn() {
    if (this.grpoModeBtn) {
      const m = this.grpoModeForced;
      this.grpoModeBtn.textContent = `mode: ${m === null ? "Auto ⇄" : m === 0 ? "GRPO" : "Dr. GRPO"}`;
    }
    this.grpo?.setMode(this.grpoModeForced);
  }

  private disposeScene() {
    this.nodeMeshes = [];
    this.meshById.clear();
    this.selected = null;
    if (this.grpo) { this.grpo.dispose(); this.grpo = null; }
    this.pulses = null;
    this.path = [];
    this.pulseMeta = [];
    this.pickMeshes = [];
    this.edges = [];
    this.dragMesh = null;
    if (!this.root) return;
    this.root.traverse((o: any) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const m = o.material;
        if (m.map) m.map.dispose?.();
        m.dispose?.();
      }
    });
    this.root.clear();
  }

  // ── interaction ────────────────────────────────────────────────────────
  private nodeAt(e: PointerEvent): THREE.Object3D | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.ray.setFromCamera(this.mouse, this.camera);
    const hit = this.ray.intersectObjects(this.pickMeshes, false)[0];
    if (!hit) return null;
    const id = (hit.object as any).userData.nodeId as string;
    return this.meshById.get(id) ?? null;
  }

  private onPointerDown(e: PointerEvent) {
    this.downXY = [e.clientX, e.clientY];
    this.downButton = e.button;
    this.dragMoved = false;
    if (e.button === 1 && !this.grpo) { // node-dragging disabled on the animated grpo map
      // middle button → grab a node and move it (plane through it, facing camera)
      const hit = this.nodeAt(e);
      if (hit) {
        e.preventDefault();
        this.dragMesh = hit;
        const n = new THREE.Vector3();
        this.camera.getWorldDirection(n);
        this.dragPlane.setFromNormalAndCoplanarPoint(n, hit.position);
        this.renderer.domElement.setPointerCapture?.(e.pointerId);
      }
    }
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.dragMesh) return;
    this.dragMoved = true;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.ray.setFromCamera(this.mouse, this.camera);
    const p = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(this.dragPlane, p)) {
      this.dragMesh.position.copy(p);
      this.updateNodeVisuals(this.dragMesh);
    }
  }

  private onPointerUp(e: PointerEvent) {
    // finishing a node drag → persist the new position back to graph.json
    if (this.dragMesh) {
      const mesh = this.dragMesh;
      this.dragMesh = null;
      if (this.dragMoved) {
        const node = (mesh as any).p3d.node as GraphNode;
        node.pos = [+mesh.position.x.toFixed(2), +mesh.position.y.toFixed(2), +mesh.position.z.toFixed(2)];
        this.plugin.saveGraph();
      }
      return;
    }
    if (!this.downXY) return;
    const moved = Math.hypot(e.clientX - this.downXY[0], e.clientY - this.downXY[1]);
    this.downXY = null;
    if (moved > 5) return; // camera drag, not a click
    if (this.downButton !== 0) return; // only left-click selects / opens / connects
    if (this.grpo) {
      // grpo map: click the policy / a rollout / a bar to open its note
      const r = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      this.ray.setFromCamera(this.mouse, this.camera);
      const gid = this.grpo.pickId(this.ray);
      if (gid) this.plugin.openNote(gid);
      return;
    }
    const hit = this.nodeAt(e);
    if (!hit) { this.linkSource = null; return; }
    const id = (hit as any).p3d.node.id as string;
    if (e.shiftKey) {
      // shift-click two nodes to connect them
      if (!this.linkSource) {
        this.linkSource = id;
        this.highlight(id);
        new Notice(`Connect: now shift-click the target node (source "${id}").`);
      } else if (this.linkSource === id) {
        this.linkSource = null;
      } else {
        const src = this.linkSource;
        this.linkSource = null;
        this.plugin.connectNodes(src, id);
        new Notice(`Connected ${src} → ${id}.`);
      }
      return;
    }
    this.highlight(id);
    this.plugin.openNote(id);
  }

  private updateNodeVisuals(mesh: THREE.Mesh) {
    const p3d = (mesh as any).p3d;
    if (p3d.label) p3d.label.position.set(mesh.position.x, mesh.position.y + p3d.yOff, mesh.position.z);
    const id = p3d.node.id as string;
    for (const ed of this.edges) {
      if (ed.from !== id && ed.to !== id) continue;
      const a = this.meshById.get(ed.from), b = this.meshById.get(ed.to);
      if (a && b) ed.line.geometry.setFromPoints(this.edgePoints(a.position, b.position, ed.skip));
    }
  }

  highlight(id: string) {
    const m = this.meshById.get(id);
    if (!m) return;
    if (this.selected && this.selected !== m) (this.selected as any).p3d.emi = 1.4;
    this.selected = m;
    (m as any).p3d.emi = 3.2;
  }

  private syncActiveFile() {
    const f = this.app.workspace.getActiveFile();
    if (!f) return;
    const prefix = this.plugin.folder + "/";
    if (f.path.startsWith(prefix) && f.extension === "md") {
      const id = f.basename;
      if (this.meshById.has(id)) this.highlight(id);
    }
  }

  // ── sizing & loop ──────────────────────────────────────────────────────
  private resize() {
    if (!this.renderer) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  private animateAttn(grids: THREE.Mesh[][][], t: number) {
    const T = this.T;
    for (let h = 0; h < grids.length; h++) {
      const grid = grids[h];
      for (let qi = 0; qi < T; qi++) {
        let mx = -1e9; const e: number[] = [];
        for (let ki = 0; ki < T; ki++) {
          const lg = (grid[qi][ki] as any).logit + Math.sin(t * 0.7 + qi * 1.3 + ki * 0.9 + h * 2) * 1.2;
          e.push(lg); if (lg > mx) mx = lg;
        }
        let sum = 0; for (let ki = 0; ki < T; ki++) { e[ki] = Math.exp(e[ki] - mx); sum += e[ki]; }
        for (let ki = 0; ki < T; ki++) {
          const w = e[ki] / sum;
          const m = grid[qi][ki].material as THREE.MeshStandardMaterial;
          m.emissiveIntensity = 0.15 + w * 2.6; m.opacity = 0.4 + w * 0.6;
          grid[qi][ki].scale.setScalar(0.7 + w * 0.9);
        }
      }
    }
  }

  private frameAll() {
    if (this.grpo) { this.grpo.frame(this.camera, this.controls); return; }
    const box = new THREE.Box3();
    this.nodeMeshes.forEach((m) => box.expandByPoint(m.position));
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 10;
    this.controls.target.copy(c);
    this.camera.position.set(c.x - 2, c.y + size * 0.35, c.z + size * 0.9);
  }

  private animate = () => {
    if (this.disposed) return; // a frame queued before onClose must not touch torn-down objects
    this.raf = requestAnimationFrame(this.animate);
    const t = this.clock.getElapsedTime();
    if (this.grpo) { this.grpo.update(t); this.controls.update(); this.composer.render(); return; }
    for (const g of this.nodeMeshes) {
      const u = (g as any).p3d;
      const target = g === this.selected ? u.emi : 1.4;
      u.cur += (target - u.cur) * 0.12;
      const breath = u.cur * (0.85 + 0.3 * Math.sin(t * 2.2 + g.position.x));
      for (const ch of g.children) {
        const mm = (ch as any).material as THREE.MeshStandardMaterial | undefined;
        if (mm && mm.emissive && !ch.userData.cell) mm.emissiveIntensity = breath;
      }
      g.scale.setScalar((g === this.selected ? 1.12 : 1) * (0.98 + 0.05 * Math.sin(t * 2.6 + g.position.x)));
      const grids = (g as any).attn as THREE.Mesh[][][] | undefined;
      if (grids) this.animateAttn(grids, t);
    }
    if (this.pulses && this.pulseMeta.length) {
      const arr = (this.pulses.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), ctrl = new THREE.Vector3(), p = new THREE.Vector3();
      for (let i = 0; i < this.pulseMeta.length; i++) {
        const pm = this.pulseMeta[i];
        pm.t += pm.speed * 0.012;
        if (pm.t > 1) pm.t -= 1;
        const ma = this.meshById.get(pm.from), mb = this.meshById.get(pm.to);
        if (!ma || !mb) { arr[i * 3] = arr[i * 3 + 1] = arr[i * 3 + 2] = 0; continue; }
        a.copy(ma.position); b.copy(mb.position);
        if (pm.skip) {
          ctrl.addVectors(a, b).multiplyScalar(0.5); ctrl.y += 4.2;
          const v = 1 - pm.t;
          p.set(
            v * v * a.x + 2 * v * pm.t * ctrl.x + pm.t * pm.t * b.x,
            v * v * a.y + 2 * v * pm.t * ctrl.y + pm.t * pm.t * b.y,
            v * v * a.z + 2 * v * pm.t * ctrl.z + pm.t * pm.t * b.z
          );
        } else {
          p.lerpVectors(a, b, pm.t);
        }
        arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
      }
      (this.pulses.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    }
    this.controls.update();
    this.composer.render();
  };
}
