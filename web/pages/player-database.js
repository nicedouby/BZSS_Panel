// -*- coding: utf-8 -*-

let rows = [];
let selectedId = null;
let searchTimer = null;

export async function renderPage({ root, api, apiFetch, routeInfo }) {
  const state = {
    query: "",
    sort: "updated_desc",
    days: 14,
    top: 10,
    initialPlayerQuery: String(routeInfo?.params?.get("player") || "").trim(),
  };

  root.innerHTML = `
    <section class="page db-page-shell">
      <div class="page-title-row">
        <div>
          <div class="page-title">鐜╁鏁版嵁搴?/div>
          <div class="match-empty">MicePanel 椋庢牸妗ｆ搴擄細鐜╁銆佸埆鍚嶃€両P銆佺櫥褰曘€佹垬鏂椼€佹殩鏈嶃€佹爣绛句笌杩濊缁熻</div>
        </div>
        <span id="db-sync-status" class="status-text" data-tone="idle">绛夊緟鎿嶄綔</span>
      </div>

      <section class="db-overview-card">
        <div class="db-stat-item"><span>鐜╁鎬绘暟</span><strong id="db-ov-total-players">--</strong></div>
        <div class="db-stat-item"><span>绐楀彛娲昏穬</span><strong id="db-ov-active-players">--</strong></div>
        <div class="db-stat-item"><span>鎬绘湇鍔″櫒鏃堕暱</span><strong id="db-ov-kd">--</strong></div>
        <div class="db-stat-item"><span>鎬绘瘮璧?/span><strong id="db-ov-total-matches">--</strong></div>
        <div class="db-stat-item"><span>鎬绘椂闀?/span><strong id="db-ov-total-hours">--</strong></div>
        <div class="db-stat-item"><span>鎬绘寚鎸ユ椂闀?/span><strong id="db-ov-rating">--</strong></div>
      </section>

      <section class="card db-toolbar-card">
        <div class="console-actions db-toolbar-row">
          <input id="db-search" class="console-search db-search" placeholder="鎼滅储锛氭樀绉?/ Steam64 / EOS / IP">
          <select id="db-sort">
            <option value="updated_desc">鎺掑簭锛氭渶杩戞洿鏂?/option>
            <option value="name_asc">鎺掑簭锛欰-Z</option>
          </select>
          <select id="db-stats-days">
            <option value="7">缁熻绐楀彛锛?澶?/option>
            <option value="14" selected>缁熻绐楀彛锛?4澶?/option>
            <option value="30">缁熻绐楀彛锛?0澶?/option>
            <option value="60">缁熻绐楀彛锛?0澶?/option>
            <option value="90">缁熻绐楀彛锛?0澶?/option>
          </select>
          <select id="db-stats-top">
            <option value="5">姒滃崟鏁伴噺锛?</option>
            <option value="10" selected>姒滃崟鏁伴噺锛?0</option>
            <option value="20">姒滃崟鏁伴噺锛?0</option>
            <option value="50">姒滃崟鏁伴噺锛?0</option>
          </select>
          <button id="db-stats-toggle-btn">鎵撳紑缁熻寮圭獥</button>
          <button id="db-sync-online-btn">鍚屾鍦ㄧ嚎鐜╁</button>
          <button id="db-reset-combat-stats-btn" class="danger-lite">閲嶇疆鍑绘潃缁熻</button>
        </div>
      </section>

      <div class="db-panel">
        <aside class="db-list-col" id="db-list"></aside>
        <section class="db-detail-col" id="db-detail">
          <div class="placeholder">璇烽€夋嫨宸︿晶鐜╁鏌ョ湅妗ｆ璇︽儏</div>
        </section>
      </div>

      <div class="db-stats-modal is-hidden" id="db-stats-modal" aria-hidden="true">
        <button class="db-stats-modal-backdrop" id="db-stats-modal-backdrop" type="button" aria-label="鍏抽棴缁熻寮圭獥"></button>
        <section class="db-stats-modal-card" role="dialog" aria-modal="true" aria-label="鏁版嵁搴撶粺璁″脊绐?>
          <header class="db-stats-modal-head">
            <h2>鏁版嵁搴撶粺璁?/h2>
            <button id="db-stats-modal-close" type="button">鍏抽棴</button>
          </header>
          <section class="db-analytics-grid">
            <div class="db-card db-analytics-card">
              <h3>Breakdowns 鍒嗗竷缁熻</h3>
              <div id="db-breakdowns" class="db-analytics-body">绛夊緟鍔犺浇...</div>
            </div>
            <div class="db-card db-analytics-card">
              <h3>Leaderboards 鎺掕姒?/h3>
              <div id="db-leaderboards" class="db-analytics-body">绛夊緟鍔犺浇...</div>
            </div>
            <div class="db-card db-analytics-card">
              <h3>Trends 瓒嬪娍</h3>
              <div id="db-trends" class="db-analytics-body">绛夊緟鍔犺浇...</div>
            </div>
          </section>
        </section>
      </div>
    </section>
  `;

  const els = {
    list: root.querySelector("#db-list"),
    detail: root.querySelector("#db-detail"),
    search: root.querySelector("#db-search"),
    sort: root.querySelector("#db-sort"),
    days: root.querySelector("#db-stats-days"),
    top: root.querySelector("#db-stats-top"),
    status: root.querySelector("#db-sync-status"),
    statsModal: root.querySelector("#db-stats-modal"),
    breakdowns: root.querySelector("#db-breakdowns"),
    leaderboards: root.querySelector("#db-leaderboards"),
    trends: root.querySelector("#db-trends"),
  };

  if (state.initialPlayerQuery) {
    state.query = state.initialPlayerQuery;
    els.search.value = state.initialPlayerQuery;
  }

  function setStatus(text, tone = "idle") {
    els.status.dataset.tone = tone;
    els.status.textContent = text;
  }

  async function loadStats({ silent = false } = {}) {
    const stats = await api(`/api/db/stats?days=${encodeURIComponent(state.days)}&top=${encodeURIComponent(state.top)}`);
    renderOverview(root, stats);
    renderBreakdowns(els.breakdowns, stats);
    renderLeaderboards(els.leaderboards, stats, async (id) => {
      selectedId = Number(id);
      renderList(els, loadDetail);
      await loadDetail(selectedId);
      closeStatsModal(els.statsModal);
    });
    renderTrends(els.trends, stats);
    if (!silent) setStatus(`缁熻宸插埛鏂帮細${state.days}澶╃獥鍙ｏ紝姒滃崟${state.top}`, "success");
  }

  async function loadList() {
    const params = new URLSearchParams({
      query: state.query,
      sort: state.sort,
      limit: "200",
      offset: "0",
    });
    const json = await api(`/api/db/players?${params.toString()}`);
    rows = json.items ?? [];
    if (!selectedId && rows.length) selectedId = rows[0].id;
    renderList(els, loadDetail);
    if (selectedId) await loadDetail(selectedId);
  }

  async function loadDetail(id) {
    const detail = await api(`/api/db/players/${encodeURIComponent(id)}`);
    renderDetail(els, detail, {
      async onSavePermission(permissionGroup) {
        await apiFetch(`/api/db/players/${encodeURIComponent(id)}/permission-group`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permissionGroup }),
        });
        setStatus("鏉冮檺缁勫凡鏇存柊", "success");
        await loadList();
      },
    });
  }

  els.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      state.query = els.search.value.trim();
      selectedId = null;
      await loadList();
    }, 300);
  });

  els.sort.addEventListener("change", async () => {
    state.sort = els.sort.value;
    selectedId = null;
    await loadList();
  });

  els.days.addEventListener("change", async () => {
    state.days = Number(els.days.value) || 14;
    await loadStats();
  });

  els.top.addEventListener("change", async () => {
    state.top = Number(els.top.value) || 10;
    await loadStats();
  });

  root.querySelector("#db-stats-toggle-btn").addEventListener("click", async () => {
    openStatsModal(els.statsModal);
    await loadStats();
  });
  root.querySelector("#db-stats-modal-close").addEventListener("click", () => closeStatsModal(els.statsModal));
  root.querySelector("#db-stats-modal-backdrop").addEventListener("click", () => closeStatsModal(els.statsModal));

  root.querySelector("#db-sync-online-btn").addEventListener("click", async () => {
    setStatus("姝ｅ湪鍚屾鍦ㄧ嚎鐜╁...", "pending");
    await apiFetch("/api/player-database/sync-online", { method: "POST" });
    await loadList();
    await loadStats({ silent: true });
    setStatus("鍦ㄧ嚎鐜╁宸插悓姝?, "success");
  });

  root.querySelector("#db-reset-combat-stats-btn").addEventListener("click", async () => {
    if (!window.confirm("纭閲嶇疆鎵€鏈夌帺瀹跺嚮鏉€缁熻鍜屾殩鏈嶇粺璁″悧锛熸鎿嶄綔涓嶅彲鎾ら攢銆?)) return;
    setStatus("姝ｅ湪閲嶇疆鍑绘潃缁熻...", "pending");
    const res = await apiFetch("/api/db/reset-combat-stats", { method: "POST" });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "閲嶇疆澶辫触");
    await loadList();
    await loadStats({ silent: true });
    setStatus(`鍑绘潃缁熻宸查噸缃紝褰卞搷 ${Number(json.changed || 0)} 鏉¤褰昤, "success");
  });

  await loadStats({ silent: true });
  await loadList();

  return () => {
    clearTimeout(searchTimer);
    rows = [];
    selectedId = null;
  };
}

function renderOverview(root, stats) {
  const overview = stats?.overview || {};
  root.querySelector("#db-ov-total-players").textContent = fmtNumber(overview.totalPlayers || 0);
  root.querySelector("#db-ov-active-players").textContent = fmtNumber(overview.activePlayersInWindow || 0);
  root.querySelector("#db-ov-kd").textContent = fmtHours(overview.totalServerSeconds || 0);
  root.querySelector("#db-ov-total-matches").textContent = fmtNumber(overview.totalMatches || 0);
  root.querySelector("#db-ov-total-hours").textContent = fmtHours(overview.totalGameSeconds || 0);
  root.querySelector("#db-ov-rating").textContent = fmtHours(overview.totalCommanderSeconds || 0);
}

function renderList(els, loadDetail) {
  if (!rows.length) {
    els.list.innerHTML = '<div class="placeholder">娌℃湁鍖归厤鐨勭帺瀹?/div>';
    return;
  }

  els.list.innerHTML = rows.map((p) => `
    <button class="db-row ${Number(p.id) === Number(selectedId) ? "active" : ""}" data-id="${p.id}">
      <div class="db-row-name">${esc(p.current_name || "(鏈懡鍚?")}</div>
      <div class="db-row-meta">${esc(p.permission_group || "default")}</div>
      <div class="db-row-meta">鏇存柊 ${rowTime(p.updated_at)}</div>
    </button>
  `).join("");

  els.list.querySelectorAll(".db-row").forEach((btn) => {
    btn.addEventListener("click", async () => {
      selectedId = Number(btn.dataset.id);
      renderList(els, loadDetail);
      await loadDetail(selectedId);
    });
  });
}

function renderDetail(els, data, actions) {
  const p = data.player;
  const currentIp = p.current_ip || data.ips?.[0]?.ip || "--";

  els.detail.innerHTML = `
    <div class="db-detail-top">
      <div class="db-card">
        <h2>${esc(p.current_name || "(未命名)")}</h2>
        <div class="db-grid">
          ${copyCell("Steam64", p.steam_id || "--", "db-vivid-id")}
          ${copyCell("EOS ID", p.eos_id || "--", "db-vivid-id")}
          ${cell("当前 IP", currentIp, "db-vivid-ip")}
          ${cell("权限组", p.permission_group || "default", "db-vivid-perm")}
          ${cell("档案创建时间", rowTime(p.created_at))}
          ${cell("最近更新时间", rowTime(p.updated_at))}
          ${cell("游戏时长", fmtSeconds(p.game_seconds), "db-vivid-duration")}
          ${cell("服务器时长", fmtSeconds(p.server_seconds))}
          ${cell("暖服时长", fmtSeconds(p.warmup_seconds))}
          ${cell("在小队中时长", fmtSeconds(p.in_squad_seconds))}
          ${cell("担任队长时长", fmtSeconds(p.squad_leader_seconds))}
          ${cell("担任指挥官时长", fmtSeconds(p.commander_seconds))}
        </div>
      </div>
    </div>

    <div class="db-card">
      <h3>行为记录</h3>
      <div class="db-grid">
        ${cell("被举报记录", fmtNumber(p.total_reports_received))}
        ${cell("举报记录", fmtNumber(p.total_reports_submitted))}
        ${cell("对局数", fmtNumber(p.total_matches))}
      </div>
    </div>

    <div class="db-detail-grid">
      ${miniList("曾用名称（最近 20）", (data.aliases || []).slice(0, 20).map((a) => `${a.alias_name} · ${rowTime(a.seen_at)}`))}
      ${miniList("历史 IP（最近 20）", summarizeIpRows(data.ips, "seen_at").slice(0, 20).map((a) => `${a.ip} ×${a.count} · 最近 ${rowTime(a.latestAt)}`))}
      ${miniList("战斗文件引用（最近 100）", (data.combatSessions || []).slice(0, 100).map((s) => `${s.date_key || "--"} · ${String(s.file_path || "").split(/[\\/]/).pop() || "--"} · ${rowTime(s.first_event_at)} ~ ${rowTime(s.last_event_at)}`))}
    </div>

    <div class="db-card">
      <h3>权限组修改</h3>
      <div class="console-actions db-action-toolbar">
        <input id="perm-input" class="console-search" value="${esc(p.permission_group || "default")}">
        <button id="perm-save">保存</button>
      </div>
      <div class="db-action-status" id="db-action-status" data-tone="idle">准备执行档案操作。</div>
    </div>
  `;

  els.detail.querySelector("#perm-save").addEventListener("click", async () => {
    const value = els.detail.querySelector("#perm-input").value.trim();
    const status = els.detail.querySelector("#db-action-status");
    if (!value) return;
    status.dataset.tone = "pending";
    status.textContent = "正在保存权限组...";
    await actions.onSavePermission(value);
    status.dataset.tone = "success";
    status.textContent = "权限组已保存。";
  });

  els.detail.querySelectorAll("[data-copy-value]").forEach((el) => {
    el.addEventListener("click", async () => {
      const value = String(el.dataset.copyValue || "").trim();
      if (!value || value === "--") return;

      const label = el.dataset.copyLabel || "内容";

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
        } else {
          const input = document.createElement("input");
          input.value = value;
          document.body.appendChild(input);
          input.select();
          document.execCommand("copy");
          input.remove();
        }
        showToast(`${label} 已复制`);
      } catch {
        showToast(`${label} 复制失败`);
      }
    });
  });
}
function renderBreakdowns(root, stats) {
  const b = stats?.breakdowns || {};
  root.innerHTML = `
    ${analyticsBlock("鏉冮檺缁勫垎甯?, chipList(b.permissionGroups, "permissionGroup", "players"))}
    ${analyticsBlock("瑙掕壊鏍囩鍒嗗竷", chipList(b.roleTags, "tagValue", "players"))}
    ${analyticsBlock("鎴愬垎鏍囩鍒嗗竷", chipList(b.componentTags, "tagValue", "players"))}
    ${analyticsBlock("杩濊绫诲瀷鍒嗗竷", chipList((b.violationTypes || []).map((row) => ({ key: row.violationLabel || row.violationKey, value: row.totalCount })), "key", "value"))}
  `;
}

function renderLeaderboards(root, stats, jumpToPlayer) {
  const l = stats?.leaderboards || {};
  root.innerHTML = `
    ${analyticsBlock("鏃堕暱姒?, rankList(l.byPlaytime, (row) => row.currentName || row.steamID || row.eosID || "鏈煡鐜╁", (row) => fmtHours(row.gameSeconds), "id"))}
    ${analyticsBlock("杩濊姒?, rankList(l.byViolations, (row) => row.currentName || row.steamID || row.eosID || "鏈煡鐜╁", (row) => `杩濊 ${fmtNumber(row.totalViolations)}`, "playerId"))}
  `;

  root.querySelectorAll(".db-rank-player").forEach((btn) => {
    btn.addEventListener("click", () => jumpToPlayer(btn.dataset.playerId));
  });
}

function renderTrends(root, stats) {
  const t = stats?.trends || {};
  root.innerHTML = `
    ${analyticsBlock("杩?N 澶╁灞€瓒嬪娍", trendList(t.matchesByDay, (row) => `瀵瑰眬 ${fmtNumber(row.matchCount)} 路 宸茬粨鏉?${fmtNumber(row.completedCount)}`))}
  `;
}

function cell(label, value, className = "") {
  return `<div><span>${esc(label)}</span><strong class="${className}">${esc(value)}</strong></div>`;
}

function copyCell(label, value, className = "") {
  return `<button type="button" class="db-copy-cell" data-copy-label="${esc(label)}" data-copy-value="${escAttr(value)}"><span>${esc(label)}</span><strong class="${className}">${esc(value)}</strong></button>`;
}

function miniList(title, items) {
  return `
    <div class="db-card">
      <h3>${esc(title)}</h3>
      <ul class="db-list-mini">${items.length ? items.map((item) => `<li>${esc(item)}</li>`).join("") : "<li>鏃?/li>"}</ul>
    </div>
  `;
}

function analyticsBlock(title, body) {
  return `<section class="db-analytics-block"><h4>${esc(title)}</h4>${body}</section>`;
}

function chipList(items, keyField, valueField) {
  if (!Array.isArray(items) || !items.length) return '<div class="placeholder">鏆傛棤鏁版嵁</div>';
  return `<div class="db-chip-wrap">${items.map((item) => `
    <span class="db-chip"><span>${esc(item?.[keyField] ?? "--")}</span><small>${fmtNumber(item?.[valueField] ?? 0)}</small></span>
  `).join("")}</div>`;
}

function rankList(items, nameGetter, valueGetter, idField) {
  if (!Array.isArray(items) || !items.length) return '<div class="placeholder">鏆傛棤鏁版嵁</div>';
  return `<ol class="db-rank-list">${items.map((item) => `
    <li>
      <button class="name db-rank-player" type="button" data-player-id="${Number(item?.[idField] || 0)}">${esc(nameGetter(item))}</button>
      <span class="value">${esc(valueGetter(item))}</span>
    </li>
  `).join("")}</ol>`;
}

function trendList(items, valueGetter) {
  if (!Array.isArray(items) || !items.length) return '<div class="placeholder">鏆傛棤鏁版嵁</div>';
  return `<ul class="db-trend-list">${items.map((item) => `
    <li><span class="name">${esc(item.day || "--")}</span><span class="value">${esc(valueGetter(item))}</span></li>
  `).join("")}</ul>`;
}

function summarizeIpRows(source, timeField) {
  const grouped = new Map();
  for (const row of Array.isArray(source) ? source : []) {
    const ip = String(row?.ip || "").trim() || "--";
    const rawTime = row?.[timeField] || row?.seen_at || row?.joined_at || null;
    const timeValue = rawTime ? new Date(rawTime).getTime() : 0;
    const item = grouped.get(ip) ?? { ip, count: 0, latestAt: rawTime, latestValue: 0 };
    item.count += 1;
    if (Number.isFinite(timeValue) && timeValue > item.latestValue) {
      item.latestAt = rawTime;
      item.latestValue = timeValue;
    }
    grouped.set(ip, item);
  }
  return [...grouped.values()].sort((a, b) => (b.latestValue || 0) - (a.latestValue || 0));
}

function openStatsModal(modal) {
  modal.classList.remove("is-hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeStatsModal(modal) {
  modal.classList.add("is-hidden");
  modal.setAttribute("aria-hidden", "true");
}

function fmtNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function fmtHours(seconds) {
  return `${(Number(seconds || 0) / 3600).toFixed(1)} h`;
}

function fmtSeconds(value) {
  const total = Math.max(0, Math.floor(Number(value || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${total}s (${hours}h ${minutes}m)`;
}

function rowTime(ts) {
  if (!ts) return "--";
  return new Date(Number(ts)).toLocaleString("zh-CN", { hour12: false });
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

function showToast(message) {
  const id = "bzss-app-toast";
  let toast = document.getElementById(id);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = id;
    toast.className = "app-toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 1400);
}

