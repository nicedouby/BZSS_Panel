// -*- coding: utf-8 -*-

export async function renderPage({ root, api, taskManager }) {
  let status = null;
  let selectedTarget = null;
  let selectedLogs = [];
  let selectedLoading = false;
  let selectedError = "";
  let logTimer = null;
  let logRequestSeq = 0;

  async function refresh() {
    try {
      status = await api("/api/system/status");
      render();
    } catch (error) {
      root.innerHTML = `<div class="card">加载失败: ${escapeHtml(error.message)}</div>`;
    }
  }

  function render() {
    if (!status) return;

    const { system, modules, plugins } = status;

    root.innerHTML = `
      <section class="page">
        <div class="page-header">
          <div class="page-title">运行状态</div>
          <div class="page-subtitle">系统内核、模块与插件的实时运行状态。</div>
        </div>

        <div class="card" style="margin-bottom: 20px;">
          <div class="card-title">系统信息</div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; margin-top: 15px;">
            <div class="status-item">
              <div class="status-label">Uptime</div>
              <div class="status-value">${formatUptime(system.uptime)}</div>
            </div>
            <div class="status-item">
              <div class="status-label">Memory (RSS)</div>
              <div class="status-value">${formatMemory(system.memory.rss)}</div>
            </div>
            <div class="status-item">
              <div class="status-label">Node.js</div>
              <div class="status-value">${escapeHtml(system.nodeVersion)}</div>
            </div>
            <div class="status-item">
              <div class="status-label">Platform</div>
              <div class="status-value">${escapeHtml(system.platform)} (${escapeHtml(system.arch)})</div>
            </div>
          </div>
        </div>

        <div class="card" style="margin-bottom: 20px;">
          <div class="card-title">内置模块 (${modules.length})</div>
          <div class="status-grid">
            ${modules.map((m) => renderItem(m, "module")).join("")}
          </div>
        </div>

        <div class="card">
          <div class="card-title">外部插件 (${plugins.length})</div>
          <div class="status-grid">
            ${plugins.map((p) => renderItem(p, "plugin")).join("")}
          </div>
        </div>
      </section>

      <style>
        .status-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 15px;
          margin-top: 15px;
        }
        .status-card {
          padding: 12px;
          background: var(--bg-secondary);
          border-radius: 6px;
          border: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 4px;
          width: 100%;
          text-align: left;
          cursor: pointer;
          transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.15s ease;
        }
        .status-card:hover {
          border-color: rgba(96, 165, 250, 0.45);
          background: rgba(255, 255, 255, 0.03);
        }
        .status-card:focus-visible {
          outline: 2px solid #6aa6ff;
          outline-offset: 2px;
        }
        .status-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }
        .status-card-name {
          font-weight: 600;
          color: var(--text-primary);
        }
        .status-card-id {
          font-size: 11px;
          color: var(--muted);
          font-family: monospace;
        }
        .status-card-desc {
          font-size: 13px;
          color: var(--text-secondary);
          margin-top: 4px;
        }
        .status-badge {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 10px;
          text-transform: uppercase;
          font-weight: 700;
          flex: 0 0 auto;
        }
        .status-badge.running { background: rgba(var(--color-good-rgb), 0.1); color: var(--color-good); }
        .status-badge.stopped { background: rgba(var(--color-bad-rgb), 0.1); color: var(--color-bad); }

        .status-item .status-label { font-size: 12px; color: var(--muted); }
        .status-item .status-value { font-weight: 600; font-size: 16px; }

        .runtime-log-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          z-index: 80;
        }
        .runtime-log-modal {
          position: fixed;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: min(1100px, calc(100vw - 48px));
          height: min(78vh, calc(100vh - 48px));
          background: rgba(8, 13, 27, 0.96);
          border: 1px solid var(--line2);
          border-radius: 14px;
          z-index: 90;
          box-shadow: var(--shadow);
          backdrop-filter: blur(18px);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .runtime-log-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--line);
        }
        .runtime-log-title {
          min-width: 0;
        }
        .runtime-log-title h3 {
          margin: 0;
          font-size: 18px;
        }
        .runtime-log-title p {
          margin: 6px 0 0;
          color: var(--muted);
          font-size: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .runtime-log-actions {
          display: flex;
          gap: 8px;
          flex: 0 0 auto;
        }
        .runtime-log-button {
          width: 34px;
          height: 34px;
          border-radius: 8px;
          border: 1px solid var(--line);
          background: rgba(255, 255, 255, 0.04);
          color: var(--text);
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        .runtime-log-button:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.08);
        }
        .runtime-log-button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .runtime-log-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 12px 16px 0;
        }
        .runtime-log-chip {
          display: inline-flex;
          align-items: center;
          min-height: 24px;
          padding: 0 10px;
          border-radius: 999px;
          font-size: 12px;
          background: rgba(255, 255, 255, 0.08);
          color: #d5dde5;
        }
        .runtime-log-chip.module { color: #8fb3ff; background: rgba(96, 165, 250, 0.12); }
        .runtime-log-chip.plugin { color: #8ee3a6; background: rgba(46, 204, 113, 0.12); }
        .runtime-log-chip.scope { color: #f0c56a; }
        .runtime-log-summary {
          padding: 10px 16px 0;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.5;
        }
        .runtime-log-error {
          margin: 12px 16px 0;
          padding: 10px 12px;
          border-radius: 8px;
          background: rgba(255, 107, 107, 0.1);
          border: 1px solid rgba(255, 107, 107, 0.3);
          color: #ff8f8f;
          font-size: 13px;
        }
        .runtime-log-body {
          flex: 1;
          min-height: 0;
          margin: 12px 16px 16px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          background: #0d1117;
          overflow: auto;
        }
        .runtime-log-empty {
          height: 100%;
          display: grid;
          place-items: center;
          color: var(--muted);
          font-size: 13px;
        }
        .runtime-log-line {
          display: grid;
          grid-template-columns: auto auto auto 1fr;
          gap: 10px;
          align-items: center;
          min-height: 32px;
          padding: 0 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          font-family: Consolas, "JetBrains Mono", monospace;
          font-size: 12px;
          color: #d1d5da;
        }
        .runtime-log-line .seq {
          color: #6a7680;
          width: 46px;
        }
        .runtime-log-line .time,
        .runtime-log-line .scope,
        .runtime-log-line .level {
          color: #8b949e;
          white-space: nowrap;
        }
        .runtime-log-line .msg {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .runtime-log-line.level-warn .msg,
        .runtime-log-line.level-warn .level {
          color: #d29922;
        }
        .runtime-log-line.level-error .msg,
        .runtime-log-line.level-error .level {
          color: #f85149;
        }
        .runtime-log-line.level-debug .msg,
        .runtime-log-line.level-debug .level {
          color: #8b949e;
        }
      </style>
    `;

    root.querySelectorAll(".status-card").forEach((card) => {
      card.addEventListener("click", () => {
        const kind = card.dataset.kind || "module";
        const id = card.dataset.id || "";
        const item = (kind === "plugin" ? plugins : modules).find((entry) => entry.id === id);
        if (item) openLogWindow({ ...item, kind });
      });
    });
  }

  function renderItem(item, kind) {
    return `
      <button
        type="button"
        class="status-card"
        data-kind="${escapeHtml(kind)}"
        data-id="${escapeHtml(item.id)}"
        title="查看 ${escapeHtml(item.name)} 日志"
      >
        <div class="status-card-header">
          <span class="status-card-name">${escapeHtml(item.name)}</span>
          <span class="status-badge ${escapeHtml(item.status)}">Running</span>
        </div>
        <div class="status-card-id">${escapeHtml(item.id)} @ ${escapeHtml(item.version)}</div>
        <div class="status-card-desc">${escapeHtml(item.description)}</div>
      </button>
    `;
  }

  function openLogWindow(item) {
    selectedTarget = item;
    selectedLogs = [];
    selectedError = "";
    selectedLoading = true;
    renderLogWindow();
    startLogTimer();
    refreshLogWindow().catch(() => {});
  }

  function closeLogWindow() {
    logRequestSeq += 1;
    stopLogTimer();
    selectedTarget = null;
    selectedLogs = [];
    selectedError = "";
    selectedLoading = false;

    const modalRoot = document.querySelector("#modal-root");
    if (modalRoot) modalRoot.innerHTML = "";
  }

  function renderLogWindow() {
    const modalRoot = document.querySelector("#modal-root");
    if (!modalRoot || !selectedTarget) return;

    modalRoot.innerHTML = `
      <div class="runtime-log-backdrop"></div>
      <div class="runtime-log-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(selectedTarget.name)} 日志">
        <div class="runtime-log-head">
          <div class="runtime-log-title">
            <h3>${escapeHtml(selectedTarget.name)} 日志</h3>
            <p>
              <span>${escapeHtml(selectedTarget.id)}</span>
              ${selectedTarget.version ? `<span>· v${escapeHtml(selectedTarget.version)}</span>` : ""}
              ${selectedTarget.status ? `<span>· ${escapeHtml(selectedTarget.status)}</span>` : ""}
            </p>
          </div>
          <div class="runtime-log-actions">
            <button id="runtime-log-refresh" type="button" class="runtime-log-button" title="刷新日志" ${selectedLoading ? "disabled" : ""}>↻</button>
            <button id="runtime-log-close" type="button" class="runtime-log-button" title="关闭">×</button>
          </div>
        </div>
        ${selectedTarget.description ? `<div class="runtime-log-summary">${escapeHtml(selectedTarget.description)}</div>` : ""}
        <div class="runtime-log-meta">
          <span class="runtime-log-chip ${escapeHtml(selectedTarget.kind)}">${selectedTarget.kind === "plugin" ? "插件日志" : "模块日志"}</span>
          <span class="runtime-log-chip scope">scope: ${escapeHtml(selectedTarget.id)}</span>
        </div>
        ${selectedError ? `<div class="runtime-log-error">${escapeHtml(selectedError)}</div>` : ""}
        <div class="runtime-log-body">
          ${selectedLoading && selectedLogs.length === 0
            ? `<div class="runtime-log-empty">正在加载日志...</div>`
            : selectedLogs.length === 0
              ? `<div class="runtime-log-empty">暂无日志</div>`
              : selectedLogs.map(renderLogLine).join("")}
        </div>
      </div>
    `;

    const backdrop = modalRoot.querySelector(".runtime-log-backdrop");
    const closeBtn = modalRoot.querySelector("#runtime-log-close");
    const refreshBtn = modalRoot.querySelector("#runtime-log-refresh");
    backdrop?.addEventListener("click", closeLogWindow);
    closeBtn?.addEventListener("click", closeLogWindow);
    refreshBtn?.addEventListener("click", () => {
      refreshLogWindow().catch(() => {});
    });
  }

  async function refreshLogWindow() {
    if (!selectedTarget) return;

    const requestSeq = ++logRequestSeq;
    selectedLoading = true;
    renderLogWindow();

    try {
      const params = new URLSearchParams({
        stream: "modules",
        scope: selectedTarget.id,
        level: "all",
        limit: "200",
      });
      const data = await api(`/api/console/lines?${params.toString()}`);
      if (requestSeq !== logRequestSeq || !selectedTarget) return;
      selectedLogs = Array.isArray(data?.lines) ? data.lines : [];
      selectedError = "";
    } catch (error) {
      if (requestSeq !== logRequestSeq || !selectedTarget) return;
      selectedError = error.message || "日志加载失败";
    } finally {
      if (requestSeq !== logRequestSeq || !selectedTarget) return;
      selectedLoading = false;
      renderLogWindow();
    }
  }

  function startLogTimer() {
    stopLogTimer();
    logTimer = setInterval(() => {
      refreshLogWindow().catch(() => {});
    }, 2000);
  }

  function stopLogTimer() {
    if (logTimer) {
      clearInterval(logTimer);
      logTimer = null;
    }
  }

  function renderLogLine(line) {
    return `
      <div class="runtime-log-line level-${safeClass(line.level)}">
        <span class="seq">#${escapeHtml(line.seq)}</span>
        <span class="time">${escapeHtml(shortTime(line.time))}</span>
        <span class="scope">${escapeHtml(line.scope || line.channel || line.stream || "app")}</span>
        <span class="level">${escapeHtml(line.level || "info")}</span>
        <span class="msg">${escapeHtml(formatLogMessage(line))}</span>
      </div>
    `;
  }

  function formatLogMessage(line) {
    return [
      line.eventName,
      line.operation,
      line.message,
      line.dataSummary && line.dataSummary !== line.message ? `[${line.dataSummary}]` : "",
    ].filter(Boolean).join(" | ");
  }

  function shortTime(value) {
    const text = String(value ?? "");
    const iso = text.match(/T(\d{2}:\d{2}:\d{2})/);
    if (iso) return iso[1];
    const plain = text.match(/(\d{2}:\d{2}:\d{2})/);
    if (plain) return plain[1];
    return text;
  }

  function safeClass(value) {
    return String(value ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(" ");
  }

  function formatMemory(bytes) {
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function onWindowKeyDown(event) {
    if (event.key === "Escape" && selectedTarget) {
      closeLogWindow();
    }
  }

  taskManager.registerTask({
    id: "runtime-status-refresh",
    intervalMs: 5000,
    run: refresh,
  });

  window.addEventListener("keydown", onWindowKeyDown);
  await refresh();

  return () => {
    taskManager.removeTask("runtime-status-refresh");
    stopLogTimer();
    window.removeEventListener("keydown", onWindowKeyDown);
    closeLogWindow();
  };
}
