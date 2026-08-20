// -*- coding: utf-8 -*-

export async function renderPage({ root, api }) {
  root.innerHTML = `
    <section class="page kill-page-shell combat-page-shell">
      <div class="page-title-row">
        <div>
          <div class="page-title">战斗记录</div>
          <div class="page-subtitle">战斗信息收集器中的全部伤害、击倒、死亡记录；保留 nullptr 与日志溯源信息</div>
        </div>
        <button id="cr-refresh" type="button">刷新</button>
      </div>
      <section class="combat-stat-grid">
        ${card("全部", "cr-total")}${card("伤害", "cr-damage")}${card("击倒", "cr-wound")}${card("死亡", "cr-death")}
        ${card("nullptr 角色", "cr-null-actors")}${card("nullptr 武器", "cr-null-weapons")}${card("溯源状态", "cr-replay")}${card("溯源进度", "cr-progress")}
      </section>
      <section class="card combat-toolbar-card">
        <div class="console-actions combat-toolbar">
          <select id="cr-source"><option value="all">全部来源</option><option value="live">实时</option><option value="replay">日志溯源</option></select>
          <select id="cr-type"><option value="all">全部类型</option><option value="damage">伤害</option><option value="wound">击倒</option><option value="death">死亡</option></select>
          <input id="cr-search" class="console-search" placeholder="玩家 / ID / 武器 / 文件 / 哈希">
          <button id="cr-query" type="button">查询</button>
          <button id="cr-previous" type="button">上一页</button>
          <button id="cr-next" type="button">下一页</button>
          <span id="cr-range">-</span>
        </div>
      </section>
      <div class="card kill-table-card combat-table-card">
        <div class="kill-table-wrap combat-table-wrap">
          <table><thead><tr><th>时间</th><th>类型</th><th>来源</th><th>攻击者</th><th>受害者</th><th>武器</th><th>伤害</th><th>日志位置</th><th>详情</th></tr></thead><tbody id="cr-body"></tbody></table>
        </div>
      </div>
      <section class="card" id="cr-detail-card" hidden>
        <div class="page-title-row"><strong>完整记录与溯源</strong><button id="cr-close-detail" type="button">关闭</button></div>
        <pre id="cr-detail" style="white-space:pre-wrap;overflow:auto;max-height:40vh"></pre>
      </section>
    </section>`;

  const limit = 200;
  const state = { sourceMode: "all", type: "all", search: "", offset: 0, total: 0, records: [] };
  const el = (id) => root.querySelector(`#${id}`);
  let timer = 0;
  let loading = false;

  async function load() {
    if (loading) return;
    loading = true;
    try {
      const params = new URLSearchParams({
        sourceMode: state.sourceMode,
        type: state.type,
        search: state.search,
        offset: String(state.offset),
        limit: String(limit),
      });
      const data = await api(`/api/combat-records?${params}`);
      const overview = data.overview ?? {};
      state.records = data.records ?? [];
      state.total = Number(data.total ?? state.records.length);
      el("cr-total").textContent = overview.count ?? state.total;
      el("cr-damage").textContent = overview.damage ?? 0;
      el("cr-wound").textContent = overview.wound ?? 0;
      el("cr-death").textContent = overview.death ?? 0;
      el("cr-null-actors").textContent = overview.nullptrActors ?? 0;
      el("cr-null-weapons").textContent = overview.nullptrWeapons ?? 0;
      el("cr-replay").textContent = overview.replay?.status ?? "-";
      el("cr-progress").textContent = `${Number(overview.replay?.progress ?? 0).toFixed(1)}%`;
      el("cr-range").textContent = state.total
        ? `${state.offset + 1}-${Math.min(state.offset + limit, state.total)} / ${state.total}`
        : "0 / 0";
      el("cr-previous").disabled = state.offset === 0;
      el("cr-next").disabled = state.offset + limit >= state.total;
      el("cr-body").innerHTML = state.records.map((record, index) => row(record, index)).join("")
        || `<tr><td colspan="9">暂无战斗记录</td></tr>`;
    } catch (error) {
      el("cr-body").innerHTML = `<tr><td colspan="9">加载失败：${esc(error?.message ?? error)}</td></tr>`;
    } finally {
      loading = false;
    }
  }

  el("cr-source").addEventListener("change", () => { state.sourceMode = el("cr-source").value; state.offset = 0; void load(); });
  el("cr-type").addEventListener("change", () => { state.type = el("cr-type").value; state.offset = 0; void load(); });
  el("cr-query").addEventListener("click", () => { state.search = el("cr-search").value.trim(); state.offset = 0; void load(); });
  el("cr-search").addEventListener("keydown", (event) => { if (event.key === "Enter") el("cr-query").click(); });
  el("cr-refresh").addEventListener("click", load);
  el("cr-previous").addEventListener("click", () => { state.offset = Math.max(0, state.offset - limit); void load(); });
  el("cr-next").addEventListener("click", () => { if (state.offset + limit < state.total) state.offset += limit; void load(); });
  el("cr-body").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-record-index]");
    if (!button) return;
    const record = state.records[Number(button.dataset.recordIndex)];
    if (!record) return;
    el("cr-detail").textContent = JSON.stringify(record, null, 2);
    el("cr-detail-card").hidden = false;
  });
  el("cr-close-detail").addEventListener("click", () => { el("cr-detail-card").hidden = true; });

  await load();
  timer = window.setInterval(load, 3000);
  root.__pageCleanup = () => window.clearInterval(timer);
  return root.__pageCleanup;
}

function row(record, index) {
  const sourceFile = record.sourceFile || record.provenance?.sourceFile || "-";
  const offset = record.sourceOffset ?? record.provenance?.sourceOffset;
  return `<tr>
    <td>${esc(formatTime(record.time))}</td><td>${esc(typeLabel(record.type))}</td><td>${esc(sourceLabel(record.observedModes))}</td>
    <td>${esc(actorLabel(record.attacker))}</td><td>${esc(actorLabel(record.victim))}</td><td>${esc(nullableLabel(record.weapon, record.weaponState))}</td>
    <td>${esc(record.damage ?? "-")}</td><td title="${esc(sourceFile)}">${esc(shortFile(sourceFile))}:${esc(offset ?? "-")}</td>
    <td><button type="button" data-record-index="${index}">查看</button></td>
  </tr>`;
}

function card(label, id) { return `<div class="card combat-stat-card"><span>${label}</span><strong id="${id}">-</strong></div>`; }
function typeLabel(type) { return ({ damage: "伤害", wound: "击倒", death: "死亡" })[type] ?? type ?? "-"; }
function sourceLabel(modes) { const list = Array.isArray(modes) ? modes : []; return list.map((mode) => mode === "live" ? "实时" : "溯源").join(" + ") || "-"; }
function actorLabel(actor) { return nullableLabel(actor?.name, actor?.nameState); }
function nullableLabel(value, state) { if (state === "nullptr") return "nullptr"; if (state === "missing") return "缺失"; return value || "缺失"; }
function shortFile(value) { return String(value ?? "-").split(/[\\/]/).pop() || "-"; }
function formatTime(value) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false }); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
