import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer } from "obsidian";
import type Progress3DPlugin from "./main";
import { askClaude } from "./claude-cli";
import { SketchModal } from "./sketch-modal";

export const CHAT_VIEW_TYPE = "progress3d-chat";

export class ClaudeChatView extends ItemView {
  plugin: Progress3DPlugin;
  private logEl: any;
  private chipsEl: any;
  private input: any;
  private sessionId: string | undefined;
  private sel: { label: string; text: string } | null = null;
  private attachments: string[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: Progress3DPlugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() { return CHAT_VIEW_TYPE; }
  getDisplayText() { return "Claude Code"; }
  getIcon() { return "message-square"; }

  async onOpen() {
    const c = this.contentEl;
    c.empty();
    c.addClass("p3d-chat");

    const head = c.createDiv({ cls: "p3d-chat-head" });
    head.createSpan({ text: "Claude Code", cls: "p3d-chat-title" });
    const min = head.createEl("button", { text: "–", attr: { title: "Minimize" } });

    this.logEl = c.createDiv({ cls: "p3d-chat-log" });
    this.chipsEl = c.createDiv({ cls: "p3d-chat-chips" });

    const bar = c.createDiv({ cls: "p3d-chat-bar" });
    const row = bar.createDiv({ cls: "p3d-chat-row" });
    const atBtn = row.createEl("button", { text: "@ selection", attr: { title: "Attach the current text selection or open note" } });
    const imgBtn = row.createEl("button", { text: "📎", attr: { title: "Attach an image" } });
    const sketchBtn = row.createEl("button", { text: "✏️", attr: { title: "Sketch a diagram to attach" } });
    const send = row.createEl("button", { text: "Send", cls: "p3d-chat-send" });
    this.input = bar.createEl("textarea", { attr: { rows: "2", placeholder: "Message Claude Code…  (⌘↵ to send)" } });

    min.onclick = () => { this.logEl.toggleClass("p3d-collapsed"); this.chipsEl.toggleClass("p3d-collapsed"); min.setText(this.logEl.classList?.contains("p3d-collapsed") ? "▢" : "–"); };
    atBtn.onclick = () => this.captureSelection();
    imgBtn.onclick = () => this.pickImage();
    sketchBtn.onclick = () => new SketchModal(this.app, (file) => this.addImage(file)).open();
    send.onclick = () => this.send();
    this.input.addEventListener("keydown", (e: any) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); this.send(); } });
    this.input.addEventListener("paste", (e: any) => this.handlePaste(e));

    // Drag an image file anywhere onto the panel to attach it.
    c.addEventListener("dragover", (e: any) => {
      if (!this.dragHasFiles(e)) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      c.addClass("p3d-chat-dragover");
    });
    c.addEventListener("dragleave", (e: any) => { if (e.target === c) c.removeClass("p3d-chat-dragover"); });
    c.addEventListener("drop", (e: any) => this.handleDrop(e, c));

    this.renderChips();
    this.append("assistant", "Hi — I'm Claude Code, running in your vault. Select text or open a node's note, hit “@ selection”, attach images with 📎, and ask.");
  }

  private append(role: "user" | "assistant", text: string) {
    const d = this.logEl.createDiv({ cls: `p3d-chat-msg p3d-chat-${role}` });
    this.setMsg(d, role, text);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    return d;
  }

  // Assistant replies are Markdown — render them with Obsidian's own renderer so headings,
  // bold, code fences, lists, and LaTeX format instead of showing raw `##`/`**`/``` ```.
  // User turns stay plain text (no accidental formatting of what they typed).
  private setMsg(el: any, role: "user" | "assistant", text: string) {
    el.empty();
    if (role !== "assistant") { el.setText(text); return; }
    const md = this.normalizeMath(text);
    try {
      const MR: any = MarkdownRenderer;
      if (MR?.render) MR.render(this.app, md, el, this.plugin.folder || "", this);
      else if (MR?.renderMarkdown) MR.renderMarkdown(md, el, this.plugin.folder || "", this);
      else el.setText(md);
    } catch { el.setText(md); }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  // Obsidian's MathJax only renders $...$ / $$...$$. Claude frequently emits \(...\) and \[...\];
  // rewrite those to the $ form so formulas actually compile in the chat.
  private normalizeMath(s: string): string {
    return s
      .replace(/\\\[([\s\S]*?)\\\]/g, (_m, e) => `$$${e}$$`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_m, e) => `$${e}$`);
  }

  private async captureSelection() {
    const ed: any = (this.app.workspace as any).activeEditor?.editor;
    const selText: string = ed?.getSelection?.() || "";
    if (selText.trim()) {
      this.sel = { label: "selection", text: selText.trim() };
    } else {
      const f = this.app.workspace.getActiveFile();
      if (!f) { new Notice("Select some text, or open a note first."); return; }
      const body = await this.app.vault.read(f);
      this.sel = { label: f.basename, text: body };
    }
    this.renderChips();
  }

  private pickImage() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = async () => { const f = inp.files && inp.files[0]; if (f) await this.addImage(f); };
    inp.click();
  }

  private dragHasFiles(e: any): boolean {
    const t = e.dataTransfer?.types;
    return !!t && Array.from(t).includes("Files");
  }

  private async handleDrop(e: any, c: any) {
    const dt = e.dataTransfer;
    if (!dt) return;
    const imgs: File[] = [];
    if (dt.files && dt.files.length) {
      for (const f of Array.from(dt.files) as File[]) if (f.type && f.type.startsWith("image/")) imgs.push(f);
    }
    if (!imgs.length && dt.items) {
      for (const it of Array.from(dt.items) as any[]) {
        if (it.kind === "file" && it.type && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) imgs.push(f); }
      }
    }
    c.removeClass("p3d-chat-dragover");
    if (!imgs.length) { new Notice("Drop an image file to attach it."); return; }
    e.preventDefault(); e.stopPropagation();  // keep Obsidian from opening the dropped file
    for (const f of imgs) await this.addImage(f);
  }

  private async handlePaste(e: any) {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.type && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); await this.addImage(f); }
      }
    }
  }

  private async addImage(file: File) {
    const dir = `${this.plugin.folder}/.attachments`;
    if (!(await this.app.vault.adapter.exists(dir))) await this.app.vault.adapter.mkdir(dir).catch(() => {});
    const safe = (file.name || "img.png").replace(/[^\w.\-]/g, "_");
    const stamp = `${this.attachments.length}-${safe}`;
    const rel = `${dir}/img-${stamp}`;
    const buf = await file.arrayBuffer();
    await this.app.vault.adapter.writeBinary(rel, buf);
    this.attachments.push(this.absPath(rel));
    this.renderChips();
  }

  private absPath(rel: string): string {
    const a: any = this.app.vault.adapter;
    const base = a.getBasePath ? a.getBasePath() : a.basePath || ".";
    return `${base}/${rel}`;
  }
  private vaultPath(): string {
    const a: any = this.app.vault.adapter;
    return a.getBasePath ? a.getBasePath() : a.basePath || ".";
  }

  private renderChips() {
    this.chipsEl.empty();
    if (this.sel) {
      const chip = this.chipsEl.createEl("span", { cls: "p3d-chip", text: `@ ${this.sel.label}` });
      chip.createEl("span", { text: " ✕", cls: "p3d-chip-x" }).onclick = () => { this.sel = null; this.renderChips(); };
    }
    this.attachments.forEach((p, i) => {
      const chip = this.chipsEl.createEl("span", { cls: "p3d-chip", text: `📎 ${p.split("/").pop()}` });
      chip.createEl("span", { text: " ✕", cls: "p3d-chip-x" }).onclick = () => { this.attachments.splice(i, 1); this.renderChips(); };
    });
  }

  private async send() {
    const text = (this.input.value || "").trim();
    if (!text && !this.attachments.length) return;
    this.input.value = "";

    let prompt = text;
    if (this.sel) prompt = `Selected context (${this.sel.label}):\n"""\n${this.sel.text}\n"""\n\n${prompt}`;
    if (this.attachments.length) prompt += `\n\nAttached image files — read them with your Read tool:\n` + this.attachments.map((p) => `- ${p}`).join("\n");

    const tag = (this.sel ? `  @${this.sel.label}` : "") + (this.attachments.length ? `  📎×${this.attachments.length}` : "");
    this.append("user", (text || "(image)") + tag);
    const pending = this.append("assistant", "…");

    const r = await askClaude({
      binPath: this.plugin.settings.claudePath,
      cwd: this.plugin.settings.agentCwd || this.vaultPath(),
      prompt,
      sessionId: this.sessionId,
    });
    if (r.error) {
      pending.setText("⚠ " + r.error);
    } else {
      this.setMsg(pending, "assistant", r.text);
      this.sessionId = r.sessionId;
    }
    this.sel = null;
    this.attachments = [];
    this.renderChips();
  }
}
