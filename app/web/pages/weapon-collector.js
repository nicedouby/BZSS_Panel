// -*- coding: utf-8 -*-

/**
 * 页面：武器统计
 * 数据来源：plugin.weaponCollector -> /api/weapon-collector/stats
 */

export async function renderPage({ root, api, apiFetch }) {
  if (root.__weaponRefreshTimer) {
    clearTimeout(root.__weaponRefreshTimer);
    root.__weaponRefreshTimer = null;
  }

  root.innerHTML = `
    <section class="page weapon-page">
      <div class="page-title-row">
        <div>
          <div class="page-title">武器统计</div>
          <div class="page-subtitle">按统一武器类型归类的伤害 / 击倒 / 击杀次数（已自动合并同类对象）</div>
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
          <button id="weapon-clear" type="button" class="danger-lite" title="清空所有武器统计数据（同时清除持久化文件）">清空统计</button>
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
                <th class="sortable" data-sort="firstSeen" style="width:9rem">首次记录</th>
                <th class="sortable" data-sort="lastSeen" style="width:9rem">最近记录</th>
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
  let sortKey = "total";
  let sortDir = "desc";

  async function load({ silent = false } = {}) {
    if (document.visibilityState === "hidden" && silent) return;
    try {
      const data = await api("/api/weapon-collector/stats");
      const weaponTypeMap = data.weaponTypeMap ?? {};
      allWeapons = prepareWeaponRows(data.weapons ?? [], weaponTypeMap);

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
    let rows = allWeapons.filter((weapon) => !q || weapon.searchText.includes(q));
    rows = sortRows(rows);

    els.tbody.innerHTML = rows.length === 0
      ? `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:2rem">暂无武器统计数据</td></tr>`
      : rows.map((weapon, index) => `
          <tr>
            <td style="color:var(--muted)">${index + 1}</td>
            <td><span class="weapon-name" title="${esc(weapon.aliasTitle)}">${esc(weapon.category)}</span></td>
            <td><strong>${fmtNum(weapon.total)}</strong></td>
            <td style="color:var(--yellow)">${fmtNum(weapon.damaged)}</td>
            <td style="color:var(--accent)">${fmtNum(weapon.wounded)}</td>
            <td style="color:var(--danger)">${fmtNum(weapon.died)}</td>
            <td style="color:var(--muted);font-size:.82em">${fmtDate(weapon.firstSeen)}</td>
            <td style="color:var(--muted);font-size:.82em">${fmtDate(weapon.lastSeen)}</td>
          </tr>
        `).join("");

    updateSortIndicators();
  }

  function sortRows(rows) {
    return [...rows].sort((left, right) => {
      let leftValue;
      let rightValue;

      if (sortKey === "total" || sortKey === "rank") {
        leftValue = left.total;
        rightValue = right.total;
      } else if (sortKey === "category") {
        leftValue = left.category ?? "";
        rightValue = right.category ?? "";
        return sortDir === "asc"
          ? leftValue.localeCompare(rightValue)
          : rightValue.localeCompare(leftValue);
      } else if (sortKey === "firstSeen") {
        leftValue = left.firstSeenTs;
        rightValue = right.firstSeenTs;
      } else if (sortKey === "lastSeen") {
        leftValue = left.lastSeenTs;
        rightValue = right.lastSeenTs;
      } else {
        leftValue = left[sortKey] ?? 0;
        rightValue = right[sortKey] ?? 0;
      }

      return sortDir === "asc" ? leftValue - rightValue : rightValue - leftValue;
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
      try {
        await load({ silent: true });
      } catch {}
      scheduleRefresh();
    }, 10000);
  }

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

  let searchDebounce = null;
  els.search.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchText = els.search.value.trim();
      renderTable();
    }, 160);
  });

  root.querySelector("#weapon-refresh").addEventListener("click", () => load());

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

function prepareWeaponRows(weapons, weaponTypeMap) {
  return weapons.map((weapon) => {
    const aliases = Array.isArray(weapon.aliases) ? weapon.aliases : [];
    const total = (weapon.damaged ?? 0) + (weapon.wounded ?? 0) + (weapon.died ?? 0);
    const aliasTitle = aliases.length
      ? `${weapon.cleanedName ?? weapon.category}\n别名: ${aliases.join(", ")}`
      : (weapon.cleanedName ?? weapon.category);

    return {
      ...weapon,
      aliases,
      total,
      aliasTitle,
      firstSeenTs: parseDateValue(weapon.firstSeen),
      lastSeenTs: parseDateValue(weapon.lastSeen),
      searchText: [
        weapon.category,
        weapon.cleanedName,
        aliases.join(" "),
        weaponTypeMap[weapon.rawCategory] ?? "",
      ].join(" ").toLowerCase(),
    };
  });
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

function parseDateValue(val) {
  const time = new Date(val).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function fmtDate(val) {
  if (!val) return "-";
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
