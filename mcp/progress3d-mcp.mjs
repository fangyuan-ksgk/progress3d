#!/usr/bin/env node
// progress3d MCP server — exposes the 3D research map (graph.json + node notes)
// to any MCP client (Claude Code, Claude Desktop) so you can read and grow the
// map from a conversation. Zero dependencies; speaks JSON-RPC over stdio.
//
//   PROGRESS3D_VAULT=/path/to/your/vault   (folder that contains progress3d/)
//
import fs from "fs";
import path from "path";
import readline from "readline";

const VAULT = process.env.PROGRESS3D_VAULT || process.argv[2] || path.join(process.env.HOME || ".", "vault/TV");
const FOLDER = "progress3d";
// The plugin writes progress3d/.active.json pointing at the active map; honor it
// so this server always reads/writes whatever map is open in Obsidian.
function active() {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(VAULT, FOLDER, ".active.json"), "utf8"));
    return { graph: path.join(VAULT, a.graph), notesDir: path.join(VAULT, a.notesDir || FOLDER) };
  } catch {
    return { graph: path.join(VAULT, FOLDER, "maps", "transformer-block.json"), notesDir: path.join(VAULT, FOLDER) };
  }
}
const graphPath = () => active().graph;
const notePath = (id) => path.join(active().notesDir, `${id}.md`);

const readGraph = () => { try { return JSON.parse(fs.readFileSync(graphPath(), "utf8")); } catch { return { title: "", nodes: [], edges: [] }; } };
const writeGraph = (g) => { fs.mkdirSync(path.dirname(graphPath()), { recursive: true }); fs.writeFileSync(graphPath(), JSON.stringify(g, null, 2)); };
const readNote = (id) => { try { return fs.readFileSync(notePath(id), "utf8"); } catch { return null; } };
const writeNote = (id, t) => { fs.mkdirSync(path.dirname(notePath(id)), { recursive: true }); fs.writeFileSync(notePath(id), t); };

const TOOLS = [
  { name: "get_graph", description: "Return the full scene-graph (graph.json): nodes + edges.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_nodes", description: "List every node in the map as id [type] label.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "read_note", description: "Read the Obsidian note for a node.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "write_note", description: "Overwrite the Obsidian note for a node (markdown; LaTeX/images OK in Obsidian).", inputSchema: { type: "object", properties: { id: { type: "string" }, content: { type: "string" } }, required: ["id", "content"] } },
  { name: "append_note", description: "Append text to a node's note.", inputSchema: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"] } },
  { name: "add_node", description: "Add a node to the map. Returns the new id. Reload the 3D view in Obsidian to see it.", inputSchema: { type: "object", properties: { label: { type: "string" }, type: { type: "string", enum: ["io", "embed", "norm", "attn", "qkv", "val", "ffn", "res", "head"] }, id: { type: "string" }, pos: { type: "array", items: { type: "number" } } } } },
  { name: "connect_nodes", description: "Add an edge between two existing nodes.", inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, kind: { type: "string", enum: ["flow", "skip"] } }, required: ["from", "to"] } },
  { name: "delete_node", description: "Delete a node and its edges.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
];

function callTool(name, a = {}) {
  switch (name) {
    case "get_graph": return JSON.stringify(readGraph(), null, 2);
    case "list_nodes": {
      const g = readGraph();
      return g.nodes.map((n) => `- ${n.id} [${n.type}] ${n.label}`).join("\n") || "(no nodes)";
    }
    case "read_note": {
      const t = readNote(a.id);
      return t == null ? `(no note yet for "${a.id}" — use write_note to create it)` : t;
    }
    case "write_note":
      if (!a.id) throw new Error("id required");
      writeNote(a.id, a.content || "");
      return `Wrote ${a.id}.md (${(a.content || "").length} chars).`;
    case "append_note": {
      if (!a.id) throw new Error("id required");
      const cur = readNote(a.id) || "";
      writeNote(a.id, cur + (cur && !cur.endsWith("\n") ? "\n" : "") + (a.text || ""));
      return `Appended to ${a.id}.md.`;
    }
    case "add_node": {
      const g = readGraph();
      const ids = new Set(g.nodes.map((n) => n.id));
      let id = a.id;
      if (!id) { let i = 1; while (ids.has(`n${i}`)) i++; id = `n${i}`; }
      if (ids.has(id)) throw new Error(`node "${id}" already exists`);
      g.nodes.push({ id, label: a.label || "New Node", type: a.type || "io", pos: a.pos || [0, 0, 0] });
      writeGraph(g);
      return `Added node "${id}". Reload the 3D map in Obsidian to see it.`;
    }
    case "connect_nodes": {
      const g = readGraph();
      if (!g.nodes.some((n) => n.id === a.from) || !g.nodes.some((n) => n.id === a.to)) throw new Error("from/to must be existing node ids");
      if (!g.edges.some((e) => e.from === a.from && e.to === a.to)) { g.edges.push({ from: a.from, to: a.to, kind: a.kind || "flow" }); writeGraph(g); }
      return `Connected ${a.from} → ${a.to}.`;
    }
    case "delete_node": {
      const g = readGraph();
      g.nodes = g.nodes.filter((n) => n.id !== a.id);
      g.edges = g.edges.filter((e) => e.from !== a.id && e.to !== a.id);
      writeGraph(g);
      return `Deleted node "${a.id}" and its edges.`;
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  line = line.trim();
  if (!line) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "progress3d", version: "0.1.0" } } });
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  } else if (method === "tools/call") {
    try {
      const text = callTool(params.name, params.arguments || {});
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e) {
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true } });
    }
  } else if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
  } else if (method && method.startsWith("notifications/")) {
    // notifications get no response
  } else if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
