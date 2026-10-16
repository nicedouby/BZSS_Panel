import fs from "node:fs/promises";
import path from "node:path";

const SAFE_ID = /^[A-Za-z0-9._-]{1,160}$/;

export class ReplayScanner {
  constructor(rootDir) { this.rootDir = path.resolve(rootDir); }

  async list() {
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !SAFE_ID.test(entry.name)) continue;
      try { result.push(await this.get(entry.name)); }
      catch (error) { result.push({ id: entry.name.replace(/\.open$/i, ""), isPlayable: false, status: "unreadable", error: error.message }); }
    }
    return result.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
  }

  async get(id) {
    const directory = await this.resolve(id);
    if (!directory) return null;
    const session = JSON.parse(await fs.readFile(path.join(directory, "session.json"), "utf8"));
    const sizes = await directorySize(directory);
    const startedAt = session.startedAt || "";
    const started = Date.parse(startedAt);
    const ended = Date.parse(session.endedAt || "");
    const durationMs = finite(session.durationMs) ? Math.max(0, Number(session.durationMs)) : (Number.isFinite(started) ? Math.max(0, (Number.isFinite(ended) ? ended : Date.now()) - started) : 0);
    const segments = await fs.readdir(path.join(directory, "segments"), { withFileTypes: true }).catch(() => []);
    const playable = segments.some((x) => x.isFile() && /^\d{6}\.(?:open\.)?rps$/.test(x.name));
    return { id: session.sessionId || id.replace(/\.open$/i, ""), sessionId: session.sessionId || id.replace(/\.open$/i, ""), map: text(session.map), layer: text(session.layer), mode: text(session.mode), startedAt, durationMs, sizeBytes: sizes, status: session.status || (session.endedAt ? "closed" : "recording"), players: Number(session.playerCount || session.players || 0) || null, isPlayable: playable };
  }

  async resolve(id) {
    if (!SAFE_ID.test(String(id))) throw Object.assign(new Error("Invalid replay id."), { statusCode: 400 });
    for (const name of [id, `${id}.open`]) {
      const candidate = path.join(this.rootDir, name);
      const info = await fs.stat(candidate).catch(() => null);
      if (info?.isDirectory()) return candidate;
    }
    return null;
  }
}

async function directorySize(directory) { let total = 0; for (const item of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) { const target = path.join(directory, item.name); total += item.isDirectory() ? await directorySize(target) : Number((await fs.stat(target).catch(() => null))?.size || 0); } return total; }
function text(value) { return String(value ?? "").trim(); }
function finite(value) { return Number.isFinite(Number(value)); }
