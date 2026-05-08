// -*- coding: utf-8 -*-

/**
 * 页面：控制台
 *
 * 目标：
 * - 在事件分发器与 RCON 原生输出之间切换
 * - RCON 原生模式显示专门的控制区
 * - 支持增量拉取日志
 */

const VIEW_OPTIONS = {
  dispatcher: {
    channel: "dispatcher",
    searchPlaceholder: "筛选事件名、参数或来源",
  },
  "rcon-native": {
    channel: "rcon-native",
    searchPlaceholder: "筛选命令、响应或推送原文",
  },
};

export async function renderPage({ root, api }) {
  clearPageTimers(root);

  const state = {
    view: "dispatcher",
    channel: "dispatcher",
    q: "",
    lastSeq: 0,
    paused: false,
    maxDomLines: 800,
  };

  root.innerHTML = `
    <section class="page console-page">
      <div class="page-title-row">
        <div>
          <div class="page-title">控制台</div>
          <div class="page-subtitle">在事件分发器与原生 RCON 数据之间切换查看。</div>
        </div>
        <div class="console-actions">
          <div class="console-view-toggle" role="tablist" aria-label="控制台视图">
            <button type="button" class="console-view-btn active" data-view="dispatcher">事件分发器</button>
            <button type="button" class="console-view-btn" data-view="rcon-native">RCON 原生</button>
          </div>
          <input id="search" class="console-search" placeholder="${esc(VIEW_OPTIONS.dispatcher.searchPlaceholder)}">
          <button id="pause">暂停</button>
          <button id="clear">清空视图</button>
        </div>
      </div>

      <div id="rcon-panel" class="card console-command-card" hidden>
        <div class="rcon-panel-header">
          <div class="rcon-panel-title">RCON 控制</div>
          <div class="rcon-status-row">
            <span class="rcon-status-chip" id="rcon-link-state">连接: -</span>
            <span class="rcon-status-chip" id="rcon-auth-state">认证: -</span>
            <span class="rcon-status-chip" id="rcon-queue-state">队列: -</span>
          </div>
        </div>

        <form id="rcon-form" class="rcon-form">
          <span class="console-prompt">RCON</span>
          <input
            id="rcon-input"
            autocomplete="off"
            placeholder="输入命令，例如 ListPlayers / ListSquads / ShowCurrentMap"
          >
          <button type="submit">发送</button>
        </form>
      </div>

      <div class="card console-log-card">
        <div id="log-list" class="log-list console-log-list"></div>
      </div>
    </section>
  `;

  const logList = root.querySelector("#log-list");
  const searchInput = root.querySelector("#search");
  const pauseButton = root.querySelector("#pause");
  const clearButton = root.querySelector("#clear");
  const rconPanel = root.querySelector("#rcon-panel");
  const rconForm = root.querySelector("#rcon-form");
  const rconInput = root.querySelector("#rcon-input");
  const viewButtons = [...root.querySelectorAll(".console-view-btn")];
  const rconLinkState = root.querySelector("#rcon-link-state");
  const rconAuthState = root.querySelector("#rcon-auth-state");
  const rconQueueState = root.querySelector("#rcon-queue-state");

  async function fullReload() {
    state.lastSeq = 0;
    logList.innerHTML = "";
    const lines = await fetchLines();
    appendLines(lines);
  }

  async function fetchLines() {
    const params = new URLSearchParams({
      channel: state.channel,
      afterSeq: String(state.lastSeq),
      limit: "300",
      q: state.q,
    });

    const data = await api(`/api/console/lines?${params}`);
    return data.lines ?? [];
  }

  function appendLines(lines) {
    if (!lines.length) return;

    const frag = document.createDocumentFragment();

    for (const line of lines) {
      state.lastSeq = Math.max(state.lastSeq, Number(line.seq ?? 0));
      frag.appendChild(renderLine(line));
    }

    logList.appendChild(frag);

    while (logList.children.length > state.maxDomLines) {
      logList.firstElementChild?.remove();
    }

    logList.scrollTop = logList.scrollHeight;
  }

  function renderLine(line) {
    const div = document.createElement("div");
    div.className = `log-line console-line level-${safeClass(line.level)} channel-${safeClass(line.channel)}`;

    div.innerHTML = `
      <span class="log-seq">#${esc(line.seq)}</span>
      <span class="log-time">${esc(shortTime(line.time))}</span>
      <span class="log-channel">${esc(getLineLabel(line))}</span>
      <span class="log-level">${esc(line.level)}</span>
      <span class="log-message">${esc(getLineMessage(line))}</span>
    `;

    return div;
  }

  function getLineLabel(line) {
    if (line.channel === "dispatcher") {
      return line.eventName || "dispatcher";
    }

    if (line.level === "input") return "command";
    if (line.level === "output") return "response";
    if (line.level === "push") return "push";
    if (line.level === "status") return "status";
    return line.channel || "console";
  }

  function getLineMessage(line) {
    const text = String(line.message ?? "");

    if (line.channel === "dispatcher" && line.eventName) {
      if (text === line.eventName) return "";

      const prefix = `${line.eventName} | `;
      if (text.startsWith(prefix)) {
        return text.slice(prefix.length);
      }
    }

    return text;
  }

  async function setView(view) {
    if (!VIEW_OPTIONS[view]) return;

    state.view = view;
    state.channel = VIEW_OPTIONS[view].channel;
    state.q = "";
    searchInput.value = "";
    searchInput.placeholder = VIEW_OPTIONS[view].searchPlaceholder;
    rconPanel.hidden = view !== "rcon-native";

    for (const button of viewButtons) {
      const active = button.dataset.view === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    }

    if (view === "rcon-native") {
      await refreshRconStatus();
      rconInput.focus();
    }

    await fullReload();
  }

  async function refreshRconStatus() {
    if (state.view !== "rcon-native") return;

    try {
      const status = await api("/api/rcon/status");
      rconLinkState.textContent = `连接: ${status.connected ? "connected" : "disconnected"}`;
      rconAuthState.textContent = `认证: ${status.authenticated ? "yes" : "no"}`;
      rconQueueState.textContent = `队列: ${Number(status.queueSize ?? 0)}`;
    } catch {
      rconLinkState.textContent = "连接: error";
      rconAuthState.textContent = "认证: error";
      rconQueueState.textContent = "队列: -";
    }
  }

  for (const button of viewButtons) {
    button.addEventListener("click", async () => {
      await setView(button.dataset.view);
    });
  }

  searchInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    state.q = searchInput.value.trim();
    await fullReload();
  });

  pauseButton.addEventListener("click", () => {
    state.paused = !state.paused;
    pauseButton.textContent = state.paused ? "继续" : "暂停";
  });

  clearButton.addEventListener("click", () => {
    logList.innerHTML = "";
  });

  rconForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const command = rconInput.value.trim();
    if (!command) return;

    rconInput.value = "";

    await fetch("/api/console/rcon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });

    await refreshRconStatus();
    await fullReload();
  });

  await setView("dispatcher");

  root.__consoleTimer = setInterval(async () => {
    if (state.paused) return;
    if (state.q) return;

    const lines = await fetchLines();
    appendLines(lines);
  }, 1000);

  root.__consoleStatusTimer = setInterval(async () => {
    await refreshRconStatus();
  }, 3000);
}

function clearPageTimers(root) {
  if (root.__consoleTimer) {
    clearInterval(root.__consoleTimer);
    root.__consoleTimer = null;
  }

  if (root.__consoleStatusTimer) {
    clearInterval(root.__consoleStatusTimer);
    root.__consoleStatusTimer = null;
  }
}

function shortTime(value) {
  const text = String(value ?? "");
  const m = text.match(/T(\d{2}:\d{2}:\d{2})/);
  if (m) return m[1];

  const m2 = text.match(/(\d{2}:\d{2}:\d{2})/);
  if (m2) return m2[1];

  return text.slice(11, 19) || text;
}

function safeClass(value) {
  return String(value ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[c]));
}
