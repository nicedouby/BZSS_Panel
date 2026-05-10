// -*- coding: utf-8 -*-

const TYPE_LABELS = {
  all: "全部",
  damage: "伤害",
  wound: "击倒",
  kill: "击杀",
};

const TYPE_CLASSES = {
  damage: "damage",
  wound: "wound",
  kill: "death",
};

let searchTimer = null;

export async function renderPage({ root, api, apiFetch }) {
  if (root.__combatCleanRefreshTimer) {
    window.clearTimeout(root.__combatCleanRefreshTimer);
    root.__combatCleanRefreshTimer = null;
  }

  const state = {
    type: "all",
    search: "",
    limit: 500,
    events: [],
    overview: {
      stats: { total: 0, damage: 0, wound: 0, kill: 0, friendlyFire: 0, teamDamage: 0, teamWound: 0, teamKill: 0 },
      rejected: 0,
      lastUpdatedAt: "",
    },
  };

  root.innerHTML = `
    <section class="page kill-page-shell combat-page-shell">
      <div class="page-title-row">
        <div>
          <div class="page-title">击杀管理（clean）</div>
          <div class="page-subtitle">标准 clean combat event layer：BZSS_DAMAGE / BZSS_WOUND / BZSS_KILL</div>
        </div>
        <span id="combat-clean-refresh-status" class="kill-refresh-status">等待刷新</span>
      </div>

      <section class="combat-stat-grid">
        ${statCard("总事件", "combat-clean-total")}
        ${statCard("伤害", "combat-clean-damage")}
        ${statCard("击倒", "combat-clean-wound")}
        ${statCard("击杀", "combat-clean-kill")}
        ${statCard("友军事件", "combat-clean-friendly")}
        ${statCard("友军击杀", "combat-clean-team-kill")}
        ${statCard("已拒绝", "combat-clean-rejected")}
        ${statCard("最近更新", "combat-clean-updated")}
      </section>

      <section class="card combat-toolbar-card">
        <div class="console-actions combat-toolbar">
          <div class="console-view-toggle combat-type-toggle" role="tablist" aria-label="clean combat 类型过滤">
            ${typeButton("all")}
            ${typeButton("damage")}
            ${typeButton("wound")}
            ${typeButton("kill")}
          </div>
          <input id="combat-clean-search" class="console-search kill-search" placeholder="搜索玩家、Steam64、EOS、武器、raw log">
          <button id="combat-clean-refresh" type="button">刷新</button>
          <button id="combat-clean-clear" type="button" class="danger-lite">清空内存事件</button>
        </div>
      </section>

      <div class="card kill-table-card combat-table-card">
        <div class="kill-table-wrap combat-table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>攻击者</th>
                <th>受害者</th>
                <th>伤害</th>
                <th>武器</th>
                <th>关系</th>
                <th>解析</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody id="combat-clean-table-body"></tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  const els = {
    body: root.querySelector("#combat-clean-table-body"),
    search: root.querySelector("#combat-clean-search"),
    status: root.querySelector("#combat-clean-refresh-status"),
    typeButtons: [...root.querySelectorAll("[data-combat-clean-type]")],
    total: root.querySelector("#combat-clean-total"),
    damage: root.querySelector("#combat-clean-damage"),
    wound: root.querySelector("#combat-clean-wound"),
    kill: root.querySelector("#combat-clean-kill"),
    friendly: root.querySelector("#combat-clean-friendly"),
    teamKill: root.querySelector("#combat-clean-team-kill"),
    rejected: root.querySelector("#combat-clean-rejected"),
    updated: root.querySelector("#combat-clean-updated"),
  };

  async function loadEvents({ silent = false } = {}) {
    if (document.visibilityState === "hidden" && silent) return;
    const params = new URLSearchParams({
      type: state.type,
      search: state.search,
      limit: String(state.limit),
    });
    const data = await api(`/api/combat-clean/events?${params.toString()}`);
    state.events = data.events ?? [];
    state.overview = data.overview ?? state.overview;
    renderStats(els, state.overview);
    renderTable(els.body, state.events);
    els.status.textContent = `已刷新 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
  }

  function scheduleRefresh() {
    root.__combatCleanRefreshTimer = window.setTimeout(async () => {
      try {
        await loadEvents({ silent: true });
      } catch (error) {
        if (error?.code === "Unauthorized") return;
      }
      scheduleRefresh();
    }, 3000);
  }

  for (const button of els.typeButtons) {
    button.addEventListener("click", async () => {
      state.type = button.dataset.combatCleanType || "all";
      updateTypeButtons(els.typeButtons, state.type);
      await loadEvents();
    });
  }

  els.search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(async () => {
      state.search = els.search.value.trim();
      await loadEvents();
    }, 180);
  });

  root.querySelector("#combat-clean-refresh").addEventListener("click", () => loadEvents());
  root.querySelector("#combat-clean-clear").addEventListener("click", async () => {
    if (!window.confirm("只清空当前内存中的 clean combat 事件，不会写入或删除数据库。继续？")) return;
    await apiFetch("/api/combat-clean/clear", { method: "POST" });
    await loadEvents();
  });

  updateTypeButtons(els.typeButtons, state.type);
  await loadEvents();
  scheduleRefresh();

  root.__pageCleanup = () => {
    if (root.__combatCleanRefreshTimer) {
      window.clearTimeout(root.__combatCleanRefreshTimer);
      root.__combatCleanRefreshTimer = null;
    }
    window.clearTimeout(searchTimer);
    closeCleanCombatDetailModal();
  };

  return root.__pageCleanup;
}

function statCard(label, id) {
  return `
    <div class="card combat-stat-card">
      <span>${esc(label)}</span>
      <strong id="${id}">-</strong>
    </div>
  `;
}

function typeButton(type) {
  return `<button type="button" class="console-view-btn" data-combat-clean-type="${type}">${esc(TYPE_LABELS[type])}</button>`;
}

function updateTypeButtons(buttons, activeType) {
  for (const button of buttons) {
    const active = button.dataset.combatCleanType === activeType;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
}

function renderStats(els, overview) {
  const stats = overview?.stats ?? {};
  els.total.textContent = fmtNumber(stats.total ?? 0);
  els.damage.textContent = fmtNumber(stats.damage ?? 0);
  els.wound.textContent = fmtNumber(stats.wound ?? 0);
  els.kill.textContent = fmtNumber(stats.kill ?? 0);
  els.friendly.textContent = fmtNumber(stats.friendlyFire ?? 0);
  els.teamKill.textContent = fmtNumber(stats.teamKill ?? 0);
  els.rejected.textContent = fmtNumber(overview?.rejected ?? 0);
  els.updated.textContent = formatTime(overview?.lastUpdatedAt);
}

function renderTable(tbody, events) {
  if (!events.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="kill-empty-cell">暂无 clean combat 事件</td></tr>`;
    return;
  }

  tbody.innerHTML = events.map((event, index) => `
    <tr class="combat-row combat-row-${TYPE_CLASSES[event.type] || "unknown"} ${event.relation?.isFriendlyFire ? "combat-row-tk" : ""}">
      <td class="combat-time-cell">${esc(formatTime(event.time))}</td>
      <td><span class="combat-type-badge ${event.relation?.isFriendlyFire ? "tk" : (TYPE_CLASSES[event.type] || "")}">${esc(TYPE_LABELS[event.type] || event.type)}</span></td>
      <td>${playerCell(event.attacker)}</td>
      <td>${playerCell(event.victim)}</td>
      <td class="combat-damage-cell">${event.damage == null ? "-" : esc(trimNumber(event.damage))}</td>
      <td>${esc(event.weapon?.displayName || event.weapon?.cleaned || event.weapon?.raw || "Unknown")}</td>
      <td>${relationCell(event.relation)}</td>
      <td>${parseCell(event.parse)}</td>
      <td><button type="button" class="combat-raw-btn" data-clean-event-index="${index}">查看</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-clean-event-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const event = events[Number(button.dataset.cleanEventIndex)];
      if (event) openCleanCombatDetailModal(event);
    });
  });
}

function playerCell(player = {}) {
  const team = player.teamID === "" || player.teamID == null ? "?" : String(player.teamID);
  const flags = [
    player.isFallback ? "fallback" : "",
    player.resolved ? player.resolutionSource : "unresolved",
  ].filter(Boolean).join(" / ");
  const ids = [
    player.steam64ID ? `Steam ${player.steam64ID}` : "",
    player.eosID ? `EOS ${player.eosID}` : "",
    player.controllerID ? `Controller ${player.controllerID}` : "",
  ].filter(Boolean).join(" / ");
  return `
    <div class="combat-player-cell">
      <strong>${esc(`${player.name || "Unknown"} (Team ${team})`)}</strong>
      ${ids ? `<span>${esc(ids)}</span>` : ""}
      ${flags ? `<span>${esc(flags)}</span>` : ""}
    </div>
  `;
}

function relationCell(relation = {}) {
  const same = relation.sameTeam ? "同队" : "非同队";
  const ff = relation.isFriendlyFire ? `友军 ${relation.friendlyFireType || ""}` : "正常";
  return `<div class="combat-player-cell"><strong>${esc(ff)}</strong><span>${esc(`${same} / ${relation.teamConfidence || "low"}`)}</span></div>`;
}

function parseCell(parse = {}) {
  const warnings = Array.isArray(parse.warnings) ? parse.warnings : [];
  return `<div class="combat-player-cell"><strong>${esc(parse.status || "-")}</strong><span>${esc([parse.confidence, warnings.length ? `${warnings.length} warning` : ""].filter(Boolean).join(" / ") || "-")}</span></div>`;
}

function openCleanCombatDetailModal(event) {
  closeCleanCombatDetailModal();

  const root = document.createElement("div");
  root.id = "bzss-clean-combat-record-root";
  root.innerHTML = `
    <div class="kill-record-backdrop" data-close-clean-combat="1"></div>
    <section class="kill-record-window combat-record-window" role="dialog" aria-modal="true" aria-label="clean combat 详情">
      <header class="kill-record-header">
        <div>
          <div class="kill-record-title">Clean Combat 详情</div>
          <div class="kill-record-subtitle">${esc(event.displayText || event.id || "")}</div>
        </div>
        <button class="kill-record-close" type="button" data-close-clean-combat="1">x</button>
      </header>

      <div class="kill-record-body">
        <div class="kill-record-grid">
          ${detailCell("displayText", event.displayText)}
          ${detailCell("eventName", event.eventName)}
          ${detailCell("type", event.type)}
          ${detailCell("time", formatTime(event.time))}
          ${detailCell("attacker", formatPlayerRef(event.attacker))}
          ${detailCell("victim", formatPlayerRef(event.victim))}
          ${detailCell("weapon", formatWeapon(event.weapon))}
          ${detailCell("relation", formatRelation(event.relation))}
          ${detailCell("warnings", formatWarnings(event.parse?.warnings))}
          ${detailCell("parse", `${event.parse?.status || "-"} / ${event.parse?.confidence || "-"}`)}
          ${detailCell("source", `${event.raw?.sourceModule || "-"} / ${event.raw?.sourceEventId || "-"}`)}
          ${detailCell("server", event.serverId || "-")}
        </div>

        <div class="kill-record-raw-card">
          <h3>Raw Log</h3>
          <pre class="kill-record-pre">${esc(event.raw?.rawLog || "无 rawLog")}</pre>
        </div>
      </div>
    </section>
  `;

  document.body.appendChild(root);
  root.querySelectorAll("[data-close-clean-combat]").forEach((el) => {
    el.addEventListener("click", closeCleanCombatDetailModal);
  });

  const onKeyDown = (keyboardEvent) => {
    if (keyboardEvent.key === "Escape") closeCleanCombatDetailModal();
  };
  window.addEventListener("keydown", onKeyDown);
  root.__onKeyDown = onKeyDown;
}

function closeCleanCombatDetailModal() {
  const root = document.querySelector("#bzss-clean-combat-record-root");
  if (!root) return;
  if (root.__onKeyDown) window.removeEventListener("keydown", root.__onKeyDown);
  root.remove();
}

function detailCell(label, value) {
  return `<div><span>${esc(label)}</span><strong>${esc(value ?? "-")}</strong></div>`;
}

function formatPlayerRef(player = {}) {
  return [
    player.name || "Unknown",
    `team=${blank(player.teamID)}`,
    `squad=${blank(player.squadID)}`,
    player.steam64ID ? `steam=${player.steam64ID}` : "",
    player.eosID ? `eos=${player.eosID}` : "",
    player.controllerID ? `controller=${player.controllerID}` : "",
    player.role ? `role=${player.role}` : "",
    player.isLeader ? "leader" : "",
    player.resolved ? `resolved:${player.resolutionSource}` : "unresolved",
    player.isFallback ? `fallback:${player.fallbackReason}` : "",
  ].filter(Boolean).join(" / ");
}

function formatWeapon(weapon = {}) {
  return [
    weapon.displayName || weapon.cleaned || weapon.raw || "Unknown",
    weapon.category ? `category=${weapon.category}` : "",
    weapon.sourceType ? `source=${weapon.sourceType}` : "",
    weapon.raw ? `raw=${weapon.raw}` : "",
  ].filter(Boolean).join(" / ");
}

function formatRelation(relation = {}) {
  return [
    `attackerTeam=${blank(relation.attackerTeamID)}`,
    `victimTeam=${blank(relation.victimTeamID)}`,
    relation.sameTeam ? "sameTeam" : "notSameTeam",
    relation.isFriendlyFire ? `friendlyFire:${relation.friendlyFireType || "yes"}` : "normal",
    `confidence=${relation.teamConfidence || "low"}`,
    `source=${relation.teamSource || "unknown"}`,
  ].join(" / ");
}

function formatWarnings(warnings) {
  return Array.isArray(warnings) && warnings.length ? warnings.join(" / ") : "-";
}

function blank(value) {
  return value === "" || value == null ? "?" : String(value);
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("zh-CN", { hour12: false });
}

function trimNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "-");
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(6)));
}

function fmtNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
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
