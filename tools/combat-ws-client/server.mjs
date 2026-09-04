import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(baseDir, "public");
const configPath = path.join(baseDir, "config.json");
const defaultConfig = { websocketUrl: "ws://127.0.0.1:12864/ws/combat", token: "CHANGE_ME", clientId: "customer-combat-receiver", dashboardPort: 39080, reconnectDelayMs: 2000, outputDirectory: "./data", maxRememberedPacketIds: 10000 };
let config, socket = null, reconnectTimer = null, connectionEpoch = 0, writeQueue = Promise.resolve(), delivered = [], deliveredSet = new Set();
const state = { connected: false, authenticated: false, startedAt: new Date().toISOString(), lastMessageAt: null, currentMatchId: null, packets: 0, events: 0, matchFinished: 0, duplicates: 0, acked: 0, reconnects: 0, bytes: 0, errors: [], recent: [] };
function outputPath(name) { return path.resolve(baseDir, config.outputDirectory, name); }
function publicConfig() { return { ...config, token: config.token ? "***" : "" }; }
function remember(kind, data) { state.recent.unshift({ at: new Date().toISOString(), kind, data }); state.recent.length = Math.min(state.recent.length, 200); }
function error(message) { state.errors.unshift({ at: new Date().toISOString(), message }); state.errors.length = Math.min(state.errors.length, 50); remember("error", message); }
function send(value) { if (!socket || socket.readyState !== WebSocket.OPEN) return false; socket.send(JSON.stringify(value)); remember("out", value); return true; }
async function ensureStorage() { await fs.mkdir(outputPath("."), { recursive: true }); try { const stored = JSON.parse(await fs.readFile(outputPath("delivered-packets.json"), "utf8")); delivered = Array.isArray(stored) ? stored.slice(-config.maxRememberedPacketIds) : []; } catch { delivered = []; } deliveredSet = new Set(delivered); }
async function appendRecords(packet) {
  const records = packet.t === "cb" ? (Array.isArray(packet.e) ? packet.e.map((event) => ({ receivedAt: new Date().toISOString(), matchId: packet.mid, packetId: packet.pid, ...event })) : []) : [{ receivedAt: new Date().toISOString(), matchId: packet.mid, packetId: packet.pid, type: "match.finished", data: packet.d ?? null }];
  const file = packet.t === "cb" ? "combat-events.ndjson" : "match-finished.ndjson";
  if (records.length) await fs.appendFile(outputPath(file), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
  delivered.push(packet.pid); delivered = delivered.slice(-config.maxRememberedPacketIds); deliveredSet = new Set(delivered);
  await fs.writeFile(outputPath("delivered-packets.json"), JSON.stringify(delivered), "utf8"); return records.length;
}
function queuePacket(packet) { writeQueue = writeQueue.then(async () => { if (!packet.pid || !packet.mid) throw new Error("Packet missing pid or mid"); if (deliveredSet.has(packet.pid)) { state.duplicates += 1; send({ t: "ack", v: 1, pid: packet.pid, mid: packet.mid }); return; } const count = await appendRecords(packet); state.packets += 1; state.events += count; if (packet.t === "mf") state.matchFinished += 1; state.currentMatchId = packet.mid; state.acked += send({ t: "ack", v: 1, pid: packet.pid, mid: packet.mid }) ? 1 : 0; remember(packet.t, { pid: packet.pid, mid: packet.mid, events: count }); }).catch((cause) => error(`Packet persistence failed: ${cause.message}`)); }
function connect() {
  const epoch = ++connectionEpoch; clearTimeout(reconnectTimer);
  if (typeof WebSocket !== "function") return error("Node.js 22+ is required (global WebSocket is unavailable).");
  try { socket?.close(); } catch {} try { socket = new WebSocket(config.websocketUrl); } catch (cause) { error(`Invalid WebSocket URL: ${cause.message}`); return; }
  socket.addEventListener("open", () => { if (epoch !== connectionEpoch) return; state.connected = true; state.authenticated = false; send({ t: "hello", v: 1, token: config.token, client: config.clientId }); });
  socket.addEventListener("message", (event) => { if (epoch !== connectionEpoch) return; const raw = String(event.data); state.lastMessageAt = new Date().toISOString(); state.bytes += Buffer.byteLength(raw); let packet; try { packet = JSON.parse(raw); } catch { error("Server sent invalid JSON."); return; } remember("in", packet); if (packet.t === "welcome") { state.authenticated = true; return; } if (packet.t === "ping") { send({ t: "pong", v: 1, ts: Date.now() }); return; } if (packet.t === "cb" || packet.t === "mf") queuePacket(packet); });
  socket.addEventListener("error", () => { if (epoch === connectionEpoch) error("WebSocket connection error."); });
  socket.addEventListener("close", (event) => { if (epoch !== connectionEpoch) return; state.connected = false; state.authenticated = false; remember("system", `closed ${event.code}${event.reason ? ` ${event.reason}` : ""}`); state.reconnects += 1; reconnectTimer = setTimeout(connect, Math.max(250, Number(config.reconnectDelayMs) || 2000)); });
}
async function loadConfig() { try { config = { ...defaultConfig, ...JSON.parse(await fs.readFile(configPath, "utf8")) }; } catch { config = { ...defaultConfig }; await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8"); } config.dashboardPort = Number(config.dashboardPort) || defaultConfig.dashboardPort; config.maxRememberedPacketIds = Math.max(100, Number(config.maxRememberedPacketIds) || defaultConfig.maxRememberedPacketIds); await ensureStorage(); }
async function readBody(req) { let body = ""; for await (const chunk of req) body += chunk; return body ? JSON.parse(body) : {}; }
function json(res, status, value, headers = {}) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }); res.end(JSON.stringify(value)); }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/state") return json(res, 200, { config: publicConfig(), state });
  if (url.pathname === "/api/config" && req.method === "POST") { try { const update = await readBody(req); config = { ...config, ...update }; config.dashboardPort = Number(config.dashboardPort) || defaultConfig.dashboardPort; config.maxRememberedPacketIds = Math.max(100, Number(config.maxRememberedPacketIds) || defaultConfig.maxRememberedPacketIds); await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8"); await ensureStorage(); connect(); return json(res, 200, { ok: true }); } catch (cause) { return json(res, 400, { ok: false, error: cause.message }); } }
  if (url.pathname === "/api/reconnect" && req.method === "POST") { connect(); return json(res, 200, { ok: true }); }
  if (url.pathname === "/api/export") return json(res, 200, { exportedAt: new Date().toISOString(), state, recent: state.recent }, { "content-disposition": "attachment; filename=combat-ws-status.json" });
  const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^[\w./-]+$/.test(relative) || relative.includes("..")) return json(res, 404, { error: "Not Found" });
  try { const body = await fs.readFile(path.join(publicDir, relative)); const type = relative.endsWith(".js") ? "text/javascript" : relative.endsWith(".css") ? "text/css" : "text/html"; res.writeHead(200, { "content-type": `${type}; charset=utf-8` }); res.end(body); } catch { json(res, 404, { error: "Not Found" }); }
});
await loadConfig();
server.listen(config.dashboardPort, "127.0.0.1", () => { console.log(`BZSS Combat Receiver: http://127.0.0.1:${config.dashboardPort}`); connect(); });
