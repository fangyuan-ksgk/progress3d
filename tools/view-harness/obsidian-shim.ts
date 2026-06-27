// Browser stand-ins for the Obsidian APIs the plugin's view.ts imports, so the
// REAL view code can be bundled and rendered in a headless browser. This is not
// a reimplementation of the view — it only fakes the obsidian module surface.
export class ItemView {
  app: any; leaf: any; contentEl: HTMLElement;
  constructor(leaf: any) { this.leaf = leaf; this.app = leaf?.app; this.contentEl = document.createElement("div"); }
  registerEvent(_e: any) {}
}
export class Notice { constructor(msg?: string) { if (msg) console.log("[Notice]", msg); } hide() {} }
export class TFile {}
export class WorkspaceLeaf {}
export class App {}
export class Modal {
  app: any; contentEl: HTMLElement;
  constructor(app: any) { this.app = app; this.contentEl = document.createElement("div"); }
  open() {} close() {}
}
export class PluginSettingTab { constructor(public app: any, public plugin: any) {} }
export class Setting {
  constructor(_c: any) {}
  setName() { return this; } setDesc() { return this; }
  addText(cb: any) { cb({ setPlaceholder() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
  addButton(cb: any) { cb({ setButtonText() { return this; }, setCta() { return this; }, onClick() { return this; } }); return this; }
}
export function normalizePath(p: string) { return p; }
export async function requestUrl(_o: any) { return { status: 200, json: {}, text: "" }; }
