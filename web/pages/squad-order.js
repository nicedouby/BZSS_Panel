// -*- coding: utf-8 -*-

export async function renderPage({ root, apiFetch, onNavigate }) {
  const data = await loadData(apiFetch);
  const status = data.status ?? {};
  const order = data.order ?? { matchId: "", orderedSquads: [] };
  const squads = order.orderedSquads ?? [];

  root.innerHTML = `
    <section class="page squad-order-page">
      <div class="page-title-row">
        <div>
          <div class="page-title">建队顺序</div>
          <div class="page-subtitle">按小队生命周期的 createdAt 排序，日志来源显示“创建于”，RCON 首次发现显示“首次发现于”。</div>
        </div>
        <div class="match-toolbar-actions">
          <span class="status-text" data-tone="idle">${esc(status.map || "未识别地图")}</span>
          <button id="refresh">刷新</button>
        </div>
      </div>

      <div class="grid cols-3">
        <div class="card match-stat-card">
          <div class="match-stat-label">当前地图</div>
          <div class="match-stat-value">${esc(status.map || "未知")}</div>
        </div>
        <div class="card match-stat-card">
          <div class="match-stat-label">当前图层</div>
          <div class="match-stat-value">${esc(status.layer || "未知")}</div>
        </div>
        <div class="card match-stat-card">
          <div class="match-stat-label">当前小队数量</div>
          <div class="match-stat-value">${squads.length}</div>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table class="data-table squad-order-table">
            <thead>
              <tr>
                <th>顺序</th>
                <th>队伍</th>
                <th>小队ID</th>
                <th>小队名</th>
                <th>队长</th>
                <th>人数</th>
                <th>锁定</th>
                <th>建立时间</th>
                <th>来源</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              ${squads.map(renderRow).join("") || `<tr><td colspan="10" class="empty-state">暂无建队顺序数据</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  root.querySelector("#refresh")?.addEventListener("click", () => {
    renderPage({ root, apiFetch, onNavigate }).catch(() => {});
  });
}

async function loadData(apiFetch) {
  const [statusRes, orderRes] = await Promise.all([
    apiFetch("/api/web/status").then((res) => res.json()),
    apiFetch("/api/squad-lifecycle/squad-order").then((res) => res.json()),
  ]);

  return {
    status: statusRes,
    order: orderRes,
  };
}

function renderRow(item) {
  return `
    <tr>
      <td>#${esc(item.order)}</td>
      <td>Team${esc(item.teamId)}</td>
      <td>Squad${esc(item.squadId)}</td>
      <td>${esc(item.squadName || "")}</td>
      <td>${esc(item.leaderName || "")}</td>
      <td>${esc(item.memberCount ?? "")}</td>
      <td>${item.locked ? "是" : "否"}</td>
      <td>${esc(item.createdAtLabel || formatTime(item.createdAt))}</td>
      <td>${esc(item.sourceLabel || sourceLabel(item.creationSource))}</td>
      <td>${esc(formatStatus(item.status))}</td>
    </tr>
  `;
}

function sourceLabel(source) {
  if (source === "LOG") return "日志确认";
  if (source === "RCON_SNAPSHOT") return "RCON首次发现";
  return "未知";
}

function formatStatus(status) {
  if (status === "ACTIVE") return "活跃";
  if (status === "MISSING_CANDIDATE") return "待确认缺失";
  if (status === "DISBANDED") return "已解散";
  if (status === "CLOSED_BY_MATCH_END") return "切图关闭";
  return status || "未知";
}

function formatTime(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return "";
  const date = new Date(value);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
