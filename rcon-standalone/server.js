import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { URL } from "node:url";

const SETTINGS = {
  httpPort: Number(process.env.RCON_HTTP_PORT ?? 3008),
  host: String(process.env.RCON_HOST ?? "").trim(),
  port: Number(process.env.RCON_PORT ?? 0),
  password: String(process.env.RCON_PASSWORD ?? "").trim(),
  username: "DoubyBear",
  passwordPlain: "傻福KK666++",
};

const COMMAND_GUIDE = [
  { cmd: "ListPlayers", desc: "列出当前在线和最近断线玩家" },
  { cmd: "ListSquads", desc: "列出当前所有小队" },
  { cmd: "ShowCurrentMap", desc: "显示当前地图" },
  { cmd: "ShowNextMap", desc: "显示下一张地图" },
  { cmd: "AdminBroadcast <msg>", desc: "向全服广播消息" },
  { cmd: "AdminWarn <player> <msg>", desc: "警告玩家" },
  { cmd: 'AdminKick "<player>" <msg>', desc: "踢出玩家" },
  { cmd: "AdminDisbandSquad <teamId> <squadId>", desc: "解散小队" },
  { cmd: "AdminRemovePlayerFromSquad <id> <msg>", desc: "将玩家移出小队" },
  { cmd: 'AdminBan "<player>" <minutes> <msg>', desc: "封禁玩家" },
  { cmd: "TB", desc: "切换队伍" },
];

const sessions = new Map();
const sessionTtlMs = 12 * 60 * 60 * 1000;
const sessionCookieName = "rcon_standalone_session";

let rconClient = null;
let rconState = {
  connected: false,
  authenticated: false,
  lastError: "",
  lastConnectedAt: "",
  lastDisconnectedAt: "",
  reconnecting: false,
};
let reconnectTimer = null;
let reconnectDelayMs = 5000;

function nowIso() {
  return new Date().toISOString();
}

function parseCookies(header) {
  const out = {};
  String(header ?? "").split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function makeCookie(name, value, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

function json(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function html(res, body) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function text(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function makeSession(user) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + sessionTtlMs;
  sessions.set(token, { user, expiresAt });
  return { token, expiresAt };
}

function getUserFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie ?? "");
  const token = cookies[sessionCookieName];
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return session.user;
}

function requireAuth(req, res) {
  const user = getUserFromRequest(req);
  if (!user) {
    json(res, 401, { ok: false, error: "Unauthorized" });
    return null;
  }
  return user;
}

function authOk(req, res) {
  const user = requireAuth(req, res);
  return Boolean(user);
}

function rconPacket(type, id, body) {
  const bodyBuffer = Buffer.from(String(body ?? ""), "utf8");
  const size = 4 + 4 + bodyBuffer.length + 2;
  const buffer = Buffer.alloc(4 + size);
  buffer.writeInt32LE(size, 0);
  buffer.writeInt32LE(id, 4);
  buffer.writeInt32LE(type, 8);
  bodyBuffer.copy(buffer, 12);
  buffer.writeInt16LE(0, 12 + bodyBuffer.length);
  return buffer;
}

class RconClient {
  constructor({ host, port, password, logger = console }) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.logger = logger;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.connected = false;
    this.authenticated = false;
    this.connectPromise = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    if (this.connected && this.authenticated) return;
    if (this.connectPromise) return this.connectPromise;
    if (!this.host || !this.port || !this.password) {
      throw new Error("RCON host/port/password is not configured.");
    }

    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new net.Socket();
      this.socket = socket;
      this.buffer = Buffer.alloc(0);
      this.authenticated = false;

      const cleanup = () => {
        socket.off("connect", onConnect);
        socket.off("error", onError);
        socket.off("data", onData);
        socket.off("close", onClose);
      };

      const onConnect = async () => {
        try {
          await this._authenticate();
          this.connected = true;
          this.authenticated = true;
          rconState.connected = true;
          rconState.authenticated = true;
          rconState.lastError = "";
          rconState.lastConnectedAt = nowIso();
          rconState.reconnecting = false;
          cleanup();
          attachSocketEvents(socket);
          resolve();
        } catch (err) {
          cleanup();
          try { socket.destroy(); } catch {}
          reject(err);
        }
      };

      const onError = (err) => {
        cleanup();
        reject(err);
      };

      const onData = (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this._drainPackets();
      };

      const onClose = () => {
        cleanup();
        this.connected = false;
        this.authenticated = false;
        rconState.connected = false;
        rconState.authenticated = false;
        rconState.lastDisconnectedAt = nowIso();
        failPending(new Error("RCON connection closed."));
        scheduleReconnect();
      };

      socket.once("connect", onConnect);
      socket.once("error", onError);
      socket.on("data", onData);
      socket.once("close", onClose);
      socket.connect(this.port, this.host);
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  async _authenticate() {
    const response = await this._request(3, this.password, { auth: true });
    if (!response.ok) {
      throw new Error("RCON authentication failed.");
    }
  }

  _request(type, body, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error("RCON socket is not connected."));
        return;
      }

      const id = options.auth ? this.nextId++ : this.nextId++;
      const packet = rconPacket(type, id, body);
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("RCON request timed out."));
      }, 15000);

      this.pending.set(id, { resolve, reject, timeout, auth: Boolean(options.auth) });
      this.socket.write(packet);
    });
  }

  async execute(command) {
    const textCommand = String(command ?? "").trim();
    if (!textCommand) throw new Error("Command is empty.");
    if (!this.connected || !this.authenticated) {
      await this.connect();
    }
    return this._request(2, textCommand, false).then((result) => result.body);
  }

  _drainPackets() {
    while (this.buffer.length >= 12) {
      const size = this.buffer.readInt32LE(0);
      if (this.buffer.length < size + 4) return;
      const id = this.buffer.readInt32LE(4);
      const type = this.buffer.readInt32LE(8);
      const body = this.buffer.subarray(12, 4 + size - 2).toString("utf8");
      this.buffer = this.buffer.subarray(4 + size);
      this._handlePacket({ id, type, body });
    }
  }

  _handlePacket(packet) {
    const pending = this.pending.get(packet.id);
    if (pending) {
      this.pending.delete(packet.id);
      clearTimeout(pending.timeout);
      if (pending.auth) {
        const ok = packet.id !== -1;
        this.connected = ok;
        this.authenticated = ok;
        pending.resolve({ ok, body: packet.body });
        return;
      }
      pending.resolve({ ok: true, body: packet.body });
      return;
    }
    this.logger.debug?.("Unmatched RCON packet", packet);
  }
}

function failPending(err) {
  for (const [id, item] of rconClient?.pending ?? []) {
    clearTimeout(item.timeout);
    item.reject(err);
    rconClient.pending.delete(id);
  }
}

function attachSocketEvents(socket) {
  socket.on("error", (err) => {
    rconState.lastError = err.message;
  });
}

function scheduleReconnect() {
  if (reconnectTimer || !SETTINGS.host || !SETTINGS.port || !SETTINGS.password) return;
  rconState.reconnecting = true;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await startRcon();
    } catch (err) {
      rconState.lastError = err.message;
      scheduleReconnect();
    }
  }, reconnectDelayMs);
  reconnectTimer.unref?.();
}

async function startRcon() {
  if (!rconClient) {
    rconClient = new RconClient({
      host: SETTINGS.host,
      port: SETTINGS.port,
      password: SETTINGS.password,
      logger: console,
    });
  }
  await rconClient.connect();
  return rconClient;
}

async function ensureRconReady() {
  if (!SETTINGS.host || !SETTINGS.port || !SETTINGS.password) {
    throw new Error("RCON is not configured. Set RCON_HOST, RCON_PORT and RCON_PASSWORD.");
  }
  return startRcon();
}

const loginPage = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RCON Standalone</title>
  <style>
    :root {
      --bg: #081019;
      --panel: rgba(10, 17, 29, 0.86);
      --panel-2: rgba(16, 25, 40, 0.95);
      --line: rgba(148, 163, 184, 0.18);
      --text: #e5eefb;
      --muted: #8ea0b8;
      --accent: #46d39a;
      --accent-2: #65b7ff;
      --danger: #ff6b6b;
      --shadow: 0 22px 60px rgba(0, 0, 0, 0.45);
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(70, 211, 154, 0.18), transparent 24%),
        radial-gradient(circle at top right, rgba(101, 183, 255, 0.14), transparent 26%),
        linear-gradient(180deg, #04070b 0%, #09131f 48%, #05090f 100%);
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .card {
      width: min(420px, 100%);
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(16px);
      padding: 28px;
    }
    .eyebrow {
      color: var(--accent);
      font-size: 12px;
      letter-spacing: .16em;
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0 0 20px; color: var(--muted); line-height: 1.6; }
    label { display: block; font-size: 13px; margin: 14px 0 6px; color: #bfd0e8; }
    input {
      width: 100%;
      padding: 13px 14px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: rgba(3, 8, 15, 0.65);
      color: var(--text);
      outline: none;
    }
    input:focus { border-color: rgba(70, 211, 154, 0.8); box-shadow: 0 0 0 3px rgba(70, 211, 154, 0.14); }
    button {
      width: 100%;
      margin-top: 18px;
      padding: 13px 14px;
      border: 0;
      border-radius: 14px;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      color: #04111b;
      font-weight: 700;
      cursor: pointer;
    }
    .note { margin-top: 14px; font-size: 13px; color: var(--muted); }
    .error { margin-top: 14px; color: var(--danger); min-height: 20px; }
  </style>
</head>
<body>
  <form class="card" id="loginForm">
    <div class="eyebrow">RCON Standalone</div>
    <h1>独立 RCON 控制台</h1>
    <p>用于 BZSS Panel 未运行时保持命令入口可用。</p>
    <label for="username">用户名</label>
    <input id="username" name="username" autocomplete="username" value="${SETTINGS.username}">
    <label for="password">密码</label>
    <input id="password" name="password" type="password" autocomplete="current-password">
    <button type="submit">登录</button>
    <div class="error" id="error"></div>
    <div class="note">默认账号固定为 SuperAdmin，登录后可直接执行 RCON 命令。</div>
  </form>
  <script>
    const form = document.getElementById("loginForm");
    const errorEl = document.getElementById("error");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorEl.textContent = "";
      const payload = {
        username: form.username.value,
        password: form.password.value,
      };
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        errorEl.textContent = data.error === "InvalidCredentials" ? "用户名或密码错误。" : (data.error || "登录失败");
        return;
      }
      location.href = "/";
    });
  </script>
</body>
</html>`;

const appPage = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RCON Standalone</title>
  <style>
    :root {
      --bg: #071018;
      --surface: rgba(10, 17, 29, 0.88);
      --surface-2: rgba(14, 23, 38, 0.94);
      --line: rgba(148, 163, 184, 0.18);
      --line-strong: rgba(148, 163, 184, 0.28);
      --text: #e7eefb;
      --muted: #8d9db5;
      --accent: #5ee4a6;
      --accent-2: #63b7ff;
      --danger: #ff6b6b;
      --warn: #ffd166;
      --shadow: 0 28px 80px rgba(0, 0, 0, 0.46);
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(94, 228, 166, 0.18), transparent 24%),
        radial-gradient(circle at top right, rgba(99, 183, 255, 0.16), transparent 22%),
        linear-gradient(180deg, #04070b 0%, #09131f 100%);
    }
    .shell {
      display: grid;
      grid-template-columns: 1.7fr 1fr;
      gap: 18px;
      min-height: 100vh;
      padding: 18px;
    }
    .panel {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(16px);
      overflow: hidden;
    }
    .main {
      display: flex;
      flex-direction: column;
      min-height: calc(100vh - 36px);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 20px 22px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent);
    }
    .title {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .eyebrow {
      color: var(--accent);
      font-size: 12px;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    h1 { margin: 0; font-size: 24px; }
    .status {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .badge {
      padding: 8px 11px;
      border-radius: 999px;
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--line);
      color: #dce6f5;
      font-size: 12px;
    }
    .badge.ok { border-color: rgba(94, 228, 166, 0.4); color: var(--accent); }
    .badge.bad { border-color: rgba(255, 107, 107, 0.4); color: var(--danger); }
    .tabs {
      display: flex;
      gap: 10px;
      padding: 14px 22px 0;
    }
    .tab {
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.04);
      color: var(--text);
      border-radius: 14px 14px 0 0;
      padding: 11px 16px;
      cursor: pointer;
      font-weight: 700;
    }
    .tab.active {
      background: linear-gradient(135deg, rgba(94, 228, 166, 0.16), rgba(99, 183, 255, 0.14));
      border-color: rgba(94, 228, 166, 0.35);
      color: white;
    }
    .content {
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      flex: 1;
    }
    .commandBox, .logBox, .aboutBox {
      background: var(--surface-2);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 18px;
    }
    .commandRow {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
    }
    input, textarea {
      width: 100%;
      border: 1px solid var(--line);
      background: rgba(0, 0, 0, 0.28);
      color: var(--text);
      border-radius: 14px;
      padding: 12px 14px;
      outline: none;
      font: inherit;
    }
    input:focus, textarea:focus {
      border-color: rgba(94, 228, 166, 0.8);
      box-shadow: 0 0 0 3px rgba(94, 228, 166, 0.13);
    }
    textarea { min-height: 160px; resize: vertical; }
    button.primary {
      border: 0;
      border-radius: 14px;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      color: #05121c;
      font-weight: 800;
      padding: 0 18px;
      cursor: pointer;
      min-width: 120px;
    }
    .hint, .small { color: var(--muted); font-size: 13px; line-height: 1.6; }
    .log {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.55;
      min-height: 220px;
      max-height: 44vh;
      overflow: auto;
    }
    .about {
      display: none;
    }
    .about.active {
      display: block;
    }
    .aboutBox ul {
      margin: 0;
      padding-left: 18px;
      display: grid;
      gap: 8px;
    }
    .commandList {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }
    .cmdItem {
      display: grid;
      gap: 4px;
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--line);
    }
    .cmdItem code { color: #9be7bf; }
    @media (max-width: 1100px) {
      .shell { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="panel main">
      <div class="header">
        <div class="title">
          <div class="eyebrow">RCON Standalone</div>
          <h1>24 小时命令入口</h1>
          <div class="small">当前用户: <span id="who"></span></div>
        </div>
        <div class="status">
          <span class="badge" id="rconStatus">RCON: checking</span>
          <span class="badge" id="authStatus">Session: active</span>
        </div>
      </div>
      <div class="tabs">
        <button class="tab active" data-tab="console">控制台</button>
        <button class="tab" data-tab="about">关于</button>
      </div>
      <div class="content">
        <div class="console">
          <div class="commandBox">
            <div class="commandRow">
              <input id="command" placeholder='输入 RCON 命令，例如: AdminBroadcast "Server online"' autocomplete="off">
              <button class="primary" id="send">发送命令</button>
            </div>
            <div class="hint">支持直接输入原始 RCON 命令。回车即可发送。</div>
          </div>
          <div class="logBox">
            <div class="small" style="margin-bottom: 10px;">执行结果</div>
            <textarea id="log" class="log" readonly></textarea>
          </div>
        </div>
    <div class="about" id="aboutPane">
          <div class="aboutBox">
            <div class="small">可用命令</div>
            <div class="commandList" id="commandList"></div>
          </div>
        </div>
      </div>
    </section>
    <aside class="panel" style="padding: 22px;">
      <div class="aboutBox">
        <div class="eyebrow">关于</div>
        <h2 style="margin: 6px 0 10px;">这个项目做什么</h2>
        <div class="small">
          这是一个独立运行的 RCON Web 进程，不依赖 BZSS Panel 主进程。
          服务器启动后会保持 RCON 连接，网页端用于手工下发命令、查看连接状态和参考命令清单。
        </div>
      </div>
      <div class="aboutBox" style="margin-top: 14px;">
        <div class="small">运行状态</div>
        <ul style="margin-top: 10px;">
          <li>HTTP 管理入口: <code>${SETTINGS.httpPort}</code></li>
          <li>RCON 主机: <code>${SETTINGS.host || "(unset)"}</code></li>
          <li>RCON 端口: <code>${SETTINGS.port || "(unset)"}</code></li>
          <li>会话有效期: 12 小时</li>
        </ul>
      </div>
      <div class="aboutBox" style="margin-top: 14px;">
        <div class="small">注意</div>
        <div class="small">
          该页面只做固定账号登录，不提供用户管理。密码修改需要直接改启动参数或代码。
        </div>
      </div>
    </aside>
  </div>
  <script>
    const commandList = ${JSON.stringify(COMMAND_GUIDE)};
    const listEl = document.getElementById("commandList");
    const whoEl = document.getElementById("who");
    const logEl = document.getElementById("log");
    const commandEl = document.getElementById("command");
    const sendEl = document.getElementById("send");
    const rconStatusEl = document.getElementById("rconStatus");
    const authStatusEl = document.getElementById("authStatus");

    whoEl.textContent = ${JSON.stringify(SETTINGS.username)};
    for (const item of commandList) {
      const div = document.createElement("div");
      div.className = "cmdItem";
      div.innerHTML = "<code>" + item.cmd + "</code><div class='small'>" + item.desc + "</div>";
      listEl.appendChild(div);
    }

    function appendLog(text) {
      const stamp = new Date().toLocaleString();
      logEl.value = "[" + stamp + "] " + text + "\\n\\n" + logEl.value;
    }

    async function refreshState() {
      const res = await fetch("/api/state");
      const data = await res.json();
      if (!res.ok) return;
      const state = data.state || {};
      if (state.connected && state.authenticated) {
        rconStatusEl.textContent = "RCON: connected";
        rconStatusEl.className = "badge ok";
      } else if (state.reconnecting) {
        rconStatusEl.textContent = "RCON: reconnecting";
        rconStatusEl.className = "badge";
      } else {
        rconStatusEl.textContent = "RCON: disconnected";
        rconStatusEl.className = "badge bad";
      }
      authStatusEl.textContent = "Session: active";
    }

    async function sendCommand() {
      const command = commandEl.value.trim();
      if (!command) return;
      sendEl.disabled = true;
      try {
        const res = await fetch("/api/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          appendLog("失败: " + (data.error || "未知错误"));
          return;
        }
        appendLog("命令: " + command + "\\n结果: " + (data.response || "(empty)"));
        commandEl.value = "";
      } catch (err) {
        appendLog("失败: " + err.message);
      } finally {
        sendEl.disabled = false;
      }
    }

    document.getElementById("send").addEventListener("click", sendCommand);
    document.getElementById("command").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendCommand();
      }
    });

    const consolePane = document.querySelector(".console");
    const aboutPane = document.getElementById("aboutPane");

    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((n) => n.classList.remove("active"));
        tab.classList.add("active");
        const active = tab.dataset.tab;
        consolePane.style.display = active === "console" ? "block" : "none";
        aboutPane.classList.toggle("active", active === "about");
      });
    });

    setInterval(refreshState, 5000);
    refreshState();
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/health") {
    return json(res, 200, { ok: true, time: nowIso(), state: rconState });
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { ok: false, error: "InvalidJson" });
    }

    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    if (username !== SETTINGS.username || password !== SETTINGS.passwordPlain) {
      return json(res, 200, { ok: false, error: "InvalidCredentials" });
    }

    const { token, expiresAt } = makeSession({ username });
    return json(res, 200, {
      ok: true,
      user: { username },
      expiresAt,
    }, {
      "Set-Cookie": makeCookie(sessionCookieName, token, Math.floor(sessionTtlMs / 1000)),
    });
  }

  if (url.pathname === "/api/logout") {
    const cookies = parseCookies(req.headers.cookie ?? "");
    const token = cookies[sessionCookieName];
    if (token) sessions.delete(token);
    return json(res, 200, { ok: true }, {
      "Set-Cookie": `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
    });
  }

  if (url.pathname === "/api/state") {
    if (!authOk(req, res)) return;
    return json(res, 200, {
      ok: true,
      state: rconState,
      user: getUserFromRequest(req),
    });
  }

  if (url.pathname === "/api/command" && req.method === "POST") {
    if (!authOk(req, res)) return;
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { ok: false, error: "InvalidJson" });
    }

    const command = String(body.command ?? "").trim();
    if (!command) {
      return json(res, 400, { ok: false, error: "Command is empty." });
    }

    try {
      await ensureRconReady();
      const response = await rconClient.execute(command);
      return json(res, 200, { ok: true, response });
    } catch (err) {
      rconState.lastError = err.message;
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (url.pathname === "/") {
    const user = getUserFromRequest(req);
    if (!user) return html(res, loginPage);
    return html(res, appPage);
  }

  if (url.pathname === "/favicon.ico") {
    return text(res, 204, "");
  }

  return text(res, 404, "Not Found");
});

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}, 60 * 1000).unref?.();

server.listen(SETTINGS.httpPort, "0.0.0.0", async () => {
  console.log(`[rcon-standalone] HTTP listening on 0.0.0.0:${SETTINGS.httpPort}`);
  if (SETTINGS.host && SETTINGS.port && SETTINGS.password) {
    try {
      await startRcon();
      console.log(`[rcon-standalone] RCON connected to ${SETTINGS.host}:${SETTINGS.port}`);
    } catch (err) {
      rconState.lastError = err.message;
      console.error("[rcon-standalone] RCON connect failed:", err.message);
      scheduleReconnect();
    }
  } else {
    console.log("[rcon-standalone] RCON env not configured yet.");
  }
});
