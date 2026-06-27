# Progress3D — 3D Research Map for Obsidian

A 3D interactive map of your research (model architectures & algorithms), rendered with
Three.js **inside Obsidian**. Click a node → its note opens in a native Obsidian pane, so
LaTeX, image drag-drop, embeds, wiki-links, backlinks, Dataview, and all your plugins just work.

## Build

```bash
cd plugin
npm install
npm run build        # type-checks, then bundles -> main.js
# or: npm run dev    # watch mode while developing
```

## Install into your vault

Copy/symlink the plugin folder (the one containing `manifest.json`, `main.js`, `styles.css`)
into your vault's plugins directory:

```bash
# from this repo root, point VAULT at your Obsidian vault:
VAULT="$HOME/path/to/YourVault"
mkdir -p "$VAULT/.obsidian/plugins/progress3d"
ln -sf "$PWD/plugin/main.js"      "$VAULT/.obsidian/plugins/progress3d/main.js"
ln -sf "$PWD/plugin/manifest.json" "$VAULT/.obsidian/plugins/progress3d/manifest.json"
ln -sf "$PWD/plugin/styles.css"   "$VAULT/.obsidian/plugins/progress3d/styles.css"
```

Then in Obsidian: **Settings → Community plugins → enable "Progress3D Research Map"**
(turn off Restricted Mode if needed). Open it from the **box ribbon icon** or the command
palette → **"Open 3D Research Map"**.

## How it works

- On load, the plugin scaffolds a `progress3d/` folder in your vault with a `graph.json`.
- `graph.json` is the **single source of truth** for the 3D scene: `nodes` (each with a stable
  `id`, `label`, `type`, `pos`) and `edges`. Edit it by hand or have an AI generate it.
- Each node `id` maps to a note `progress3d/<id>.md`. Clicking a node opens/creates that note
  in a docked pane beside the map.
- **Authoring the 3D design** from the toolbar (all changes persist to `graph.json`, keeping
  note ↔ design in sync):
  - **✎ Edit** → **drag nodes** to reposition (labels + edges follow live).
  - **＋ Node** → add a node at the camera focus; **🗑 Node** → delete the selected node + its edges.
  - **shift-click two nodes** → connect them with an edge.
  - or hand-edit `graph.json` + **⟲ Reload**.
- Selecting a note (anywhere) highlights its node in the map.

### Claude Code chat panel
- **Open Claude Code chat** (message-square ribbon / command) docks a chat panel in the right sidebar
  (minimize with the **–** button; collapse the sidebar to hide). It spawns the real `claude` CLI in
  your vault (headless print mode, `--resume` for continuity) — so it's **Claude Code**, agentic, with
  file access and your MCP, not just the API.
- **@ selection** attaches the current editor text selection (or the open note) as context.
- **📎** attaches an image; **paste** an image into the box works too.
- **✏️** opens a quick **sketch canvas** — draw a rough diagram, "Attach to chat", then prompt e.g.
  *"build the 3D map from this sketch"* — Claude Code reads the image and edits `graph.json` via the MCP.
- If the chat says it can't find `claude`, set the full binary path in **Settings → Progress3D**
  (e.g. `~/.local/bin/claude`).

### Commands
- **Open 3D Research Map**
- **Generate 3D map from a prompt (AI)** — describe an architecture/algorithm; Claude emits a
  scene-graph that replaces the map. The previous map is saved to `progress3d/graph.backup.json`.
- **Reload 3D map from graph.json** — re-read the graph after editing it
- **Voice chat with the active node** — opens a chat about the node, grounded in its note + the
  graph (via Claude), and **speaks replies aloud** (Web Speech TTS); voice input where supported.
  Swap the `speak()` / `listen()` seams in `src/voice.ts` for your own voice-model API later.

### AI generation setup
Settings → **Progress3D**: paste your **Anthropic API key** (model defaults to `claude-opus-4-8`).
Generation calls the Messages API via Obsidian's `requestUrl` (no CORS issues) and forces
schema-valid JSON with structured outputs (`output_config.format`). The system prompt enforces the
house layout: sub-modules unfolded, left→right flow on X, parallel branches on Y/Z, residuals as
`skip` edges, node `type` → color. See `src/ai.ts`.

## Vault conventions (informed by the LLM-Wiki / second-brain pattern)

These references — Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
and [obsidian-second-brain](https://github.com/eugeniughelbur/obsidian-second-brain) — treat the
vault as an **AI-maintained knowledge store**. Progress3D leans the same way, so a future
"ingest a paper → update the map" agent can maintain nodes for you:

- **`graph.json` is the index** — the catalog of every node, analogous to their `index.md`.
- **Frontmatter per note** (`node`, `type`, `tags: [progress3d]`) enables Dataview queries and
  graph filtering. Extendable with `created`, `updated`, `status`, `confidence`, `source`.
- **Mandatory `[[wiki-links]]`** between node notes — both Obsidian backlinks AND map edges.
- **Node-typed notes** (`attn`, `ffn`, `norm`, …) mirror their entity/concept/decision typing,
  so synthesis/lint passes can reason over the map.

### Roadmap hooks (not built yet)
- AI scene-graph generation: prompt → `graph.json` (the `render-3d` skill in this repo is the seed).
- "Ingest paper → add/modify nodes + edges, flag contradictions" maintenance agent.
- In-map note preview on hover; live activations on tensor nodes; voice chat per node.
