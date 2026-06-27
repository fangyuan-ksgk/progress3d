import { App, Modal } from "obsidian";

// A quick sketch surface. Draw a rough 2D diagram; "Attach" exports it as a PNG
// File handed to onDone — used as an image prompt for Claude Code to draw/edit the map.
export class SketchModal extends Modal {
  private onDone: (file: File) => void;
  constructor(app: App, onDone: (file: File) => void) {
    super(app);
    this.onDone = onDone;
  }

  onOpen() {
    const c = this.contentEl;
    c.empty();
    c.createEl("h3", { text: "Sketch the diagram you want" });
    c.createEl("p", { cls: "setting-item-description", text: "Draw a rough layout. Attach it + a text prompt to ask Claude Code to build/edit the 3D map." });

    const canvas = c.createEl("canvas") as HTMLCanvasElement;
    canvas.width = 600; canvas.height = 400;
    canvas.style.cssText = "border:1px solid var(--background-modifier-border);border-radius:8px;background:#0b0f1c;touch-action:none;cursor:crosshair;display:block;max-width:100%";
    const ctx = canvas.getContext("2d")!;
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#cfe0ff";

    let drawing = false;
    let last = { x: 0, y: 0 };
    const pos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
    };
    canvas.addEventListener("pointerdown", (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p;
    });
    canvas.addEventListener("pointerup", () => { drawing = false; });

    const row = c.createDiv();
    row.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap";

    // colour swatches
    for (const col of ["#cfe0ff", "#ff9a5c", "#39d2a0", "#b06bff", "#ffd27a"]) {
      const sw = row.createEl("button");
      sw.style.cssText = `width:20px;height:20px;border-radius:50%;border:1px solid #0006;background:${col};cursor:pointer`;
      sw.onclick = () => { ctx.strokeStyle = col; };
    }
    // brush size
    const size = row.createEl("input"); (size as any).type = "range"; (size as any).min = "1"; (size as any).max = "10"; (size as any).value = "2.5";
    size.oninput = () => { ctx.lineWidth = parseFloat((size as any).value); };

    const spacer = row.createDiv(); spacer.style.flex = "1";
    const clear = row.createEl("button", { text: "Clear" });
    clear.onclick = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
    const attach = row.createEl("button", { text: "Attach to chat", cls: "mod-cta" });
    attach.onclick = () => {
      canvas.toBlob((blob) => {
        if (blob) this.onDone(new File([blob], `sketch-${blob.size}.png`, { type: "image/png" }));
        this.close();
      }, "image/png");
    };
  }

  onClose() { this.contentEl.empty(); }
}
