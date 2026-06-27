// Renders the REAL ResearchMapView with the bespoke "grpo" map active, to prove
// the GrpoScene animation draws inside the actual plugin view (not just the demo).
import { ResearchMapView } from "../../plugin/src/view";
import { DEFAULT_GRAPH } from "../../plugin/src/graph";

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

const app: any = { workspace: { on: () => ({}), getActiveFile: () => null, getLeavesOfType: () => [] } };
const leaf: any = { app };
const plugin: any = {
  graph: JSON.parse(JSON.stringify(DEFAULT_GRAPH)),
  folder: "progress3d",
  settings: { activeMap: "grpo" },           // ← the bespoke animated map
  async listMaps() { return ["grpo", "transformer-block"]; },
  async switchMap() {},
  async newMap() { return "map"; },
  openNote(id: string) { (window as any).__opened = id; },
  async saveGraph() {},
  async loadGraph() {},
};

const view: any = new (ResearchMapView as any)(leaf, plugin);
const ce: HTMLElement = view.contentEl;
ce.style.position = "fixed"; ce.style.inset = "0";
document.body.appendChild(ce);
view.onOpen();
(window as any).__view = view;

// optionally pin a mode via ?mode=grpo|dr to screenshot a specific pass
const mode = new URLSearchParams(location.search).get("mode");
if (mode) setTimeout(() => {
  view.grpoModeForced = mode === "dr" ? 1 : 0;
  view.updateGrpoBtn();
}, 200);
