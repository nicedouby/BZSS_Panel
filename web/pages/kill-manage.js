// -*- coding: utf-8 -*-

let searchTimer = null;

export async function renderPage({ root, api }) {
  if (root.__killManageTimer) {
    window.clearTimeout(root.__killManageTimer);
    root.__killManageTimer = null;
  }

  const state = {
    allRecords: [],
    filteredRecords: [],
    query: "",
    lastSignature: "",
    lastRefreshAt: "",
  };

  root.innerHTML = `
    <section class="page kill-page-shell">
      <div class="page-title-row">
        <div class="page-title">Kill Manage</div>
        <div class="console-actions">
          <span id="kill-refresh-status" class="kill-refresh-status">Auto refresh enabled</span>
          <input id="kill-search" class="console-search kill-search" placeholder="Search by type, victim, attacker, damage, weapon, time">
          <button id="refresh" type="button">Refresh</button>
        </div>
      </div>

      <div class="card kill-table-card">
        <div class="kill-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Victim</th>
                <th>Attacker</th>
                <th>Damage</th>
                <th>Weapon</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody id="kill-table-body"></tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  const els = {
    body: root.querySelector("#kill-table-body"),
    search: root.querySelector("#kill-search"),
    refreshStatus: root.querySelector("#kill-refresh-status"),
  };

  function applyFilter() {
    const q = state.query.trim().toLowerCase();
    state.filteredRecords = q
      ? state.allRecords.filter((record) => matchesQuery(record, q))
      : state.allRecords.slice();
    renderTable(els.body, state.filteredRecords);
  }

  async function refreshRecords({ silent = false } = {}) {
    if (document.visibilityState === "hidden" && silent) return;
    const data = await api("/api/kills/recent");
    const records = data.records ?? [];
    state.lastRefreshAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    els.refreshStatus.textContent = `Auto refresh | ${state.lastRefreshAt}`;

    const nextSignature = buildSignature(records);
    if (nextSignature === state.lastSignature && silent) return;

    state.allRecords = records;
    state.lastSignature = nextSignature;
    applyFilter();
  }

  function scheduleRefresh() {
    root.__killManageTimer = window.setTimeout(async () => {
      try {
        await refreshRecords({ silent: true });
      } catch (error) {
        if (error?.code === "Unauthorized") return;
      }
      scheduleRefresh();
    }, 5000);
  }

  els.search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.query = els.search.value || "";
      applyFilter();
    }, 120);
  });

  root.querySelector("#refresh").addEventListener("click", async () => {
    await refreshRecords();
  });

  await refreshRecords();
  scheduleRefresh();

  root.__pageCleanup = () => {
    if (root.__killManageTimer) {
      window.clearTimeout(root.__killManageTimer);
      root.__killManageTimer = null;
    }
    window.clearTimeout(searchTimer);
    closeKillRecordWindow();
  };

  return root.__pageCleanup;
}

function renderTable(tbody, records) {
  if (!records.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="kill-empty-cell">No matching records</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map((r, i) => `
    <tr data-record-index="${i}">
      <td>${esc(r.type)}</td>
      <td>${esc(r.victimName)}</td>
      <td>${esc(r.attackerName)}</td>
      <td>${esc(r.damage)}</td>
      <td>${esc(r.weapon)}</td>
      <td>${esc(formatTime(r.time))}</td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-record-index]").forEach((el) => {
    el.addEventListener("click", () => {
      const record = records[Number(el.dataset.recordIndex)];
      if (!record) return;
      openKillRecordWindow(record);
    });
  });
}

function openKillRecordWindow(record) {
  closeKillRecordWindow();

  const root = document.createElement("div");
  root.id = "bzss-kill-record-root";
  root.innerHTML = `
    <div class="kill-record-backdrop" data-close-kill-window="1"></div>
    <section class="kill-record-window" role="dialog" aria-modal="true" aria-label="Kill record detail">
      <header class="kill-record-header">
        <div>
          <div class="kill-record-title">Kill Record Detail</div>
          <div class="kill-record-subtitle">${esc(record.type || "--")} | ${esc(record.attackerName || "--")} -> ${esc(record.victimName || "--")}</div>
        </div>
        <button class="kill-record-close" type="button" data-close-kill-window="1">x</button>
      </header>

      <div class="kill-record-body">
        <div class="kill-record-grid">
          ${detailCell("Type", record.type)}
          ${detailCell("Victim", record.victimName)}
          ${detailCell("Attacker", record.attackerName)}
          ${detailCell("Damage", record.damage)}
          ${detailCell("Weapon", record.weapon)}
          ${detailCell("Time", formatTime(record.time))}
        </div>

        <div class="kill-record-raw-card">
          <h3>Raw Data</h3>
          <pre class="kill-record-pre">${esc(JSON.stringify(record, null, 2))}</pre>
        </div>
      </div>
    </section>
  `;

  document.body.appendChild(root);

  root.querySelectorAll("[data-close-kill-window]").forEach((el) => {
    el.addEventListener("click", closeKillRecordWindow);
  });

  const onKeyDown = (event) => {
    if (event.key === "Escape") closeKillRecordWindow();
  };
  window.addEventListener("keydown", onKeyDown);
  root.__onKeyDown = onKeyDown;
}

function closeKillRecordWindow() {
  const root = document.querySelector("#bzss-kill-record-root");
  if (!root) return;
  if (root.__onKeyDown) {
    window.removeEventListener("keydown", root.__onKeyDown);
  }
  root.remove();
}

function detailCell(label, value) {
  return `<div><span>${esc(label)}</span><strong>${esc(value ?? "--")}</strong></div>`;
}

function matchesQuery(record, query) {
  return [
    record.type,
    record.victimName,
    record.attackerName,
    record.damage,
    record.weapon,
    record.time,
    record.sourceEventId,
    record.rawLog,
  ].some((value) => String(value ?? "").toLowerCase().includes(query));
}

function buildSignature(records) {
  if (!records.length) return "0";
  const head = records[0] || {};
  return [
    records.length,
    head.sourceEventId || "",
    head.time || "",
    head.type || "",
    head.attackerName || "",
    head.victimName || "",
  ].join("|");
}

function formatTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("zh-CN", { hour12: false });
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
