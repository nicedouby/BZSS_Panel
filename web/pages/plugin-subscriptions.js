// -*- coding: utf-8 -*-

const KIND_LABELS = {
  module: "module",
  plugin: "plugin",
  "web page": "web page",
  parser: "parser",
  unknown: "unknown",
};

const STATUS_LABELS = {
  running: "运行中",
  stopped: "已停止",
  unloaded: "未加载",
  error: "错误",
};

export async function renderPage({ root, api, apiFetch }) {
  clearTimer(root);

  const state = {
    subscriptions: [],
    pendingIds: new Set(),
    lastUpdatedAt: "",
  };

  root.innerHTML = `
    <section class="page plugin-subscriptions-page">
      <div class="page-title-row">
        <div>
          <div class="page-title">插件订阅</div>
          <div class="page-subtitle">选择需要启用的插件。关闭后，该插件不再接收实时事件，也不再向前端推送数据。</div>
        </div>
        <div class="plugin-subscription-actions">
          <span id="plugin-subscriptions-status" class="kill-refresh-status">等待刷新</span>
          <button id="plugin-subscriptions-refresh" type="button">刷新</button>
        </div>
      </div>

      <div id="plugin-subscriptions-error" class="plugin-subscriptions-error" hidden></div>

      <div class="card plugin-subscriptions-table-card">
        <div class="plugin-subscriptions-table-wrap">
          <table>
            <thead>
              <tr>
                <th>插件名称</th>
                <th>插件 ID</th>
                <th>类型</th>
                <th>状态</th>
                <th>是否订阅</th>
                <th>简短说明</th>
                <th>最近更新时间</th>
              </tr>
            </thead>
            <tbody id="plugin-subscriptions-body"></tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  const els = {
    body: root.querySelector("#plugin-subscriptions-body"),
    status: root.querySelector("#plugin-subscriptions-status"),
    error: root.querySelector("#plugin-subscriptions-error"),
    refresh: root.querySelector("#plugin-subscriptions-refresh"),
  };

  async function loadState({ silent = false } = {}) {
    try {
      const data = await api("/api/plugin-subscriptions/state");
      state.subscriptions = data.subscriptions ?? [];
      state.lastUpdatedAt = data.lastUpdatedAt ?? "";
      renderRows();
      els.status.textContent = `已刷新 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
      showError("");
    } catch (error) {
      if (!silent) showError(`读取订阅状态失败：${error.message}`);
      throw error;
    }
  }

  function renderRows() {
    if (!state.subscriptions.length) {
      els.body.innerHTML = `<tr><td colspan="7" class="kill-empty-cell">暂无已注册插件或模块</td></tr>`;
      return;
    }

    els.body.innerHTML = state.subscriptions.map((item) => {
      const pending = state.pendingIds.has(item.id);
      const subscribed = Boolean(item.subscribed);
      return `
        <tr>
          <td><strong>${esc(item.name || item.id)}</strong></td>
          <td><code>${esc(item.id)}</code></td>
          <td>${esc(KIND_LABELS[item.kind] ?? "unknown")}</td>
          <td><span class="plugin-status plugin-status-${safeClass(item.status)}">${esc(STATUS_LABELS[item.status] ?? item.status ?? "未知")}</span></td>
          <td>
            <button
              type="button"
              class="plugin-subscription-switch ${subscribed ? "is-on" : ""}"
              data-plugin-id="${escAttr(item.id)}"
              role="switch"
              aria-checked="${subscribed ? "true" : "false"}"
              ${pending ? "disabled" : ""}
            >
              <span>${subscribed ? "启用" : "关闭"}</span>
            </button>
          </td>
          <td>${esc(item.description || "-")}</td>
          <td>${esc(formatTime(item.lastUpdatedAt))}</td>
        </tr>
      `;
    }).join("");

    els.body.querySelectorAll("[data-plugin-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.pluginId;
        if (!id || state.pendingIds.has(id)) return;
        const item = state.subscriptions.find((entry) => entry.id === id);
        if (!item) return;

        const previous = Boolean(item.subscribed);
        const next = !previous;
        item.subscribed = next;
        state.pendingIds.add(id);
        renderRows();

        try {
          const res = await apiFetch("/api/plugin-subscriptions/set", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, subscribed: next }),
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.message ?? data.error ?? "切换失败");
          }
          item.subscribed = Boolean(data.subscribed);
          showError("");
          await loadState({ silent: true });
        } catch (error) {
          item.subscribed = previous;
          showError(`更新 ${id} 失败：${error.message}`);
        } finally {
          state.pendingIds.delete(id);
          renderRows();
        }
      });
    });
  }

  function showError(message) {
    els.error.hidden = !message;
    els.error.textContent = message;
  }

  els.refresh.addEventListener("click", () => {
    loadState().catch(() => {});
  });

  await loadState();

  root.__pluginSubscriptionsTimer = window.setInterval(() => {
    loadState({ silent: true }).catch((error) => {
      if (error?.code !== "Unauthorized") {
        els.status.textContent = "刷新失败";
      }
    });
  }, 4000);

  root.__pageCleanup = () => clearTimer(root);
  return root.__pageCleanup;
}

function clearTimer(root) {
  if (root.__pluginSubscriptionsTimer) {
    window.clearInterval(root.__pluginSubscriptionsTimer);
    root.__pluginSubscriptionsTimer = null;
  }
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("zh-CN", { hour12: false });
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

function escAttr(value) {
  return esc(value).replace(/`/g, "&#96;");
}
