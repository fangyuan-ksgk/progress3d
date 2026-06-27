import { App, PluginSettingTab, Setting } from "obsidian";
import type Progress3DPlugin from "./main";

export interface Progress3DSettings {
  apiKey: string;
  model: string;
  claudePath: string;
  agentCwd: string;
  activeMap: string;
}

export const DEFAULT_SETTINGS: Progress3DSettings = {
  apiKey: "",
  model: "claude-opus-4-8",
  claudePath: "claude",
  // Working dir for the chat agent. Point it at the progress3d repo so the chat bar is a true
  // peer of the terminal session: same project memory/CLAUDE.md + can edit the plugin source.
  // The map/notes are still editable from anywhere via the progress3d MCP. Empty = use the vault.
  agentCwd: "/Users/fangyuanyu/Implementation/progress3d",
  activeMap: "",
};

export class Progress3DSettingTab extends PluginSettingTab {
  plugin: Progress3DPlugin;

  constructor(app: App, plugin: Progress3DPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "Progress3D — AI scene-graph generation" });

    new Setting(containerEl)
      .setName("Anthropic API key")
      .setDesc("Used to generate 3D maps from a prompt. Stored locally in your vault.")
      .addText((t) =>
        t
          .setPlaceholder("sk-ant-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (v) => {
            this.plugin.settings.apiKey = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Claude model id for generation.")
      .addText((t) =>
        t
          .setPlaceholder("claude-opus-4-8")
          .setValue(this.plugin.settings.model)
          .onChange(async (v) => {
            this.plugin.settings.model = v.trim() || "claude-opus-4-8";
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Claude Code chat panel" });
    new Setting(containerEl)
      .setName("Claude binary path")
      .setDesc("Path to the 'claude' CLI used by the chat panel. Leave as 'claude' to auto-detect; set the full path (e.g. /opt/homebrew/bin/claude or ~/.claude/local/claude) if it isn't found.")
      .addText((t) =>
        t
          .setPlaceholder("claude")
          .setValue(this.plugin.settings.claudePath)
          .onChange(async (v) => {
            this.plugin.settings.claudePath = v.trim() || "claude";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Agent working directory")
      .setDesc("Where the chat agent runs. Point at the progress3d repo to give the bar the same project context as the terminal (memory + plugin source). Leave empty to run in the vault. The map/notes are editable from either via the MCP.")
      .addText((t) =>
        t
          .setPlaceholder("/path/to/progress3d  (empty = vault)")
          .setValue(this.plugin.settings.agentCwd)
          .onChange(async (v) => {
            this.plugin.settings.agentCwd = v.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}
