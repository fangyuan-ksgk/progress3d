---
name: vault-notes
description: Save research notes/findings to the user's Obsidian vault via the progress3d MCP. Use whenever you produce something worth keeping — a finding, summary, derivation, decision, or reference — and it should persist to the user's personal knowledge base (not just the chat). Works from any agent, local or ephemeral cloud, as long as the progress3d MCP is connected.
---

# vault-notes — write to the user's Obsidian vault

The user keeps a single Obsidian vault as their second brain. The **progress3d MCP** exposes it to
you as tools (it may be backed by local disk, or by a GitHub repo over HTTPS when you're an
ephemeral cloud agent — you don't need to know which; the tools are identical). Your job: when you
produce something durable, **write it as a clean Obsidian note** instead of letting it evaporate in
the conversation.

## Tools you use (from the `progress3d` MCP)
- `search_vault(query)` — full-text search; run this FIRST to avoid duplicating an existing note.
- `list_vault(dir?, query?)` — see what's already there.
- `read_file(path)` / `append_file(path, text)` — read or extend an existing note.
- `write_file(path, content)` — create a note (parent folders auto-created). This is the main one.

If these tools aren't present, the MCP isn't connected — say so; don't pretend you saved anything.

## Where to put notes
- Default new notes under **`inbox/`** with a descriptive **kebab-case** filename, made unique so
  parallel agents never collide: `inbox/<topic>-<short-discriminator>.md`
  (e.g. `inbox/grpo-baseline-variance.md`). The user triages `inbox/` into the vault later.
- Add to an existing note with `append_file` only when it's clearly the same topic (search first).
- **Do NOT touch the 3D map** (`graph.json` / `add_node` / `connect_nodes`). It's a single shared
  file; concurrent writers corrupt it. The map is curated locally, not from cloud agents.

## Note format (Obsidian conventions)
Write real Obsidian markdown so it renders and links in the vault:
- **Frontmatter** for Dataview — at minimum:
  ```
  ---
  tags: [<topic>, source/agent]
  created: <date if you know it, else omit>
  source: <where this came from — paper, repo, this task>
  ---
  ```
- **Wiki-links** liberally: `[[Transformer]]`, `[[GRPO]]` — link concepts even if the target note
  doesn't exist yet (that's how the graph grows). Don't use bare URLs where a wiki-link fits.
- **LaTeX**: inline `$\hat{A}_i$`, display `$$ \mathcal{L} = \dots $$` (Obsidian renders MathJax).
- One idea per note. Lead with a one-line summary, then the detail. Keep it self-contained.

## Workflow
1. `search_vault` for the topic — extend an existing note if there's a clear match, else create one.
2. `write_file inbox/<topic>-<disc>.md` with frontmatter + body.
3. Tell the user exactly what path you wrote, so they can find it. If the vault is GitHub-backed,
   note that it lands in their vault after the next sync (Obsidian Git auto-pull / `git pull`).
