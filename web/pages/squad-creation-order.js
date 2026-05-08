// -*- coding: utf-8 -*-

const AUTO_REFRESH_MS = 3000;

export async function renderPage({ root, api }) {
  if (root.__squadOrderTimer) {
    window.clearTimeout(root.__squadOrderTimer);
    root.__squadOrderTimer = null;
  }

  const scrollTop = root.scrollTop;
  const data = await api("/api/squads/creation-order");
  const records = data.records ?? [];
  const teamSummaries = buildTeamOrderSummary(records);

  root.innerHTML = `
    <section class="page">
      <div class="page-title-row">
        <div>
          <div class="page-title">建队顺序</div>
          <div class="squad-order-subtitle">顺序只来自 On_SquadCreated 日志；RCON 快照只用于校准小队是否仍存在。</div>
        </div>
        <button id="refresh">刷新</button>
      </div>

      <div class="card">
        <div class="squad-order-summary">
          <span class="match-pill">历史记录 ${records.length}</span>
          <span class="match-pill">有效顺序 ${records.filter((record) => record.order != null).length}</span>
          <span class="match-pill">Server ${esc(data.serverId || "Unknown")}</span>
          <span class="match-pill">Session ${esc(data.sessionId || records[0]?.sessionId || "N/A")}</span>
          <span class="match-pill">Auto ${AUTO_REFRESH_MS / 1000}s</span>
        </div>
      </div>

      <div class="card squad-order-flow-card">
        ${teamSummaries.length
          ? teamSummaries.map(renderTeamSummary).join("")
          : `<div class="squad-order-empty">还没有可用于排序的建队日志。</div>`}
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>顺序</th>
                <th>状态</th>
                <th>时间</th>
                <th>队伍</th>
                <th>SquadID</th>
                <th>小队名</th>
                <th>创建者</th>
                <th>Steam64ID</th>
                <th>来源</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              ${records.length
                ? records.map((record) => `
                    <tr>
                      <td>${record.order == null ? "?" : `#${esc(record.order)}`}</td>
                      <td>${renderStatus(record)}</td>
                      <td>${esc(formatDisplayTime(record))}</td>
                      <td>${esc(formatTeamName(record))}</td>
                      <td>${esc(record.squadID || "")}</td>
                      <td>${esc(record.squadName || "")}</td>
                      <td>${esc(resolveCreatorName(record))}</td>
                      <td>${esc(record.creatorSteam64ID || "")}</td>
                      <td>${esc(formatSource(record))}</td>
                      <td>${esc(formatNote(record))}</td>
                    </tr>
                  `).join("")
                : `
                    <tr>
                      <td colspan="10" class="squad-order-empty">当前对局还没有收到建队日志。</td>
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

  root.scrollTop = scrollTop;
  root.__pageCleanup = () => {
    if (root.__squadOrderTimer) {
      window.clearTimeout(root.__squadOrderTimer);
      root.__squadOrderTimer = null;
    }
  };

  root.__squadOrderTimer = window.setTimeout(() => {
    renderPage({ root, api }).catch(() => {});
  }, AUTO_REFRESH_MS);

  return root.__pageCleanup;
}

function buildTeamOrderSummary(records) {
  const byTeam = new Map();
  const orderedLogRecords = records
    .filter((record) => record.order != null && record.source !== "rcon_snapshot_without_log")
    .sort((a, b) => Number(a.order) - Number(b.order));

  for (const record of orderedLogRecords) {
    const teamKey = getTeamKey(record);
    if (!byTeam.has(teamKey)) {
      byTeam.set(teamKey, {
        key: teamKey,
        label: formatTeamName(record),
        records: [],
      });
    }
    byTeam.get(teamKey).records.push(record);
  }

  return [...byTeam.values()].sort(compareTeamSummary);
}

function renderTeamSummary(team) {
  const flow = team.records
    .map((record) => `<span class="squad-order-flow-item ${record.status === "replaced" || record.status === "disbanded" ? "is-muted" : ""}">${esc(formatSquadFlowLabel(record))}</span>`)
    .join(`<span class="squad-order-flow-separator">&gt;</span>`);

  return `
    <div class="squad-order-team-flow">
      <div class="squad-order-team-label">${esc(team.label)}</div>
      <div class="squad-order-flow-line">${flow || `<span class="squad-order-empty">-</span>`}</div>
    </div>
  `;
}

function compareTeamSummary(a, b) {
  const aNum = Number(a.key);
  const bNum = Number(b.key);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
  return String(a.label).localeCompare(String(b.label));
}

function getTeamKey(record) {
  const teamID = String(record.teamID ?? "").trim();
  if (teamID) return teamID;

  const teamName = String(record.teamName || record.factionName || "").trim();
  return teamName || "unknown";
}

function formatTeamName(record) {
  const teamID = String(record.teamID ?? "").trim();
  if (teamID) return `TEAM ${teamID}`;

  const teamName = String(record.teamName || record.factionName || "").trim();
  if (teamName) return teamName.toUpperCase().startsWith("TEAM ") ? teamName : teamName;

  return "TEAM ?";
}

function formatSquadFlowLabel(record) {
  return String(record.squadName || record.squadID || "?").trim() || "?";
}

function renderStatus(record) {
  const status = String(record.status ?? "uncertain");
  const label = statusLabel(status, record);
  return `<span class="match-badge ${statusClass(status)}">${esc(label)}</span>`;
}

function statusLabel(status, record) {
  if (record.source === "rcon_snapshot_without_log" && record.status === "active") {
    return "RCON存在但缺少日志";
  }

  if (status === "active") return "存活";
  if (status === "missing") return "暂时未发现";
  if (status === "disbanded") return "已解散";
  if (status === "replaced") return "被替换";
  if (status === "uncertain") return "不确定";
  return status;
}

function statusClass(status) {
  if (status === "active") return "open";
  if (status === "missing" || status === "uncertain") return "locked";
  if (status === "disbanded" || status === "replaced") return "bad";
  return "";
}

function resolveCreatorName(record) {
  const creatorName = String(record.creatorName ?? "").trim();
  if (creatorName) return creatorName;

  const steam64 = String(record.creatorSteam64ID ?? "").trim();
  if (steam64) return steam64;

  return "Unknown";
}

function formatDisplayTime(record) {
  const text = String(record.createdAt || record.time || "").trim();
  if (text) {
    const match = text.match(/\b(\d{2}:\d{2}:\d{2})(?:\.\d+)?\b/);
    return match ? match[1] : text;
  }

  return String(record.createdLogTime || record.logTime || record.firstSeenInRconAt || "").trim() || "Unknown";
}

function formatSource(record) {
  if (record.source === "rcon_snapshot_without_log") return "RCON补充";
  if (record.source === "log") return "日志";
  return record.source || "Unknown";
}

function formatNote(record) {
  const parts = [];

  if (record.statusConfidence) parts.push(record.statusConfidence);
  if (record.reusedSlot) parts.push(`slot复用 gen=${record.generation}`);
  if (record.missingSnapshotCount) parts.push(`缺失 ${record.missingSnapshotCount} 次`);
  if (record.disappearedAt) parts.push(`推断消失 ${formatShortTime(record.disappearedAt)}`);

  return parts.join(" | ");
}

function formatShortTime(value) {
  const text = String(value ?? "");
  const match = text.match(/\b(\d{2}:\d{2}:\d{2})(?:\.\d+)?\b/);
  return match ? match[1] : text;
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
