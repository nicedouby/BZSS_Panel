// -*- coding: utf-8 -*-

const TYPE_LABELS = {
  all: "All",
  damage: "Damage",
  wound: "Wound",
  kill: "Kill",
};

export async function renderPage({ root, api, apiFetch }) {
  const state = {
    type: "all",
    search: "",
    limit: 100,
    events: [],
    overview: null,
  };

  root.innerHTML = `
    <section class="page infantry-combat-enhancer-page">
      <div class="page-title-row">
        <div>
          <div class="page-title">Infantry Combat Enhancer</div>
          <div class="page-subtitle">Processed combat warnings sent to the players involved.</div>
        </div>
        <div class="toolbar-actions">
          <button type="button" id="ice-refresh">Refresh</button>
          <button type="button" id="ice-clear" class="danger-lite">Clear</button>
        </div>
      </div>

      <section class="card ice-card">
        <div class="ice-toolbar">
          <select id="ice-type">
            ${Object.keys(TYPE_LABELS).map((value) => `<option value="${value}">${TYPE_LABELS[value]}</option>`).join("")}
          </select>
          <input id="ice-search" placeholder="Search attacker / victim / weapon / reason">
          <select id="ice-limit">
            <option value="50">50</option>
            <option value="100" selected>100</option>
            <option value="200">200</option>
            <option value="300">300</option>
          </select>
          <span id="ice-status" class="ice-status">Waiting</span>
        </div>
      </section>

      <section class="card ice-card">
        <div class="ice-summary" id="ice-summary"></div>
      </section>

      <section class="card ice-card">
        <div class="ice-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Attacker</th>
                <th>Victim</th>
                <th>Damage</th>
                <th>Weapon</th>
                <th>Victim warn</th>
                <th>Attacker warn</th>
              </tr>
            </thead>
            <tbody id="ice-body"></tbody>
          </table>
        </div>
      </section>
    </section>
  `;

  const els = {
    type: root.querySelector("#ice-type"),
    search: root.querySelector("#ice-search"),
    limit: root.querySelector("#ice-limit"),
    status: root.querySelector("#ice-status"),
    summary: root.querySelector("#ice-summary"),
    body: root.querySelector("#ice-body"),
  };

  async function loadEvents() {
    const params = new URLSearchParams({
      type: state.type,
      search: state.search,
      limit: String(state.limit),
    });
    const data = await api(`/api/plugins/infantry-combat-enhancer/events?${params.toString()}`);
    state.events = data.events ?? [];
    state.overview = data.overview ?? null;
    render();
    els.status.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  }

  function render() {
    const overview = state.overview ?? {};
    const stats = overview.stats ?? {};
    els.summary.innerHTML = [
      `Total: ${stats.total ?? state.events.length}`,
      `Victim warned: ${stats.victimWarned ?? 0}`,
      `Attacker warned: ${stats.attackerWarned ?? 0}`,
      `Same-player skipped: ${stats.samePlayerSuppressed ?? 0}`,
      `Last updated: ${formatTime(overview.lastUpdatedAt)}`,
    ].map((text) => `<span class="ice-chip">${escapeHtml(text)}</span>`).join("");

    if (!state.events.length) {
      els.body.innerHTML = `<tr><td colspan="8" class="ice-empty">No events</td></tr>`;
      return;
    }

    els.body.innerHTML = state.events.map((event) => `
      <tr>
        <td>${escapeHtml(formatTime(event.time))}</td>
        <td>${escapeHtml(event.type || "-")}</td>
        <td>${escapeHtml(event.attackerName || "-")}</td>
        <td>${escapeHtml(event.victimName || "-")}</td>
        <td>${escapeHtml(formatDamage(event.damage))}</td>
        <td>${escapeHtml(event.weapon || "-")}</td>
        <td>${escapeHtml(renderDecision(event.victimWarning))}</td>
        <td>${escapeHtml(renderDecision(event.attackerWarning))}</td>
      </tr>
    `).join("");
  }

  function renderDecision(decision) {
    if (!decision) return "-";
    if (decision.success) return "sent";
    if (decision.skipped) return `skip: ${decision.skipReason || "unknown"}`;
    return `fail: ${decision.errorMessage || "unknown"}`;
  }

  els.type.addEventListener("change", () => {
    state.type = els.type.value;
    void loadEvents();
  });

  els.search.addEventListener("input", () => {
    window.clearTimeout(root.__iceSearchTimer);
    root.__iceSearchTimer = window.setTimeout(() => {
      state.search = els.search.value.trim();
      void loadEvents();
    }, 180);
  });

  els.limit.addEventListener("change", () => {
    state.limit = Number(els.limit.value) || 100;
    void loadEvents();
  });

  root.querySelector("#ice-refresh").addEventListener("click", () => loadEvents());
  root.querySelector("#ice-clear").addEventListener("click", async () => {
    if (!window.confirm("Clear infantry combat enhancer history?")) return;
    await apiFetch("/api/plugins/infantry-combat-enhancer/clear", { method: "POST" });
    await loadEvents();
  });

  await loadEvents();
}

function formatTime(value) {
  const text = String(value ?? "");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}

function formatDamage(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
