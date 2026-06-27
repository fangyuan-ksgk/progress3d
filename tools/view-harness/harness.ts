// Drives the REAL ResearchMapView (plugin/src/view.ts) in a browser, and can
// fire real synthetic gestures at it (?act=drag|add|connect|delete) so we can
// SEE that interactions actually work — not just that the data layer does.
import { ResearchMapView } from "../../plugin/src/view";
import { DEFAULT_GRAPH } from "../../plugin/src/graph";

// Obsidian augments HTMLElement with these helpers; polyfill them for the browser.
const P: any = HTMLElement.prototype;
P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); return this; };
P.addClass = function (c: string) { this.classList.add(c); return this; };
P.removeClass = function (c: string) { this.classList.remove(c); return this; };
P.toggleClass = function (c: string, v?: boolean) { this.classList.toggle(c, v); return this; };
P.setText = function (t: string) { this.textContent = t; return this; };
P.createEl = function (tag: string, o: any) {
  const e = document.createElement(tag);
  if (o) { if (o.text) e.textContent = o.text; if (o.cls) e.className = o.cls;
    if (o.attr) for (const k in o.attr) e.setAttribute(k, o.attr[k]); }
  this.appendChild(e); return e;
};
P.createDiv = function (o: any) { return this.createEl("div", o); };
P.createSpan = function (o: any) { return this.createEl("span", o); };

let view: any;

// A FAITHFUL plugin: authoring methods mutate the graph and re-render the view,
// exactly like the real plugin (which does saveGraph + refreshViews→rebuild).
const app: any = { workspace: { on: () => ({}), getActiveFile: () => null, getLeavesOfType: () => [] } };
const leaf: any = { app };
const plugin: any = {
  graph: JSON.parse(JSON.stringify(DEFAULT_GRAPH)),
  folder: "progress3d",
  settings: { activeMap: "transformer-block" },
  async listMaps() { return ["transformer-block"]; },
  async switchMap() {},
  async newMap() { return "map"; },
  openNote() {},
  async saveGraph() {},
  async loadGraph() {},
  async addNode(o: any = {}) {
    const id = "n" + (this.graph.nodes.length + 1);
    this.graph.nodes.push({ id, label: o.label || "New Node", type: o.type || "io", pos: o.pos || [0, 0, 0] });
    view.rebuild();
    return id;
  },
  async deleteNode(id: string) {
    this.graph.nodes = this.graph.nodes.filter((n: any) => n.id !== id);
    this.graph.edges = this.graph.edges.filter((e: any) => e.from !== id && e.to !== id);
    view.rebuild();
  },
  async connectNodes(a: string, b: string, kind = "flow") {
    if (a !== b && !this.graph.edges.some((e: any) => e.from === a && e.to === b)) {
      this.graph.edges.push({ from: a, to: b, kind });
      view.rebuild();
    }
  },
};

view = new (ResearchMapView as any)(leaf, plugin);
const ce: HTMLElement = view.contentEl;
ce.style.position = "fixed";
ce.style.inset = "0";
document.body.appendChild(ce);
view.onOpen();
(window as any).__view = view;

// ── synthetic gesture driver ────────────────────────────────────────────────
function screenOf(id: string) {
  const m = view.meshById.get(id);
  const v = m.position.clone().project(view.camera);
  const r = view.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
}
function pe(type: string, x: number, y: number, opts: any = {}) {
  view.renderer.domElement.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, ...opts })
  );
}
function runAct(act: string) {
  view.renderer.domElement.setPointerCapture = () => {}; // synthetic pointer can't be captured
  const btns = () => Array.from(document.querySelectorAll(".p3d-toolbar button")) as HTMLElement[];
  if (act === "drag") {
    view.editMode = true;
    const s = screenOf("attn");
    pe("pointerdown", s.x, s.y);
    pe("pointermove", s.x - 230, s.y + 150);
    pe("pointerup", s.x - 230, s.y + 150);
  } else if (act === "add") {
    btns().find((b) => (b.textContent || "").includes("＋"))?.click();
  } else if (act === "connect") {
    view.editMode = false; // so the click reaches the shift-connect branch
    const a = screenOf("q"), c = screenOf("v");
    pe("pointerdown", a.x, a.y); pe("pointerup", a.x, a.y, { shiftKey: true });
    pe("pointerdown", c.x, c.y); pe("pointerup", c.x, c.y, { shiftKey: true });
  } else if (act === "delete") {
    view.editMode = false;
    const t = screenOf("ffn");
    pe("pointerdown", t.x, t.y); pe("pointerup", t.x, t.y);
    btns().find((b) => (b.textContent || "").includes("🗑"))?.click();
  }
}
const act = new URLSearchParams(location.search).get("act");
if (act) setTimeout(() => runAct(act), 1000);
