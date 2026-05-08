// -*- coding: utf-8 -*-

/**
 * 页面：武器统计
 * 数据来源：plugin.weaponCollector → /api/weapon-collector/stats
 */

let refreshTimer = null;
let sortKey = "total";
let sortDir = "desc";

export async function renderPage({ root, api, apiFetch }) {
  if (root.__weaponRefreshTimer) {
    clearTimeout(root.__weaponRefreshTimer);
    root.__weaponRefreshTimer = null;
  }

  sortKey = "total";
  sortDir = "desc";

  root.innerHTML = `
    <section class="page weapon-page">
      <div class="page-title-row">
        <div>
          <div class="page-title">武器统计</div>
          <div class="page-subtitle">按武器类别归类的伤害 / 击倒 / 击杀次数（持久化数据）</div>
        </div>
        <span id="weapon-refresh-status" class="kill-refresh-status">等待刷新</span>
      </div>

      <section class="combat-stat-grid">
        <div class="card combat-stat-card">
          <span>武器种类</span>
          <strong id="stat-weapon-count">-</strong>
        </div>
        <div class="card combat-stat-card">
          <span>总伤害次数</span>
          <strong id="stat-damaged" style="color:var(--yellow)">-</strong>
        </div>
        <div class="card combat-stat-card">
          <span>总击倒次数</span>
          <strong id="stat-wounded" style="color:var(--accent)">-</strong>
        </div>
        <div class="card combat-stat-card">
          <span>总击杀次数</span>
          <strong id="stat-died" style="color:var(--danger)">-</strong>
        </div>
      </section>

      <section class="card combat-toolbar-card">
        <div class="console-actions combat-toolbar">
          <input id="weapon-search" class="console-search kill-search" placeholder="搜索武器名称…" style="flex:1">
          <button id="weapon-refresh" type="button">刷新</button>
          <button id="weapon-clear" type="button" class="danger-lite" title="清空所有武器统计数据（同时清除文件）">清空统计</button>
        </div>
      </section>

      <div class="card kill-table-card">
        <div class="kill-table-wrap">
          <table id="weapon-table">
            <thead>
              <tr>
                <th class="sortable" data-sort="rank" style="width:3rem">#</th>
                <th class="sortable" data-sort="category">武器名称</th>
                <th class="sortable" data-sort="total" style="width:6rem">总计</th>
                <th class="sortable" data-sort="damaged" style="width:6rem">伤害</th>
                <th class="sortable" data-sort="wounded" style="width:6rem">击倒</th>
                <th class="sortable" data-sort="died" style="width:6rem">击杀</th>
                <th data-sort="firstSeen" class="sortable" style="width:9rem">首次记录</th>
                <th data-sort="lastSeen" class="sortable" style="width:9rem">最近记录</th>
              </tr>
            </thead>
            <tbody id="weapon-tbody"></tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  const els = {
    status: root.querySelector("#weapon-refresh-status"),
    search: root.querySelector("#weapon-search"),
    tbody: root.querySelector("#weapon-tbody"),
    count: root.querySelector("#stat-weapon-count"),
    damaged: root.querySelector("#stat-damaged"),
    wounded: root.querySelector("#stat-wounded"),
    died: root.querySelector("#stat-died"),
    headers: root.querySelectorAll("th.sortable"),
  };

  let allWeapons = [];
  let searchText = "";

  async function load({ silent = false } = {}) {
    if (document.visibilityState === "hidden" && silent) return;
    try {
      const data = await api("/api/weapon-collector/stats");
      allWeapons = data.weapons ?? [];
      const totals = data.totals ?? {};
      els.count.textContent = allWeapons.length;
      els.damaged.textContent = fmtNum(totals.damaged ?? 0);
      els.wounded.textContent = fmtNum(totals.wounded ?? 0);
      els.died.textContent = fmtNum(totals.died ?? 0);
      renderTable();
      els.status.textContent = `已刷新 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
    } catch (err) {
      if (err?.code === "Unauthorized") return;
      els.status.textContent = `加载失败: ${err.message}`;
    }
  }

  function renderTable() {
    const q = searchText.toLowerCase();
    let rows = allWeapons.filter((w) => !q || w.category.toLowerCase().includes(q));

    rows = sortRows(rows);

    els.tbody.innerHTML = rows.length === 0
      ? `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:2rem">暂无武器统计数据</td></tr>`
      : rows.map((w, i) => {
          const total = w.damaged + w.wounded + w.died;
          return `<tr>
            <td style="color:var(--muted)">${i + 1}</td>
            <td><span class="weapon-name" title="${esc(w.rawName ?? w.category)}">${esc(w.category)}</span></td>
            <td><strong>${fmtNum(total)}</strong></td>
            <td style="color:var(--yellow)">${fmtNum(w.damaged)}</td>
            <td style="color:var(--accent)">${fmtNum(w.wounded)}</td>
            <td style="color:var(--danger)">${fmtNum(w.died)}</td>
            <td style="color:var(--muted);font-size:.82em">${fmtDate(w.firstSeen)}</td>
            <td style="color:var(--muted);font-size:.82em">${fmtDate(w.lastSeen)}</td>
          </tr>`;
        }).join("");

    updateSortIndicators();
  }

  function sortRows(rows) {
    return [...rows].sort((a, b) => {
      let va, vb;
      if (sortKey === "total") {
        va = a.damaged + a.wounded + a.died;
        vb = b.damaged + b.wounded + b.died;
      } else if (sortKey === "rank") {
        va = a.damaged + a.wounded + a.died;
        vb = b.damaged + b.wounded + b.died;
      } else if (sortKey === "category") {
        va = a.category ?? "";
        vb = b.category ?? "";
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      } else if (sortKey === "firstSeen") {
        va = new Date(a.firstSeen).getTime();
        vb = new Date(b.firstSeen).getTime();
      } else if (sortKey === "lastSeen") {
        va = new Date(a.lastSeen).getTime();
        vb = new Date(b.lastSeen).getTime();
      } else {
        va = a[sortKey] ?? 0;
        vb = b[sortKey] ?? 0;
      }
      return sortDir === "asc" ? va - vb : vb - va;
    });
  }

  function updateSortIndicators() {
    for (const th of els.headers) {
      const key = th.dataset.sort;
      th.classList.toggle("sort-active", key === sortKey);
      th.dataset.sortDir = key === sortKey ? sortDir : "";
    }
  }

  function scheduleRefresh() {
    root.__weaponRefreshTimer = setTimeout(async () => {
      try { await load({ silent: true }); } catch {}
      scheduleRefresh();
    }, 10000);
  }

  // Sort header clicks
  for (const th of els.headers) {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortKey === key) {
        sortDir = sortDir === "desc" ? "asc" : "desc";
      } else {
        sortKey = key;
        sortDir = "desc";
      }
      renderTable();
    });
  }

  // Search
  let searchDebounce = null;
  els.search.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchText = els.search.value.trim();
      renderTable();
    }, 160);
  });

  // Refresh button
  root.querySelector("#weapon-refresh").addEventListener("click", () => load());

  // Clear button
  root.querySelector("#weapon-clear").addEventListener("click", async () => {
    if (!window.confirm("此操作将清空所有武器统计数据并删除持久化文件内容，不可恢复。确认继续？")) return;
    try {
      const res = await apiFetch("/api/weapon-collector/clear", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      allWeapons = [];
      renderTable();
      els.count.textContent = "0";
      els.damaged.textContent = "0";
      els.wounded.textContent = "0";
      els.died.textContent = "0";
      els.status.textContent = "已清空";
    } catch (err) {
      alert(`清空失败: ${err.message}`);
    }
  });

  await load();
  scheduleRefresh();

  return () => {
    if (root.__weaponRefreshTimer) {
      clearTimeout(root.__weaponRefreshTimer);
      root.__weaponRefreshTimer = null;
    }
    clearTimeout(searchDebounce);
  };
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtNum(n) {
  return Number(n).toLocaleString("zh-CN");
}

function fmtDate(val) {
  if (!val) return "-";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
