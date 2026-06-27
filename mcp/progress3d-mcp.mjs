#!/usr/bin/env node
// progress3d MCP server — a bridge to your Obsidian vault for any MCP client
// (Claude Code, Claude Desktop). Two tool families: the 3D research MAP (graph.json
// + node notes) AND general VAULT access (read/write/append/list/search any note,
// anywhere) so any agent can add content directly. Zero deps; JSON-RPC over stdio.
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

// --- general vault access (ANY file, not just the map) -------------------------------------
// Lets any agent read/add/search content anywhere in the vault. safe() pins every path inside
// VAULT so an agent can't escape with "../.." — writes stay within your vault.
const VAULT_ABS = path.resolve(VAULT);
const IGNORE = new Set([".obsidian", ".git", ".trash", "node_modules"]);
function safe(rel) {
  const p = path.resolve(VAULT_ABS, rel || "");
  if (p !== VAULT_ABS && !p.startsWith(VAULT_ABS + path.sep)) throw new Error("path escapes the vault");
  return p;
}
function walk(dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (IGNORE.has(e.name)) continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, out);
    else if (e.name.endsWith(".md")) out.push(path.relative(VAULT_ABS, fp));
  }
  return out;
}

// --- storage backend: local fs (default) OR a GitHub repo over HTTPS -----------------------
// For EPHEMERAL cloud agents: set PROGRESS3D_REPO=owner/repo + GITHUB_TOKEN and the vault file
// tools (list/read/write/append/search) write to that repo via the Contents API over HTTPS —
// no git clone, no tunnel, durable even when your laptop is asleep. Each write is one commit;
// your local vault receives them with a plain `git pull` (cron or the Obsidian-Git plugin).
// Map tools (graph.json) stay local on purpose — one shared file + many writers = merge hell;
// cloud agents should add NOTES (unique files), not do concurrent map surgery.
const GH_REPO = process.env.PROGRESS3D_REPO || "";
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const GH_BRANCH = process.env.PROGRESS3D_REPO_BRANCH || "main";
const GH_PREFIX = (process.env.PROGRESS3D_REPO_DIR || "").replace(/^\/+|\/+$/g, "");
const GH = !!(GH_REPO && GH_TOKEN);
function ghRel(rel) {
  if (String(rel).split(/[\\/]/).includes("..")) throw new Error("path escapes the repo");
  return (GH_PREFIX ? GH_PREFIX + "/" : "") + String(rel).replace(/^\/+/, "");
}
async function ghApi(method, url, body) {
  if (typeof fetch === "undefined") throw new Error("GitHub mode needs Node >= 18 (global fetch)");
  return fetch(`https://api.github.com${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "progress3d-mcp",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function ghRead(rel) {
  const r = await ghApi("GET", `/repos/${GH_REPO}/contents/${encodeURI(ghRel(rel))}?ref=${GH_BRANCH}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 140)}`);
  const j = await r.json();
  return { text: Buffer.from(j.content || "", "base64").toString("utf8"), sha: j.sha };
}
async function ghWrite(rel, text) {
  const cur = await ghRead(rel).catch(() => null);
  const r = await ghApi("PUT", `/repos/${GH_REPO}/contents/${encodeURI(ghRel(rel))}`, {
    message: `progress3d: ${cur ? "update" : "add"} ${rel}`,
    content: Buffer.from(text).toString("base64"), branch: GH_BRANCH, sha: cur?.sha,
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 140)}`);
}
async function ghListMd() {
  const r = await ghApi("GET", `/repos/${GH_REPO}/git/trees/${GH_BRANCH}?recursive=1`);
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 140)}`);
  const pre = GH_PREFIX ? GH_PREFIX + "/" : "";
  return ((await r.json()).tree || [])
    .filter((t) => t.type === "blob" && t.path.endsWith(".md") && t.path.startsWith(pre))
    .map((t) => t.path.slice(pre.length));
}

// backend-agnostic ops used by the vault file tools
async function storeRead(rel) {
  if (GH) return (await ghRead(rel))?.text ?? null;
  return fs.existsSync(safe(rel)) ? fs.readFileSync(safe(rel), "utf8") : null;
}
async function storeWrite(rel, text) {
  if (GH) return ghWrite(rel, text);
  const p = safe(rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text);
}
async function storeAppend(rel, text) {
  const cur = (await storeRead(rel)) || "";
  return storeWrite(rel, cur + (cur && !cur.endsWith("\n") ? "\n" : "") + text);
}
async function storeList(dir, query) {
  let files = GH ? await ghListMd() : walk(dir ? safe(dir) : VAULT_ABS);
  if (GH && dir) { const d = String(dir).replace(/^\/+|\/+$/g, "") + "/"; files = files.filter((f) => f.startsWith(d)); }
  if (query) { const q = String(query).toLowerCase(); files = files.filter((f) => f.toLowerCase().includes(q)); }
  return files;
}
async function storeSearch(query, limit) {
  const q = String(query).toLowerCase(); const hits = [];
  const files = GH ? await ghListMd() : walk(VAULT_ABS);
  let scanned = 0;
  for (const rel of files) {
    if (GH && scanned >= 150) { hits.push("(GitHub-mode search capped at 150 files)"); break; }
    const text = await storeRead(rel); scanned++;
    if (text == null) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) { hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 160)}`); if (hits.length >= limit) return hits; }
    }
  }
  return hits;
}

const TOOLS = [
  { name: "get_graph", description: "Return the full scene-graph (graph.json): nodes + edges.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_nodes", description: "List every node in the map as id [type] label.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "read_note", description: "Read the Obsidian note for a node.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "write_note", description: "Overwrite the Obsidian note for a node (markdown; LaTeX/images OK in Obsidian).", inputSchema: { type: "object", properties: { id: { type: "string" }, content: { type: "string" } }, required: ["id", "content"] } },
  { name: "append_note", description: "Append text to a node's note.", inputSchema: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"] } },
  { name: "add_node", description: "Add a node to the map. Returns the new id. Reload the 3D view in Obsidian to see it.", inputSchema: { type: "object", properties: { label: { type: "string" }, type: { type: "string", enum: ["io", "embed", "norm", "attn", "qkv", "val", "ffn", "res", "head"] }, id: { type: "string" }, pos: { type: "array", items: { type: "number" } } } } },
  { name: "connect_nodes", description: "Add an edge between two existing nodes.", inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, kind: { type: "string", enum: ["flow", "skip"] } }, required: ["from", "to"] } },
  { name: "delete_node", description: "Delete a node and its edges.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  // --- general vault tools (work on any note, anywhere in the vault) ---
  { name: "list_vault", description: "List markdown files anywhere in the vault. Optionally scope to a subdir or filter by a substring of the path.", inputSchema: { type: "object", properties: { dir: { type: "string" }, query: { type: "string" } } } },
  { name: "read_file", description: "Read any file in the vault by path relative to the vault root.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "write_file", description: "Create or overwrite a note anywhere in the vault (markdown; LaTeX/images render in Obsidian). Path is relative to the vault root; parent folders are created. This is how you ADD content to the vault.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "append_file", description: "Append text to any file in the vault (creates it if missing).", inputSchema: { type: "object", properties: { path: { type: "string" }, text: { type: "string" } }, required: ["path", "text"] } },
  { name: "search_vault", description: "Full-text search across all notes; returns matching files with line numbers.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
];

async function callTool(name, a = {}) {
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
    case "list_vault": {
      const files = await storeList(a.dir, a.query);
      return files.slice(0, 500).map((f) => `- ${f}`).join("\n") || "(no markdown files)";
    }
    case "read_file": {
      const t = await storeRead(a.path);
      return t == null ? `(no file at "${a.path}")` : t;
    }
    case "write_file": {
      if (!a.path) throw new Error("path required");
      await storeWrite(a.path, a.content || "");
      return `Wrote ${a.path} (${(a.content || "").length} chars)${GH ? ` → GitHub ${GH_REPO}` : ""}.`;
    }
    case "append_file": {
      if (!a.path) throw new Error("path required");
      await storeAppend(a.path, a.text || "");
      return `Appended to ${a.path}${GH ? ` → GitHub ${GH_REPO}` : ""}.`;
    }
    case "search_vault": {
      if (!a.query) throw new Error("query required");
      const hits = await storeSearch(a.query, a.limit || 50);
      return hits.join("\n") || `(no matches for "${a.query}")`;
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
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
      const text = await callTool(params.name, params.arguments || {});
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
