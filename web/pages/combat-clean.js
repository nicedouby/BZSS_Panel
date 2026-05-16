// -*- coding: utf-8 -*-

const TYPE_LABELS = {
  all: "\u5168\u90e8",
  damage: "\u4f24\u5bb3",
  wound: "\u51fb\u503c",
  kill: "\u51fb\u6740",
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
    hoverKey: "",
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
          <div class="page-title">\u6218\u6597\u7ba1\u7406\uff08\u5904\u7406\u540e\uff09</div>
          <div class="page-subtitle">Clean combat event layer: BZSS_DAMAGE / BZSS_WOUND / BZSS_KILL</div>
        </div>
        <span id="combat-clean-refresh-status" class="kill-refresh-status">Waiting for refresh</span>
      </div>

      <section class="combat-stat-grid">
        ${statCard("\u603b\u4e8b\u4ef6", "combat-clean-total")}
        ${statCard("\u4f24\u5bb3", "combat-clean-damage")}
        ${statCard("\u51fb\u503c", "combat-clean-wound")}
        ${statCard("\u51fb\u6740", "combat-clean-kill")}
        ${statCard("\u53cb\u519b\u4e8b\u4ef6", "combat-clean-friendly")}
        ${statCard("\u53cb\u519b\u51fb\u6740", "combat-clean-team-kill")}
        ${statCard("\u5df2\u62d2\u7edd", "combat-clean-rejected")}
        ${statCard("\u6700\u8fd1\u66f4\u65b0", "combat-clean-updated")}
      </section>

      <section class="card combat-toolbar-card">
        <div class="console-actions combat-toolbar">
          <div class="console-view-toggle combat-type-toggle" role="tablist" aria-label="clean combat type filter">
            ${typeButton("all")}
            ${typeButton("damage")}
            ${typeButton("wound")}
            ${typeButton("kill")}
          </div>
          <input id="combat-clean-search" class="console-search kill-search" placeholder="Search player / Steam64 / EOS / weapon / raw log">
          <button id="combat-clean-refresh" type="button">Refresh</button>
          <button id="combat-clean-clear" type="button" class="danger-lite">Clear events</button>
        </div>
      </section>

      <div class="card kill-table-card combat-table-card">
        <div class="kill-table-wrap combat-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Mark</th>
                <th>Attacker</th>
                <th>Victim</th>
                <th>Damage</th>
                <th>Weapon</th>
                <th>Relation</th>
                <th>Parse</th>
                <th>Details</th>
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
    renderTable(els.body, state.events, state.hoverKey);
    els.status.textContent = `宸插埛鏂?${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
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
    if (!window.confirm("鍙竻绌哄綋鍓嶅唴瀛樹腑鐨?clean combat 浜嬩欢锛屼笉浼氬啓鍏ユ垨鍒犻櫎鏁版嵁搴撱€傜户缁紵")) return;
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

function renderTable(tbody, events, hoverKey = "") {
  if (!events.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="kill-empty-cell">No clean combat events yet</td></tr>`;
    return;
  }

  tbody.innerHTML = events.map((event, index) => {
    const pairKey = eventPairKey(event);
    return `
    <tr class="combat-row combat-row-${TYPE_CLASSES[event.type] || "unknown"} ${event.relation?.isFriendlyFire ? "combat-row-tk" : ""} ${isRowHighlighted(event, hoverKey) ? "combat-row-hovered" : ""}" data-event-pair-key="${esc(pairKey)}">
      <td class="combat-time-cell">${esc(formatTime(event.time))}</td>
      <td><span class="combat-type-badge ${event.relation?.isFriendlyFire ? "tk" : (TYPE_CLASSES[event.type] || "")}">${esc(TYPE_LABELS[event.type] || event.type)}</span></td>
      <td>${flagCell(event)}</td>
      <td>${playerCell(event.attacker, "attacker", hoverKey, pairKey)}</td>
      <td>${playerCell(event.victim, "victim", hoverKey, pairKey)}</td>
      <td class="combat-damage-cell">${event.damage == null ? "-" : esc(trimNumber(event.damage))}</td>
      <td>${esc(event.weapon?.displayName || event.weapon?.cleaned || event.weapon?.raw || "Unknown")}</td>
      <td>${relationCell(event.relation)}</td>
      <td>${parseCell(event.parse)}</td>
      <td><button type="button" class="combat-raw-btn" data-clean-event-index="${index}">鏌ョ湅</button></td>
    </tr>
  `;
  }).join("");

  tbody.querySelectorAll("[data-clean-event-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const event = events[Number(button.dataset.cleanEventIndex)];
      if (event) openCleanCombatDetailModal(event);
    });
  });

  tbody.querySelectorAll("[data-event-pair-key]").forEach((row) => {
    const key = String(row.dataset.eventPairKey ?? "").trim().toLowerCase();
    if (!key) return;
    row.addEventListener("mouseenter", () => {
      if (state.hoverKey === key) return;
      setHoverKey(tbody, events, key);
    });
    row.addEventListener("mouseleave", () => {
      if (!state.hoverKey) return;
      setHoverKey(tbody, events, "");
    });
  });

  applyHoverState(tbody, events, hoverKey);
}

function playerCell(player = {}, side = "", hoverKey = "", pairKey = "") {
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
  const isHighlighted = pairKey && hoverKey && pairKey === hoverKey;
  return `
    <div class="combat-player-cell ${isHighlighted ? "is-highlighted" : ""}" data-pair-key="${esc(pairKey)}" data-player-side="${esc(side)}">
      <strong>${esc(`${player.name || "Unknown"}`)}</strong>
      <div class="combat-player-meta">${esc(`Team ID ${team} / Squad ID ${blank(player.squadID)}`)}</div>
      ${ids ? `<span>${esc(ids)}</span>` : ""}
      ${flags ? `<span>${esc(flags)}</span>` : ""}
    </div>
  `;
}

function flagCell(event = {}) {
  const labels = eventFlagLabels(event);
  if (!labels.length) return `<span class="combat-flag-empty">-</span>`;
  return `
    <div class="combat-flag-cell">
      ${labels.map((label) => `<span class="combat-flag-chip">${esc(label)}</span>`).join("")}
    </div>
  `;
}

function relationCell(relation = {}) {
  const same = relation.sameTeam ? "\u540c\u961f" : "\u975e\u540c\u961f";
  const ff = relation.isFriendlyFire ? `\u53cb\u519b ${relation.friendlyFireType || ""}` : "\u6b63\u5e38";
  return `<div class="combat-player-cell"><strong>${esc(ff)}</strong><span>${esc(`${same} / ${relation.teamSource || "unknown"}`)}</span></div>`;
}

function eventFlagLabels(event = {}) {
  const direct = Array.isArray(event?.eventFlagLabels) ? event.eventFlagLabels : [];
  if (direct.length) return direct.map((label) => String(label)).filter(Boolean);
  const structured = Array.isArray(event?.eventFlags) ? event.eventFlags : [];
  return structured.map((flag) => String(flag?.label ?? "")).filter(Boolean);
}

function eventPairKey(event = {}) {
  const attackerKey = displayedPlayerKey(event.attacker?.name);
  const victimKey = displayedPlayerKey(event.victim?.name);
  if (!attackerKey || !victimKey) return "";
  return `${attackerKey}::${victimKey}`;
}

function displayedPlayerKey(value = "") {
  const key = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return key && key !== "unknown" ? key : "";
}

function isRowHighlighted(event = {}, hoverKey = "") {
  const key = String(hoverKey ?? "").trim().toLowerCase();
  if (!key) return false;
  return eventPairKey(event) === key;
}

function setHoverKey(tbody, events, key) {
  state.hoverKey = key;
  applyHoverState(tbody, events, key);
}

function applyHoverState(tbody, events, hoverKey = "") {
  const key = String(hoverKey ?? "").trim().toLowerCase();
  tbody.querySelectorAll("tr.combat-row").forEach((row, index) => {
    const event = events[index];
    row.classList.toggle("combat-row-hovered", Boolean(key && event && isRowHighlighted(event, key)));
    row.querySelectorAll("[data-pair-key]").forEach((cell) => {
      const pairKey = String(cell.dataset.pairKey ?? "").trim().toLowerCase();
      cell.classList.toggle("is-highlighted", Boolean(key && pairKey && pairKey === key));
    });
  });
}

function parseCell(parse = {}) {
  const warnings = Array.isArray(parse.warnings) ? parse.warnings : [];
  return `<div class="combat-player-cell"><strong>${esc(parse.status || "-")}</strong><span>${esc(warnings.length ? `${warnings.length} warning` : "-")}</span></div>`;
}

function openCleanCombatDetailModal(event) {
  closeCleanCombatDetailModal();

  const root = document.createElement("div");
  root.id = "bzss-clean-combat-record-root";
  root.innerHTML = `
    <div class="kill-record-backdrop" data-close-clean-combat="1"></div>
    <section class="kill-record-window combat-record-window" role="dialog" aria-modal="true" aria-label="clean combat details">
      <header class="kill-record-header">
        <div>
          <div class="kill-record-title">Clean Combat details</div>
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
          ${detailCell("parse", `${event.parse?.status || "-"} / ${Array.isArray(event.parse?.warnings) ? event.parse.warnings.length : 0}`)}
          ${detailCell("source", `${event.raw?.sourceModule || "-"} / ${event.raw?.sourceEventId || "-"}`)}
          ${detailCell("server", event.serverId || "-")}
        </div>

        <div class="kill-record-raw-card">
          <h3>Raw Log</h3>
          <pre class="kill-record-pre">${esc(event.raw?.rawLog || "No rawLog available")}</pre>
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

