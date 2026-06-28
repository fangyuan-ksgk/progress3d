#!/usr/bin/env bash
# Observable proof the setup actually works. Each check RUNS the capability and prints
# what happened — trust this output, not anyone's claims. Exit 0 only if all (non-skipped) pass.
set -uo pipefail
PROG="${PROGRESS3D_HOME:-$HOME/progress3d}"; VAULT="${PROGRESS3D_VAULT:-$HOME/vault}"
export PATH="$HOME/.local/bin:$PATH"
pass=0; fail=0
chk(){ if eval "$2" >/tmp/chk.$$ 2>&1; then echo "  PASS  $1"; pass=$((pass+1));
       else echo "  FAIL  $1"; sed 's/^/        | /' /tmp/chk.$$ | head -4; fail=$((fail+1)); fi; }

echo "== 1 · Claude + MCP =="
chk "claude on PATH"             "command -v claude"
chk "progress3d MCP registered"  "claude mcp list 2>/dev/null | grep -qi progress3d"

echo "== 2 · Skills (research organization) =="
for s in research-pipeline render-3d judge-visual vault-notes; do
  chk "skill: $s" "test -f \"$HOME/.claude/skills/$s/SKILL.md\""
done

echo "== 3 · Write an Obsidian note via the MCP (watch the file appear) =="
NOTE="inbox/runpod-verify-$RANDOM.md"
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
 "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"write_file\",\"arguments\":{\"path\":\"$NOTE\",\"content\":\"# RunPod verify\\nwritten through the MCP\"}}}" \
 | PROGRESS3D_VAULT="$VAULT" node "$PROG/mcp/progress3d-mcp.mjs" >/tmp/mcp.$$ 2>&1
chk "note written to vault"      "test -f \"$VAULT/$NOTE\""
[ -f "$VAULT/$NOTE" ] && echo "        | $(head -1 "$VAULT/$NOTE")"

echo "== 4 · Push & pull =="
if git -C "$VAULT" remote get-url origin >/dev/null 2>&1; then
  git -C "$VAULT" add -A >/dev/null 2>&1
  git -C "$VAULT" commit -q -m "runpod verify $NOTE" >/dev/null 2>&1 || true
  chk "git push"  "git -C \"$VAULT\" push origin HEAD"
  chk "git pull"  "git -C \"$VAULT\" pull --no-edit --no-rebase"
else echo "  SKIP  no vault git remote (set GITHUB_TOKEN + VAULT_REPO)"; fi

echo "== 5 · Agent judge (kimi + glm) =="
if [ -n "${GLM_API_KEY:-}${MOONSHOT_API_KEY:-}" ]; then
  chk "judge.mjs returns a scorecard" \
      "node \"$PROG/tools/judge/judge.mjs\" \"$PROG/tools/render-proof/vivid.png\" --intent 'self-test' 2>/dev/null | grep -q avg_scores"
else echo "  SKIP  no judge keys (set GLM_API_KEY / MOONSHOT_API_KEY)"; fi

echo; echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
