// -*- coding: utf-8 -*-

const VIEW_OPTIONS = {
  modules: {
    stream: "modules",
    title: "模块日志",
    searchPlaceholder: "过滤模块名、事件名、操作或消息",
  },
  "raw-log": {
    stream: "raw-log",
    title: "Raw Log",
    searchPlaceholder: "过滤原始日志内容、source 或 channel",
  },
  "rcon-native": {
    stream: "rcon-native",
    title: "RCON 原生",
    searchPlaceholder: "过滤命令、响应、推送或错误",
  },
};

export async function renderPage({ root, api, apiFetch }) {
  clearPageTimers(root);

  const state = {
    view: "modules",
    stream: "modules",
    scope: "all",
    level: "all",
    q: "",
    lastSeq: 0,
    paused: false,
    maxDomLines: 800,
    rawOutputEnabled: false,
  };

  root.innerHTML = `
    <section class="page console-page">
      <div class="page-title-row">
        <div>
          <div class="page-title">控制台</div>
          <div class="page-subtitle">查看模块日志、LogPost 原始日志输出和 RCON 原生收发。</div>
        </div>
        <div class="console-actions">
          <div class="console-view-toggle" role="tablist" aria-label="控制台视图">
            <button type="button" class="console-view-btn active" data-view="modules">模块日志</button>
            <button type="button" class="console-view-btn" data-view="raw-log">Raw Log</button>
            <button type="button" class="console-view-btn" data-view="rcon-native">RCON 原生</button>
          </div>
          <select id="scope-filter" class="console-filter" aria-label="来源筛选"></select>
          <select id="level-filter" class="console-filter" aria-label="级别筛选"></select>
          <input id="search" class="console-search" placeholder="${esc(VIEW_OPTIONS.modules.searchPlaceholder)}">
          <button id="raw-output-toggle" type="button">Raw 输出: ...</button>
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
  const scopeFilter = root.querySelector("#scope-filter");
  const levelFilter = root.querySelector("#level-filter");
  const rawOutputToggle = root.querySelector("#raw-output-toggle");
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
    await refreshFilters();
    const lines = await fetchLines();
    appendLines(lines);
  }

  async function refreshFilters() {
    const meta = await api(`/api/console/channels?stream=${encodeURIComponent(state.stream)}`);
    applySelectOptions(scopeFilter, meta.scopes ?? [], state.scope);
    applySelectOptions(levelFilter, meta.levels ?? [], state.level);

    if (![...scopeFilter.options].some((item) => item.value === state.scope)) {
      state.scope = "all";
      scopeFilter.value = state.scope;
    }

    if (![...levelFilter.options].some((item) => item.value === state.level)) {
      state.level = "all";
      levelFilter.value = state.level;
    }
  }

  async function fetchLines() {
    const params = new URLSearchParams({
      stream: state.stream,
      scope: state.scope,
      level: state.level,
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
    div.className = `log-line console-line level-${safeClass(line.level)} channel-${safeClass(line.channel)} stream-${safeClass(line.stream)}`;

    div.innerHTML = `
      <span class="log-seq">#${esc(line.seq)}</span>
      <span class="log-time">${esc(shortTime(line.time))}</span>
      <span class="log-channel">${esc(getLineLabel(line))}</span>
      <span class="log-level">${esc(line.level)}</span>
      <span class="log-message">${esc(getLineMessage(line))}</span>
    `;

    if (line.dataSummary) div.title = String(line.dataSummary);
    if (line.rawTruncated) div.title = "Raw line was truncated for UDP/UI output. Full raw input remains in LogPost raw_input_log.";
    return div;
  }

  function getLineLabel(line) {
    if (state.stream === "raw-log") {
      return [line.rawSource || line.source || "Squad.log", line.rawChannel || line.scope]
        .filter(Boolean)
        .join(" / ");
    }

    if (state.stream === "modules") {
      return line.scope || line.moduleId || line.source || "app";
    }

    if (line.level === "input") return "command";
    if (line.level === "output") return "response";
    if (line.level === "push") return "push";
    if (line.level === "status") return "status";
    return line.scope || line.source || line.channel || "rcon";
  }

  function getLineMessage(line) {
    if (state.stream === "raw-log") {
      return line.message || "";
    }

    const detailParts = [];
    if (line.eventName) detailParts.push(line.eventName);
    if (line.operation) detailParts.push(line.operation);
    if (line.message) detailParts.push(String(line.message));
    if (line.dataSummary && line.dataSummary !== line.message) detailParts.push(`[${line.dataSummary}]`);
    return detailParts.filter(Boolean).join(" | ");
  }

  async function setView(view) {
    if (!VIEW_OPTIONS[view]) return;

    state.view = view;
    state.stream = VIEW_OPTIONS[view].stream;
    state.scope = "all";
    state.level = "all";
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

  async function refreshRawOutputStatus() {
    try {
      const data = await api("/api/logpost/raw-output");
      state.rawOutputEnabled = Boolean(data.enabled);
      rawOutputToggle.textContent = `Raw 输出: ${state.rawOutputEnabled ? "开" : "关"}`;
      rawOutputToggle.classList.toggle("active", state.rawOutputEnabled);
      rawOutputToggle.title = state.rawOutputEnabled
        ? "LogPost 正在向控制台输出 On_RawLogLine"
        : "LogPost 当前只保存 raw_input_log，不向控制台输出 raw 日志";
    } catch {
      rawOutputToggle.textContent = "Raw 输出: ?";
      rawOutputToggle.title = "无法读取 LogPost raw 输出配置";
    }
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

  scopeFilter.addEventListener("change", async () => {
    state.scope = scopeFilter.value || "all";
    await fullReload();
  });

  levelFilter.addEventListener("change", async () => {
    state.level = levelFilter.value || "all";
    await fullReload();
  });

  rawOutputToggle.addEventListener("click", async () => {
    rawOutputToggle.disabled = true;
    try {
      const res = await apiFetch("/api/logpost/raw-output", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !state.rawOutputEnabled }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      state.rawOutputEnabled = Boolean(data.enabled);
      await refreshRawOutputStatus();
      if (state.view === "raw-log") await fullReload();
    } finally {
      rawOutputToggle.disabled = false;
    }
  });

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

    await apiFetch("/api/console/rcon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });

    await refreshRconStatus();
    await fullReload();
  });

  await refreshRawOutputStatus();
  await setView("modules");

  root.__consoleTimer = setInterval(async () => {
    if (state.paused) return;
    if (state.q) return;

    const lines = await fetchLines();
    appendLines(lines);
  }, 1000);

  root.__consoleMetaTimer = setInterval(async () => {
    await refreshFilters();
  }, 5000);

  root.__consoleStatusTimer = setInterval(async () => {
    await refreshRconStatus();
  }, 3000);
}

function applySelectOptions(select, items, currentValue) {
  select.innerHTML = "";

  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.title;
    if (item.id === currentValue) option.selected = true;
    select.appendChild(option);
  }
}

function clearPageTimers(root) {
  if (root.__consoleTimer) {
    clearInterval(root.__consoleTimer);
    root.__consoleTimer = null;
  }

  if (root.__consoleMetaTimer) {
    clearInterval(root.__consoleMetaTimer);
    root.__consoleMetaTimer = null;
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
