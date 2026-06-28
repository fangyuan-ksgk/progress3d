#!/usr/bin/env node
// judge.mjs — a general multi-model VISUAL judge for Three.js renders (and any HTML/image).
//
// Why CLI agents, not vision APIs: each judge is a coding-agent CLI (kimi, and later glm/
// codex/gemini) spawned in print mode. It opens the screenshots with its OWN file tools,
// reasons against a rubric, and returns structured JSON. No API keys to manage, robust to
// model/endpoint churn, and an agent *reasons* about the image instead of one-shot classifying.
// This mirrors how the Obsidian chat bar spawns `claude -p` (plugin/src/claude-cli.ts).
//
// Usage:
//   node tools/judge/judge.mjs <file.html | image.png ...> [--intent "what it depicts"]
//   JUDGES=kimi,glm node tools/judge/judge.mjs demos/2-threejs-code.html
//
// Output: a synthesized scorecard + ranked, actionable fixes (JSON) for Claude to apply,
// then re-run to confirm the scores went up. Exit 0 always; this is advisory.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, extname, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT_TIMES = [1500, 4000, 7000]; // ms of virtual time → different motion frames & auto-rotate angles

// ---- judge registry: each entry spawns a coding-agent CLI in print mode --------------------
// add(): returns { cmd, args } given the prompt. The agent must be able to read image files.
// GLM has no native CLI; it runs THROUGH the claude harness (which we know reads images)
// pointed at z.ai's Anthropic-compatible endpoint. So GLM is a `claude -p` subprocess with a
// swapped env. Key comes from GLM_API_KEY; if not in this (non-interactive) env, pull it from
// the login shell the same way plugin/src/claude-cli.ts resolves the claude binary.
function glmKey() {
  if (process.env.GLM_API_KEY) return process.env.GLM_API_KEY;
  try { return spawnSync("zsh", ["-ic", 'printf %s "$GLM_API_KEY"'], { encoding: "utf8" }).stdout.trim(); }
  catch { return ""; }
}

const JUDGE_DEFS = {
  // kimi: local kimi-code CLI if present; else headless via Moonshot's Anthropic-compatible
  // endpoint through the claude harness (RunPod has no kimi CLI / OAuth) — set MOONSHOT_API_KEY.
  kimi: (prompt) => {
    const hasKimi = spawnSync("sh", ["-c", "command -v kimi"], { encoding: "utf8" }).stdout.trim();
    if (hasKimi && !process.env.MOONSHOT_API_KEY) return { cmd: "kimi", args: ["-p", prompt] };
    return {
      cmd: "claude", args: ["-p", prompt, "--permission-mode", "bypassPermissions"],
      env: {
        ANTHROPIC_BASE_URL: "https://api.moonshot.ai/anthropic",
        ANTHROPIC_AUTH_TOKEN: process.env.MOONSHOT_API_KEY || "",
        ANTHROPIC_API_KEY: null,
        API_TIMEOUT_MS: "300000",
      },
    };
  },
  // verified: GLM via z.ai through the claude harness. Drop ANTHROPIC_API_KEY so AUTH_TOKEN +
  // the z.ai base URL take effect (otherwise the user's own key routes to Anthropic). Default
  // server-side model mapping is multimodal enough to read images.
  glm: (prompt) => ({
    cmd: "claude", args: ["-p", prompt, "--permission-mode", "bypassPermissions"],
    env: {
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
      ANTHROPIC_AUTH_TOKEN: glmKey(),
      ANTHROPIC_API_KEY: null, // null = delete from child env
      API_TIMEOUT_MS: "300000",
    },
  }),
  // pluggable — flip on once the CLI is installed & logged in (same print-mode shape):
  codex:  (prompt) => ({ cmd: "codex",  args: ["exec", prompt] }),
  gemini: (prompt) => ({ cmd: "gemini", args: ["-p", prompt] }),
  // native claude (your own ANTHROPIC_API_KEY); least independent since claude also applies fixes.
  claude: (prompt) => ({ cmd: "claude", args: ["-p", prompt, "--permission-mode", "bypassPermissions"] }),
};

const RUBRIC = [
  "composition", "bloom_glow", "color_harmony", "label_legibility",
  "depth_layering", "motion_quality", "fidelity", "vividness",
];

function prompt(images, intent) {
  return [
    "You are a demanding 3D-graphics art director reviewing a Three.js visualization.",
    "Open and LOOK AT each of these image frames (different moments of the same animation) with your file/media reading tool:",
    ...images.map((p) => `  - ${p}`),
    intent ? `\nWhat it is meant to depict: ${intent}` : "",
    "\nHouse style it must hit: dark background + UnrealBloom, glowing nodes that breathe, additive glow lines,",
    "flowing pulses, vivid sub-module internals (NEVER abstracted into a single blob), readable labels.",
    `\nScore each criterion 1-10 (10=excellent): ${RUBRIC.join(", ")}.`,
    "Be specific and actionable — every critique needs a concrete fix a coder can apply.",
    "\nReply with ONLY a single JSON object, no prose before or after:",
    '{"scores":{' + RUBRIC.map((k) => `"${k}":<int>`).join(",") + '},',
    '"overall":<int 1-10>,',
    '"critiques":[{"severity":"high|med|low","area":"<criterion>","issue":"<what is wrong>","fix":"<concrete change>"}]}',
  ].filter(Boolean).join("\n");
}

// ---- capture: shoot N frames of an HTML file in headless Chrome -----------------------------
function capture(htmlAbs, outDir) {
  if (!existsSync(CHROME)) { console.error(`Chrome not found at ${CHROME}`); process.exit(1); }
  mkdirSync(outDir, { recursive: true });
  const shots = [];
  SHOT_TIMES.forEach((t, i) => {
    const out = resolve(outDir, `frame-${i}.png`);
    spawnSync(CHROME, [
      "--headless=new", "--hide-scrollbars",
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--window-size=1600,900", `--virtual-time-budget=${t}`,
      `--screenshot=${out}`, `file://${htmlAbs}`,
    ], { stdio: "ignore" });
    const bytes = existsSync(out) ? statSync(out).size : 0;
    if (bytes > 20000) { shots.push(out); console.error(`  captured frame-${i}.png (${bytes}b) ✓`); }
    else console.error(`  frame-${i}.png near-blank (${bytes}b) ✗ — render may be broken`);
  });
  return shots;
}

// ---- run one judge: spawn its CLI, capture stdout, extract the JSON object ------------------
function runJudge(name, images, intent) {
  const def = JUDGE_DEFS[name];
  if (!def) return Promise.resolve({ name, error: `unknown judge '${name}'` });
  const { cmd, args, env } = def(prompt(images, intent));
  const childEnv = { ...process.env };
  for (const [k, v] of Object.entries(env || {})) { if (v == null) delete childEnv[k]; else childEnv[k] = v; }
  if (name === "glm" && !childEnv.ANTHROPIC_AUTH_TOKEN) {
    return Promise.resolve({ name, error: "GLM_API_KEY not found in env or ~/.zshrc" });
  }
  return new Promise((res) => {
    let p;
    try { p = spawn(cmd, args, { cwd: resolve(HERE, "../.."), env: childEnv }); }
    catch (e) { return res({ name, error: String(e?.message || e) }); }
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => res({ name, error: String(e?.message || e) }));
    p.on("close", () => {
      const m = out.match(/\{[\s\S]*\}/);
      if (!m) return res({ name, error: `no JSON in output: ${(err || out).slice(-200)}` });
      try { res({ name, ...JSON.parse(m[0]) }); }
      catch (e) { res({ name, error: `bad JSON: ${String(e?.message || e)}` }); }
    });
    try { p.stdin.end(); } catch { /* ignore */ }
  });
}

// ---- synthesize: average scores, merge critiques, surface disagreement ----------------------
function synthesize(results) {
  const ok = results.filter((r) => r.scores);
  const avg = {};
  for (const k of RUBRIC) {
    const xs = ok.map((r) => r.scores[k]).filter((n) => Number.isFinite(n));
    avg[k] = xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null;
  }
  const overall = ok.map((r) => r.overall).filter(Number.isFinite);
  const sev = { high: 0, med: 1, low: 2 };
  const critiques = ok.flatMap((r) => (r.critiques || []).map((c) => ({ judge: r.name, ...c })))
    .sort((a, b) => (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3));
  return {
    judges: results.map((r) => ({ name: r.name, overall: r.overall ?? null, error: r.error ?? null })),
    avg_scores: avg,
    overall_avg: overall.length ? +(overall.reduce((a, b) => a + b, 0) / overall.length).toFixed(1) : null,
    weakest: Object.entries(avg).filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([k, v]) => `${k} (${v})`),
    critiques,
  };
}

// ---- main ----------------------------------------------------------------------------------
const argv = process.argv.slice(2);
let intent = "";
const inputs = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--intent") { intent = argv[++i] || ""; }
  else inputs.push(argv[i]);
}
if (!inputs.length) { console.error("usage: judge.mjs <file.html | image.png ...> [--intent \"...\"]"); process.exit(1); }

let images = [];
const first = resolve(inputs[0]);
if (extname(first).toLowerCase() === ".html") {
  console.error(`capturing frames of ${basename(first)} …`);
  images = capture(first, resolve(HERE, "shots", basename(first, ".html")));
} else {
  images = inputs.map((p) => resolve(p)).filter((p) => existsSync(p));
}
if (!images.length) { console.error("no usable frames/images (render broken or files missing)"); process.exit(1); }

const enabled = (process.env.JUDGES || "kimi").split(",").map((s) => s.trim()).filter(Boolean);
console.error(`judging with: ${enabled.join(", ")} …  (${images.length} frame(s))`);
const results = await Promise.all(enabled.map((n) => runJudge(n, images, intent)));
const report = synthesize(results);
console.log(JSON.stringify(report, null, 2));
