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

## Many agents / cloud — GitHub relay (built)
MCP registration is **per host config, inherited by every agent on that host** — you do **not**
re-register per spawned agent. For **ephemeral cloud agents** that have no local vault, the server
can write to a **GitHub repo over HTTPS** (Contents API) instead of local disk. Each write is one
commit; your laptop doesn't need to be online; distinct notes never conflict.

**On the cloud agent** (bake into the image / entrypoint — once per image, not per agent):
```bash
claude mcp add -s user progress3d \
  -e PROGRESS3D_REPO="owner/vault-inbox" \
  -e GITHUB_TOKEN="ghp_…"            \
  -e PROGRESS3D_REPO_BRANCH="main"   \  # optional, default main
  -e PROGRESS3D_REPO_DIR=""          \  # optional subfolder prefix in the repo
  -- node /path/to/mcp/progress3d-mcp.mjs
```
With `PROGRESS3D_REPO` + a token set, the **vault file tools** (`list_vault`/`read_file`/
`write_file`/`append_file`/`search_vault`) target the repo over HTTPS — no clone, no tunnel.
The token needs `contents:write` on that repo (a fine-grained PAT scoped to the one repo is ideal).

Also drop the **`vault-notes` skill** on the image so agents know *how* to write notes (conventions,
frontmatter, wiki-links, don't touch the map): `cp -r .claude/skills/vault-notes ~/.claude/skills/`.
(`./mcp/install.sh` does this for you locally; bake the same two steps into the image for the fleet.)

**Map tools stay local on purpose.** `graph.json` is one shared file; many writers = merge hell.
Cloud agents add NOTES (unique paths like `inbox/<topic>-<agent>.md`); curate the map locally.

**Always pull before push.** The relay repo has many writers — any agent (or script) that commits to
it must `git pull --no-rebase` BEFORE `git push`, or its push will be rejected on a non-fast-forward.
`runpod-verify.sh` and Obsidian Git (`pullBeforePush`) already do this; follow the same rule by hand.

**On your machine** — receive the notes by pulling the repo into your vault. Either:
- Install the **Obsidian Git** community plugin and set auto-pull (e.g. every few minutes), or
- a cron/launchd job: `git -C "$HOME/vault/TV" pull --rebase` (make the vault, or an `inbox/`
  subfolder, a clone of the relay repo).

### Alternative: one persistent host holding the vault
Run `./mcp/install.sh` once on that box (or bake it into the image). Every agent there gets the
local-disk tools and writes straight into the vault. No GitHub needed.

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
