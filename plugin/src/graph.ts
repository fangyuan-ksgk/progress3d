// The scene-graph: the single source of truth for the 3D map.
// Lives in the vault at `progress3d/graph.json` and is editable by hand or by AI.
// Every node has a stable `id` → its note is `progress3d/<id>.md`.

export type NodeType =
  // transformer/algorithm sub-modules (rendered as exploded cell clusters)
  | "io" | "embed" | "norm" | "attn" | "qkv" | "val" | "ffn" | "res" | "head"
  // general research-map nodes (rendered as a single clean glowing sphere)
  | "hub" | "primary" | "doc" | "entity" | "accent" | "muted"
  // a flat dashboard CARD (report section: summary / figure / method / sources)
  | "board"
  // a label-only node (no geometry) — axis guides, captions
  | "text";

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  pos: [number, number, number];
  weight?: number;  // research sphere size (e.g. a magnitude like % gain); default 1
  sub?: string;     // board subtitle / one-line caption
}

export interface GraphEdge {
  from: string;
  to: string;
  kind?: "flow" | "skip"; // skip => high-bow residual arc
}

export interface SceneGraph {
  title: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const TYPE_COLOR: Record<NodeType, string> = {
  io: "#66e0ff",
  embed: "#f2b45c",
  norm: "#9fb8ff",
  attn: "#5b8cff",
  qkv: "#b06bff",
  val: "#39d2a0",
  ffn: "#ff9a5c",
  res: "#5fe0c0",
  head: "#e06f9c",
  // research-map node colors
  hub: "#ffd27a",      // the central subject
  primary: "#ff9a5c",  // the headline / summary
  doc: "#9fb8ff",      // a report section (figure / method / sources)
  entity: "#39d2a0",   // a domain entity
  accent: "#5b8cff",   // a highlighted entity (the answer / winner)
  muted: "#8a93a8",    // secondary / inactive
  board: "#9fb8ff",    // a dashboard card (report section)
  text: "#7f8bbf",     // a label-only node (axis guide / caption)
};

// Default scene: one transformer block, exploded into its sub-modules.
export const DEFAULT_GRAPH: SceneGraph = {
  title: "transformer-block",
  nodes: [
    { id: "input", label: "Input tokens", type: "io", pos: [-18, 0, 0] },
    { id: "ln1", label: "LayerNorm", type: "norm", pos: [-13.5, 0, 0] },
    { id: "q", label: "Q = Wq·x", type: "qkv", pos: [-9, 0, -3.2] },
    { id: "k", label: "K = Wk·x", type: "qkv", pos: [-9, 0, 0] },
    { id: "v", label: "V = Wv·x", type: "val", pos: [-9, 0, 3.2] },
    { id: "attn", label: "softmax(Q·Kᵀ/√d)", type: "attn", pos: [-3.5, 0, 0] },
    { id: "proj", label: "Σ weights · V", type: "val", pos: [1.5, 0, 0] },
    { id: "res1", label: "Wo · + residual", type: "res", pos: [6, 0, 0] },
    { id: "ln2", label: "LayerNorm", type: "norm", pos: [10.5, 0, 0] },
    { id: "ffn", label: "FFN ↑GELU↓", type: "ffn", pos: [15, 0, 0] },
    { id: "res2", label: "output", type: "res", pos: [19.5, 0, 0] },
  ],
  edges: [
    { from: "input", to: "ln1" },
    { from: "ln1", to: "q" }, { from: "ln1", to: "k" }, { from: "ln1", to: "v" },
    { from: "q", to: "attn" }, { from: "k", to: "attn" }, { from: "v", to: "attn" },
    { from: "attn", to: "proj" }, { from: "proj", to: "res1" },
    { from: "input", to: "res1", kind: "skip" },
    { from: "res1", to: "ln2" }, { from: "ln2", to: "ffn" }, { from: "ffn", to: "res2" },
    { from: "res1", to: "res2", kind: "skip" },
  ],
};

// Empty note — the filename is the only title. No frontmatter, no heading
// (the plugin matches notes by filename, not properties).
export function noteTemplate(_node: GraphNode): string {
  return "";
}
