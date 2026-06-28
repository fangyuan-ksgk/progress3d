#!/usr/bin/env bash
# progress3d — one-shot RunPod setup.
#
# Gives a fresh box the WHOLE stack from one command:
#   • research-pipeline + render-3d + judge-visual + vault-notes skills (research organization)
#   • progress3d MCP at user scope  (write Obsidian notes anywhere in the vault)
#   • a git clone of your vault       (push & pull)
#   • the kimi + glm agent-judge      (both via the claude harness — no extra CLI, no OAuth)
#
# A few-liner, no harder than the old `curl install.sh | bash`:
#
#   export GITHUB_TOKEN=ghp_...               # push/pull the vault
#   export GLM_API_KEY=...                     # glm judge   (z.ai)
#   export MOONSHOT_API_KEY=sk-...             # kimi judge  (Moonshot Anthropic endpoint)
#   export VAULT_REPO=you/obsidian-vault       # your vault repo (optional; default below)
#   curl -fsSL https://raw.githubusercontent.com/fangyuan-ksgk/progress3d/main/runpod-setup.sh | bash
#
# Idempotent: safe to re-run. Verifies itself at the end (see runpod-verify.sh).
set -euo pipefail
export GIT_TERMINAL_PROMPT=0   # never hang on an interactive git auth prompt — fail fast instead

REPO_GIT="${PROGRESS3D_GIT:-https://github.com/fangyuan-ksgk/progress3d}"
REPO_SRC="${PROGRESS3D_SRC:-}"                     # local path override (for testing without GitHub)
VAULT_REPO="${VAULT_REPO:-fangyuan-ksgk/obsidian-vault}"
PROG="$HOME/progress3d"
VAULT="${PROGRESS3D_VAULT:-$HOME/vault}"
log(){ printf '\033[36m[setup]\033[0m %s\n' "$*"; }

# 1 · Claude Code CLI ---------------------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  log "installing Claude Code…"; curl -fsSL https://claude.ai/install.sh | bash
fi
export PATH="$HOME/.local/bin:$PATH"
grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"

# 2 · Node >=18 (MCP server + judge) -----------------------------------------
if ! command -v node >/dev/null 2>&1; then
  log "installing Node 20…"; curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
fi

# 3 · the progress3d repo (MCP server, skills, judge) ------------------------
if [ ! -d "$PROG/.git" ] && [ ! -f "$PROG/mcp/progress3d-mcp.mjs" ]; then
  if [ -n "$REPO_SRC" ]; then log "copying progress3d from $REPO_SRC…"; mkdir -p "$PROG"; cp -R "$REPO_SRC/." "$PROG/";
  else log "cloning progress3d…"; git clone --depth 1 "$REPO_GIT" "$PROG"; fi
fi

# 4 · skills → user scope (every agent on this box gets them) ------------------
log "installing skills → ~/.claude/skills"
mkdir -p "$HOME/.claude/skills"
cp -R "$PROG/.claude/skills/." "$HOME/.claude/skills/"

# 5 · vault git clone + credentials (push & pull) -----------------------------
if [ -n "${GITHUB_TOKEN:-}" ]; then
  git config --global credential.helper store
  printf 'https://x-access-token:%s@github.com\n' "$GITHUB_TOKEN" > "$HOME/.git-credentials"; chmod 600 "$HOME/.git-credentials"
  git config --global user.name  "${GIT_NAME:-runpod-agent}"
  git config --global user.email "${GIT_EMAIL:-agent@runpod.local}"
fi
if [ ! -d "$VAULT/.git" ]; then
  log "cloning vault $VAULT_REPO…"
  if [ -n "${GITHUB_TOKEN:-}" ]; then CLONE_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/$VAULT_REPO";
  else CLONE_URL="https://github.com/$VAULT_REPO"; fi
  if git clone --depth 1 "$CLONE_URL" "$VAULT" 2>/dev/null; then
    git -C "$VAULT" remote set-url origin "https://github.com/$VAULT_REPO"   # don't leave the token in .git/config
  else
    log "vault clone failed (new/empty repo?) — starting a fresh vault"; mkdir -p "$VAULT"; git -C "$VAULT" init -q -b main
    git -C "$VAULT" remote add origin "https://github.com/$VAULT_REPO" 2>/dev/null || true
  fi
fi

# 6 · MCP at user scope — local vault mode → write_file + the agent git-pushes -
log "registering progress3d MCP (user scope)"
claude mcp remove -s user progress3d >/dev/null 2>&1 || true
claude mcp add -s user progress3d -e PROGRESS3D_VAULT="$VAULT" -- node "$PROG/mcp/progress3d-mcp.mjs"

# 7 · judge env — kimi (Moonshot) + glm (z.ai), both through the claude harness
cat > "$HOME/.progress3d-judge.env" <<ENV
export GLM_API_KEY="${GLM_API_KEY:-}"
export MOONSHOT_API_KEY="${MOONSHOT_API_KEY:-}"
export PROGRESS3D_VAULT="$VAULT"
export JUDGES="kimi,glm"
export PATH="\$HOME/.local/bin:\$PATH"
ENV
grep -q 'progress3d-judge.env' "$HOME/.bashrc" 2>/dev/null || echo 'source ~/.progress3d-judge.env' >> "$HOME/.bashrc"

log "setup complete — run:  bash $PROG/runpod-verify.sh"
