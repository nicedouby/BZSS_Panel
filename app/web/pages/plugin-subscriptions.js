// -*- coding: utf-8 -*-

/**
 * 订阅页面的分类元信息。
 *
 * 这里不只是做标签映射，也承担页面解释职责：
 * 管理员切换分类时，能立刻知道这一类条目在系统中的定位。
 */
const KIND_META = {
  all: {
    label: "全部",
    subtitle: "查看所有已登记的模块、插件与页面入口。这里是面板能力的完整清单，包含运行中、已停止和尚未加载的全部条目。",
  },
  module: {
    label: "模块",
    subtitle: "模块是面板架构中看不见的核心能力层。它们负责订阅游戏原始事件、维护内存中的实时状态快照、封装 RCON 执行接口，并向上层插件和网页提供标准化 API。模块不会直接与前端交互，是整个数据流的中枢。",
  },
  plugin: {
    label: "插件",
    subtitle: "插件是基于模块事件流构建的具体业务规则扩展。它们通过订阅模块发出的 Module Event（如 combatResolved、squadCreated）来响应游戏动态，可聚合数据、触发警告、收集统计，但不允许直接调用 RCON——所有执行操作必须通过对应模块 API 完成。",
  },
  "web page": {
    label: "网页",
    subtitle: "网页是面板的前端视图入口，每个条目对应一个具体的管理页面。页面数据由对应模块的 API 提供，通过 WebRegistry 注册后出现在左侧导航栏。关闭某个网页条目不会影响其后端模块的运行，仅隐藏该入口。",
  },
  parser: {
    label: "解析器",
    subtitle: "解析器是日志和协议的原始事件解析单元。Python 日志解析进程（LogPost）将 Squad 游戏日志文件实时尾读，逐行匹配正则规则后转为结构化事件，通过 UDP 或 HTTP 推送到 Node.js 核心，再经由 EventBus 分发给各模块。",
  },
  unknown: {
    label: "其他",
    subtitle: "暂时无法识别类型的条目会先归入此处。通常是尚未配置 manifest.kind 字段的新条目，或处于 unloaded 状态的历史遗留记录。",
  },
};

const STATUS_LABELS = {
  running: "运行中",
  stopped: "已停止",
  unloaded: "未加载",
  error: "错误",
};

/**
 * 插件订阅页
 *
 * 这个页面的重点不是安装管理，而是把“哪些能力正在接收实时事件”讲清楚。
 * 因此布局上优先突出分类、状态和订阅开关，而不是做成普通长表格。
 */
export async function renderPage({ root, api, apiFetch }) {
  clearTimer(root);

  const state = {
    subscriptions: [],
    pendingIds: new Set(),
    lastUpdatedAt: "",
    activeKind: "all",
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

      <section id="plugin-subscriptions-summary" class="plugin-subscriptions-summary"></section>

      <section class="card plugin-subscriptions-filter-card">
        <div class="plugin-subscriptions-filter-head">
          <div>
            <div class="plugin-subscriptions-filter-title">分类视图</div>
            <div id="plugin-subscriptions-filter-subtitle" class="plugin-subscriptions-filter-subtitle"></div>
          </div>
        </div>
        <div id="plugin-subscriptions-kind-tabs" class="plugin-subscriptions-kind-tabs"></div>
      </section>

      <div id="plugin-subscriptions-error" class="plugin-subscriptions-error" hidden></div>

      <section id="plugin-subscriptions-groups" class="plugin-subscriptions-groups"></section>
    </section>
  `;

  const els = {
    summary: root.querySelector("#plugin-subscriptions-summary"),
    status: root.querySelector("#plugin-subscriptions-status"),
    filterSubtitle: root.querySelector("#plugin-subscriptions-filter-subtitle"),
    kindTabs: root.querySelector("#plugin-subscriptions-kind-tabs"),
    error: root.querySelector("#plugin-subscriptions-error"),
    groups: root.querySelector("#plugin-subscriptions-groups"),
    refresh: root.querySelector("#plugin-subscriptions-refresh"),
  };

  /**
   * 从后端读取最新状态。
   * 页面定时刷新与手动刷新共用这一条路径，避免出现两套渲染逻辑。
   */
  async function loadState({ silent = false } = {}) {
    try {
      const data = await api("/api/plugin-subscriptions/state");
      state.subscriptions = data.subscriptions ?? [];
      state.lastUpdatedAt = data.lastUpdatedAt ?? "";
      renderPageState();
      els.status.textContent = `已刷新 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
      showError("");
    } catch (error) {
      if (!silent) showError(`读取订阅状态失败：${error.message}`);
      throw error;
    }
  }

  function renderPageState() {
    renderSummary(els.summary, state);
    renderKindTabs(els.kindTabs, state);
    renderGroups(els.groups, state);
    els.filterSubtitle.textContent = getKindMeta(state.activeKind).subtitle;
  }

  /**
   * 顶部摘要区用于快速感知全局状态。
   */
  function renderSummary(container, pageState) {
    const total = pageState.subscriptions.length;
    const enabledCount = pageState.subscriptions.filter((item) => item.subscribed).length;
    const pausedCount = total - enabledCount;
    const runningCount = pageState.subscriptions.filter((item) => item.status === "running").length;

    container.innerHTML = [
      summaryCard("总条目", String(total)),
      summaryCard("订阅中", String(enabledCount)),
      summaryCard("已暂停", String(pausedCount)),
      summaryCard("运行中", String(runningCount)),
    ].join("");
  }

  /**
   * 分类按钮除了过滤，还承担“解释每种类型是什么”的作用。
   */
  function renderKindTabs(container, pageState) {
    const counts = countByKind(pageState.subscriptions);
    const kinds = ["all", "module", "plugin", "web page", "parser", "unknown"];

    container.innerHTML = kinds.map((kind) => {
      const meta = getKindMeta(kind);
      const active = pageState.activeKind === kind;
      const count = kind === "all" ? pageState.subscriptions.length : (counts[kind] ?? 0);

      return `
        <button
          type="button"
          class="plugin-kind-tab ${active ? "is-active" : ""}"
          data-kind="${escAttr(kind)}"
        >
          <strong>${esc(meta.label)}</strong>
          <span>${esc(String(count))}</span>
        </button>
      `;
    }).join("");

    container.querySelectorAll("[data-kind]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeKind = button.dataset.kind || "all";
        renderPageState();
      });
    });
  }

  /**
   * 页面主体按类型分组，每一组单独形成自己的可滚动容器。
   * 这样页面本身不需要长滚动，管理员可以并排比较不同类别。
   */
  function renderGroups(container, pageState) {
    const groups = groupSubscriptions(pageState.subscriptions, pageState.activeKind);

    if (!groups.length) {
      container.innerHTML = `
        <div class="card plugin-subscriptions-table-card">
          <div class="kill-empty-cell">当前分类下暂无已登记条目</div>
        </div>
      `;
      return;
    }

    container.innerHTML = groups.map(({ kind, items }) => {
      const meta = getKindMeta(kind);
      return `
        <section class="card plugin-subscriptions-group-card">
          <div class="plugin-subscriptions-group-head">
            <div>
              <div class="plugin-subscriptions-group-title">${esc(meta.label)}</div>
              <div class="plugin-subscriptions-group-subtitle">${esc(meta.subtitle)}</div>
            </div>
            <div class="plugin-subscriptions-group-count">${esc(String(items.length))} 项</div>
          </div>
          <div class="plugin-subscriptions-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>ID</th>
                  <th>状态</th>
                  <th>是否订阅</th>
                  <th>说明</th>
                  <th>最近更新时间</th>
                </tr>
              </thead>
              <tbody>
                ${items.map((item) => renderRow(item, pageState.pendingIds)).join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }).join("");

    bindSwitchEvents(container, pageState);
  }

  function renderRow(item, pendingIds) {
    const pending = pendingIds.has(item.id);
    const subscribed = Boolean(item.subscribed);

    return `
      <tr>
        <td>
          <div class="plugin-subscription-name-cell">
            <strong>${esc(item.name || item.id)}</strong>
            <span>${esc(getKindMeta(item.kind).label)}</span>
          </div>
        </td>
        <td><code>${esc(item.id)}</code></td>
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
  }

  /**
   * 开关操作采用乐观更新。
   * 成功则保持当前状态，失败则立刻回滚并显示错误。
   */
  function bindSwitchEvents(container, pageState) {
    container.querySelectorAll("[data-plugin-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.pluginId;
        if (!id || pageState.pendingIds.has(id)) return;

        const item = pageState.subscriptions.find((entry) => entry.id === id);
        if (!item) return;

        const previous = Boolean(item.subscribed);
        const next = !previous;

        item.subscribed = next;
        pageState.pendingIds.add(id);
        renderPageState();

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
          pageState.pendingIds.delete(id);
          renderPageState();
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

/**
 * 根据当前激活分类对条目做分组。
 */
function groupSubscriptions(items, activeKind) {
  const grouped = new Map();

  for (const item of items) {
    if (activeKind !== "all" && item.kind !== activeKind) continue;
    if (!grouped.has(item.kind)) grouped.set(item.kind, []);
    grouped.get(item.kind).push(item);
  }

  return [...grouped.entries()]
    .map(([kind, groupItems]) => ({ kind, items: groupItems }))
    .sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind));
}

function countByKind(items) {
  const result = {};

  for (const item of items) {
    result[item.kind] = (result[item.kind] ?? 0) + 1;
  }

  return result;
}

function getKindMeta(kind) {
  return KIND_META[kind] ?? KIND_META.unknown;
}

function kindOrder(kind) {
  return {
    module: 0,
    plugin: 1,
    "web page": 2,
    parser: 3,
    unknown: 4,
  }[kind] ?? 5;
}

function summaryCard(label, value) {
  return `
    <div class="card plugin-summary-card">
      <span>${esc(label)}</span>
      <strong>${esc(value)}</strong>
    </div>
  `;
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
