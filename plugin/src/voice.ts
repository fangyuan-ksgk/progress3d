import { requestUrl } from "obsidian";
import { SceneGraph } from "./graph";
import { AISettings } from "./ai";

export interface VoiceTurn { role: "user" | "assistant"; text: string; }

export function graphSummary(g: SceneGraph): string {
  return g.nodes.map((n) => `${n.id} (${n.type}): ${n.label}`).join("; ");
}

// Pure builder (unit-testable) — assembles the Anthropic Messages body for a
// spoken, note-grounded conversation about one node.
export function buildChatBody(opts: {
  model: string; nodeId: string; nodeLabel: string;
  note: string; graph: SceneGraph; history: VoiceTurn[]; userText: string;
}) {
  const system =
    `You are a voice study-buddy embedded in a 3D research map. The user is talking about the node ` +
    `"${opts.nodeLabel}" (id ${opts.nodeId}). Ground every answer in their note and the surrounding ` +
    `architecture. Your replies are SPOKEN ALOUD, so be conversational and concise — a few sentences, ` +
    `no markdown, no code blocks, no bullet lists, no LaTeX.\n\n` +
    `NODE NOTE:\n${opts.note || "(empty)"}\n\n` +
    `SURROUNDING GRAPH: ${graphSummary(opts.graph)}`;
  const messages = [
    ...opts.history.map((t) => ({ role: t.role, content: t.text })),
    { role: "user", content: opts.userText },
  ];
  return { model: opts.model || "claude-opus-4-8", max_tokens: 1000, system, messages };
}

export async function chatAboutNode(body: any, settings: AISettings): Promise<string> {
  if (!settings.apiKey) throw new Error("Set your Anthropic API key in Settings → Progress3D to chat.");
  const res = await requestUrl({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    contentType: "application/json",
    headers: {
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    throw: false,
  });
  if (res.status !== 200) {
    throw new Error(`Anthropic API ${res.status}: ${res.json?.error?.message || res.text?.slice(0, 200)}`);
  }
  const text = (res.json.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();
  return text || "(no response)";
}

// ── Voice seams — replace these two with your voice-model API when you have it.
// Defaults use the browser's built-in Web Speech API so the feature works today.
export function speak(text: string): boolean {
  const synth = (window as any).speechSynthesis;
  const Utter = (window as any).SpeechSynthesisUtterance;
  if (!synth || !Utter) return false;
  synth.cancel();
  const u = new Utter(text);
  u.rate = 1.0; u.pitch = 1.0;
  synth.speak(u);
  return true;
}

export function listen(onText: (t: string) => void, onEnd: () => void): null | (() => void) {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
  rec.onresult = (e: any) => onText(e.results[0][0].transcript);
  rec.onerror = onEnd;
  rec.onend = onEnd;
  rec.start();
  return () => { try { rec.stop(); } catch { /* ignore */ } };
}
