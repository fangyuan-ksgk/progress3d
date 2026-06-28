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
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync } from "node:fs";
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
  // kimi: local kimi-code CLI fallback (used only when no MOONSHOT/OPENROUTER key is set; the
  // keyed, headless HTTP path is handled in runJudge → httpKimiCritique).
  kimi: (prompt) => ({ cmd: "kimi", args: ["-p", prompt] }),
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

// ---- kimi headless via a direct HTTP call (no CLI, no OAuth) --------------------------------
// Prefers Kimi-For-Coding (MOONSHOT_API_KEY from kimi.com/code/console) on its OpenAI-compatible
// endpoint api.kimi.com/coding/v1 (model kimi-for-coding, vision via image_url). Falls back to
// OpenRouter's Anthropic endpoint (kimi-k2) if only OPENROUTER_API_KEY is present. Node base64-
// embeds the images; retries text-only if the model rejects them.
const b64png = (p) => { try { return readFileSync(p).toString("base64"); } catch { return null; } };
async function httpKimiCritique(images, intent) {
  if (typeof fetch === "undefined") throw new Error("HTTP judge needs Node >= 18");
  const text = prompt(images, intent);
  const kfc = process.env.MOONSHOT_API_KEY;
  if (kfc) {                       // Kimi-For-Coding — OpenAI-compatible
    const base = process.env.KIMI_BASE || "https://api.kimi.com/coding/v1";
    const model = process.env.KIMI_MODEL || "kimi-for-coding";
    const call = async (withImg) => {
      const blocks = [{ type: "text", text }];
      if (withImg) for (const p of images) { const d = b64png(p); if (d) blocks.push({ type: "image_url", image_url: { url: `data:image/png;base64,${d}` } }); }
      const r = await fetch(`${base}/chat/completions`, { method: "POST",
        headers: { Authorization: `Bearer ${kfc}`, "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 3000, messages: [{ role: "user", content: withImg ? blocks : text }] }) });
      if (!r.ok) throw new Error(`Kimi ${r.status}: ${(await r.text()).slice(0, 140)}`);
      return (await r.json()).choices?.[0]?.message?.content || "";
    };
    try { return await call(images.length > 0); } catch { return await call(false); }
  }
  const model = process.env.PROGRESS3D_KIMI_MODEL || "moonshotai/kimi-k2";  // OpenRouter — Anthropic-compatible
  const call = async (withImg) => {
    const content = [{ type: "text", text }];
    if (withImg) for (const p of images) { const d = b64png(p); if (d) content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: d } }); }
    const r = await fetch("https://openrouter.ai/api/v1/messages", { method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1600, messages: [{ role: "user", content }] }) });
    if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 120)}`);
    return ((await r.json()).content || []).map((c) => c.text || "").join("");
  };
  try { return await call(images.length > 0); } catch { return await call(false); }
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
  // kimi headless via direct HTTP: always when the Kimi-For-Coding key (MOONSHOT_API_KEY) is set;
  // else via OpenRouter when forced or there's no local kimi CLI.
  const noKimiCli = !spawnSync("sh", ["-c", "command -v kimi"], { encoding: "utf8" }).stdout.trim();
  if (name === "kimi" && (process.env.MOONSHOT_API_KEY ||
      (process.env.OPENROUTER_API_KEY && (process.env.PROGRESS3D_KIMI_BACKEND === "openrouter" || noKimiCli)))) {
    return httpKimiCritique(images, intent)
      .then((out) => { const m = out.match(/\{[\s\S]*\}/); return m ? { name, ...JSON.parse(m[0]) } : { name, error: `no JSON from kimi: ${out.slice(0, 80)}` }; })
      .catch((e) => ({ name, error: String(e?.message || e) }));
  }
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
