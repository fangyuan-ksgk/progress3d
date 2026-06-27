// Spawns the real Claude Code CLI in headless print mode so the in-Obsidian chat
// panel IS Claude Code (agentic, with file access + your MCP), not just the API.
// Electron GUI apps don't inherit the shell PATH, so we resolve the binary once.
const cp = require("child_process");
const fs = require("fs");

export interface ChatResult { text: string; sessionId?: string; error?: string; }

// Role injected into every chat-bar turn so the spawned `claude` boots AS the
// progress3d map agent (not a vanilla assistant) even though the vault has no CLAUDE.md.
const SYSTEM_PROMPT =
  "You are the progress3d research-map agent, running inside the user's Obsidian vault. " +
  "The vault holds a 3D map of model architectures & algorithms: nodes (each linked to a typed " +
  "`.md` note) and edges, with `progress3d/graph.json` as the source of truth. " +
  "Use the `progress3d` MCP tools (get_graph, list_nodes, read_note, write_note, append_note, " +
  "add_node, connect_nodes, delete_node) to read and edit the map directly — don't ask the user to " +
  "edit graph.json by hand. Follow vault conventions: typed notes, mandatory wiki-links between " +
  "related nodes, frontmatter for Dataview. Be concise and act on the map when asked. " +
  "Write math in Obsidian syntax: inline $...$ and display $$...$$ (not \\(...\\) or \\[...\\]), " +
  "and put ASCII diagrams in fenced code blocks so alignment is preserved.";

function run(cmd: string, args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let p: any;
    try { p = cp.spawn(cmd, args, { cwd }); }
    catch (e: any) { resolve({ code: -1, stdout: "", stderr: String(e?.message || e) }); return; }
    let out = "", err = "";
    p.stdout.on("data", (d: any) => (out += d.toString()));
    p.stderr.on("data", (d: any) => (err += d.toString()));
    p.on("error", (e: any) => resolve({ code: -1, stdout: out, stderr: String(e?.message || e) }));
    p.on("close", (code: number) => resolve({ code, stdout: out, stderr: err }));
    try { p.stdin.end(); } catch { /* ignore */ }
  });
}

let resolvedBin: string | null = null;
async function resolveBin(configured: string): Promise<string> {
  if (configured && configured !== "claude") return configured;
  if (resolvedBin) return resolvedBin;
  const candidates: string[] = [];
  try {
    const sh = process.env.SHELL || "/bin/zsh";
    const r = await run(sh, ["-lic", "command -v claude"]);
    const found = r.stdout.trim().split("\n").pop();
    if (found) candidates.push(found);
  } catch { /* ignore */ }
  const home = process.env.HOME || "";
  candidates.push(`${home}/.claude/local/claude`, "/opt/homebrew/bin/claude", "/usr/local/bin/claude");
  for (const c of candidates) { try { if (c && fs.existsSync(c)) { resolvedBin = c; return c; } } catch { /* ignore */ } }
  resolvedBin = "claude";
  return resolvedBin;
}

export async function askClaude(opts: { binPath: string; cwd: string; prompt: string; sessionId?: string }): Promise<ChatResult> {
  const bin = await resolveBin(opts.binPath || "claude");
  // Headless: stdin is closed, so no permission prompts can be answered. Run with permissions
  // bypassed so the chat bar is a true peer of the terminal session — it can edit files (repo
  // or vault), run bash, and drive the map MCP without stalling on an unanswerable prompt.
  const args = [
    "-p", opts.prompt, "--output-format", "json",
    "--append-system-prompt", SYSTEM_PROMPT,
    "--permission-mode", "bypassPermissions",
  ];
  if (opts.sessionId) args.push("--resume", opts.sessionId);
  const r = await run(bin, args, opts.cwd);
  if (r.code !== 0 && !r.stdout) {
    const hint = /ENOENT|not found/i.test(r.stderr) ? ` — couldn't find the 'claude' binary. Set its full path in Settings → Progress3D.` : "";
    return { text: "", error: (r.stderr || `claude exited with code ${r.code}`) + hint };
  }
  try {
    const j = JSON.parse(r.stdout);
    return { text: j.result ?? j.text ?? "(no result)", sessionId: j.session_id ?? opts.sessionId };
  } catch {
    return { text: r.stdout.trim() || "(no output)", sessionId: opts.sessionId };
  }
}
