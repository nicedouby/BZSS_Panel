// -*- coding: utf-8 -*-

let rows = [];
let selectedId = null;
let searchTimer = null;

export async function renderPage({ root, api }) {
  const state = {
    query: "",
    sort: "updated_desc",
    days: 14,
    top: 10,
  };

  root.innerHTML = `
    <section class="page db-page-shell">
      <div class="page-title-row">
        <div>
          <div class="page-title">玩家数据库</div>
          <div class="match-empty">MicePanel 风格档案库：玩家、别名、IP、登录、战斗、暖服、标签与违规统计</div>
        </div>
        <span id="db-sync-status" class="status-text" data-tone="idle">等待操作</span>
      </div>

      <section class="db-overview-card">
        <div class="db-stat-item"><span>玩家总数</span><strong id="db-ov-total-players">--</strong></div>
        <div class="db-stat-item"><span>窗口活跃</span><strong id="db-ov-active-players">--</strong></div>
        <div class="db-stat-item"><span>总击杀 / 死亡</span><strong id="db-ov-kd">--</strong></div>
        <div class="db-stat-item"><span>总比赛</span><strong id="db-ov-total-matches">--</strong></div>
        <div class="db-stat-item"><span>总时长</span><strong id="db-ov-total-hours">--</strong></div>
        <div class="db-stat-item"><span>天梯均值 / 极值</span><strong id="db-ov-rating">--</strong></div>
      </section>

      <section class="card db-toolbar-card">
        <div class="console-actions db-toolbar-row">
          <input id="db-search" class="console-search db-search" placeholder="搜索：昵称 / Steam64 / EOS / IP">
          <select id="db-sort">
            <option value="updated_desc">排序：最近更新</option>
            <option value="name_asc">排序：A-Z</option>
            <option value="last_login_desc">排序：登录时间</option>
          </select>
          <select id="db-stats-days">
            <option value="7">统计窗口：7天</option>
            <option value="14" selected>统计窗口：14天</option>
            <option value="30">统计窗口：30天</option>
            <option value="60">统计窗口：60天</option>
            <option value="90">统计窗口：90天</option>
          </select>
          <select id="db-stats-top">
            <option value="5">榜单数量：5</option>
            <option value="10" selected>榜单数量：10</option>
            <option value="20">榜单数量：20</option>
            <option value="50">榜单数量：50</option>
          </select>
          <button id="db-stats-toggle-btn">打开统计弹窗</button>
          <button id="db-sync-online-btn">同步在线玩家</button>
          <button id="db-reset-kill-stats-btn" class="danger-lite">重置击杀统计</button>
        </div>
      </section>

      <div class="db-panel">
        <aside class="db-list-col" id="db-list"></aside>
        <section class="db-detail-col" id="db-detail">
          <div class="placeholder">请选择左侧玩家查看档案详情</div>
        </section>
      </div>

      <div class="db-stats-modal is-hidden" id="db-stats-modal" aria-hidden="true">
        <button class="db-stats-modal-backdrop" id="db-stats-modal-backdrop" type="button" aria-label="关闭统计弹窗"></button>
        <section class="db-stats-modal-card" role="dialog" aria-modal="true" aria-label="数据库统计弹窗">
          <header class="db-stats-modal-head">
            <h2>数据库统计</h2>
            <button id="db-stats-modal-close" type="button">关闭</button>
          </header>
          <section class="db-analytics-grid">
            <div class="db-card db-analytics-card">
              <h3>Breakdowns 分布统计</h3>
              <div id="db-breakdowns" class="db-analytics-body">等待加载...</div>
            </div>
            <div class="db-card db-analytics-card">
              <h3>Leaderboards 排行榜</h3>
              <div id="db-leaderboards" class="db-analytics-body">等待加载...</div>
            </div>
            <div class="db-card db-analytics-card">
              <h3>Trends 趋势</h3>
              <div id="db-trends" class="db-analytics-body">等待加载...</div>
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
    if (!silent) setStatus(`统计已刷新：${state.days}天窗口，榜单${state.top}`, "success");
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
        await fetch(`/api/db/players/${encodeURIComponent(id)}/permission-group`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permissionGroup }),
        });
        setStatus("权限组已更新", "success");
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
    setStatus("正在同步在线玩家...", "pending");
    await fetch("/api/player-database/sync-online", { method: "POST" });
    await loadList();
    await loadStats({ silent: true });
    setStatus("在线玩家已同步", "success");
  });

  root.querySelector("#db-reset-kill-stats-btn").addEventListener("click", async () => {
    if (!window.confirm("确认重置所有玩家击杀/击倒/TK/死亡/自杀统计吗？此操作不可撤销。")) return;
    setStatus("正在重置击杀统计...", "pending");
    const res = await fetch("/api/db/reset-kill-stats", { method: "POST" });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "重置失败");
    await loadList();
    await loadStats({ silent: true });
    setStatus(`击杀统计已重置，影响 ${Number(json.changed || 0)} 条玩家记录`, "success");
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
  root.querySelector("#db-ov-kd").textContent = `${fmtNumber(overview.totalKills || 0)} / ${fmtNumber(overview.totalDeaths || 0)}`;
  root.querySelector("#db-ov-total-matches").textContent = fmtNumber(overview.totalMatches || 0);
  root.querySelector("#db-ov-total-hours").textContent = fmtHours(overview.totalGameSeconds || 0);
  root.querySelector("#db-ov-rating").textContent = `${Number(overview.averageLadderRating || 0).toFixed(1)} / ${fmtNumber(overview.minLadderRating || 0)}-${fmtNumber(overview.maxLadderRating || 0)}`;
}

function renderList(els, loadDetail) {
  if (!rows.length) {
    els.list.innerHTML = '<div class="placeholder">没有匹配的玩家</div>';
    return;
  }

  els.list.innerHTML = rows.map((p) => `
    <button class="db-row ${Number(p.id) === Number(selectedId) ? "active" : ""}" data-id="${p.id}">
      <div class="db-row-name">${esc(p.current_name || "(未命名)")}</div>
      <div class="db-row-meta">${esc(p.permission_group || "default")} · R=${fmtNumber(p.ladder_rating)} · K=${fmtNumber(p.total_kills_light)} · TK=${fmtNumber(Number(p.total_tk_down || 0) + Number(p.total_tk_kill || 0))}</div>
      <div class="db-row-meta">最近登录 ${rowTime(p.last_login_at)} · 更新 ${rowTime(p.updated_at)}</div>
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
  const warmup = data.warmupStats || {};
  const currentIp = p.current_ip || data.logins?.[0]?.ip || data.ips?.[0]?.ip || "--";
  const winRate = p.total_matches > 0 ? `${((p.total_match_wins / p.total_matches) * 100).toFixed(1)}%` : "--";
  const leadWinRate = p.total_lead_matches > 0 ? `${((p.total_lead_wins / p.total_lead_matches) * 100).toFixed(1)}%` : "--";
  const cmdWinRate = p.total_cmd_matches > 0 ? `${((p.total_cmd_wins / p.total_cmd_matches) * 100).toFixed(1)}%` : "--";
  const fatalDownRate = p.total_kills_light > 0 ? `${((p.total_downed_light_fatal / p.total_kills_light) * 100).toFixed(1)}%` : "--";
  const kd = p.total_deaths > 0
    ? ((Number(p.total_kills_light || 0) + Number(p.total_kills_other || 0)) / Number(p.total_deaths || 0)).toFixed(2)
    : "--";
  const totalKills = Number(p.total_kills_light || 0) + Number(p.total_kills_other || 0);
  const totalDowns = Number(p.total_downed_light || 0) + Number(p.total_downed_other || 0);

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
          ${cell("最后更新时间", rowTime(p.updated_at))}
          ${cell("游戏时长", fmtSeconds(p.game_seconds), "db-vivid-duration")}
          ${cell("服务器游玩时长", fmtSeconds(p.server_seconds))}
          ${cell("暖服时长", fmtSeconds(p.warmup_seconds))}
          ${cell("处于小队时长", fmtSeconds(p.in_squad_seconds))}
          ${cell("作为队长时长", fmtSeconds(p.squad_leader_seconds))}
          ${cell("担任指挥官时长", fmtSeconds(p.commander_seconds))}
          ${cell("天梯分", fmtNumber(p.ladder_rating), "db-vivid-rating")}
          ${cell("胜率", winRate)}
          ${cell("带队胜率", leadWinRate)}
          ${cell("指挥胜率", cmdWinRate)}
        </div>
      </div>

      <div class="db-card">
        <h3>击杀统计</h3>
        <div class="db-grid">
          ${cell("总 K / 击倒 / 死亡", `${fmtNumber(totalKills)} / ${fmtNumber(totalDowns)} / ${fmtNumber(p.total_deaths)}`, "db-vivid-kill")}
          ${cell("轻武器 K / 击倒", `${fmtNumber(p.total_kills_light)} / ${fmtNumber(p.total_downed_light)}`, "db-vivid-kill")}
          ${cell("致命击倒", fmtNumber(p.total_downed_light_fatal), "db-vivid-kill")}
          ${cell("致命击倒率", fatalDownRate)}
          ${cell("其他 K / 击倒", `${fmtNumber(p.total_kills_other)} / ${fmtNumber(p.total_downed_other)}`)}
          ${cell("TK 击倒", fmtNumber(p.total_tk_down), "db-vivid-danger")}
          ${cell("TK 击杀", fmtNumber(p.total_tk_kill), "db-vivid-danger")}
          ${cell("被击倒", fmtNumber(p.total_downed_received))}
          ${cell("KD", kd)}
          ${cell("自杀", fmtNumber(p.total_suicides))}
        </div>
      </div>
    </div>

    <div class="db-card">
      <h3>暖服统计</h3>
      <div class="db-grid">
        ${cell("暖服击杀", fmtNumber(Number(warmup.total_kills_light || 0) + Number(warmup.total_kills_other || 0)))}
        ${cell("暖服击倒", fmtNumber(Number(warmup.total_downed_light || 0) + Number(warmup.total_downed_other || 0)))}
        ${cell("暖服被击倒", fmtNumber(warmup.total_downed_received || 0))}
        ${cell("暖服 TK", fmtNumber(Number(warmup.total_tk_down || 0) + Number(warmup.total_tk_kill || 0)))}
        ${cell("暖服死亡", fmtNumber(warmup.total_deaths || 0))}
        ${cell("暖服自杀", fmtNumber(warmup.total_suicides || 0))}
      </div>
    </div>

    <div class="db-card">
      <h3>行为记录</h3>
      <div class="db-grid">
        ${cell("被举报记录", fmtNumber(p.total_reports_received))}
        ${cell("举报记录", fmtNumber(p.total_reports_submitted))}
        ${cell("小队创建记录", fmtNumber(p.total_squad_created))}
        ${cell("对局数", fmtNumber(p.total_matches))}
      </div>
    </div>

    ${miniList("曾用名（最近 20）", (data.aliases || []).slice(0, 20).map((a) => `${a.alias_name} · ${rowTime(a.seen_at)}`))}
    ${miniList("历史 IP（最近 20）", summarizeIpRows(data.ips, "seen_at").slice(0, 20).map((a) => `${a.ip} ×${a.count} · 最近 ${rowTime(a.latestAt)}`))}
    ${miniList("登录记录（最近 50）", summarizeIpRows(data.logins, "joined_at").slice(0, 50).map((a) => `${a.ip} ×${a.count} · 最近 ${rowTime(a.latestAt)}`))}
    ${miniList("战斗日志索引（最近 100）", (data.combatSessions || []).slice(0, 100).map((s) => `${s.date_key || "--"} · ${String(s.file_path || "").split(/[\\/]/).pop() || "--"} · ${rowTime(s.first_event_at)} ~ ${rowTime(s.last_event_at)}`))}

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
      const originalTitle = el.getAttribute("title") || "";

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
        el.setAttribute("title", `${label} 已复制`);
      } catch {
        el.setAttribute("title", `${label} 复制失败`);
      }

      window.setTimeout(() => {
        if (originalTitle) el.setAttribute("title", originalTitle);
        else el.removeAttribute("title");
      }, 1200);
    });
  });
}

function renderBreakdowns(root, stats) {
  const b = stats?.breakdowns || {};
  root.innerHTML = `
    ${analyticsBlock("权限组分布", chipList(b.permissionGroups, "permissionGroup", "players"))}
    ${analyticsBlock("角色标签分布", chipList(b.roleTags, "tagValue", "players"))}
    ${analyticsBlock("成分标签分布", chipList(b.componentTags, "tagValue", "players"))}
    ${analyticsBlock("违规类型分布", chipList((b.violationTypes || []).map((row) => ({ key: row.violationLabel || row.violationKey, value: row.totalCount })), "key", "value"))}
  `;
}

function renderLeaderboards(root, stats, jumpToPlayer) {
  const l = stats?.leaderboards || {};
  root.innerHTML = `
    ${analyticsBlock("击杀榜", rankList(l.byKills, (row) => row.currentName || row.steamID || row.eosID || "未知玩家", (row) => `K ${fmtNumber(row.totalKills)} / D ${fmtNumber(row.totalDeaths)} / KD ${row.kd ?? "--"}`, "id"))}
    ${analyticsBlock("时长榜", rankList(l.byPlaytime, (row) => row.currentName || row.steamID || row.eosID || "未知玩家", (row) => fmtHours(row.gameSeconds), "id"))}
    ${analyticsBlock("违规榜", rankList(l.byViolations, (row) => row.currentName || row.steamID || row.eosID || "未知玩家", (row) => `违规 ${fmtNumber(row.totalViolations)}`, "playerId"))}
  `;

  root.querySelectorAll(".db-rank-player").forEach((btn) => {
    btn.addEventListener("click", () => jumpToPlayer(btn.dataset.playerId));
  });
}

function renderTrends(root, stats) {
  const t = stats?.trends || {};
  root.innerHTML = `
    ${analyticsBlock("近 N 天登录趋势", trendList(t.loginsByDay, (row) => `登录 ${fmtNumber(row.loginCount)} · 去重玩家 ${fmtNumber(row.uniquePlayers)}`))}
    ${analyticsBlock("近 N 天对局趋势", trendList(t.matchesByDay, (row) => `对局 ${fmtNumber(row.matchCount)} · 已结束 ${fmtNumber(row.completedCount)}`))}
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
      <ul class="db-list-mini">${items.length ? items.map((item) => `<li>${esc(item)}</li>`).join("") : "<li>无</li>"}</ul>
    </div>
  `;
}

function analyticsBlock(title, body) {
  return `<section class="db-analytics-block"><h4>${esc(title)}</h4>${body}</section>`;
}

function chipList(items, keyField, valueField) {
  if (!Array.isArray(items) || !items.length) return '<div class="placeholder">暂无数据</div>';
  return `<div class="db-chip-wrap">${items.map((item) => `
    <span class="db-chip"><span>${esc(item?.[keyField] ?? "--")}</span><small>${fmtNumber(item?.[valueField] ?? 0)}</small></span>
  `).join("")}</div>`;
}

function rankList(items, nameGetter, valueGetter, idField) {
  if (!Array.isArray(items) || !items.length) return '<div class="placeholder">暂无数据</div>';
  return `<ol class="db-rank-list">${items.map((item) => `
    <li>
      <button class="name db-rank-player" type="button" data-player-id="${Number(item?.[idField] || 0)}">${esc(nameGetter(item))}</button>
      <span class="value">${esc(valueGetter(item))}</span>
    </li>
  `).join("")}</ol>`;
}

function trendList(items, valueGetter) {
  if (!Array.isArray(items) || !items.length) return '<div class="placeholder">暂无数据</div>';
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
