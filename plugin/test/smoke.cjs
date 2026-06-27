/* Runtime smoke test: load the BUNDLED main.js (not the TS source) the way
 * Obsidian would, run onload() against in-memory stubs, and assert the plugin
 * actually registers/scaffolds/loads — catching load-time crashes that tsc cannot.
 * Layer B constructs the view and runs onOpen up to WebGL (which Node lacks),
 * proving every non-rendering code path executes without throwing.
 */
const Module = require("module");
const path = require("path");

let lastModalError = null; // captures async errors thrown inside Modal.onOpen

// ── obsidian module stub ──────────────────────────────────────────────────
class TFile {}
class Notice { constructor() {} hide() {} }
class Plugin {
  constructor(app, manifest) {
    this.app = app; this.manifest = manifest;
    this._commands = []; this._views = {}; this._ribbons = []; this._tabs = [];
  }
  registerView(t, f) { this._views[t] = f; }
  addRibbonIcon(i, t, cb) { this._ribbons.push({ i, t, cb }); return {}; }
  addCommand(c) { this._commands.push(c); return c; }
  addSettingTab(t) { this._tabs.push(t); }
  registerEvent() {}
  async loadData() { return null; }
  async saveData() {}
}
class ItemView {
  constructor(leaf) { this.leaf = leaf; this.app = leaf && leaf.app; this.contentEl = el(); }
  registerEvent() {}
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = el(); } }
class Modal {
  constructor(app) { this.app = app; this.contentEl = el(); }
  open() { // Obsidian calls onOpen on open(); mirror that and capture async errors
    try { const r = this.onOpen && this.onOpen(); if (r && r.catch) r.catch((e) => { lastModalError = e; }); }
    catch (e) { lastModalError = e; }
  }
  close() { this.onClose && this.onClose(); }
}
class Setting {
  setName() { return this; } setDesc() { return this; }
  addText(cb) { cb({ setPlaceholder() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
  addButton(cb) { cb({ setButtonText() { return this; }, setCta() { return this; }, onClick() { return this; } }); return this; }
}
function normalizePath(p) { return p.replace(/\/+/g, "/"); }
async function requestUrl() { return { status: 200, json: {}, text: "" }; }

const obsidian = { Plugin, ItemView, PluginSettingTab, Modal, Setting, Notice, TFile, normalizePath, requestUrl, WorkspaceLeaf: class {}, App: class {} };
const origLoad = Module._load;
Module._load = function (request) {
  if (request === "obsidian") return obsidian;
  return origLoad.apply(this, arguments);
};

// ── DOM / browser stubs ────────────────────────────────────────────────────
function el() {
  const e = {
    style: {}, dataset: {}, textContent: "", children: [],
    empty() { this.children = []; return this; },
    addClass() { return this; }, removeClass() { return this; }, toggleClass() { return this; },
    addEventListener() {}, removeEventListener() {},
    createDiv() { const c = el(); this.children.push(c); return c; },
    createSpan(o) { const c = el(); if (o && o.text) c.textContent = o.text; this.children.push(c); return c; },
    createEl(tag, o) { const c = el(); c.tag = tag; if (o && o.text) c.textContent = o.text; this.children.push(c); return c; },
    appendChild(c) { this.children.push(c); return c; },
    setText(t) { this.textContent = t; return this; },
    remove() {},
    value: "",
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
  };
  Object.defineProperty(e, "clientWidth", { get: () => 800 });
  Object.defineProperty(e, "clientHeight", { get: () => 600 });
  let onclick = null;
  Object.defineProperty(e, "onclick", { get: () => onclick, set: (v) => { onclick = v; } });
  return e;
}
function mock2d() { return { font: "", textBaseline: "", fillStyle: "", measureText: () => ({ width: 50 }), fillText() {} }; }
function canvasLike() {
  const c = el();
  c.getContext = (t) => (t === "2d" ? mock2d() : null); // no WebGL in Node → Three throws (expected)
  c.toDataURL = () => "";
  c.width = 300; c.height = 150;
  return c;
}
global.window = global.window || {};
Object.assign(global.window, { devicePixelRatio: 1, addEventListener() {}, innerWidth: 800, innerHeight: 600 });
global.self = global.window;
global.document = { createElement: canvasLike, createElementNS: () => canvasLike(), body: el() };
global.navigator = { userAgent: "node" };
global.devicePixelRatio = 1;
global.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

// ── in-memory vault/app ────────────────────────────────────────────────────
const files = new Map();
function tfile(p) { const f = Object.create(TFile.prototype); f.path = p; f.basename = p.split("/").pop().replace(/\.md$/, ""); f.extension = p.split(".").pop(); return f; }
const adapter = {
  async exists(p) { return files.has(p); },
  async read(p) { return files.get(p); },
  async write(p, d) { files.set(p, d); },
  async mkdir() {},
  async writeBinary(p, d) { files.set(p, d); },
  async list(dir) {
    const pre = dir.replace(/\/+$/, "") + "/";
    const f = [...files.keys()].filter((k) => k.startsWith(pre) && !k.includes("::") && k.indexOf("/", pre.length) === -1);
    return { files: f, folders: [] };
  },
};
const vault = {
  adapter,
  async createFolder(p) { files.set(p + "::dir", ""); },
  getAbstractFileByPath(p) { return files.has(p) ? tfile(p) : null; },
  async create(p, d) { files.set(p, d); return tfile(p); },
  async read(f) { return files.get(f.path); },
};
function leaf() { return { app, setViewState: async () => {}, openFile: async () => {}, view: null, parent: {} }; }
const workspace = {
  _ready: [], onLayoutReady(cb) { this._ready.push(cb); },
  getLeavesOfType() { return []; }, getLeaf() { return leaf(); }, getActiveFile() { return null; },
  revealLeaf() {}, on() { return {}; }, iterateAllLeaves() {}, createLeafBySplit() { return leaf(); },
};
const app = { vault, workspace };

// ── run ────────────────────────────────────────────────────────────────────
(async () => {
  let pass = 0, fail = 0;
  const ok = (n, c) => { if (c) { pass++; console.log("  ✓", n); } else { fail++; console.log("  ✗", n); } };

  // Compile the bundle as CommonJS (package.json sets "type":"module", which
  // would otherwise make Node mis-parse the CJS bundle as ESM).
  const fs = require("fs");
  const mainPath = path.join(__dirname, "..", "main.js");
  const m = new Module(mainPath, module);
  m.filename = mainPath;
  m.paths = Module._nodeModulePaths(path.dirname(mainPath));
  m._compile(fs.readFileSync(mainPath, "utf8"), mainPath);
  const mod = m.exports;
  const PluginClass = mod.default || mod;
  ok("default export is a class", typeof PluginClass === "function");

  const plugin = new PluginClass(app, { id: "progress3d" });
  await plugin.onload();

  ok("view registered (progress3d-map)", !!plugin._views["progress3d-map"]);
  ok("commands added (>=3)", plugin._commands.length >= 3);
  ok("has generate-3d-map command", plugin._commands.some((c) => c.id === "generate-3d-map"));
  ok("settings tab registered", plugin._tabs.length >= 1);
  ok("default map scaffolded in vault", files.has("progress3d/maps/transformer-block.json"));
  ok("graph loaded with nodes", plugin.graph && plugin.graph.nodes.length > 0);
  ok("default graph has 11 nodes", plugin.graph.nodes.length === 11);
  ok("all labels reasonable (<=24 chars)", plugin.graph.nodes.every((n) => n.label.length <= 24));
  ok("layout spread (x span > 30)", (() => {
    const xs = plugin.graph.nodes.map((n) => n.pos[0]);
    return Math.max(...xs) - Math.min(...xs) > 30;
  })());

  // Layer B — construct the view and run onOpen up to WebGL.
  const view = plugin._views["progress3d-map"](leaf());
  ok("view type id correct", view.getViewType() === "progress3d-map");
  let bErr = null;
  try { await view.onOpen(); } catch (e) { bErr = e; }
  if (!bErr) {
    ok("onOpen ran fully (WebGL present)", true);
  } else {
    const webglOnly = /webgl|gl context|creating webgl|getcontext/i.test(bErr.message || "");
    ok("onOpen reached WebGL with no logic error (Node has no GL)", webglOnly);
    if (!webglOnly) console.log("     ↳ UNEXPECTED:", bErr && bErr.message);
  }

  // Lifecycle: onClose must be safe even after onOpen failed, and a stray
  // animation frame queued before close must no-op (not crash on torn-down GL).
  let closeErr = null;
  try { await view.onClose(); } catch (e) { closeErr = e; }
  ok("onClose safe after failed onOpen", !closeErr);
  ok("disposed flag set by onClose", view.disposed === true);
  let frameErr = null;
  try { view.animate(); } catch (e) { frameErr = e; }
  ok("stray frame after dispose no-ops (lifecycle guard works)", !frameErr);

  // Voice chat: the command opens a VoiceModal whose onOpen builds the UI and
  // loads the node note without throwing (the real feature, not the old stub).
  ok("has voice-node command", plugin._commands.some((c) => c.id === "voice-node"));
  const voiceCmd = plugin._commands.find((c) => c.id === "voice-node");
  lastModalError = null;
  let vErr = null;
  try { voiceCmd.callback(); } catch (e) { vErr = e; }
  await new Promise((r) => setTimeout(r, 20)); // let async onOpen settle
  ok("voice command opens chat modal without throwing", !vErr && !lastModalError);
  if (lastModalError) console.log("     ↳ voice onOpen error:", lastModalError.message);

  // Edit-the-3D-design: dragging a node persists its new position to graph.json.
  ok("plugin exposes saveGraph()", typeof plugin.saveGraph === "function");
  plugin.graph.nodes[0].pos = [1.5, -2, 3];
  await plugin.saveGraph();
  const saved = JSON.parse(files.get("progress3d/maps/transformer-block.json"));
  ok("saveGraph persists node positions", saved.nodes[0].pos.join(",") === "1.5,-2,3");

  // Authoring: add → connect → delete must mutate the graph AND persist.
  const before = plugin.graph.nodes.length;
  const newId = await plugin.addNode({ label: "Probe", type: "ffn" });
  ok("addNode adds a node", plugin.graph.nodes.length === before + 1 &&
    plugin.graph.nodes.some((n) => n.id === newId && n.label === "Probe"));
  await plugin.connectNodes(plugin.graph.nodes[0].id, newId);
  ok("connectNodes adds an edge", plugin.graph.edges.some((e) => e.to === newId));
  await plugin.connectNodes(plugin.graph.nodes[0].id, newId); // dup
  ok("connectNodes ignores duplicate edge", plugin.graph.edges.filter((e) => e.to === newId).length === 1);
  await plugin.deleteNode(newId);
  ok("deleteNode removes node + its edges",
    !plugin.graph.nodes.some((n) => n.id === newId) &&
    !plugin.graph.edges.some((e) => e.from === newId || e.to === newId));
  const persisted = JSON.parse(files.get("progress3d/maps/transformer-block.json"));
  ok("authoring persisted to active map", persisted.nodes.length === plugin.graph.nodes.length);

  // Multiple research maps: list / create / switch.
  ok("listMaps finds the seeded map", (await plugin.listMaps()).includes("transformer-block"));
  const newSlug = await plugin.newMap("My Diffusion Model");
  ok("newMap creates + switches active", plugin.settings.activeMap === newSlug && files.has(`progress3d/maps/${newSlug}.json`));
  ok("new map starts empty", plugin.graph.nodes.length === 0);
  await plugin.switchMap("transformer-block");
  ok("switchMap reloads the other map", plugin.settings.activeMap === "transformer-block" && plugin.graph.nodes.length === 11);
  ok(".active.json written for the MCP", files.has("progress3d/.active.json"));

  // Claude Code chat panel: view registered, command present, UI builds clean.
  ok("chat view registered (progress3d-chat)", !!plugin._views["progress3d-chat"]);
  ok("has open-claude-chat command", plugin._commands.some((c) => c.id === "open-claude-chat"));
  const chatView = plugin._views["progress3d-chat"](leaf());
  let chatErr = null;
  try { await chatView.onOpen(); } catch (e) { chatErr = e; }
  ok("chat view onOpen builds UI without throwing", !chatErr);
  if (chatErr) console.log("     ↳ chat onOpen error:", chatErr.message);

  console.log(`\n${fail === 0 ? "ALL PASS ✅" : "FAILURES ❌"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("SMOKE CRASHED:", e); process.exit(1); });
