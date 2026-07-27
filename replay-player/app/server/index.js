import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ReplayScanner } from "./replay-scanner.js";
import { ReplayDecoder } from "./replay-decoder.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = await loadConfig();
const scanner = new ReplayScanner(config.rootDir);
const decoder = new ReplayDecoder(scanner);
const clients = new Set();
const server = http.createServer((req, res) => handleHttp(req, res).catch((error) => respond(res, error.statusCode || 500, { error: error.message || "Internal error" })));
server.on("upgrade", upgrade);
server.listen(config.port, config.host, () => console.log(`BZSS Replay Player: http://${config.host}:${config.port}  root=${config.rootDir}`));

async function handleHttp(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/api/health") return respond(res, 200, { ok: true, rootDir: config.rootDir });
  if (url.pathname === "/api/replays") return respond(res, 200, { replays: await scanner.list() });
  const match = url.pathname.match(/^\/api\/replays\/([^/]+)\/state$/);
  if (match) { const replay = await decoder.read(decodeURIComponent(match[1]), url.searchParams.get("at")); return replay ? respond(res, 200, replay) : respond(res, 404, { error: "Replay not found" }); }
  const target = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const webRoot = path.resolve(here, "../web"); const file = path.resolve(webRoot, target);
  if (!file.startsWith(webRoot + path.sep) && file !== path.join(webRoot, "index.html")) return respond(res, 403, { error: "Forbidden" });
  const bytes = await fs.readFile(file).catch(() => null); if (!bytes) return respond(res, 404, { error: "Not found" });
  res.writeHead(200, { "content-type": mime(file), "cache-control": "no-store" }); res.end(bytes);
}
function upgrade(req, socket) { if (new URL(req.url || "/", "http://localhost").pathname !== "/ws") return socket.destroy(); const key = req.headers["sec-websocket-key"]; if (!key) return socket.destroy(); const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64"); socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`); const client = { socket, replayId: null, atMs: 0, rate: 1, playing: false, timer: null }; clients.add(client); socket.on("data", (buffer) => receive(client, buffer)); socket.on("close", () => close(client)); socket.on("error", () => close(client)); send(client, { type: "ready" }); }
function receive(client, buffer) { const message = readFrame(buffer); if (!message) return; let data; try { data = JSON.parse(message); } catch { return; } if (data.type === "play") { client.replayId = String(data.replay || client.replayId || ""); client.atMs = Math.max(0, Number(data.atMs) || client.atMs); client.rate = Math.min(8, Math.max(.25, Number(data.rate) || client.rate)); client.playing = true; start(client); } else if (data.type === "pause") client.playing = false; else if (data.type === "seek") { client.atMs = Math.max(0, Number(data.atMs) || 0); void frame(client); } else if (data.type === "rate") client.rate = Math.min(8, Math.max(.25, Number(data.rate) || 1)); }
function start(client) { if (client.timer) return; client.timer = setInterval(async () => { if (!client.playing || !client.replayId) return; client.atMs += 333 * client.rate; await frame(client); }, 333); void frame(client); }
async function frame(client) { if (!client.replayId) return; try { const replay = await decoder.read(client.replayId, client.atMs); if (!replay) return send(client, { type: "error", error: "Replay not found" }); const duration = replay.session.durationMs || 0; if (duration && client.atMs >= duration) { client.atMs = duration; client.playing = false; } send(client, { type: "frame", time: client.atMs, duration, replay: replay.session, state: replay.state, diagnostics: replay.diagnostics }); } catch (error) { send(client, { type: "error", error: error.message || "Decode failed" }); } }
function close(client) { clients.delete(client); if (client.timer) clearInterval(client.timer); client.timer = null; }
function send(client, value) { if (!client.socket.destroyed) client.socket.write(encodeFrame(JSON.stringify(value))); }
function encodeFrame(text) { const payload = Buffer.from(text); const n = payload.length; if (n < 126) return Buffer.concat([Buffer.from([0x81, n]), payload]); if (n < 65536) { const h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(n, 2); return Buffer.concat([h, payload]); } const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return Buffer.concat([h, payload]); }
function readFrame(buffer) { if (buffer.length < 2) return null; let n = buffer[1] & 127, offset = 2; if (n === 126) { n = buffer.readUInt16BE(offset); offset += 2; } else if (n === 127) { n = Number(buffer.readBigUInt64BE(offset)); offset += 8; } if (!(buffer[1] & 128) || buffer.length < offset + 4 + n) return null; const mask = buffer.subarray(offset, offset + 4); offset += 4; const out = Buffer.alloc(n); for (let i = 0; i < n; i++) out[i] = buffer[offset + i] ^ mask[i % 4]; return out.toString(); }
function respond(res, status, body) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); }
function mime(file) { return file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".js") ? "application/javascript; charset=utf-8" : "application/octet-stream"; }
async function loadConfig() { const defaults = { rootDir: "D:/BZSS_Replays", host: "127.0.0.1", port: 13000 }; const file = path.resolve(here, "../../config/replay-player.json"); const saved = JSON.parse(await fs.readFile(file, "utf8").catch(() => "{}")); const args = process.argv.slice(2); const option = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; }; return { rootDir: path.resolve(option("--root") || saved.rootDir || defaults.rootDir), host: option("--host") || saved.host || defaults.host, port: Number(option("--port") || saved.port || defaults.port) }; }
