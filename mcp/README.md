# progress3d MCP server

Exposes your 3D research map (the `progress3d/` folder in your vault — `graph.json` + node notes)
to **Claude Code / Claude Desktop** as MCP tools, so you can read and grow the map from a chat.

Zero dependencies — plain Node, stdio JSON-RPC.

## Tools
| tool | what it does |
|---|---|
| `get_graph` | full scene-graph (nodes + edges) |
| `list_nodes` | every node as `id [type] label` |
| `read_note` | read a node's Obsidian note |
| `write_note` | overwrite a node's note (markdown — LaTeX/images render in Obsidian) |
| `append_note` | append to a node's note |
| `add_node` | add a node (returns new id) |
| `connect_nodes` | add an edge between two nodes |
| `delete_node` | delete a node + its edges |

Writes land directly in the vault's `progress3d/` files; **Reload** the 3D map in Obsidian
(or reopen it) to see graph changes. Note edits show immediately in the docked Obsidian pane.

## Add it to Claude Code

```bash
claude mcp add progress3d \
  -e PROGRESS3D_VAULT="$HOME/vault/TV" \
  -- node /Users/fangyuanyu/Implementation/progress3d/mcp/progress3d-mcp.mjs
```

Point `PROGRESS3D_VAULT` at the vault folder that contains `progress3d/` (defaults to `~/vault/TV`).
Verify with `claude mcp list`, then in a Claude Code session: *"list the nodes in my research map"*,
*"read the attn note and add a section on KV-cache"*, *"add a node 'RoPE' and connect it to q and k"*.

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
