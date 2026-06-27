import { requestUrl } from "obsidian";
import { SceneGraph } from "./graph";

export interface AISettings {
  apiKey: string;
  model: string;
}

// JSON Schema the model is forced to emit. Mirrors SceneGraph in graph.ts.
// Structured-outputs rules: every object needs additionalProperties:false and
// all properties in `required`. No length constraints on arrays (pos = 3 nums
// is enforced via the prompt, not the schema).
const SCENE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "nodes", "edges"],
  properties: {
    title: { type: "string" },
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "type", "pos"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          type: {
            type: "string",
            enum: ["io", "embed", "norm", "attn", "qkv", "val", "ffn", "res", "head"],
          },
          pos: { type: "array", items: { type: "number" } },
        },
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "kind"],
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          kind: { type: "string", enum: ["flow", "skip"] },
        },
      },
    },
  },
};

const SYSTEM = `You are a 3D layout engine for a research-visualization tool. Given a description of a model architecture or algorithm, you emit a scene-graph that a Three.js renderer turns into a vivid 3D diagram.

Rules:
- Decompose into the SMALLEST meaningful sub-modules — never abstract a block into one node. A transformer is input/embed/norm/q/k/v/attention/proj/residual/ffn/etc., not one "transformer" node.
- Each node has a stable snake_case "id" (notes anchor to it), a SHORT "label" (aim for <= 16 characters so 3D text doesn't overlap — e.g. "Out Proj", "FFN up-GELU-down"), a "type", and a 3D "pos" of EXACTLY three numbers [x, y, z].
- Lay the main data flow left -> right along +X. Space sequential nodes ~4.5 units apart on X (labels are wide; cramped spacing makes them collide).
- Put parallel branches (e.g. Q/K/V, attention heads, experts) side by side, separated on the Y and Z axes (±2 to ±4).
- "edges" connect node ids in data-flow order. Use kind:"flow" normally; kind:"skip" for residual/skip connections (rendered as a high arc).
- Node "type" picks a color: io (tokens in/out), embed (embeddings), norm (layer/batch norm), attn (attention), qkv (Q/K projections), val (V / value), ffn (feed-forward/MLP), res (residual add), head (output head / logits). Choose the closest type.
- Keep it legible: aim for 8-20 nodes for one block; if the user asks for the whole model, show one representative block plus an "N x" worth of structure, not every layer.
- "title" is a short slug like "transformer-block" or "mixture-of-experts".

Return ONLY the scene-graph object matching the schema.`;

export async function generateSceneGraph(prompt: string, settings: AISettings): Promise<SceneGraph> {
  if (!settings.apiKey) throw new Error("No Anthropic API key set (Settings → Progress3D).");

  const body = {
    model: settings.model || "claude-opus-4-8",
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema: SCENE_SCHEMA } },
  };

  const res = await requestUrl({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    contentType: "application/json",
    headers: {
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    throw: false,
  });

  if (res.status !== 200) {
    const msg = res.json?.error?.message || res.text?.slice(0, 300) || "unknown error";
    throw new Error(`Anthropic API ${res.status}: ${msg}`);
  }

  const data = res.json;
  if (data.stop_reason === "refusal") throw new Error("The model declined this prompt.");

  const text = (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
  if (!text) throw new Error("Empty response from the model.");

  let graph: SceneGraph;
  try {
    graph = JSON.parse(text);
  } catch (e) {
    throw new Error("Model returned non-JSON output.");
  }
  if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) {
    throw new Error("Generated graph has no nodes.");
  }
  return graph;
}
