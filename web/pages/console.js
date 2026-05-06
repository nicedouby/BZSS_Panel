// -*- coding: utf-8 -*-

/**
 * 页面：控制台
 *
 * 目标：
 * - 频道筛选
 * - RCON 输入框
 * - 增量拉取日志
 * - DOM 数量上限，避免长时间运行导致页面变慢
 */

export async function renderPage({ root, api }) {
  const state = {
    channel: "all",
    q: "",
    lastSeq: 0,
    paused: false,
    maxDomLines: 800,
  };

  const channelsData = await api("/api/console/channels");
  const channels = channelsData.channels ?? [];

  root.innerHTML = `
    <section class="page console-page">
      <div class="page-title-row">
        <div class="page-title">控制台</div>
        <div class="console-actions">
          <select id="channel">
            ${channels.map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join("")}
          </select>
          <input id="search" class="console-search" placeholder="筛选日志内容">
          <button id="pause">暂停</button>
          <button id="clear">清空视图</button>
        </div>
      </div>

      <div class="card console-command-card">
        <form id="rcon-form" class="rcon-form">
          <span class="console-prompt">RCON</span>
          <input id="rcon-input" autocomplete="off" placeholder="输入 RCON 指令，例如 ListPlayers / ListSquads / ShowCurrentMap">
          <button type="submit">发送</button>
        </form>
      </div>

      <div class="card console-log-card">
        <div id="log-list" class="log-list console-log-list"></div>
      </div>
    </section>
  `;

  const logList = root.querySelector("#log-list");
  const channelSelect = root.querySelector("#channel");
  const searchInput = root.querySelector("#search");
  const pauseButton = root.querySelector("#pause");
  const clearButton = root.querySelector("#clear");
  const rconForm = root.querySelector("#rcon-form");
  const rconInput = root.querySelector("#rcon-input");

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
      <span class="log-channel">${esc(line.channel)}</span>
      <span class="log-level">${esc(line.level)}</span>
      <span class="log-message">${esc(line.message)}</span>
    `;

    return div;
  }

  channelSelect.addEventListener("change", async () => {
    state.channel = channelSelect.value;
    await fullReload();
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

    await fetch("/api/console/rcon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });

    state.channel = "rcon";
    channelSelect.value = "rcon";
    await fullReload();
  });

  await fullReload();

  const timer = setInterval(async () => {
    if (state.paused) return;
    if (state.q) return;

    const lines = await fetchLines();
    appendLines(lines);
  }, 1000);

  // 页面被重新渲染时，旧 DOM 会被替换；这里用弱方式避免明显泄漏。
  root.__consoleTimer = timer;
}

function shortTime(value) {
  const text = String(value ?? "");
  const m = text.match(/T(\d{2}:\d{2}:\d{2})/);
  if (m) return m[1];
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
