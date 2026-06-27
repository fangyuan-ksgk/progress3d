// GrpoScene — a bespoke animated renderer for the "grpo" research map.
//
// The generic graph renderer (view.ts) draws nodes+edges from graph.json. The
// grpo map is special: instead of static nodes we play the *advantage-computation
// dynamics* of GRPO (and the Dr. GRPO debiasing) as a timed, looping animation —
// prompt → policy → a group of variable-length rollouts → reward → group baseline
// → advantage → per-token length-norm → policy gradient on every token.
//
// view.ts delegates to this when settings.activeMap === "grpo": it builds into the
// view's root group, drives a per-frame update(), owns a small DOM HUD, and answers
// pickId() so clicking the policy / a rollout still opens its note.

import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Dyn = { sp: THREE.Sprite; set(text: string, col?: string): void; vis(v: boolean): void; tex: THREE.CanvasTexture };

const COL = {
  tok: "#66e0ff", pos: "#4dff9e", neg: "#ff5a6a", rew: "#ffd27a",
  policy: "#b48bff", prompt: "#6ad0ff", mean: "#ffd27a",
};

const lens = [12, 4, 8, 6];   // |o_i| — rollout token counts (deliberately different)
const rew = [1, 0, 1, 1];     // r_i  — verifier reward (3 correct, 1 wrong)
const G = lens.length;
const mean = rew.reduce((a, b) => a + b, 0) / G;                    // 0.75
const std = Math.sqrt(rew.reduce((a, b) => a + (b - mean) * (b - mean), 0) / G); // ~0.433
const L_CONST = 8;            // Dr. GRPO constant normalizer
const advGRPO = rew.map((r) => (r - mean) / std);
const advDR = rew.map((r) => r - mean);
const gGRPO = advGRPO.map((a, i) => a / lens[i]);   // length bias lives here
const gDR = advDR.map((a) => a / L_CONST);          // length-independent

const yR = [5.0, 1.7, -1.6, -4.9];
const xStart = -8.4, dx = 0.62;

const PHASES = [
  { id: "rollouts", dur: 5.5, title: "1 · Sample a group of G rollouts",
    desc: "For one prompt q, the policy samples G completions of different lengths |oᵢ|." },
  { id: "reward", dur: 3.2, title: "2 · Verifier assigns a reward rᵢ",
    desc: "Each rollout is scored. Here r = [1, 0, 1, 1] — three correct, one wrong." },
  { id: "baseline", dur: 3.2, title: "3 · Group baseline: mean(r), std(r)",
    desc: "The group itself is the baseline — no critic network. mean(r)=0.75, std(r)≈0.43." },
  { id: "advantage", dur: 5.0, title: "4 · Advantage  Âᵢ = (rᵢ − mean)/std",
    desc: "Subtract the mean (center on zero), then divide by std (normalize spread)." },
  { id: "lengthnorm", dur: 4.0, title: "5 · Per-token weight  gᵢ = Âᵢ / |oᵢ|",
    desc: "The advantage is spread over the tokens. Long rollouts → diluted per-token push." },
  { id: "gradient", dur: 6.5, title: "6 · Policy gradient on every token",
    desc: "Every token in a rollout is pushed by gᵢ — green up (good), red down (bad)." },
];
const PASS = PHASES.reduce((a, p) => a + p.dur, 0);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeIO = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const cMix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), clamp(t, 0, 1));

export class GrpoScene {
  private root: THREE.Group;
  private host: HTMLElement;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private prevAutoRotate = true;

  private sphGeo = new THREE.IcosahedronGeometry(1, 3);
  private cellGeo = new THREE.BoxGeometry(0.5, 0.5, 0.14);

  private allNodes: THREE.Mesh[] = [];
  private rollouts: { cells: THREE.Mesh[]; xEnd: number; rLab: Dyn; gLab: Dyn }[] = [];
  private bars: { m: THREE.Mesh; vLab: Dyn; state: { val: number; color: number } }[] = [];
  private meanLine!: THREE.Mesh;
  private stdBand!: THREE.Mesh;
  private axis!: THREE.Mesh;
  private meanLab!: Dyn; private stdLab!: Dyn;

  private backFlow!: THREE.Points; private pPos!: Float32Array; private pCol!: Float32Array;
  private pSeed: { roll: number; p: number; v: number }[] = [];
  private fwdFlow!: THREE.Points; private fPos!: Float32Array;
  private fSeed: { roll: number; p: number; v: number }[] = [];

  private pickList: THREE.Mesh[] = [];

  // HUD (info only — mode is driven by the view's toolbar button via setMode)
  private hud!: HTMLElement;
  private hPhase!: HTMLElement; private hFormula!: HTMLElement; private hDesc!: HTMLElement; private hBadge!: HTMLElement;

  private modeForced: number | null = null; // null = auto-toggle each pass
  private t0 = -1;                            // timeline origin (set on first update)
  private barX = (i: number) => 8.0 + (i - (G - 1) / 2) * 1.25;
  private readonly scaleV = 2.1;
  private readonly spanX = G * 1.25 + 0.5;

  constructor(root: THREE.Group, host: HTMLElement) {
    this.root = root;
    this.host = host;
  }

  // ── small builders ────────────────────────────────────────────────────────
  private node(color: string, x: number, y: number, z: number, r = 0.5, id?: string): THREE.Mesh {
    const m = new THREE.Mesh(this.sphGeo, new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 1.3, roughness: 0.3,
    }));
    m.position.set(x, y, z); m.scale.setScalar(r); (m.userData as any).base = r;
    this.root.add(m);
    if (id) { (m.userData as any).nodeId = id; this.pickList.push(m); }
    return m;
  }

  private glowLine(p1: THREE.Vector3, p2: THREE.Vector3, color: string, opacity = 0.3) {
    const g = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({
      color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.root.add(l);
  }

  private staticLabel(text: string, x: number, y: number, z: number, col = "#b9b2e0", size = 26) {
    const c = document.createElement("canvas"); const g = c.getContext("2d")!;
    g.font = `600 ${size}px Inter, sans-serif`; const w = g.measureText(text).width;
    c.width = w + 30; c.height = size + 18; g.font = `600 ${size}px Inter, sans-serif`;
    g.fillStyle = col; g.textBaseline = "middle"; g.fillText(text, 15, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    sp.scale.set((c.width / c.height) * 0.8, 0.8, 1); sp.position.set(x, y, z); sp.renderOrder = 4;
    this.root.add(sp);
  }

  // updatable chip label — dark rounded plate so it reads on top of bloomed bars
  private dynLabel(x: number, y: number, z: number, size = 30, scale = 1): Dyn {
    const c = document.createElement("canvas"); c.width = 380; c.height = 110;
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    sp.scale.set((380 / 110) * scale, scale, 1); sp.position.set(x, y, z); sp.renderOrder = 6;
    this.root.add(sp);
    let last = "";
    return {
      sp, tex,
      set(text: string, col = "#e7e3ff") {
        const key = text + "|" + col; if (key === last) return; last = key;
        const g = c.getContext("2d")! as any; g.clearRect(0, 0, c.width, c.height);
        g.font = `700 ${size}px "SF Mono", Menlo, monospace`;
        const tw = g.measureText(text).width;
        const bw = Math.min(c.width - 6, tw + 46), bh = size + 34, bx = (c.width - bw) / 2, by = (c.height - bh) / 2;
        g.beginPath();
        if (g.roundRect) g.roundRect(bx, by, bw, bh, 16); else g.rect(bx, by, bw, bh);
        g.fillStyle = "rgba(5,7,14,0.82)"; g.fill();
        g.lineWidth = 2; g.strokeStyle = col; g.globalAlpha = 0.5; g.stroke(); g.globalAlpha = 1;
        g.shadowBlur = 0; g.fillStyle = col; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(text, c.width / 2, c.height / 2 + 1);
        tex.needsUpdate = true;
      },
      vis(v: boolean) { sp.visible = v; },
    };
  }

  // ── build ──────────────────────────────────────────────────────────────────
  build(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    this.camera = camera; this.controls = controls;
    this.prevAutoRotate = controls.autoRotate;
    controls.autoRotate = false;
    controls.minDistance = 10; controls.maxDistance = 70;
    this.frame(camera, controls);

    // prompt → policy
    const prompt = this.node(COL.prompt, -15.5, 0, 0, 0.55, "prompt");
    this.staticLabel("prompt q", -15.5, 1.25, 0, "#9fe8ff", 30);
    const policy = this.node(COL.policy, -11.5, 0, 0, 0.85, "policy");
    this.staticLabel("policy  π_θ", -11.5, 2.5, 0, "#cdb6ff", 30);
    this.glowLine(prompt.position, policy.position, COL.prompt, 0.4);
    this.allNodes.push(prompt, policy);

    // rollout strips of different length
    for (let i = 0; i < G; i++) {
      const cells: THREE.Mesh[] = [];
      for (let j = 0; j < lens[i]; j++) {
        const mat = new THREE.MeshStandardMaterial({
          color: COL.tok, emissive: COL.tok, emissiveIntensity: 0.5, roughness: 0.4, transparent: true, opacity: 0.95,
        });
        const m = new THREE.Mesh(this.cellGeo, mat);
        m.position.set(xStart + j * dx, yR[i], 0); m.scale.setScalar(0.001);
        (m.userData as any) = { base: 1, tgt: 0, nodeId: "o" + (i + 1) };
        this.root.add(m); this.pickList.push(m); cells.push(m);
      }
      const xEnd = xStart + (lens[i] - 1) * dx;
      this.glowLine(policy.position, new THREE.Vector3(xStart, yR[i], 0), COL.policy, 0.2);
      this.staticLabel(`o${i + 1}  |o|=${lens[i]}`, xStart - 1.55, yR[i], 0, "#9fb6e8", 26);
      const rLab = this.dynLabel(xEnd + 1.25, yR[i], 0, 30, 0.85);
      const gLab = this.dynLabel(xEnd + 1.25, yR[i] - 0.62, 0, 22, 0.62);
      this.rollouts.push({ cells, xEnd, rLab, gLab });
    }
    this.staticLabel("a group of G rollouts — different lengths", xStart + 2.4, yR[0] + 1.5, 0, "#8ea0d0", 24);

    // reward → advantage panel (bars spread along X)
    this.staticLabel("reward → advantage", 8.0, 5.4, 0, "#cdb6ff", 26);
    const barGeo = new THREE.BoxGeometry(0.7, 1, 0.7);
    for (let i = 0; i < G; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: COL.rew, emissive: COL.rew, emissiveIntensity: 1.0, roughness: 0.35, transparent: true, opacity: 0.94,
      });
      const m = new THREE.Mesh(barGeo, mat); m.position.set(this.barX(i), 0, 0.6);
      (m.userData as any) = { nodeId: "adv" }; this.root.add(m); this.pickList.push(m);
      const vLab = this.dynLabel(this.barX(i), 0, 1.0, 22, 0.62);
      this.staticLabel("o" + (i + 1), this.barX(i), -5.7, 0, "#7e8cc0", 22);
      this.bars.push({ m, vLab, state: { val: 0, color: 0 } });
    }
    // mean line / std band / zero axis — thin and set BEHIND the bars (z<0) to avoid z-fighting
    this.meanLine = new THREE.Mesh(new THREE.BoxGeometry(this.spanX, 0.07, 0.35),
      new THREE.MeshStandardMaterial({ color: COL.mean, emissive: COL.mean, emissiveIntensity: 1.4, transparent: true, opacity: 0.9 }));
    this.meanLine.position.set(8.0, 0, -0.1); this.root.add(this.meanLine);
    this.stdBand = new THREE.Mesh(new THREE.BoxGeometry(this.spanX, 1, 0.3),
      new THREE.MeshStandardMaterial({ color: COL.mean, emissive: COL.mean, emissiveIntensity: 0.5, transparent: true, opacity: 0.0, depthWrite: false }));
    this.stdBand.position.set(8.0, 0, -0.3); this.stdBand.renderOrder = -1; this.root.add(this.stdBand);
    this.axis = new THREE.Mesh(new THREE.BoxGeometry(this.spanX, 0.03, 0.35),
      new THREE.MeshStandardMaterial({ color: "#54608f", emissive: "#54608f", emissiveIntensity: 0.7, transparent: true, opacity: 0.35 }));
    this.axis.position.set(8.0, 0, -0.1); this.root.add(this.axis);
    this.meanLab = this.dynLabel(8.0 + this.spanX / 2 + 1.5, mean * this.scaleV, 0.6, 22, 0.6);
    this.stdLab = this.dynLabel(8.0 + this.spanX / 2 + 1.5, mean * this.scaleV - 0.8, 0.6, 20, 0.54);

    // back-flow gradient pulses (strip → policy)
    const PPER = 16, PN = G * PPER;
    this.pPos = new Float32Array(PN * 3); this.pCol = new Float32Array(PN * 3);
    for (let i = 0; i < G; i++) for (let k = 0; k < PPER; k++) this.pSeed.push({ roll: i, p: (i * 0.13 + k / PPER) % 1, v: 0.18 + (k % 5) * 0.03 });
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
    pGeo.setAttribute("color", new THREE.BufferAttribute(this.pCol, 3));
    this.backFlow = new THREE.Points(pGeo, new THREE.PointsMaterial({
      size: 0.22, vertexColors: true, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.root.add(this.backFlow);

    // forward sampling pulses (policy → strips)
    const FN = 60; this.fPos = new Float32Array(FN * 3);
    for (let i = 0; i < FN; i++) this.fSeed.push({ roll: i % G, p: (i / FN) % 1, v: 0.2 + (i % 7) * 0.02 });
    const fGeo = new THREE.BufferGeometry(); fGeo.setAttribute("position", new THREE.BufferAttribute(this.fPos, 3));
    this.fwdFlow = new THREE.Points(fGeo, new THREE.PointsMaterial({
      color: "#eafaff", size: 0.16, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.root.add(this.fwdFlow);

    this.buildHud();
  }

  private buildHud() {
    const css = (el: HTMLElement, s: Record<string, string>) => Object.assign(el.style, s);
    const hud = document.createElement("div");
    css(hud, {
      position: "absolute", top: "54px", left: "14px", zIndex: "20", maxWidth: "360px",
      padding: "13px 15px", borderRadius: "13px", backdropFilter: "blur(12px)",
      background: "rgba(10,12,24,0.62)", border: "1px solid rgba(150,120,255,0.18)",
      color: "#e7e3ff", font: '13px -apple-system,"SF Pro Text",Inter,system-ui,sans-serif',
      pointerEvents: "none", // info panel — never swallow orbit/clicks on the canvas
    });
    const h1 = document.createElement("div"); h1.textContent = "GRPO — advantage dynamics & the length bias";
    css(h1, { fontSize: "14px", fontWeight: "650" });
    this.hPhase = document.createElement("div"); css(this.hPhase, { marginTop: "8px", fontSize: "13px", fontWeight: "650", color: "#cdb6ff" });
    this.hFormula = document.createElement("div"); css(this.hFormula, { marginTop: "7px", fontSize: "12.5px", color: "#9be0c0", fontFamily: '"SF Mono",ui-monospace,Menlo,monospace' });
    this.hDesc = document.createElement("div"); css(this.hDesc, { marginTop: "7px", fontSize: "11.5px", lineHeight: "1.5", color: "#b3a8d8" });
    this.hBadge = document.createElement("span"); css(this.hBadge, { display: "inline-block", marginTop: "9px", fontSize: "11px", padding: "3px 10px", borderRadius: "999px" });
    const hint = document.createElement("div"); hint.textContent = "↑ toolbar “mode” cycles Auto ⇄ GRPO ⇄ Dr. GRPO · click the policy or a rollout to open its note";
    css(hint, { marginTop: "10px", fontSize: "10.5px", color: "#6f7aa6" });

    hud.appendChild(h1); hud.appendChild(this.hPhase); hud.appendChild(this.hFormula);
    hud.appendChild(this.hDesc); hud.appendChild(this.hBadge); hud.appendChild(hint);
    this.host.appendChild(hud); this.hud = hud;
  }

  // driven by the view's toolbar mode button
  setMode(m: number | null) { this.modeForced = m; }
  replay() { this.t0 = -1; }

  private phaseAt(localT: number) {
    let acc = 0;
    for (let i = 0; i < PHASES.length; i++) {
      const d = PHASES[i].dur;
      if (localT < acc + d) return { idx: i, prog: (localT - acc) / d, ph: PHASES[i] };
      acc += d;
    }
    return { idx: PHASES.length - 1, prog: 1, ph: PHASES[PHASES.length - 1] };
  }

  // ── per-frame ───────────────────────────────────────────────────────────────
  update(t: number) {
    if (this.t0 < 0) this.t0 = t;
    const tl = t - this.t0;
    const pass = Math.floor(tl / PASS);
    const localT = tl - pass * PASS;
    const mode = this.modeForced !== null ? this.modeForced : (pass % 2);
    const { idx, prog, ph } = this.phaseAt(localT);
    const adv = mode ? advDR : advGRPO;
    const gw = mode ? gDR : gGRPO;

    for (const m of this.allNodes) {
      const base = (m.userData as any).base as number;
      (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.0 + 0.4 * Math.sin(t * 2.2 + m.position.x * 0.4);
      m.scale.setScalar(base * (0.96 + 0.06 * Math.sin(t * 2.6 + m.position.x)));
    }

    // rollout cells: reveal + per-token gradient glow
    for (let i = 0; i < G; i++) {
      const R = this.rollouts[i], n = lens[i];
      let revealed = n;
      if (idx === 0) revealed = Math.floor(easeIO(clamp(prog, 0, 1)) * n + 0.001);
      let gStrength = 0;
      if (idx === 4) gStrength = easeIO(clamp((prog - 0.3) / 0.7, 0, 1)) * 0.6;
      if (idx === 5) gStrength = 1;
      const sgnCol = adv[i] >= 0 ? COL.pos : COL.neg;
      const boost = Math.min(Math.abs(gw[i]) * 3.6, 1.0); // capped so the big negative push stays bright but doesn't blow out
      for (let j = 0; j < n; j++) {
        const m = R.cells[j]; const ud = m.userData as any;
        const tgt = j < revealed ? 1 : 0; ud.tgt += (tgt - ud.tgt) * 0.25;
        const pulse = 0.5 + 0.5 * Math.sin(t * 4.0 - j * 0.5 + i);
        const gGlow = gStrength * boost * pulse;
        m.scale.setScalar(ud.tgt * (1 + 0.5 * gGlow));
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.45 + 1.5 * gGlow;
        mat.color.copy(cMix(COL.tok, sgnCol, gStrength));
        mat.emissive.copy(cMix(COL.tok, sgnCol, gStrength));
      }
      R.rLab.vis(idx >= 1); R.rLab.set("r = " + rew[i], COL.rew);
      if (idx >= 4) {
        R.gLab.vis(true);
        const gtxt = (gw[i] >= 0 ? "+" : "") + gw[i].toFixed(3);
        R.gLab.set("g = Â/" + (mode ? L_CONST : "|o|=" + lens[i]) + " = " + gtxt, sgnCol);
      } else R.gLab.vis(false);
    }

    // panel bars: reward → advantage morph
    let meanY = mean * this.scaleV, bandOp = 0;
    for (let i = 0; i < G; i++) {
      const B = this.bars[i]; let val: number, colorMix: number;
      if (idx <= 1) { val = rew[i]; colorMix = 0; meanY = mean * this.scaleV; bandOp = 0; }
      else if (idx === 2) { val = rew[i]; colorMix = 0; meanY = mean * this.scaleV; bandOp = 0.42; }
      else if (idx === 3) {
        const p = easeIO(prog);
        if (p < 0.5) { const s = p / 0.5; val = lerp(rew[i], rew[i] - mean, s); meanY = lerp(mean * this.scaleV, 0, s); colorMix = s; bandOp = lerp(0.42, 0.2, s); }
        else { const s = (p - 0.5) / 0.5; val = lerp(rew[i] - mean, adv[i], s); meanY = 0; colorMix = 1; bandOp = lerp(0.2, 0, s); }
      } else { val = adv[i]; colorMix = 1; meanY = 0; bandOp = 0; }
      B.state.val += (val - B.state.val) * 0.18;
      B.state.color += (colorMix - B.state.color) * 0.18;
      const v = B.state.val, h = Math.max(Math.abs(v) * this.scaleV, 0.02), sgn = v >= 0 ? 1 : -1;
      B.m.scale.y = h; B.m.position.y = sgn * h / 2;
      const target = v >= 0 ? COL.pos : COL.neg; const mat = B.m.material as THREE.MeshStandardMaterial;
      mat.color.copy(cMix(COL.rew, target, B.state.color));
      mat.emissive.copy(cMix(COL.rew, target, B.state.color));
      mat.emissiveIntensity = 0.62 + 0.16 * Math.sin(t * 3 + i);
      B.vLab.vis(idx >= 1);
      if (idx <= 2) B.vLab.set("r=" + rew[i], COL.rew);
      else { const txt = (adv[i] >= 0 ? "Â=+" : "Â=") + adv[i].toFixed(2); B.vLab.set(txt, adv[i] >= 0 ? COL.pos : COL.neg); }
      B.vLab.sp.position.y = sgn * h + sgn * 0.35 + (v >= 0 ? 0.1 : -0.1);
    }

    this.meanLine.position.y += (meanY - this.meanLine.position.y) * 0.18;
    this.meanLine.visible = idx >= 2 && idx <= 3;
    this.stdBand.scale.y = 2 * std * this.scaleV; this.stdBand.position.y = this.meanLine.position.y;
    const sbMat = this.stdBand.material as THREE.MeshStandardMaterial;
    sbMat.opacity += (bandOp - sbMat.opacity) * 0.15;
    const axMat = this.axis.material as THREE.MeshStandardMaterial;
    axMat.opacity = lerp(axMat.opacity, idx >= 3 ? 0.4 : 0.0, 0.15);
    this.meanLab.vis(idx >= 2 && idx <= 3); this.meanLab.set("mean(r)=" + mean.toFixed(2), COL.mean);
    this.meanLab.sp.position.y = this.meanLine.position.y + 0.05;
    this.stdLab.vis(idx >= 2 && idx <= 3); this.stdLab.set("std(r)=" + std.toFixed(2) + (mode ? "  (ignored)" : ""), mode ? "#ff9aa8" : COL.mean);
    this.stdLab.sp.position.y = this.meanLine.position.y - 0.8;

    // forward sampling pulses
    const fMat = this.fwdFlow.material as THREE.PointsMaterial;
    fMat.opacity += ((idx === 0 ? 0.95 : 0) - fMat.opacity) * 0.1;
    if (fMat.opacity > 0.02) {
      for (let i = 0; i < this.fSeed.length; i++) {
        const s = this.fSeed[i]; s.p += s.v * 0.02; if (s.p > 1) s.p -= 1;
        const R = this.rollouts[s.roll]; const ex = clamp(s.p, 0, 1);
        this.fPos[i * 3] = lerp(-11.5, R.xEnd, ex);
        this.fPos[i * 3 + 1] = lerp(0, yR[s.roll], Math.min(1, ex * 1.6));
        this.fPos[i * 3 + 2] = 0;
      }
      this.fwdFlow.geometry.getAttribute("position").needsUpdate = true;
    }

    // back-flow gradient pulses
    const bMat = this.backFlow.material as THREE.PointsMaterial;
    bMat.opacity += ((idx === 5 ? 0.95 : 0) - bMat.opacity) * 0.1;
    if (bMat.opacity > 0.02) {
      for (let k = 0; k < this.pSeed.length; k++) {
        const s = this.pSeed[k]; const i = s.roll;
        const boost = Math.min(Math.abs(gw[i]) * 3.6, 1.0);
        s.p += s.v * 0.02 * (0.4 + boost); if (s.p > 1) s.p -= 1;
        const ex = clamp(s.p, 0, 1);
        this.pPos[k * 3] = lerp(this.rollouts[i].xEnd, -11.5, ex);
        this.pPos[k * 3 + 1] = lerp(yR[i], 0, ex);
        this.pPos[k * 3 + 2] = 0;
        const c = new THREE.Color(adv[i] >= 0 ? COL.pos : COL.neg).multiplyScalar(clamp(0.3 + boost, 0.3, 1.6));
        this.pCol[k * 3] = c.r; this.pCol[k * 3 + 1] = c.g; this.pCol[k * 3 + 2] = c.b;
      }
      this.backFlow.geometry.getAttribute("position").needsUpdate = true;
      this.backFlow.geometry.getAttribute("color").needsUpdate = true;
    }

    // HUD
    this.hPhase.textContent = ph.title; this.hDesc.textContent = ph.desc;
    this.hBadge.textContent = mode ? "Dr. GRPO  (debiased)" : "GRPO  (original)";
    if (mode) { this.hBadge.style.background = "rgba(77,255,158,0.16)"; this.hBadge.style.color = "#7dffbe"; this.hBadge.style.border = "1px solid rgba(77,255,158,0.4)"; }
    else { this.hBadge.style.background = "rgba(90,140,255,0.22)"; this.hBadge.style.color = "#9fc0ff"; this.hBadge.style.border = "1px solid rgba(120,150,255,0.4)"; }
    if (idx <= 2) this.hFormula.textContent = "r = [1, 0, 1, 1]   mean=0.75   std=0.43";
    else if (idx === 3) this.hFormula.textContent = mode ? "Dr.GRPO:  Âᵢ = rᵢ − mean(r)        (no ÷ std)" : "GRPO:  Âᵢ = (rᵢ − mean(r)) / std(r)";
    else this.hFormula.textContent = mode ? "gᵢ = Âᵢ / L_const   → every token equal (no length bias)" : "gᵢ = Âᵢ / |oᵢ|   → long rollout ⇒ diluted per-token push";
  }

  // clicking the policy / a rollout / a bar opens its note (ids match the grpo map notes)
  pickId(ray: THREE.Raycaster): string | null {
    const hit = ray.intersectObjects(this.pickList, false)[0];
    return hit ? ((hit.object.userData as any).nodeId as string) ?? null : null;
  }

  frame(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    camera.position.set(-3.5, 3.2, 28);
    controls.target.set(-2.5, 0, 0);
  }

  dispose() {
    if (this.controls) { this.controls.autoRotate = this.prevAutoRotate; this.controls.minDistance = 6; this.controls.maxDistance = 80; }
    this.hud?.remove();
    // geometry/material/texture disposal is handled by view.disposeScene()'s root.traverse()
  }
}
