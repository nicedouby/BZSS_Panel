// -*- coding: utf-8 -*-

export async function renderPage({ root, api }) {
  const data = await api("/api/squads/creation-order");
  const records = data.records ?? [];

  root.innerHTML = `
    <section class="page">
      <div class="page-title-row">
        <div>
          <div class="page-title">建队顺序</div>
          <div class="squad-order-subtitle">仅基于日志事件 On_SquadCreated，不使用 RCON 快照补数。</div>
        </div>
        <button id="refresh">刷新</button>
      </div>

      <div class="card">
        <div class="squad-order-summary">
          <span class="match-pill">当前记录 ${records.length}</span>
          <span class="match-pill">Server ${esc(data.serverId || "Unknown")}</span>
          <span class="match-pill">Session ${esc(records[0]?.sessionId || "N/A")}</span>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>顺序</th>
                <th>时间</th>
                <th>阵营</th>
                <th>小队 ID</th>
                <th>小队名称</th>
                <th>创建者</th>
                <th>Steam64ID</th>
              </tr>
            </thead>
            <tbody>
              ${records.length
                ? records.map((record) => `
                    <tr>
                      <td>#${esc(record.order)}</td>
                      <td>${esc(formatDisplayTime(record.time, record.logTime))}</td>
                      <td>${esc(record.factionName || "Unknown")}</td>
                      <td>${esc(record.squadID || "")}</td>
                      <td>${esc(record.squadName || "")}</td>
                      <td>${esc(resolveCreatorName(record))}</td>
                      <td>${esc(record.creatorSteam64ID || "")}</td>
                    </tr>
                  `).join("")
                : `
                    <tr>
                      <td colspan="7" class="squad-order-empty">当前对局还没有收到建队日志。</td>
                    </tr>
                  `}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  root.querySelector("#refresh")?.addEventListener("click", () => {
    renderPage({ root, api }).catch(() => {});
  });
}

function resolveCreatorName(record) {
  const creatorName = String(record.creatorName ?? "").trim();
  if (creatorName) return creatorName;

  const steam64 = String(record.creatorSteam64ID ?? "").trim();
  if (steam64) return steam64;

  return "Unknown";
}

function formatDisplayTime(time, logTime) {
  const text = String(time ?? "").trim();
  if (text) {
    const match = text.match(/\b(\d{2}:\d{2}:\d{2})(?:\.\d+)?\b/);
    return match ? match[1] : text;
  }

  return String(logTime ?? "").trim() || "Unknown";
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
