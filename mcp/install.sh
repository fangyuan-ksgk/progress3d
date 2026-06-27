#!/usr/bin/env bash
# Enable EVERY Claude Code agent (any project, any directory) to read & add content to your
# Obsidian vault — one command. Registers the progress3d MCP server at USER scope, which Claude
# inherits in all sessions. Idempotent: re-run any time (e.g. to point at a different vault).
#
#   ./mcp/install.sh                  # uses $PROGRESS3D_VAULT or ~/vault/TV
#   ./mcp/install.sh /path/to/vault   # explicit vault (folder that holds your notes)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER="$DIR/progress3d-mcp.mjs"
VAULT="${1:-${PROGRESS3D_VAULT:-$HOME/vault/TV}}"

if ! command -v claude >/dev/null 2>&1; then echo "✗ 'claude' CLI not found on PATH"; exit 1; fi
if ! command -v node   >/dev/null 2>&1; then echo "✗ 'node' not found on PATH";       exit 1; fi
if [ ! -d "$VAULT" ]; then echo "✗ vault folder not found: $VAULT"; exit 1; fi

# Re-register cleanly so this is safe to run repeatedly.
claude mcp remove -s user progress3d >/dev/null 2>&1 || true
claude mcp add -s user progress3d -e PROGRESS3D_VAULT="$VAULT" -- node "$SERVER"

# Also install the vault-notes SKILL user-scope, so every agent knows HOW to use the tools
# (conventions: where to put notes, frontmatter, wiki-links, don't touch the map). The MCP gives
# tools; the skill gives know-how. Bake this whole script into a cloud image to get both per-image.
SKILL_SRC="$DIR/../.claude/skills/vault-notes"
SKILL_DST="$HOME/.claude/skills/vault-notes"
if [ -d "$SKILL_SRC" ]; then
  mkdir -p "$SKILL_DST" && cp "$SKILL_SRC/SKILL.md" "$SKILL_DST/SKILL.md" && echo "  installed skill: vault-notes → $SKILL_DST"
fi

echo "✓ Every Claude agent can now reach your vault: $VAULT"
echo "  Tools: map (get_graph/add_node/…) + vault (list_vault/read_file/write_file/append_file/search_vault)"
echo "  Skill: vault-notes (how to save notes the Obsidian way)"
echo
claude mcp list 2>/dev/null | grep -i progress3d || echo "  (run 'claude mcp list' to verify)"
echo
echo "Try in any Claude session:  \"write a note to inbox/idea-$(whoami).md saying hello from the MCP\""
