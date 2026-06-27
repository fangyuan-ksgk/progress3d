import { Plugin, WorkspaceLeaf, TFile, Notice, normalizePath } from "obsidian";
import { ResearchMapView, VIEW_TYPE } from "./view";
import { DEFAULT_GRAPH, SceneGraph, NodeType, noteTemplate } from "./graph";
import { Progress3DSettings, DEFAULT_SETTINGS, Progress3DSettingTab } from "./settings";
import { PromptModal } from "./prompt-modal";
import { generateSceneGraph } from "./ai";
import { VoiceModal } from "./voice-modal";
import { ClaudeChatView, CHAT_VIEW_TYPE } from "./claude-chat-view";

export default class Progress3DPlugin extends Plugin {
  folder = "progress3d";
  mapsFolder = "progress3d/maps";
  graph: SceneGraph = DEFAULT_GRAPH;
  settings: Progress3DSettings = DEFAULT_SETTINGS;
  private noteLeaf: WorkspaceLeaf | null = null;

  async onload() {
    await this.loadSettings();
    await this.ensureScaffold();

    this.registerView(VIEW_TYPE, (leaf) => new ResearchMapView(leaf, this));
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ClaudeChatView(leaf, this));
    this.addSettingTab(new Progress3DSettingTab(this.app, this));

    this.addRibbonIcon("box", "Open 3D Research Map", () => this.activateView());
    this.addRibbonIcon("message-square", "Open Claude Code chat", () => this.activateChat());
    this.addCommand({ id: "open-claude-chat", name: "Open Claude Code chat", callback: () => this.activateChat() });

    this.addCommand({
      id: "open-3d-map",
      name: "Open 3D Research Map",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "generate-3d-map",
      name: "Generate 3D map from a prompt (AI)",
      callback: () => {
        if (!this.settings.apiKey) {
          new Notice("Progress3D: set your Anthropic API key in Settings first.");
          return;
        }
        new PromptModal(this.app, (prompt) => this.generateAndApply(prompt)).open();
      },
    });
    this.addCommand({
      id: "reload-3d-graph",
      name: "Reload 3D map from graph.json",
      callback: async () => {
        await this.loadGraph();
        this.refreshViews();
        new Notice("Progress3D: graph reloaded");
      },
    });
    this.addCommand({
      id: "voice-node",
      name: "Voice chat with the active node",
      callback: () => this.voiceChat(),
    });

    // Show the 3D map automatically once the workspace is ready.
    this.app.workspace.onLayoutReady(() => this.activateView());
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ── AI generation ────────────────────────────────────────────────────────
  private async generateAndApply(prompt: string) {
    const notice = new Notice("Progress3D: generating 3D map…", 0);
    try {
      const graph = await generateSceneGraph(prompt, this.settings);
      // back up the current graph before overwriting
      const gp = normalizePath(`${this.folder}/graph.json`);
      if (await this.app.vault.adapter.exists(gp)) {
        const prev = await this.app.vault.adapter.read(gp);
        await this.app.vault.adapter.write(normalizePath(`${this.folder}/graph.backup.json`), prev);
      }
      await this.app.vault.adapter.write(gp, JSON.stringify(graph, null, 2));
      this.graph = graph;
      this.refreshViews();
      await this.activateView();
      notice.hide();
      new Notice(`Progress3D: generated "${graph.title}" (${graph.nodes.length} nodes). Previous map saved to graph.backup.json.`);
    } catch (e: any) {
      notice.hide();
      new Notice(`Progress3D: ${e?.message || e}`, 8000);
      console.error("Progress3D generation failed", e);
    }
  }

  // ── vault scaffold + graph I/O ───────────────────────────────────────────
  private async ensureScaffold() {
    const ad = this.app.vault.adapter;
    if (!(await ad.exists(this.folder))) await this.app.vault.createFolder(this.folder).catch(() => {});
    if (!(await ad.exists(this.mapsFolder))) await this.app.vault.createFolder(this.mapsFolder).catch(() => {});

    let maps = await this.listMaps();
    if (maps.length === 0) {
      // migrate a legacy single graph.json if present, else seed the default
      const legacy = normalizePath(`${this.folder}/graph.json`);
      let seed: SceneGraph = DEFAULT_GRAPH;
      if (await ad.exists(legacy)) {
        try { const p = JSON.parse(await ad.read(legacy)); if (p && Array.isArray(p.nodes)) seed = p; } catch { /* ignore */ }
      }
      await ad.write(this.mapPath("transformer-block"), JSON.stringify(seed, null, 2));
      maps = await this.listMaps();
    }
    if (!this.settings.activeMap || !maps.includes(this.settings.activeMap)) {
      this.settings.activeMap = maps[0];
      await this.saveSettings();
    }
    await this.loadGraph();
    await this.writeActive();
  }

  // ── multiple research maps (progress3d/maps/<slug>.json) ─────────────────
  private mapPath(slug = this.settings.activeMap) {
    return normalizePath(`${this.mapsFolder}/${slug}.json`);
  }

  async listMaps(): Promise<string[]> {
    try {
      const res = await this.app.vault.adapter.list(this.mapsFolder);
      return res.files
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.split("/").pop()!.replace(/\.json$/, ""))
        .sort();
    } catch {
      return [];
    }
  }

  private async writeActive() {
    // a pointer file so the MCP server / Claude Code knows the active map
    const data = { map: this.settings.activeMap, graph: `${this.mapsFolder}/${this.settings.activeMap}.json`, notesDir: this.folder };
    await this.app.vault.adapter.write(normalizePath(`${this.folder}/.active.json`), JSON.stringify(data, null, 2));
  }

  async switchMap(slug: string) {
    this.settings.activeMap = slug;
    await this.saveSettings();
    await this.loadGraph();
    await this.writeActive();
    this.refreshViews();
  }

  async newMap(name: string): Promise<string> {
    const base = (name || "map").trim().toLowerCase().replace(/[^\w\-]+/g, "-").replace(/^-+|-+$/g, "") || "map";
    const existing = await this.listMaps();
    let slug = base, i = 2;
    while (existing.includes(slug)) slug = `${base}-${i++}`;
    await this.app.vault.adapter.write(this.mapPath(slug), JSON.stringify({ title: name || slug, nodes: [], edges: [] }, null, 2));
    await this.switchMap(slug);
    return slug;
  }

  // Persist the current scene-graph (e.g. after dragging a node in the view).
  async saveGraph() {
    await this.app.vault.adapter.write(this.mapPath(), JSON.stringify(this.graph, null, 2));
    await this.writeActive();
  }

  // ── authoring the 3D design (mutate graph → persist → re-render) ───────────
  private nextNodeId(): string {
    const ids = new Set(this.graph.nodes.map((n) => n.id));
    let i = 1;
    while (ids.has(`n${i}`)) i++;
    return `n${i}`;
  }

  async addNode(opts: { label?: string; type?: NodeType; pos?: [number, number, number] } = {}): Promise<string> {
    const id = this.nextNodeId();
    this.graph.nodes.push({ id, label: opts.label ?? "New Node", type: opts.type ?? "io", pos: opts.pos ?? [0, 0, 0] });
    await this.saveGraph();
    this.refreshViews();
    return id;
  }

  async deleteNode(id: string) {
    this.graph.nodes = this.graph.nodes.filter((n) => n.id !== id);
    this.graph.edges = this.graph.edges.filter((e) => e.from !== id && e.to !== id);
    await this.saveGraph();
    this.refreshViews();
  }

  async connectNodes(from: string, to: string, kind: "flow" | "skip" = "flow") {
    if (from === to) return;
    if (this.graph.edges.some((e) => e.from === from && e.to === to)) return;
    this.graph.edges.push({ from, to, kind });
    await this.saveGraph();
    this.refreshViews();
  }

  async loadGraph() {
    try {
      const raw = await this.app.vault.adapter.read(this.mapPath());
      const parsed = JSON.parse(raw) as SceneGraph;
      if (parsed && Array.isArray(parsed.nodes)) this.graph = parsed;
    } catch (e) {
      this.graph = DEFAULT_GRAPH;
    }
  }

  private refreshViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => {
      const v = l.view as ResearchMapView;
      v?.rebuild?.();
    });
  }

  // ── open the 3D view ─────────────────────────────────────────────────────
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async activateChat() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getRightLeaf(true) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  // ── open a node's note in a docked Obsidian pane ─────────────────────────
  async openNote(nodeId: string) {
    const file = await this.ensureNote(nodeId);
    if (!file) return;

    let valid = false;
    if (this.noteLeaf) {
      this.app.workspace.iterateAllLeaves((l) => {
        if (l === this.noteLeaf) valid = true;
      });
    }
    if (!valid) {
      const mapLeaf =
        this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] ?? this.app.workspace.getLeaf(false);
      this.noteLeaf = this.app.workspace.createLeafBySplit(mapLeaf, "vertical", false);
    }
    await this.noteLeaf.openFile(file, { active: true });
    this.app.workspace.revealLeaf(this.noteLeaf);
  }

  private async ensureNote(nodeId: string): Promise<TFile | null> {
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    const path = normalizePath(`${this.folder}/${nodeId}.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    try {
      return await this.app.vault.create(path, noteTemplate(node));
    } catch (e) {
      // possible race if created between check and create
      const f = this.app.vault.getAbstractFileByPath(path);
      return f instanceof TFile ? f : null;
    }
  }

  // ── voice chat ────────────────────────────────────────────────────────────
  // Working today: speaks replies via the Web Speech API (TTS) and accepts voice
  // input where available. Swap the speak()/listen() seams in src/voice.ts for
  // your own voice-model API when you have it.
  private voiceChat() {
    const f = this.app.workspace.getActiveFile();
    let id =
      f && f.path.startsWith(this.folder + "/") && f.extension === "md" ? f.basename : null;
    if (!id || !this.graph.nodes.some((n) => n.id === id)) {
      id = this.graph.nodes[0]?.id ?? null; // fall back to the first node
    }
    if (!id) {
      new Notice("Progress3D: no nodes in the map yet.");
      return;
    }
    new VoiceModal(this.app, this, id).open();
  }
}
