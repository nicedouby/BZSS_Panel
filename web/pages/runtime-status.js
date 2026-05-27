// -*- coding: utf-8 -*-

export async function renderPage({ root, api, taskManager }) {
  let status = null;

  async function refresh() {
    try {
      status = await api("/api/system/status");
      render();
    } catch (error) {
      root.innerHTML = `<div class="card">加载失败: ${error.message}</div>`;
    }
  }

  function render() {
    if (!status) return;

    const { system, modules, plugins } = status;

    root.innerHTML = `
      <section class="page">
        <div class="page-header">
          <div class="page-title">运行状态</div>
          <div class="page-subtitle">系统内核、模块与插件的实时运行状况。</div>
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
              <div class="status-value">${system.nodeVersion}</div>
            </div>
            <div class="status-item">
              <div class="status-label">Platform</div>
              <div class="status-value">${system.platform} (${system.arch})</div>
            </div>
          </div>
        </div>

        <div class="card" style="margin-bottom: 20px;">
          <div class="card-title">内置模块 (${modules.length})</div>
          <div class="status-grid">
            ${modules.map(m => renderItem(m)).join("")}
          </div>
        </div>

        <div class="card">
          <div class="card-title">外部插件 (${plugins.length})</div>
          <div class="status-grid">
            ${plugins.map(p => renderItem(p)).join("")}
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
        }
        .status-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
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
        }
        .status-badge.running { background: rgba(var(--color-good-rgb), 0.1); color: var(--color-good); }
        .status-badge.stopped { background: rgba(var(--color-bad-rgb), 0.1); color: var(--color-bad); }
        
        .status-item .status-label { font-size: 12px; color: var(--muted); }
        .status-item .status-value { font-weight: 600; font-size: 16px; }
      </style>
    `;
  }

  function renderItem(item) {
    return `
      <div class="status-card">
        <div class="status-card-header">
          <span class="status-card-name">${escapeHtml(item.name)}</span>
          <span class="status-badge ${item.status}">${item.status}</span>
        </div>
        <div class="status-card-id">${escapeHtml(item.id)} @ ${escapeHtml(item.version)}</div>
        <div class="status-card-desc">${escapeHtml(item.description)}</div>
      </div>
    `;
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

  taskManager.registerTask({
    id: "runtime-status-refresh",
    intervalMs: 5000,
    run: refresh,
  });

  await refresh();

  return () => {
    taskManager.removeTask("runtime-status-refresh");
  };
}
