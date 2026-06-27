import { App, Modal, Notice, TFile } from "obsidian";
import type Progress3DPlugin from "./main";
import { VoiceTurn, buildChatBody, chatAboutNode, speak, listen } from "./voice";

export class VoiceModal extends Modal {
  private plugin: Progress3DPlugin;
  private nodeId: string;
  private nodeLabel = "";
  private note = "";
  private history: VoiceTurn[] = [];
  private speakReplies = true;
  private stopListen: null | (() => void) = null;
  private logEl: any;
  private input: any;

  constructor(app: App, plugin: Progress3DPlugin, nodeId: string) {
    super(app);
    this.plugin = plugin;
    this.nodeId = nodeId;
  }

  async onOpen() {
    const node = this.plugin.graph.nodes.find((n) => n.id === this.nodeId);
    this.nodeLabel = node ? node.label : this.nodeId;
    try {
      const f = this.app.vault.getAbstractFileByPath(`${this.plugin.folder}/${this.nodeId}.md`);
      if (f instanceof TFile) this.note = await this.app.vault.read(f);
    } catch { /* note may not exist yet */ }

    const c = this.contentEl;
    c.createEl("h3", { text: `🎙 Voice chat · ${this.nodeLabel}` });
    this.logEl = c.createDiv({ cls: "p3d-voicelog" });

    const row = c.createDiv({ cls: "p3d-voicerow" });
    this.input = row.createEl("input", { attr: { type: "text", placeholder: "Ask about this node…" } });
    const send = row.createEl("button", { text: "Send" });
    const mic = row.createEl("button", { text: "🎙" });
    const spk = row.createEl("button", { text: "🔊 on" });

    send.onclick = () => this.ask(this.input.value);
    this.input.addEventListener("keydown", (e: any) => { if (e.key === "Enter") this.ask(this.input.value); });
    spk.onclick = () => { this.speakReplies = !this.speakReplies; spk.setText(this.speakReplies ? "🔊 on" : "🔇 off"); };
    mic.onclick = () => {
      if (this.stopListen) { this.stopListen(); this.stopListen = null; mic.setText("🎙"); return; }
      const stop = listen((t) => { this.input.value = t; this.ask(t); }, () => { this.stopListen = null; mic.setText("🎙"); });
      if (!stop) { new Notice("Speech input isn't available here — type instead."); return; }
      this.stopListen = stop;
      mic.setText("⏺ listening…");
    };

    this.append("assistant", `Hi — ask me anything about ${this.nodeLabel}.`);
  }

  private append(role: "user" | "assistant", text: string) {
    const d = this.logEl.createDiv({ cls: `p3d-msg p3d-${role}` });
    d.setText((role === "user" ? "you: " : "") + text);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    return d;
  }

  private async ask(text: string) {
    text = (text || "").trim();
    if (!text) return;
    this.input.value = "";
    this.append("user", text);
    const pending = this.append("assistant", "…");
    try {
      const body = buildChatBody({
        model: this.plugin.settings.model,
        nodeId: this.nodeId,
        nodeLabel: this.nodeLabel,
        note: this.note,
        graph: this.plugin.graph,
        history: this.history,
        userText: text,
      });
      const reply = await chatAboutNode(body, this.plugin.settings);
      pending.setText(reply);
      this.history.push({ role: "user", text }, { role: "assistant", text: reply });
      if (this.speakReplies) speak(reply);
    } catch (e: any) {
      pending.setText("⚠ " + (e?.message || e));
    }
  }

  onClose() {
    if (this.stopListen) this.stopListen();
    const synth = (window as any).speechSynthesis;
    if (synth) synth.cancel();
    this.contentEl.empty();
  }
}
