// -*- coding: utf-8 -*-

const TYPE_LABELS = {
  all: "全部",
  damage: "伤害",
  wound: "击倒",
  death: "死亡/击杀",
  friendly: "友军事件",
  teamDamage: "友军伤害",
  teamWound: "TK击倒",
  teamKill: "友军击杀",
  tk: "友军击杀",
};

const TYPE_CLASSES = {
  damage: "damage",
  wound: "wound",
  death: "death",
  team_damage: "tk",
  team_wound: "tk",
  team_kill: "tk",
  tk: "tk",
};

let searchTimer = null;

export async function renderPage({ root, api, apiFetch }) {
  if (root.__combatRefreshTimer) {
    window.clearTimeout(root.__combatRefreshTimer);
    root.__combatRefreshTimer = null;
  }

  const state = {
    type: "all",
    search: "",
    limit: 500,
    events: [],
    overview: {
      stats: { total: 0, damage: 0, wound: 0, death: 0, teamDamage: 0, teamWound: 0, teamKill: 0 },
      lastUpdatedAt: "",
    },
  };

  root.innerHTML = `
    <section class="page kill-page-shell combat-page-shell">
      <div class="page-title-row">
        <div>
          <div class="page-title">战斗事件管理</div>
          <div class="page-subtitle">伤害、击倒、死亡/击杀事件流水</div>
        </div>
        <span id="combat-refresh-status" class="kill-refresh-status">等待刷新</span>
      </div>

      <section class="combat-stat-grid">
        ${statCard("总事件", "combat-total")}
        ${statCard("伤害", "combat-damage")}
        ${statCard("击倒", "combat-wound")}
        ${statCard("死亡/击杀", "combat-death")}
        ${statCard("友军伤害", "combat-team-damage")}
        ${statCard("TK击倒", "combat-team-wound")}
        ${statCard("友军击杀", "combat-team-kill")}
        ${statCard("最近更新时间", "combat-updated")}
      </section>

      <section class="card combat-toolbar-card">
        <div class="console-actions combat-toolbar">
          <div class="console-view-toggle combat-type-toggle" role="tablist" aria-label="事件类型筛选">
            ${typeButton("all")}
            ${typeButton("damage")}
            ${typeButton("wound")}
            ${typeButton("death")}
            ${typeButton("teamDamage")}
            ${typeButton("teamWound")}
            ${typeButton("teamKill")}
          </div>
          <input id="combat-search" class="console-search kill-search" placeholder="搜索玩家名、Steam64、EOS、武器/来源">
          <button id="combat-refresh" type="button">刷新</button>
          <button id="combat-clear" type="button" class="danger-lite" title="只清空当前内存中的战斗事件，不删除日志文件">清空内存事件</button>
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
                <th>伤害值</th>
                <th>武器/来源</th>
                <th>置信度</th>
                <th>解析状态</th>
                <th>原始日志</th>
              </tr>
            </thead>
            <tbody id="combat-table-body"></tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  const els = {
    body: root.querySelector("#combat-table-body"),
    search: root.querySelector("#combat-search"),
    status: root.querySelector("#combat-refresh-status"),
    typeButtons: [...root.querySelectorAll("[data-combat-type]")],
    total: root.querySelector("#combat-total"),
    damage: root.querySelector("#combat-damage"),
    wound: root.querySelector("#combat-wound"),
    death: root.querySelector("#combat-death"),
    teamDamage: root.querySelector("#combat-team-damage"),
    teamWound: root.querySelector("#combat-team-wound"),
    teamKill: root.querySelector("#combat-team-kill"),
    updated: root.querySelector("#combat-updated"),
  };

  async function loadEvents({ silent = false } = {}) {
    if (document.visibilityState === "hidden" && silent) return;

    const params = new URLSearchParams({
      type: state.type,
      search: state.search,
      limit: String(state.limit),
    });
    const data = await api(`/api/combat/events?${params.toString()}`);
    state.events = data.events ?? [];
    state.overview = data.overview ?? state.overview;
    renderStats(els, state.overview);
    renderTable(els.body, state.events);
    els.status.textContent = `已刷新 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
  }

  function scheduleRefresh() {
    root.__combatRefreshTimer = window.setTimeout(async () => {
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
      state.type = button.dataset.combatType || "all";
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

  root.querySelector("#combat-refresh").addEventListener("click", () => loadEvents());

  root.querySelector("#combat-clear").addEventListener("click", async () => {
    if (!window.confirm("只清空当前内存中的战斗事件，不删除日志文件。确认继续？")) return;
    await apiFetch("/api/combat/clear", { method: "POST" });
    state.events = [];
    await loadEvents();
  });

  updateTypeButtons(els.typeButtons, state.type);
  await loadEvents();
  scheduleRefresh();

  root.__pageCleanup = () => {
    if (root.__combatRefreshTimer) {
      window.clearTimeout(root.__combatRefreshTimer);
      root.__combatRefreshTimer = null;
    }
    window.clearTimeout(searchTimer);
    closeCombatEventWindow();
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
  return `<button type="button" class="console-view-btn" data-combat-type="${type}">${TYPE_LABELS[type]}</button>`;
}

function updateTypeButtons(buttons, activeType) {
  for (const button of buttons) {
    const active = button.dataset.combatType === activeType;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
}

function renderStats(els, overview) {
  const stats = overview?.stats ?? {};
  els.total.textContent = fmtNumber(stats.total ?? 0);
  els.damage.textContent = fmtNumber(stats.damage ?? 0);
  els.wound.textContent = fmtNumber(stats.wound ?? 0);
  els.death.textContent = fmtNumber(stats.death ?? 0);
  els.teamDamage.textContent = fmtNumber(stats.teamDamage ?? 0);
  els.teamWound.textContent = fmtNumber(stats.teamWound ?? 0);
  els.teamKill.textContent = fmtNumber(stats.teamKill ?? 0);
  els.updated.textContent = formatTime(overview?.lastUpdatedAt);
}

function renderTable(tbody, events) {
  if (!events.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="kill-empty-cell">暂无匹配的战斗事件</td></tr>`;
    return;
  }

  tbody.innerHTML = events.map((event, index) => `
    <tr class="combat-row combat-row-${TYPE_CLASSES[event.type] || "unknown"} ${event.isFriendlyFire || event.isTeamKill || event.tk ? "combat-row-tk" : ""}">
      <td class="combat-time-cell">${esc(formatTime(event.time))}</td>
      <td><span class="combat-type-badge ${event.isFriendlyFire || event.isTeamKill || event.tk ? "tk" : (TYPE_CLASSES[event.type] || "")}">${esc(getEventTypeLabel(event))}</span></td>
      <td>${playerCell(event.attackerName, "未知攻击者", event.attackerSteam64ID, event.attackerEOSID, event.attackerControllerID, event.attackerTeamID)}</td>
      <td>${playerCell(event.victimName, "未知受害者", event.victimSteam64ID, event.victimEOSID, "", event.victimTeamID)}</td>
      <td class="combat-damage-cell">${event.damage == null ? "-" : esc(trimNumber(event.damage))}</td>
      <td>${esc(event.weapon || event.causedBy || "未知来源")}</td>
      <td>${confidenceCell(event)}</td>
      <td>${esc(event.parseStatus || "-")}</td>
      <td><button type="button" class="combat-raw-btn" data-event-index="${index}">查看</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-event-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const event = events[Number(button.dataset.eventIndex)];
      if (event) openCombatEventWindow(event);
    });
  });
}

function playerCell(name, fallback, steam64, eos, controllerID = "", teamID = "") {
  const title = name || fallback;
  const normalizedTeam = teamID === "" || teamID == null ? "?" : String(teamID);
  const teamSuffix = `（team${normalizedTeam}）`;
  const ids = [
    steam64 ? `Steam ${steam64}` : "",
    eos ? `EOS ${eos}` : "",
    controllerID ? `Controller ${controllerID}` : "",
  ].filter(Boolean).join(" / ");
  return `
    <div class="combat-player-cell">
      <strong>${esc(`${title}${teamSuffix}`)}</strong>
      ${ids ? `<span>${esc(ids)}</span>` : ""}
    </div>
  `;
}

function confidenceCell(event) {
  const parts = [
    event.confidence ? `总 ${event.confidence}` : "",
    event.parseConfidence ? `解析 ${event.parseConfidence}` : "",
    event.identityConfidence ? `身份 ${event.identityConfidence}` : "",
  ].filter(Boolean);
  return esc(parts.join(" / ") || "-");
}

function getEventTypeLabel(event) {
  if (event.friendlyFireLabel) return event.friendlyFireLabel;
  if (event.isTeamKill || event.tk) return "友军击杀";
  if (event.isFriendlyFire) {
    if (event.type === "damage" || event.type === "damaged") return "友军伤害";
    if (event.type === "wound" || event.type === "wounded") return "TK击倒";
    return "友军击杀";
  }
  return TYPE_LABELS[event.type] || event.type || "-";
}

function formatPlayerWithTeam(name, teamID) {
  const normalizedTeam = teamID === "" || teamID == null ? "?" : String(teamID);
  return `${String(name ?? "").trim() || "-"}（team${normalizedTeam}）`;
}

function openCombatEventWindow(event) {
  closeCombatEventWindow();

  const root = document.createElement("div");
  root.id = "bzss-kill-record-root";
  root.innerHTML = `
    <div class="kill-record-backdrop" data-close-combat-window="1"></div>
    <section class="kill-record-window combat-record-window" role="dialog" aria-modal="true" aria-label="战斗事件详情">
      <header class="kill-record-header">
        <div>
          <div class="kill-record-title">战斗事件详情</div>
          <div class="kill-record-subtitle">${esc(TYPE_LABELS[event.type] || event.type)} | ${esc(formatPlayerWithTeam(event.attackerName || "未知攻击者", event.attackerTeamID))} -> ${esc(formatPlayerWithTeam(event.victimName || "未知受害者", event.victimTeamID))}</div>
        </div>
        <button class="kill-record-close" type="button" data-close-combat-window="1">x</button>
      </header>

      <div class="kill-record-body">
        <div class="kill-record-grid">
          ${detailCell("事件", event.eventName)}
          ${detailCell("时间", formatTime(event.time))}
          ${detailCell("类型", getEventTypeLabel(event))}
          ${detailCell("友军事件", event.isFriendlyFire || event.isTeamKill || event.tk ? "是" : "否")}
          ${detailCell("攻击者队伍", event.attackerTeamID || "-")}
          ${detailCell("受害者队伍", event.victimTeamID || "-")}
          ${detailCell("攻击者", formatPlayerWithTeam(event.attackerName || "未知攻击者", event.attackerTeamID))}
          ${detailCell("受害者", formatPlayerWithTeam(event.victimName || "未知受害者", event.victimTeamID))}
          ${detailCell("伤害值", event.damage == null ? "-" : trimNumber(event.damage))}
          ${detailCell("CausedBy", event.causedBy || "未知来源")}
          ${detailCell("FromObject", event.fromObject || "-")}
          ${detailCell("解析状态", event.parseStatus || "-")}
          ${detailCell("置信度", event.confidence || "-")}
          ${detailCell("身份来源", event.identitySource || "-")}
          ${detailCell("Server", event.serverId || "-")}
        </div>

        <div class="kill-record-raw-card">
          <h3>原始日志</h3>
          <pre class="kill-record-pre">${esc(event.rawLog || "事件中没有原始日志字段。")}</pre>
        </div>
      </div>
    </section>
  `;

  document.body.appendChild(root);
  root.querySelectorAll("[data-close-combat-window]").forEach((el) => {
    el.addEventListener("click", closeCombatEventWindow);
  });

  const onKeyDown = (event) => {
    if (event.key === "Escape") closeCombatEventWindow();
  };
  window.addEventListener("keydown", onKeyDown);
  root.__onKeyDown = onKeyDown;
}

function closeCombatEventWindow() {
  const root = document.querySelector("#bzss-kill-record-root");
  if (!root) return;
  if (root.__onKeyDown) {
    window.removeEventListener("keydown", root.__onKeyDown);
  }
  root.remove();
}

function detailCell(label, value) {
  return `<div><span>${esc(label)}</span><strong>${esc(value ?? "-")}</strong></div>`;
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
