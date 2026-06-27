import { App, Modal, Setting } from "obsidian";

export interface PromptModalOpts {
  title?: string;
  desc?: string;
  placeholder?: string;
  cta?: string;
  rows?: number;
}

export class PromptModal extends Modal {
  private value = "";
  private onSubmit: (prompt: string) => void;
  private opts: PromptModalOpts;

  constructor(app: App, onSubmit: (prompt: string) => void, opts: PromptModalOpts = {}) {
    super(app);
    this.onSubmit = onSubmit;
    this.opts = opts;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.opts.title ?? "Generate 3D map from a prompt" });
    contentEl.createEl("p", {
      text: this.opts.desc ?? "Describe an architecture or algorithm. The AI emits a scene-graph and replaces the 3D map.",
      cls: "setting-item-description",
    });

    const ta = contentEl.createEl("textarea", {
      attr: { rows: String(this.opts.rows ?? 5), placeholder: this.opts.placeholder ?? "e.g. A Mixture-of-Experts transformer block with 4 experts and a top-2 router" },
    });
    ta.style.width = "100%";
    ta.addEventListener("input", () => (this.value = ta.value));
    ta.focus();

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText(this.opts.cta ?? "Generate")
          .setCta()
          .onClick(() => {
            if (!this.value.trim()) return;
            this.close();
            this.onSubmit(this.value.trim());
          })
      )
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}
