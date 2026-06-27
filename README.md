# progress3d

A 3D interactive renderer for visualizing research progression — model architectures and
algorithm designs — where every node links to an Obsidian note (and, later, a voice chat).

## The product → `plugin/` (this is the real thing)

An **Obsidian plugin**. The 3D map renders with Three.js *inside* Obsidian; clicking a node
opens its `.md` note in a native Obsidian pane, so **LaTeX, image paste, embeds, and backlinks
all work for free**. See [`plugin/README.md`](plugin/README.md) for build + install.

```bash
cd plugin
npm install
npm run build      # tsc → bundle → smoke test (must all pass)
# then symlink/copy main.js + manifest.json + styles.css into
#   <your-vault>/.obsidian/plugins/progress3d/  and enable it.
```

- `npm run build` is gated on `npm test` (`plugin/test/smoke.cjs`) — a headless runtime test that
  loads the bundle, runs `onload`, and exercises the view lifecycle. "Builds" means "loads and runs."
- The scene-graph lives in your vault at `progress3d/graph.json` (nodes + edges; node `id` → note).
- **AI generation**: command *"Generate 3D map from a prompt"* → Claude emits a scene-graph
  (`claude-opus-4-8`, structured outputs, via Obsidian `requestUrl`). Needs an Anthropic API key in
  Settings → Progress3D. The API key is **only** for this; the map + notes work fully without it.

## `demos/` — throwaway visual prototypes (not the product)

Standalone HTML opened via `python3 -m http.server 8731`. Used to pick the rendering style and
preview interactions. **Their note editor is a `marked` mock with no math engine — LaTeX does not
render there.** Real editing only happens in the Obsidian plugin.

| file | what it shows |
|---|---|
| `1-scene-graph.html` | clean structured spec → primitives + JSON panel |
| `2-threejs-code.html` | the chosen style: exploded transformer, live per-head softmax, FFN, residuals |
| `3-text-to-3d.html` | text-to-3D blobs (rejected — can't anchor notes) |
| `4-bbycroft-style.html` | tensor-cell grids + flowing thread (bbycroft.net/llm style) |
| `5-notes.html` | docked node↔note prototype (the plugin's UX, in the browser) |

## `.claude/skills/render-3d/` — the house style, for agents

A repo skill so any Claude Code agent spawned here produces a vivid Three.js diagram matching the
established look (dark + bloom, glowing nodes, additive lines, flowing pulses, sub-modules never
abstracted, stable node ids). Invoke with `/render-3d <thing to diagram>`.

## Status / roadmap

- ✅ Three.js renderer, docked node→note in Obsidian, AI scene-graph generation, headless smoke test.
- ✅ **Edit the 3D design interactively** — drag nodes (✎ Edit), ＋ add / 🗑 delete nodes,
  shift-click to connect; all persisted to `graph.json`. Still to come: rename a node's label in-view.
- ✅ **Voice chat per node** — chat grounded in the note + graph (Claude), replies spoken via Web
  Speech TTS, voice input where supported. Provider seams `speak()`/`listen()` in `plugin/src/voice.ts`
  for the user's own voice-model API.
- ⏳ Richer in-plugin node visuals (live attention/FFN internals like `demos/2`).
- ✅ **Rendering verified — including the actual plugin view.** `tools/render-check.sh` renders in
  headless Chromium (the same engine Obsidian/Electron runs on) with software WebGL and screenshots
  to `tools/render-proof/`. It renders the demos **and the real `plugin/src/view.ts`** (bundled with
  an Obsidian shim in `tools/view-harness/`) — see `plugin-view.png`: the toolbar (Reload/Frame/Edit/
  ＋Node/🗑Node) and the full map draw correctly.
- ✅ **Gestures verified visually too.** The harness fires real synthetic pointer events at the actual
  view (`?act=drag|add|connect|delete`) — screenshots confirm dragging moves a node *and its edges +
  label*, shift-click adds an edge, and ＋Node re-renders a new node (`plugin-view-{drag,add,connect}.png`).
  The only step never run from here is a literal launch in *your* Obsidian; everything else — load,
  lifecycle, rendering of the real view, and the interactions themselves — is covered.
