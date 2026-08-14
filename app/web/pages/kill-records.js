// -*- coding: utf-8 -*-

export async function renderPage({ root, api, apiFetch }) {
  root.innerHTML = `
    <section class="page kill-page-shell combat-page-shell">
      <div class="page-title-row"><div><div class="page-title">击杀记录</div><div class="page-subtitle">查询当前对局实时及历史回溯的击杀记录</div></div><button id="kill-records-replay">重新回溯</button></div>
      <section class="combat-stat-grid">
        ${card("回溯状态", "kr-status")}${card("回溯进度", "kr-progress")}${card("历史击杀", "kr-replay")}${card("实时击杀", "kr-live")}${card("TK", "kr-tk")}${card("最后更新", "kr-updated")}
      </section>
      <section class="card combat-toolbar-card"><div class="console-actions combat-toolbar"><select id="kr-source"><option value="all">全部来源</option><option value="live">实时</option><option value="replay">回溯</option></select><select id="kr-type"><option value="all">全部类型</option><option value="kill">击杀</option><option value="tk">TK</option></select><input id="kr-search" class="console-search" placeholder="玩家 / Steam64 / EOS / 武器"><button id="kr-refresh">刷新</button></div></section>
      <div class="card kill-table-card combat-table-card"><div class="kill-table-wrap combat-table-wrap"><table><thead><tr><th>时间</th><th>来源</th><th>类型</th><th>击杀者</th><th>Team</th><th>被击杀者</th><th>Team</th><th>武器</th><th>详情</th></tr></thead><tbody id="kr-body"></tbody></table></div></div>
    </section>`;
  const state = { source: "all", type: "all", search: "" };
  const els = Object.fromEntries(["status", "progress", "replay", "live", "tk", "updated", "body", "source", "type", "search"].map((key) => [key, root.querySelector(`#kr-${key}`)]));
  let timer;
  async function load() {
    const params = new URLSearchParams({ ...state, limit: "200" });
    const [data, status] = await Promise.all([api(`/api/kill-records?${params}`), api("/api/kill-records/status")]);
    const overview = data.overview ?? {};
    const replay = status.replay ?? {};
    els.status.textContent = replay.status ?? "-";
    els.progress.textContent = `${Number(replay.progress ?? 0).toFixed(1)}%`;
    els.replay.textContent = overview.replayCount ?? 0;
    els.live.textContent = overview.liveCount ?? 0;
    els.tk.textContent = overview.teamKills ?? 0;
    els.updated.textContent = formatTime(overview.lastUpdatedAt);
    els.body.innerHTML = (data.records ?? []).map((record) => `<tr><td>${esc(formatTime(record.time))}</td><td>${record.source === "live" ? "实时" : "回溯"}</td><td>${record.isTeamKill ? "TK" : "击杀"}</td><td>${esc(record.attacker?.name || "未知")}</td><td>${esc(record.attacker?.teamID ?? "-")}</td><td>${esc(record.victim?.name || "未知")}</td><td>${esc(record.victim?.teamID ?? "-")}</td><td>${esc(record.weapon || "-")}</td><td><button data-detail="${esc(record.id)}">查看</button></td></tr>`).join("") || `<tr><td colspan="9">暂无记录</td></tr>`;
  }
  els.source.addEventListener("change", () => { state.source = els.source.value; void load(); });
  els.type.addEventListener("change", () => { state.type = els.type.value; void load(); });
  els.search.addEventListener("change", () => { state.search = els.search.value.trim(); void load(); });
  root.querySelector("#kr-refresh").addEventListener("click", load);
  root.querySelector("#kill-records-replay").addEventListener("click", async () => { await apiFetch("/api/kill-records/replay", { method: "POST", body: JSON.stringify({ clear: false }), headers: { "Content-Type": "application/json" } }); await load(); });
  await load();
  timer = window.setInterval(load, 3000);
  root.__pageCleanup = () => window.clearInterval(timer);
  return root.__pageCleanup;
}

function card(label, id) { return `<div class="card combat-stat-card"><span>${label}</span><strong id="${id}">-</strong></div>`; }
function formatTime(value) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false }); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
