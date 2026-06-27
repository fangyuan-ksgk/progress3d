---
name: judge-visual
description: Critique and improve a visual artifact (a Three.js render, the plugin view, any HTML/image) with a panel of independent model judges (Kimi, GLM, …), then apply the fixes and re-judge. Use after generating or changing a 3D render, or whenever you want an objective second/third opinion on how something LOOKS.
---

# judge-visual — multi-model visual critique panel

Pixels, not prose. A render can pass the smoke test, run with no console errors, and still look
bad. This skill captures what's actually on screen and has **several independent coding-agent CLIs
look at it** (different model families → different blind spots), scores it against a house rubric,
and returns ranked, actionable fixes. You then apply them and re-run until scores plateau.

This is the strong form of the `render-3d` verify step: don't just check it *renders* — judge
whether it's *good*, and improve it.

## Why CLI agents, not vision APIs
Each judge is a coding-agent CLI spawned in print mode that opens the screenshots with its own
file tools and reasons against the rubric. No API keys to store/rotate, robust to model/endpoint
churn, and an agent *reasons* about the image instead of one-shot classifying. Same pattern as the
Obsidian chat bar spawning `claude -p` (`plugin/src/claude-cli.ts`).

## Run it
```bash
# judge an HTML render (auto-captures 3 frames at different animation times / auto-rotate angles)
node tools/judge/judge.mjs demos/2-threejs-code.html --intent "exploded transformer block"

# judge existing image(s) directly
node tools/judge/judge.mjs tools/render-proof/vivid.png --intent "..."

# pick the panel (default: kimi)
JUDGES=kimi,glm node tools/judge/judge.mjs <file.html> --intent "..."
```
Output is one JSON object on stdout: `avg_scores`, `overall_avg`, `weakest` (the 3 lowest
criteria — fix these first), and `critiques[]` (`{judge, severity, area, issue, fix}`, sorted
high→low). Capture logs go to stderr.

## The judges (registry in `tools/judge/judge.mjs`)
- **kimi** — `kimi -p` (kimi-code). Verified: reads images via `ReadMediaFile`. Highest visual
  fidelity of the two. Note: `-p` cannot combine with `-y`/`--auto` (print mode auto-handles perms).
- **glm** — runs THROUGH the `claude` harness pointed at z.ai's Anthropic-compatible endpoint
  (`ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`, `ANTHROPIC_AUTH_TOKEN=$GLM_API_KEY`,
  `ANTHROPIC_API_KEY` deleted so the user's own key doesn't hijack it). Key is read from env or
  pulled from the login shell (`~/.zshrc`). GLM sees images but confabulates more than Kimi —
  weight its specifics lower; it's valuable for divergent ideas, not pixel-accurate readings.
- **codex / gemini / claude** — stubbed in the registry; flip on when the CLI is installed/logged in.

## The loop (how to use the output)
1. Run the judge on the artifact with a clear `--intent`.
2. Read `weakest` + the `high`-severity critiques. Where judges agree = strong signal; where they
   disagree = a judgment call you make.
3. Apply concrete `fix`es to the source (edit the HTML / `view.ts`).
4. Re-run. Confirm `overall_avg` and the weak criteria went UP. Stop when scores plateau or you've
   hit a round budget. Don't claim improvement you didn't measure — show the before/after scores.

## Rubric (criteria scored 1-10)
composition · bloom_glow · color_harmony · label_legibility · depth_layering · motion_quality ·
fidelity (to the thing being diagrammed) · vividness (house rule: never abstract a module into a
blob). Edit `RUBRIC`/`prompt()` in `judge.mjs` to retune.

## Caveats
- **Capture is macOS headless Chrome** (`/Applications/Google Chrome.app`), same engine as
  `tools/render-check.sh`. Animated motion is sampled as keyframes (these CLIs take images, not
  video), so judge motion from the frame deltas, not a single still.
- **Cost/latency**: one agent invocation per judge per run; GLM is slower. Fine on-demand.
- Screenshots land in `tools/judge/shots/` (gitignored).
