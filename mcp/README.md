# progress3d MCP server

A bridge to your **Obsidian vault** for **Claude Code / Claude Desktop**. Two tool families:
the 3D research **map** (`graph.json` + node notes) and general **vault** access (read/write/
append/list/search any note, anywhere), so any agent can add content directly.

Zero dependencies — plain Node, stdio JSON-RPC.

## Enable for EVERY agent — one command
```bash
./mcp/install.sh                  # uses $PROGRESS3D_VAULT or ~/vault/TV
./mcp/install.sh /path/to/vault   # explicit vault
```
This registers the server at **user scope**, so *every* `claude` session you run on this machine
inherits it automatically — no per-agent setup. Idempotent; re-run to repoint at another vault.
(See **Many agents / cloud** below for fleets.)

## Tools
**Map** (the `progress3d/` folder; **Reload** the 3D view in Obsidian to see graph changes):
| tool | what it does |
|---|---|
| `get_graph` / `list_nodes` | scene-graph; nodes as `id [type] label` |
| `read_note` / `write_note` / `append_note` | a node's Obsidian note |
| `add_node` / `connect_nodes` / `delete_node` | grow/prune the map |

**Vault** (any note, anywhere; paths relative to the vault root, pinned inside it):
| tool | what it does |
|---|---|
| `list_vault` | list markdown files (optional subdir / substring filter) |
| `read_file` | read any file by relative path |
| `write_file` | **create/overwrite any note** (parent folders auto-created) |
| `append_file` | append to any file (creates if missing) |
| `search_vault` | full-text search; returns `file:line` matches |

Try: *"write a note to inbox/idea.md about …"*, *"search the vault for RoPE and append a summary"*,
*"add a node 'RoPE' to the map and connect it to q and k"*.

## Manual / one-off registration
```bash
claude mcp add -s user progress3d \
  -e PROGRESS3D_VAULT="$HOME/vault/TV" \
  -- node /Users/fangyuanyu/Implementation/progress3d/mcp/progress3d-mcp.mjs
```
`-s user` = all your sessions. Drop `-s user` for just the current project. Verify: `claude mcp list`.

## Many agents / cloud
MCP registration is **per host config, inherited by every agent on that host** — you do **not**
re-register per spawned agent. Two cases:
- **One persistent server holding the vault** → run `./mcp/install.sh` once (or bake it into the
  machine image / startup). Every agent on that box gets the tools. The vault files must live there.
- **Many ephemeral hosts sharing one central vault** → a per-host stdio server can't share one
  vault. Run the MCP as a **remote HTTP service** next to the vault and point agents at it with
  `claude mcp add -s user --transport http <name> <url>` baked into the image — install-once,
  no per-agent, no per-host vault copy. (HTTP transport: ask; it's a small add to this server.)

### Or project-scoped via `.mcp.json`
```json
{
  "mcpServers": {
    "progress3d": {
      "command": "node",
      "args": ["/Users/fangyuanyu/Implementation/progress3d/mcp/progress3d-mcp.mjs"],
      "env": { "PROGRESS3D_VAULT": "/Users/fangyuanyu/vault/TV" }
    }
  }
}
```

### Claude Desktop
Add the same block to `claude_desktop_config.json` (Settings → Developer → Edit Config), then restart.

## Quick self-test
```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | PROGRESS3D_VAULT="$HOME/vault/TV" node progress3d-mcp.mjs
```
