// -*- coding: utf-8 -*-

export async function renderPage({ root, api, apiFetch }) {
  if (root.__combatLogTimer) {
    window.clearInterval(root.__combatLogTimer);
    root.__combatLogTimer = null;
  }

  const state = {
    status: null,
    months: [],
    files: [],
    entries: [],
    meta: null,
    selectedMonth: "",
    selectedDate: "",
    search: "",
    limit: 200,
    offset: 0,
    bootLoading: true,
    bootError: "",
    entriesLoading: false,
    entriesError: "",
  };

  root.innerHTML = `
    <section class="page combat-log-page">
      <div class="page-title-row">
        <div>
          <div class="page-title">战斗日志</div>
          <div class="page-subtitle">按月分文件夹、按天分文件。只保留时间、事件类型、标记、攻击者、受害者、伤害和武器。</div>
        </div>
        <div class="console-actions">
          <button id="combat-log-refresh" type="button">刷新</button>
        </div>
      </div>

      <section class="card combat-log-status-card">
        <div class="combat-log-status-grid">
          <div class="combat-log-status-item">
            <span class="label">当前文件</span>
            <strong class="value" id="combat-log-current-file">--</strong>
          </div>
          <div class="combat-log-status-item">
            <span class="label">当前目标</span>
            <strong class="value" id="combat-log-current-target">--</strong>
          </div>
          <div class="combat-log-status-item">
            <span class="label">最近写入</span>
            <strong class="value" id="combat-log-last-written">--</strong>
          </div>
          <div class="combat-log-status-item">
            <span class="label">写入次数</span>
            <strong class="value" id="combat-log-write-count">--</strong>
          </div>
        </div>
        <div class="combat-log-status-path">
          <span class="label">路径</span>
          <code id="combat-log-path">--</code>
        </div>
      </section>

      <div id="combat-log-loading" class="card">加载中...</div>

      <div id="combat-log-body" hidden>
        <div class="combat-log-layout">
          <section class="card combat-log-list-card">
            <div class="section-head">
              <strong>月份</strong>
              <button type="button" class="mini-button" id="combat-log-refresh-months">刷新</button>
            </div>
            <div id="combat-log-months" class="month-list"></div>
          </section>

          <section class="card combat-log-list-card">
            <div class="section-head">
              <strong>日期</strong>
              <span class="muted" id="combat-log-month-label">--</span>
            </div>
            <div id="combat-log-files" class="day-list"></div>
          </section>

          <section class="card combat-log-viewer-card">
            <div class="viewer-toolbar">
              <input id="combat-log-search" class="search-input" placeholder="搜索攻击者 / 受害者 / 武器 / 标记">
              <select id="combat-log-limit" class="limit-select">
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="500">500</option>
                <option value="1000">1000</option>
              </select>
              <button id="combat-log-newer" type="button">更新的</button>
              <button id="combat-log-older" type="button">更旧的</button>
              <button id="combat-log-current" type="button">刷新当前页</button>
            </div>

            <div class="viewer-meta">
              <span>文件：<span id="combat-log-file-label">--</span></span>
              <span>总行数：<span id="combat-log-total">0</span></span>
              <span>偏移：<span id="combat-log-offset">0</span></span>
              <span id="combat-log-relative-path"></span>
            </div>

            <div id="combat-log-entries-loading" class="empty-note" hidden>加载中...</div>
            <div id="combat-log-entries-empty" class="empty-note" hidden>没有日志行</div>
            <div id="combat-log-entries-error" class="empty-note" hidden></div>

            <div class="log-table-wrap">
              <table class="log-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>事件</th>
                    <th>标记</th>
                    <th>攻击者</th>
                    <th>受害者</th>
                    <th>伤害</th>
                    <th>武器</th>
                  </tr>
                </thead>
                <tbody id="combat-log-rows"></tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </section>
  `;

  const els = {
    loading: root.querySelector("#combat-log-loading"),
    body: root.querySelector("#combat-log-body"),
    currentFile: root.querySelector("#combat-log-current-file"),
    currentTarget: root.querySelector("#combat-log-current-target"),
    lastWritten: root.querySelector("#combat-log-last-written"),
    writeCount: root.querySelector("#combat-log-write-count"),
    path: root.querySelector("#combat-log-path"),
    months: root.querySelector("#combat-log-months"),
    monthLabel: root.querySelector("#combat-log-month-label"),
    files: root.querySelector("#combat-log-files"),
    search: root.querySelector("#combat-log-search"),
    limit: root.querySelector("#combat-log-limit"),
    newer: root.querySelector("#combat-log-newer"),
    older: root.querySelector("#combat-log-older"),
    current: root.querySelector("#combat-log-current"),
    total: root.querySelector("#combat-log-total"),
    offset: root.querySelector("#combat-log-offset"),
    relativePath: root.querySelector("#combat-log-relative-path"),
    rows: root.querySelector("#combat-log-rows"),
    entriesLoading: root.querySelector("#combat-log-entries-loading"),
    entriesEmpty: root.querySelector("#combat-log-entries-empty"),
    entriesError: root.querySelector("#combat-log-entries-error"),
  };

  async function bootstrap() {
    state.bootLoading = true;
    state.bootError = "";
    renderState();

    try {
      await refreshStatus();
      await refreshMonths();
      await ensureSelection();
      await loadFiles();
      await ensureDateSelection();
      await reloadEntries();
    } catch (error) {
      state.bootError = error?.message || "加载战斗日志失败";
    } finally {
      state.bootLoading = false;
      renderState();
    }
  }

  async function refreshStatus() {
    state.status = await api("/api/combat-logs/status");
  }

  async function refreshMonths() {
    const data = await api("/api/combat-logs/months");
    state.months = Array.isArray(data.months) ? data.months : [];
  }

  async function loadFiles() {
    if (!state.selectedMonth) {
      state.files = [];
      return;
    }
    const data = await api(`/api/combat-logs/files?month=${encodeURIComponent(state.selectedMonth)}`);
    state.files = Array.isArray(data.files) ? data.files : [];
  }

  async function reloadEntries() {
    if (!state.selectedMonth || !state.selectedDate) {
      state.entries = [];
      state.meta = null;
      renderState();
      return;
    }

    state.entriesLoading = true;
    state.entriesError = "";
    renderState();

    try {
      const params = new URLSearchParams({
        month: state.selectedMonth,
        date: state.selectedDate,
        q: state.search,
        offset: String(state.offset),
        limit: String(state.limit),
      });
      const data = await api(`/api/combat-logs/read?${params.toString()}`);
      state.entries = Array.isArray(data.lines) ? data.lines : [];
      state.meta = data;
    } catch (error) {
      state.entriesError = error?.message || "加载战斗日志失败";
      state.entries = [];
      state.meta = null;
    } finally {
      state.entriesLoading = false;
      renderState();
    }
  }

  async function ensureSelection() {
    state.selectedMonth = state.selectedMonth
      || String(root.dataset.month || "").trim()
      || String(state.status?.currentMonth ?? "").trim()
      || state.months[0]?.month
      || "";
  }

  async function ensureDateSelection() {
    state.selectedDate = state.selectedDate
      || String(root.dataset.date || "").trim()
      || String(state.status?.currentDate ?? "").trim()
      || state.files[0]?.date
      || "";
  }

  function renderState() {
    els.loading.hidden = !state.bootLoading;
    els.body.hidden = state.bootLoading || Boolean(state.bootError);
    if (state.bootError) {
      els.loading.textContent = state.bootError;
      els.loading.hidden = false;
      els.body.hidden = true;
    }

    els.currentFile.textContent = state.status?.currentRelativePath
      || state.status?.currentTargetRelativePath
      || state.status?.currentFilePath
      || state.status?.currentTargetFilePath
      || "--";
    els.currentTarget.textContent = state.status
      ? `${state.status.currentMonth ?? "--"} / ${state.status.currentDate ?? "--"}`
      : "--";
    els.lastWritten.textContent = formatDateTime(state.status?.lastWrittenAt);
    els.writeCount.textContent = formatNumber(state.status?.writeCount ?? 0);
    els.path.textContent = state.status?.currentRelativePath
      || state.status?.currentTargetRelativePath
      || state.status?.currentFilePath
      || state.status?.currentTargetFilePath
      || "--";

    renderMonths();
    renderFiles();
    renderEntries();

    els.monthLabel.textContent = state.selectedMonth || "--";
    els.total.textContent = formatNumber(state.meta?.total ?? 0);
    els.offset.textContent = formatNumber(state.offset);
    els.relativePath.textContent = state.meta?.relativePath ? `路径：${state.meta.relativePath}` : "";

    els.search.value = state.search;
    els.limit.value = String(state.limit);
    els.newer.disabled = state.offset <= 0;
    els.older.disabled = !Boolean(state.meta?.hasMoreOlder);
    els.current.disabled = !state.selectedMonth || !state.selectedDate;

    els.entriesLoading.hidden = !state.entriesLoading;
    els.entriesEmpty.hidden = state.entriesLoading || Boolean(state.entriesError) || state.entries.length > 0;
    els.entriesError.hidden = !state.entriesError;
    els.entriesError.textContent = state.entriesError;
  }

  function renderMonths() {
    els.months.innerHTML = state.months.length
      ? state.months.map((month) => `
        <button type="button" class="list-item ${month.month === state.selectedMonth ? "active" : ""}" data-month="${escAttr(month.month)}">
          <span>${esc(month.month)}</span>
          <small>${formatNumber(month.fileCount)} 个文件</small>
        </button>
      `).join("")
      : `<div class="empty-note">暂无月份</div>`;

    els.months.querySelectorAll("[data-month]").forEach((button) => {
      button.addEventListener("click", async () => {
        await selectMonth(String(button.getAttribute("data-month") || ""));
      });
    });
  }

  function renderFiles() {
    els.files.innerHTML = state.files.length
      ? state.files.map((file) => `
        <button type="button" class="list-item ${file.date === state.selectedDate ? "active" : ""}" data-date="${escAttr(file.date)}">
          <span>${esc(file.date)}</span>
          <small>${formatBytes(file.size)}</small>
        </button>
      `).join("")
      : `<div class="empty-note">当前月份没有日志文件</div>`;

    els.files.querySelectorAll("[data-date]").forEach((button) => {
      button.addEventListener("click", async () => {
        await selectDate(String(button.getAttribute("data-date") || ""));
      });
    });
  }

  function renderEntries() {
    if (state.entriesLoading || state.entriesError || state.entries.length === 0) {
      els.rows.innerHTML = "";
      return;
    }

    els.rows.innerHTML = state.entries.map((line) => `
      <tr>
        <td class="time-cell">${esc(line.time || "--")}</td>
        <td><span class="type-pill">${esc(line.type || "--")}</span></td>
        <td>${esc(line.mark || "-")}</td>
        <td>${esc(line.attacker || "-")}</td>
        <td>${esc(line.victim || "-")}</td>
        <td class="damage-cell">${esc(line.damage || "-")}</td>
        <td>${esc(line.weapon || "-")}</td>
      </tr>
    `).join("");
  }

  async function selectMonth(month) {
    if (!month || month === state.selectedMonth) return;
    state.selectedMonth = month;
    state.offset = 0;
    await loadFiles();
    state.selectedDate = state.files[0]?.date || "";
    await reloadEntries();
  }

  async function selectDate(date) {
    if (!date || date === state.selectedDate) return;
    state.selectedDate = date;
    state.offset = 0;
    await reloadEntries();
  }

  async function runSearch() {
    state.offset = 0;
    await reloadEntries();
  }

  async function pageOlder() {
    if (!state.meta?.hasMoreOlder) return;
    state.offset += state.limit;
    await reloadEntries();
  }

  async function pageNewer() {
    if (state.offset <= 0) return;
    state.offset = Math.max(0, state.offset - state.limit);
    await reloadEntries();
  }

  els.search.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    state.search = els.search.value.trim();
    await runSearch();
  });
  els.limit.addEventListener("change", async () => {
    state.limit = clampInt(els.limit.value, 200, 100, 1000);
    state.offset = 0;
    await reloadEntries();
  });
  els.newer.addEventListener("click", () => pageNewer().catch(() => {}));
  els.older.addEventListener("click", () => pageOlder().catch(() => {}));
  els.current.addEventListener("click", () => reloadEntries().catch(() => {}));
  root.querySelector("#combat-log-refresh")?.addEventListener("click", () => bootstrap().catch(() => {}));
  root.querySelector("#combat-log-refresh-months")?.addEventListener("click", () => bootstrap().catch(() => {}));

  statusTimer = window.setInterval(() => {
    refreshStatus().then(() => {
      renderState();
    }).catch(() => {});
  }, 5000);

  await bootstrap();

  root.__pageCleanup = () => {
    if (statusTimer) {
      window.clearInterval(statusTimer);
      statusTimer = null;
    }
  };

  return root.__pageCleanup;
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value ?? 0));
}

function clampInt(value, defaultValue, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(max, Math.max(min, parsed));
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
