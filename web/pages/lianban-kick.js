// -*- coding: utf-8 -*-

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTime(value) {
  const text = String(value ?? "");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString("zh-CN", { hour12: false });
}

export async function renderPage({ root, api }) {
  const state = await api("/api/plugins/lianban-kick/state");
  const data = state?.data ?? {};

  root.innerHTML = `
    <section class="page lianban-kick-page">
      <div class="page-title-row">
        <div>
          <div class="page-title">联办文模块</div>
          <div class="page-subtitle">玩家加入后按 SteamID / EOSID 比对 Ban 目录名单，命中后只做展示，不自动联动封禁。</div>
        </div>
        <div class="toolbar-actions">
          <button type="button" id="lianban-refresh">刷新</button>
        </div>
      </div>

      ${data.scanError ? `<div class="error-banner">${escapeHtml(data.scanError)}</div>` : ""}

      <section class="card">
        <div class="summary-row">
          <span class="chip ${data.enabled ? "ok" : "danger"}">${data.enabled ? "已启用" : "已停用"}</span>
          <span class="chip ${data.subscribed ? "ok" : "danger"}">${data.subscribed ? "已订阅" : "未订阅"}</span>
          <span class="chip">文件 ${data.totalFiles ?? 0}</span>
          <span class="chip">记录 ${data.totalRecords ?? 0}</span>
          <span class="chip">命中 ${data.matchedCount ?? 0}</span>
        </div>
        <dl class="meta-grid">
          <div><dt>目录</dt><dd>${escapeHtml(data.banDir || "Ban")}</dd></div>
          <div><dt>最近扫描</dt><dd>${escapeHtml(formatTime(data.lastScanAt))}</dd></div>
          <div><dt>最近加入</dt><dd>${escapeHtml(formatTime(data.lastJoinAt))}</dd></div>
          <div><dt>最近命中</dt><dd>${escapeHtml(formatTime(data.lastMatchAt))}</dd></div>
        </dl>
      </section>

      <section class="card">
        <h3>最近命中的联办玩家</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>玩家</th>
                <th>SteamID</th>
                <th>EOSID</th>
                <th>命中方式</th>
                <th>来源文件</th>
                <th>行号</th>
              </tr>
            </thead>
            <tbody>
              ${(data.recentMatches ?? []).length ? (data.recentMatches ?? []).map((item) => `
                <tr>
                  <td>${escapeHtml(formatTime(item.at))}</td>
                  <td>${escapeHtml(item.playerName || "-")}</td>
                  <td class="mono">${escapeHtml(item.steamID || "-")}</td>
                  <td class="mono">${escapeHtml(item.eosID || "-")}</td>
                  <td>${escapeHtml(item.matchKey ? `${item.matchKey}: ${item.matchedValue}` : "-")}</td>
                  <td>${escapeHtml(item.fileName || "-")}</td>
                  <td>${escapeHtml(String(item.lineNumber ?? "-"))}</td>
                </tr>
              `).join("") : `<tr><td colspan="7" class="empty-state">暂无命中</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h3>载入文件</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>文件</th>
                <th>记录数</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              ${(data.loadedFiles ?? []).length ? (data.loadedFiles ?? []).map((item) => `
                <tr>
                  <td>${escapeHtml(item.fileName || "-")}</td>
                  <td>${escapeHtml(String(item.recordCount ?? 0))}</td>
                  <td>${escapeHtml(item.error || "-")}</td>
                </tr>
              `).join("") : `<tr><td colspan="3" class="empty-state">暂无文件</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `;

  root.querySelector("#lianban-refresh")?.addEventListener("click", async () => {
    await api("/api/plugins/lianban-kick/reload", { method: "POST" });
    window.location.reload();
  });
}
