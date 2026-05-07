// -*- coding: utf-8 -*-

export async function renderPage({ root, api, openDrawer }) {
  const state = {
    q: "",
    sort: "updated_desc",
    limit: 100,
  };

  async function load() {
    const params = new URLSearchParams({
      q: state.q,
      sort: state.sort,
      limit: String(state.limit),
    });
    return api(`/api/player-database/list?${params.toString()}`);
  }

  async function draw() {
    const data = await load();
    const players = data.players ?? [];
    const stats = data.stats ?? {};

    root.innerHTML = `
      <section class="page">
        <div class="page-title-row">
          <div>
            <div class="page-title">玩家数据库</div>
            <div class="match-empty">MicePanel 兼容 SQLite：players / aliases / ips / logins / squad records / log events</div>
          </div>
          <div class="console-actions">
            <button id="sync-online">同步在线玩家</button>
            <button id="refresh">刷新</button>
          </div>
        </div>

        <div class="grid cols-3">
          <div class="card match-stat-card">
            <div class="match-stat-label">总玩家</div>
            <div class="match-stat-value">${fmtNumber(stats.totalPlayers)}</div>
          </div>
          <div class="card match-stat-card">
            <div class="match-stat-label">服务器时长</div>
            <div class="match-stat-value">${fmtDuration(stats.totalServerSeconds)}</div>
          </div>
          <div class="card match-stat-card">
            <div class="match-stat-label">击杀 / 死亡</div>
            <div class="match-stat-value">${fmtNumber(stats.totalKills)} / ${fmtNumber(stats.totalDeaths)}</div>
          </div>
        </div>

        <div class="card">
          <div class="console-actions" style="margin-bottom: 10px;">
            <input id="search" class="console-search" placeholder="搜索名称 / Steam64 / EOS / IP" value="${esc(state.q)}" />
            <select id="sort">
              <option value="updated_desc" ${state.sort === "updated_desc" ? "selected" : ""}>最近更新</option>
              <option value="name_asc" ${state.sort === "name_asc" ? "selected" : ""}>名称排序</option>
            </select>
            <span class="match-empty">显示 ${players.length} / ${fmtNumber(data.total)} 条</span>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>Steam64</th>
                  <th>EOS</th>
                  <th>权限组</th>
                  <th>时长</th>
                  <th>K/D</th>
                  <th>建队</th>
                  <th>最近更新</th>
                </tr>
              </thead>
              <tbody>
                ${players.map((p) => `
                  <tr data-player-id="${p.id}">
                    <td>${esc(p.name || "未知玩家")}</td>
                    <td>${esc(p.steam64)}</td>
                    <td>${esc(p.eos)}</td>
                    <td>${esc(p.permissionGroup)}</td>
                    <td>${esc(fmtDuration(p.serverSeconds))}</td>
                    <td>${fmtNumber(p.kills)} / ${fmtNumber(p.deaths)}</td>
                    <td>${fmtNumber(p.squadCreated)}</td>
                    <td>${esc(fmtTime(p.updatedAt))}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;

    root.querySelector("#refresh").addEventListener("click", draw);
    root.querySelector("#sync-online").addEventListener("click", async () => {
      await fetch("/api/player-database/sync-online", { method: "POST" });
      await draw();
    });
    root.querySelector("#sort").addEventListener("change", async (event) => {
      state.sort = event.target.value;
      await draw();
    });
    root.querySelector("#search").addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      state.q = event.currentTarget.value.trim();
      await draw();
    });

    root.querySelectorAll("[data-player-id]").forEach((el) => {
      el.addEventListener("click", async () => {
        const detail = await api(`/api/player-database/detail?id=${encodeURIComponent(el.dataset.playerId)}`);
        openDrawer({
          title: detail.player?.current_name || "玩家详情",
          body: renderDetail(detail),
        });
      });
    });
  }

  await draw();
}

function renderDetail(detail) {
  const p = detail.player ?? {};
  return `
    <div class="detail-block">
      <div class="detail-grid">
        <div><span>Steam64</span><strong>${esc(p.steam_id)}</strong></div>
        <div><span>EOS</span><strong>${esc(p.eos_id)}</strong></div>
        <div><span>IP</span><strong>${esc(p.current_ip)}</strong></div>
        <div><span>权限组</span><strong>${esc(p.permission_group)}</strong></div>
        <div><span>服务器时长</span><strong>${esc(fmtDuration(p.server_seconds))}</strong></div>
        <div><span>小队长时长</span><strong>${esc(fmtDuration(p.squad_leader_seconds))}</strong></div>
        <div><span>击杀 / 倒地 / 死亡</span><strong>${fmtNumber(Number(p.total_kills_light || 0) + Number(p.total_kills_other || 0))} / ${fmtNumber(Number(p.total_downed_light || 0) + Number(p.total_downed_other || 0))} / ${fmtNumber(p.total_deaths)}</strong></div>
        <div><span>TK / 自杀</span><strong>${fmtNumber(Number(p.total_tk_down || 0) + Number(p.total_tk_kill || 0))} / ${fmtNumber(p.total_suicides)}</strong></div>
      </div>
    </div>
    <div class="detail-block">
      <strong>别名</strong>
      <pre class="detail-pre">${esc(JSON.stringify(detail.aliases ?? [], null, 2))}</pre>
    </div>
    <div class="detail-block">
      <strong>IP 历史</strong>
      <pre class="detail-pre">${esc(JSON.stringify(detail.ips ?? [], null, 2))}</pre>
    </div>
    <div class="detail-block">
      <strong>登录记录</strong>
      <pre class="detail-pre">${esc(JSON.stringify(detail.logins ?? [], null, 2))}</pre>
    </div>
    <div class="detail-block">
      <strong>建队记录</strong>
      <pre class="detail-pre">${esc(JSON.stringify(detail.squadCreated ?? [], null, 2))}</pre>
    </div>
  `;
}

function fmtNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function fmtDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function fmtTime(value) {
  const ts = Number(value || 0);
  if (!ts) return "";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
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
