---
name: render-3d
description: Generate a vivid, animated Three.js 3D diagram of a model architecture or algorithm as a self-contained HTML file, then serve and open it. Use whenever the user wants to visualize/render an architecture, algorithm, data structure, or research concept in 3D in this repo.
---

# render-3d — vivid Three.js architecture diagrams

Produce ONE self-contained `.html` file (CDN imports, no build step), serve it on a local
port, and `open` it. Match the house visual language below. Never abstract a module into a
single blob — **unfold its internals** (the whole point is vivid detail).

## Reference implementations (read before writing)
- `demos/2-threejs-code.html` — **the canonical style**: glowing nodes, additive lines,
  flowing pulses, per-head softmax grids, FFN up/GELU/down, residual skip arcs. Copy its scaffold.
- `demos/1-scene-graph.html` — clean structured spec → primitives + JSON side panel.
- `demos/4-bbycroft-style.html` — InstancedMesh tensor-cell grids when you need thousands of cells.
- `demos/5-notes.html` — how nodes carry stable ids and bind to notes (keep this contract).

## Technical scaffold (always)
- `<script type="importmap">` → `three@0.160.0` + `three/addons/`.
- Renderer: `antialias`, `setPixelRatio(min(dpr,2))`, `ACESFilmicToneMapping`, exposure ~1.1.
- `EffectComposer` + `RenderPass` + `UnrealBloomPass` (strength ~0.85, radius ~0.55, threshold ~0.16).
- `OrbitControls` with `enableDamping`; gentle `autoRotate` for hero shots.
- Labels = canvas-texture `Sprite`s (`depthTest:false`, `renderOrder` high). No font loaders.
- Large cell grids → `InstancedMesh` with per-instance colors; everything else individual meshes.

## Visual language
- Background `#03040a`–`#070a12` + `FogExp2(~0.018)`.
- Nodes: `Icosahedron` with `emissive:color, emissiveIntensity~1.3`; **breathe** (scale + emissive sin).
- Connections: `LineBasicMaterial` `AdditiveBlending`, opacity 0.15–0.35; residual skips = high-bow beziers.
- Flow: `Points` riding polyline paths down the residual stream (white, additive).
- Live compute: animate the actual math — e.g. attention = T×T cell grid with **per-row softmax recomputed every frame** (brightness/scale = weight).

## Scene-graph contract (required)
Define an explicit `nodes` array; every node has a **stable string `id`**, `label`, `type`, `pos`.
Color by `type` (io/norm/attn/ffn/res/embed). These ids are the anchor for notes + voice-chat —
never render a meaningful module without one. Expose the array so other tooling can read it.

## Color palette
tokens/residual `#66e0ff` · norm `#9fb8ff` · Q `#5b8cff` · K `#b06bff` · V `#39d2a0` ·
attention weights `#ffd27a` · ffn/GELU `#ff9a5c` · output `#5fe0c0` · residual line `#3a4a7a`.

## Finish
Write under `demos/` (or the path the user gives), then:
`python3 -m http.server 8731` (reuse if already up) and `open http://localhost:8731/<file>.html`.
Briefly describe what's on screen and which nodes are addressable.
