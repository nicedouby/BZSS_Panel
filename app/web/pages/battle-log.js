// -*- coding: utf-8 -*-

const TYPE_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "down", label: "击倒" },
  { value: "kill", label: "击杀" },
  { value: "death", label: "死亡" },
  { value: "revive", label: "复苏" },
  { value: "tk", label: "TK" },
  { value: "player_connected", label: "连接" },
  { value: "player_joined", label: "加入" },
  { value: "player_disconnected", label: "断开" },
  { value: "player_left", label: "离开" },
  { value: "squad_created", label: "建队" },
  { value: "squad_disbanded", label: "解散" },
  { value: "map_bring_up", label: "地图启动" },
  { value: "map_changed", label: "胜负判定" },
];

export async function renderPage({ root, api, apiFetch, routeInfo }) {
  if (root.__battleLogTimer) {
    window.clearInterval(root.__battleLogTimer);
    root.__battleLogTimer = null;
  }

  const state = {
    type: String(routeInfo?.params?.get?.("type") ?? "all"),
    search: String(routeInfo?.params?.get?.("q") ?? ""),
    player: String(routeInfo?.params?.get?.("player") ?? routeInfo?.params?.get?.("playerKey") ?? ""),
    limit: clampInt(routeInfo?.params?.get?.("limit"), 200, 100, 1000),
    overview: null,
    events: [],
    playerStats: null,
    bootLoading: true,
    bootError: "",
    eventsLoading: false,
    eventsError: "",
    playerLoading: false,
  };

  root.innerHTML = `
    <section class="page battle-log-page">
      <div class="page-title-row">
        <div>
          <div class="page-title">战绩记录</div>
          <div class="page-subtitle">击倒来自 combatClean，击杀 / 死亡 / 复苏来自 combatClean，TK 仅来自 RCON TEAM_KILL。</div>
        </div>
        <div class="console-actions">
          <button id="battle-log-refresh" type="button">刷新</button>
        </div>
      </div>

      <section class="card battle-summary-card">
        <div class="battle-summary-grid">
          <div class="battle-summary-item"><span>总数</span><strong id="battle-log-total">0</strong></div>
          <div class="battle-summary-item"><span>击倒</span><strong id="battle-log-down">0</strong></div>
          <div class="battle-summary-item"><span>击杀</span><strong id="battle-log-kill">0</strong></div>
          <div class="battle-summary-item"><span>死亡</span><strong id="battle-log-death">0</strong></div>
          <div class="battle-summary-item"><span>复苏</span><strong id="battle-log-revive">0</strong></div>
          <div class="battle-summary-item"><span>TK</span><strong id="battle-log-tk">0</strong></div>
        </div>
        <div class="battle-summary-meta">
          <span>来源: <span id="battle-log-source">--</span></span>
          <span>最后更新: <span id="battle-log-updated">--</span></span>
        </div>
      </section>

      <section class="card battle-toolbar-card">
        <div class="console-actions battle-toolbar">
          <div class="console-view-toggle" role="tablist" aria-label="battle log type filter">
            ${TYPE_OPTIONS.map((opt) => `<button type="button" class="console-view-btn" data-battle-log-type="${opt.value}">${opt.label}</button>`).join("")}
          </div>
          <input id="battle-log-search" class="console-search" placeholder="搜索玩家 / 武器 / 来源 / 备注">
          <input id="battle-log-player" class="console-search" placeholder="玩家查询（名称 / Steam64 / EOS / Controller）">
          <select id="battle-log-limit" class="console-filter">
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="500">500</option>
            <option value="1000">1000</option>
          </select>
        </div>
      </section>

      <section id="battle-log-player-card" class="card battle-player-card" hidden>
        <div class="section-head">
          <strong>玩家统计</strong>
          <span id="battle-log-player-name">--</span>
        </div>
        <div class="battle-summary-grid battle-player-grid">
          <div class="battle-summary-item"><span>击倒</span><strong id="battle-log-player-down">0</strong></div>
          <div class="battle-summary-item"><span>击杀</span><strong id="battle-log-player-kill">0</strong></div>
          <div class="battle-summary-item"><span>死亡</span><strong id="battle-log-player-death">0</strong></div>
          <div class="battle-summary-item"><span>复苏</span><strong id="battle-log-player-revive">0</strong></div>
          <div class="battle-summary-item"><span>TK</span><strong id="battle-log-player-tk">0</strong></div>
          <div class="battle-summary-item"><span>总数</span><strong id="battle-log-player-total">0</strong></div>
        </div>
        <div class="battle-summary-meta" id="battle-log-player-meta"></div>
        <div id="battle-log-player-events" class="battle-player-events"></div>
      </section>

      <div id="battle-log-loading" class="card">加载中...</div>
      <div id="battle-log-body" hidden>
        <div id="battle-log-error" class="card" hidden></div>
        <div class="card battle-table-card">
          <div class="table-wrap battle-table-wrap">
            <table class="battle-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>玩家</th>
                  <th>对手</th>
                  <th>来源</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody id="battle-log-rows"></tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  `;

  const els = {
    loading: root.querySelector("#battle-log-loading"),
    body: root.querySelector("#battle-log-body"),
    error: root.querySelector("#battle-log-error"),
    total: root.querySelector("#battle-log-total"),
    down: root.querySelector("#battle-log-down"),
    kill: root.querySelector("#battle-log-kill"),
    death: root.querySelector("#battle-log-death"),
    revive: root.querySelector("#battle-log-revive"),
    tk: root.querySelector("#battle-log-tk"),
    source: root.querySelector("#battle-log-source"),
    updated: root.querySelector("#battle-log-updated"),
    rows: root.querySelector("#battle-log-rows"),
    search: root.querySelector("#battle-log-search"),
    player: root.querySelector("#battle-log-player"),
    limit: root.querySelector("#battle-log-limit"),
    playerCard: root.querySelector("#battle-log-player-card"),
    playerName: root.querySelector("#battle-log-player-name"),
    playerMeta: root.querySelector("#battle-log-player-meta"),
    playerDown: root.querySelector("#battle-log-player-down"),
    playerKill: root.querySelector("#battle-log-player-kill"),
    playerDeath: root.querySelector("#battle-log-player-death"),
    playerRevive: root.querySelector("#battle-log-player-revive"),
    playerTk: root.querySelector("#battle-log-player-tk"),
    playerTotal: root.querySelector("#battle-log-player-total"),
    playerEvents: root.querySelector("#battle-log-player-events"),
  };

  const typeButtons = [...root.querySelectorAll("[data-battle-log-type]")];

  root.querySelector("#battle-log-refresh").addEventListener("click", () => refreshAll());
  els.search.value = state.search;
  els.player.value = state.player;
  els.limit.value = String(state.limit);

  for (const button of typeButtons) {
    button.addEventListener("click", async () => {
      state.type = button.dataset.battleLogType || "all";
      updateButtons();
      await refreshEvents();
    });
  }

  els.search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") refreshEvents();
  });
  els.player.addEventListener("keydown", (event) => {
    if (event.key === "Enter") refreshPlayer();
  });
  els.limit.addEventListener("change", () => {
    state.limit = Number(els.limit.value) || 200;
    refreshEvents();
  });
  els.search.addEventListener("input", () => {
    state.search = els.search.value;
  });
  els.player.addEventListener("input", () => {
    state.player = els.player.value;
  });

  updateButtons();
  await refreshAll();

  root.__battleLogTimer = window.setInterval(() => {
    refreshEvents({ silent: true }).catch(() => {});
  }, 3000);

  root.__pageCleanup = () => {
    if (root.__battleLogTimer) {
      window.clearInterval(root.__battleLogTimer);
      root.__battleLogTimer = null;
    }
  };

  return root.__pageCleanup;

  async function refreshAll() {
    state.bootLoading = true;
    state.bootError = "";
    renderState();
    try {
      await Promise.all([refreshEvents(), refreshPlayer()]);
    } catch (error) {
      state.bootError = error?.message || "加载战绩记录失败";
    } finally {
      state.bootLoading = false;
      renderState();
    }
  }

  async function refreshEvents({ silent = false } = {}) {
    state.eventsLoading = true;
    state.eventsError = "";
    renderState();

    try {
      const params = new URLSearchParams({
        type: state.type,
        search: state.search,
        limit: String(state.limit),
      });
      const data = await api(`/api/battle-log/events?${params.toString()}`);
      state.events = Array.isArray(data.events) ? data.events : [];
      state.overview = data.overview ?? state.overview;
    } catch (error) {
      state.eventsError = error?.message || "加载战绩事件失败";
      if (!silent) {
        state.events = [];
      }
    } finally {
      state.eventsLoading = false;
      renderState();
    }
  }

  async function refreshPlayer() {
    const query = state.player.trim();
    if (!query) {
      state.playerStats = null;
      renderState();
      return;
    }

    state.playerLoading = true;
    renderState();
    try {
      const params = new URLSearchParams({ q: query });
      state.playerStats = await api(`/api/battle-log/player?${params.toString()}`);
    } catch (error) {
      state.playerStats = null;
      state.eventsError = error?.message || "加载玩家统计失败";
    } finally {
      state.playerLoading = false;
      renderState();
    }
  }

  function updateButtons() {
    for (const button of typeButtons) {
      const active = button.dataset.battleLogType === state.type;
      button.classList.toggle("active", active);
    }
  }

  function renderState() {
    els.loading.hidden = !state.bootLoading;
    els.body.hidden = state.bootLoading || Boolean(state.bootError);
    if (state.bootError) {
      els.loading.textContent = state.bootError;
      els.loading.hidden = false;
      els.body.hidden = true;
    }

    els.total.textContent = formatNumber(state.overview?.count ?? 0);
    els.down.textContent = formatNumber(state.overview?.stats?.down ?? 0);
    els.kill.textContent = formatNumber(state.overview?.stats?.kill ?? 0);
    els.death.textContent = formatNumber(state.overview?.stats?.death ?? 0);
    els.revive.textContent = formatNumber(state.overview?.stats?.revive ?? 0);
    els.tk.textContent = formatNumber(state.overview?.stats?.tk ?? 0);
    els.source.textContent = formatSourceSummary(state.overview);
    els.updated.textContent = formatTime(state.overview?.lastUpdatedAt);

    if (state.eventsError) {
      els.error.hidden = false;
      els.error.textContent = state.eventsError;
    } else {
      els.error.hidden = true;
      els.error.textContent = "";
    }

    renderRows();
    renderPlayer();
  }

  function renderRows() {
    if (!state.events.length) {
      els.rows.innerHTML = `<tr><td colspan="6" class="battle-empty-cell">暂无战绩事件</td></tr>`;
      return;
    }

    els.rows.innerHTML = state.events.map((event) => `
      <tr class="battle-row battle-row--${esc(event.statType || "")}">
        <td class="time-cell">${esc(formatTime(event.time))}</td>
        <td><span class="type-pill ${esc(event.statType || "")}">${esc(eventTypeLabel(event))}</span></td>
        <td>${renderPlayerCell(event.player, event.playerName)}</td>
        <td>${renderPlayerCell(event.counterparty, event.counterpartyName)}</td>
        <td>${esc(renderSourceLabel(event))}<br><small>${esc(event.sourceEventName || event.sourceModule || "-")}</small></td>
        <td>${esc(event.note || event.displayText || "-")}</td>
      </tr>
    `).join("");
  }

  function renderPlayer() {
    const player = state.playerStats;
    if (!player) {
      els.playerCard.hidden = true;
      els.playerEvents.innerHTML = "";
      return;
    }

    els.playerCard.hidden = false;
    els.playerName.textContent = player.player?.displayName || player.player?.name || player.query || "Unknown";
    els.playerMeta.textContent = [
      player.player?.steam64ID ? `Steam64 ${player.player.steam64ID}` : "",
      player.player?.eosID ? `EOS ${player.player.eosID}` : "",
      player.player?.controllerID ? `Controller ${player.player.controllerID}` : "",
    ].filter(Boolean).join("  ");
    els.playerDown.textContent = formatNumber(player.stats?.down ?? 0);
    els.playerKill.textContent = formatNumber(player.stats?.kill ?? 0);
    els.playerDeath.textContent = formatNumber(player.stats?.death ?? 0);
    els.playerRevive.textContent = formatNumber(player.stats?.revive ?? 0);
    els.playerTk.textContent = formatNumber(player.stats?.tk ?? 0);
    els.playerTotal.textContent = formatNumber(player.count ?? 0);

    const latest = Array.isArray(player.latest) ? player.latest : [];
    if (!latest.length) {
      els.playerEvents.innerHTML = `<div class="empty-note">该玩家暂无匹配事件</div>`;
      return;
    }

    els.playerEvents.innerHTML = latest.map((event) => `
      <div class="battle-player-event">
        <span>${esc(formatTime(event.time))}</span>
        <strong>${esc(eventTypeLabel(event))}</strong>
        <span>${esc(event.displayText || event.note || "-")}</span>
      </div>
    `).join("");
  }
}

function formatSourceSummary(overview) {
  const log = overview?.sourceStatus?.log;
  const mod = overview?.sourceStatus?.mod;
  const logText = log ? `log:${log.enabled ? "on" : "off"}/${log.subscribed ? "sub" : "unsub"}` : "log:--";
  const modText = mod ? `mod:${mod.enabled ? "on" : "off"}` : "mod:--";
  return `${logText} ${modText}`;
}

function eventTypeLabel(event) {
  const type = String(event?.statType ?? event?.type ?? "").trim().toLowerCase();
  if (type === "down") return "击倒";
  if (type === "kill") return "击杀";
  if (type === "death") return "死亡";
  if (type === "revive") return "复苏";
  if (type === "tk") return "TK";
  if (type === "player_connected") return "连接";
  if (type === "player_joined") return "加入";
  if (type === "player_disconnected") return "断开";
  if (type === "player_left") return "离开";
  if (type === "squad_created") return "建队";
  if (type === "squad_disbanded") return "解散";
  if (type === "map_bring_up") return "地图启动";
  if (type === "map_changed") return "胜负判定";
  return type || "-";
}

function renderSourceLabel(event) {
  if (event?.sourceType === "rcon") return "RCON";
  if (event?.sourceType === "core") return "BZSS CORE";
  return String(event?.sourceModule ?? "").includes("combatClean") ? "combatClean" : "core";
}

function renderPlayerCell(player, fallback = "") {
  const name = esc(player?.displayName || player?.name || fallback || "-");
  const steam = player?.steam64ID ? `<small>Steam64 ${esc(player.steam64ID)}</small>` : "";
  return `<div class="battle-player-cell"><strong>${name}</strong>${steam}</div>`;
}

function formatTime(value) {
  const text = String(value ?? "");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : "0";
}

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
