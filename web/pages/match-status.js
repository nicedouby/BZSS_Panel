// -*- coding: utf-8 -*-

/**
 * 页面：对局状态
 *
 * 数据来源：module.matchState / playerState / squadState
 * 展示结构：Team -> Squad -> Members
 */
export async function renderPage({ root, api, openDrawer }) {
  if (root.__matchStatusTimer) {
    window.clearTimeout(root.__matchStatusTimer);
    root.__matchStatusTimer = null;
  }

  const scrollTop = root.scrollTop;
  const data = await api("/api/match/overview");
  const status = data.status ?? {};
  const players = data.players ?? [];
  const squads = data.squads ?? [];
  const teams = buildTeams({ players, squads });

  root.innerHTML = `
    <section class="page">
      <div class="page-title-row">
        <div class="page-title">对局状态</div>
        <button id="refresh">刷新</button>
      </div>

      <div class="grid cols-3">
        <div class="card match-stat-card">
          <div class="match-stat-label">服务器</div>
          <div class="match-stat-value">${esc(status.serverName || "未连接")}</div>
        </div>
        <div class="card match-stat-card">
          <div class="match-stat-label">在线玩家</div>
          <div class="match-stat-value">${players.length}</div>
        </div>
        <div class="card match-stat-card">
          <div class="match-stat-label">活跃小队</div>
          <div class="match-stat-value">${squads.length}</div>
        </div>
      </div>

      <div class="match-team-list">
        ${teams.map((team, teamIndex) => renderTeam(team, teamIndex)).join("")}
      </div>
    </section>
  `;

  root.querySelector("#refresh").addEventListener("click", () => renderPage({ root, api, openDrawer }));

  root.querySelectorAll("[data-player-index]").forEach((el) => {
    el.addEventListener("click", () => {
      const player = players[Number(el.dataset.playerIndex)];
      if (!player) return;

      openDrawer({
        title: `${displayName(player.name)} 详情`,
        body: renderPlayerDrawer(player),
      });
    });
  });

  root.scrollTop = scrollTop;

  root.__pageCleanup = () => {
    if (root.__matchStatusTimer) {
      window.clearTimeout(root.__matchStatusTimer);
      root.__matchStatusTimer = null;
    }
  };

  root.__matchStatusTimer = window.setTimeout(() => {
    renderPage({ root, api, openDrawer }).catch(() => {});
  }, 3000);

  return root.__pageCleanup;
}

function buildTeams({ players, squads }) {
  const teamMap = new Map([
    ["1", createTeam(1)],
    ["2", createTeam(2)],
  ]);
  const squadMap = new Map();
  const squadsById = new Map();

  for (const squad of squads) {
    const teamID = normalizeTeamID(squad.teamID);
    const squadID = normalizeSquadID(squad.squadID);
    if (teamID == null || squadID == null) continue;

    const team = ensureTeam(teamMap, teamID, squad.teamName);
    const nextSquad = {
      teamID,
      squadID,
      squadName: squad.squadName || squad.name || `Squad ${squadID}`,
      locked: Boolean(squad.locked),
      creatorName: squad.creatorName || squad.leaderName || "",
      creatorSteamID: squad.creatorSteamID || squad.leaderSteamID || "",
      creatorEOSID: squad.creatorEOSID || squad.leaderEOSID || "",
      size: Number(squad.size ?? 0),
      members: [],
      unassigned: false,
    };

    team.squads.push(nextSquad);
    squadMap.set(squadKey(teamID, squadID), nextSquad);
    if (!squadsById.has(squadID)) squadsById.set(squadID, []);
    squadsById.get(squadID).push(nextSquad);
  }

  players.forEach((player, index) => {
    const placement = resolvePlacement(player);
    placement.squad.members.push({
      ...player,
      _playerIndex: index,
      _resolvedTeamID: placement.team.teamID,
      _resolvedSquadID: placement.squad.squadID,
      _resolvedUnassigned: Boolean(placement.squad.unassigned),
    });
  });

  for (const team of teamMap.values()) {
    team.squads.sort(compareSquads);
    team.playerCount = team.squads.reduce((sum, squad) => sum + squad.members.length, 0);
    if (!team.teamName) {
      team.teamName = `Team ${team.teamID}`;
    }
  }

  return [teamMap.get("1"), teamMap.get("2")];

  function createTeam(teamID) {
    return {
      teamID,
      teamName: `Team ${teamID}`,
      squads: [],
      playerCount: 0,
    };
  }

  function ensureTeam(map, teamID, teamName) {
    const key = String(teamID);
    if (!map.has(key)) {
      map.set(key, createTeam(teamID));
    }
    const team = map.get(key);
    if (teamName && !team.teamName) {
      team.teamName = teamName;
    }
    return team;
  }

  function resolvePlacement(player) {
    const teamID = normalizeTeamID(player.teamID);
    const squadID = normalizeSquadID(player.squadID);
    const normalizedName = normalizeName(player.name);

    if (teamID != null && squadID != null) {
      const exact = squadMap.get(squadKey(teamID, squadID));
      if (exact) {
        return { team: ensureTeam(teamMap, teamID, ""), squad: exact };
      }
    }

    if (squadID != null) {
      const candidates = squadsById.get(squadID) || [];
      const byName = candidates.find((candidate) => {
        const creator = normalizeName(candidate.creatorName);
        const leader = normalizeName(candidate.creatorName);
        return creator === normalizedName || leader === normalizedName;
      });
      if (byName) {
        return { team: ensureTeam(teamMap, byName.teamID, ""), squad: byName };
      }

      if (candidates.length === 1) {
        return { team: ensureTeam(teamMap, candidates[0].teamID, ""), squad: candidates[0] };
      }

      if (teamID != null) {
        const fallback = squadMap.get(squadKey(teamID, squadID));
        if (fallback) {
          return { team: ensureTeam(teamMap, teamID, ""), squad: fallback };
        }
      }
    }

    const fallbackTeam = teamID != null ? ensureTeam(teamMap, teamID, "") : teamMap.get("1");
    return { team: fallbackTeam, squad: ensureUnassignedSquad(fallbackTeam) };
  }

  function ensureUnassignedSquad(team) {
    let squad = team.squads.find((item) => item.unassigned);
    if (!squad) {
      squad = {
        teamID: team.teamID,
        squadID: "N/A",
        squadName: "未编队",
        locked: false,
        creatorName: "",
        creatorSteamID: "",
        creatorEOSID: "",
        size: 0,
        members: [],
        unassigned: true,
      };
      team.squads.push(squad);
    }
    return squad;
  }

  function compareSquads(a, b) {
    if (a.unassigned && !b.unassigned) return 1;
    if (!a.unassigned && b.unassigned) return -1;
    return numericish(a.squadID) - numericish(b.squadID);
  }
}

function renderTeam(team, teamIndex) {
  const teamClass = Number(team.teamID) === 1
    ? "team-1"
    : Number(team.teamID) === 2
      ? "team-2"
      : teamIndex % 2 === 0
        ? "team-1"
        : "team-2";

  return `
    <section class="card match-team-card ${teamClass}">
      <div class="match-team-header">
        <div>
          <div class="match-team-eyebrow">Team ${esc(team.teamID)}</div>
          <div class="match-team-title">${esc(team.teamName)}</div>
        </div>
        <div class="match-team-meta">
          <span class="match-pill">小队 ${team.squads.filter((squad) => !squad.unassigned).length}</span>
          <span class="match-pill">成员 ${team.playerCount}</span>
        </div>
      </div>

      <div class="match-squad-list">
        ${team.squads.map((squad) => renderSquad(squad)).join("")}
      </div>
    </section>
  `;
}

function renderSquad(squad) {
  const totals = squad.members.reduce((summary, member) => {
    const stats = getMatchStats(member);
    summary.kills += stats.kills;
    summary.downs += stats.downs;
    summary.deaths += stats.deaths;
    return summary;
  }, { kills: 0, downs: 0, deaths: 0 });

  return `
    <article class="match-squad-card">
      <div class="match-squad-header">
        <div class="match-squad-heading">
          <div class="match-squad-name">${esc(squad.squadName)}</div>
          <div class="match-squad-subtitle">
            <span class="match-badge ${squad.locked ? "locked" : "open"}">${squad.locked ? "锁队" : "公开"}</span>
            <span class="match-squad-creator">创建人 ${esc(displayName(squad.creatorName, "未知"))}</span>
          </div>
        </div>
        <div class="match-squad-stats">
          <span>K ${totals.kills}</span>
          <span>D ${totals.downs}</span>
          <span>死 ${totals.deaths}</span>
          <span>人数 ${squad.members.length || squad.size || 0}</span>
        </div>
      </div>

      <div class="match-member-list">
        ${squad.members.length
          ? squad.members.map((member) => renderMember(member)).join("")
          : `<div class="match-empty">暂无成员</div>`}
      </div>
    </article>
  `;
}

function renderMember(member) {
  const stats = getMatchStats(member);
  const stateLabel = formatState(member.state);
  const roleLabel = member.role || "未知角色";
  const teamLabel = member._resolvedUnassigned ? "待确认队伍" : `Team ${member._resolvedTeamID ?? "?"}`;
  const squadLabel = member._resolvedUnassigned ? "未编队" : `Squad ${member._resolvedSquadID ?? "?"}`;

  return `
    <button class="match-member-row" type="button" data-player-index="${member._playerIndex}">
      <div class="match-member-main">
        <span class="match-member-name">${esc(displayName(member.name))}</span>
        ${member.isLeader ? '<span class="match-badge leader">队长</span>' : ""}
      </div>
      <div class="match-member-meta">
        <span class="match-member-stat">${esc(stateLabel)}</span>
        <span class="match-member-stat">${esc(roleLabel)}</span>
        <span class="match-member-stat">${esc(teamLabel)} / ${esc(squadLabel)}</span>
        <span class="match-member-stat">K ${stats.kills} / D ${stats.downs} / 死 ${stats.deaths}</span>
      </div>
    </button>
  `;
}

function renderPlayerDrawer(player) {
  const stats = getMatchStats(player);

  return `
    <div class="detail-block">
      <div class="detail-grid">
        <div><strong>玩家名</strong><br>${esc(displayName(player.name))}</div>
        <div><strong>状态</strong><br>${esc(formatState(player.state))}</div>
        <div><strong>角色</strong><br>${esc(player.role || "未知角色")}</div>
        <div><strong>是否队长</strong><br>${player.isLeader ? "是" : "否"}</div>
        <div><strong>Team</strong><br>${esc(player._resolvedTeamID ?? player.teamID ?? "N/A")}</div>
        <div><strong>Squad</strong><br>${esc(player._resolvedUnassigned ? "未编队" : (player._resolvedSquadID ?? player.squadID ?? "N/A"))}</div>
        <div><strong>击杀</strong><br>${stats.kills}</div>
        <div><strong>击倒</strong><br>${stats.downs}</div>
        <div><strong>死亡</strong><br>${stats.deaths}</div>
      </div>
    </div>

    <div class="detail-block">
      <strong>身份信息</strong>
      <div class="detail-grid">
        <div><strong>Steam64</strong><br>${esc(player.steamID || "未记录")}</div>
        <div><strong>EOS</strong><br>${esc(player.eosID || "未记录")}</div>
        <div><strong>Player ID</strong><br>${esc(player.playerID ?? "N/A")}</div>
        <div><strong>最后出现</strong><br>${esc(player.lastSeenTime || "未知")}</div>
      </div>
    </div>

    <div class="detail-block">
      <strong>原始数据</strong>
      <pre class="detail-pre">${esc(JSON.stringify(player.raw ?? player, null, 2))}</pre>
    </div>
  `;
}

function getMatchStats(player) {
  const sources = [
    player.matchStats,
    player.runtime?.matchStats,
    player.runtime?.stats?.match,
    player.stats?.match,
  ];

  for (const stats of sources) {
    if (stats && typeof stats === "object") {
      return {
        kills: Number(stats.kills ?? 0),
        downs: Number(stats.downs ?? 0),
        deaths: Number(stats.deaths ?? 0),
      };
    }
  }

  return { kills: 0, downs: 0, deaths: 0 };
}

function formatState(state) {
  const normalized = String(state ?? "").trim().toLowerCase();
  if (normalized === "online") return "在线";
  if (normalized === "playing") return "作战中";
  if (normalized === "wounded") return "倒地";
  if (normalized === "dead") return "死亡";
  if (!normalized) return "未知";
  return state;
}

function displayName(value, fallback = "未知") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeTeamID(value) {
  const num = Number(value);
  return Number.isInteger(num) && (num === 1 || num === 2) ? num : null;
}

function normalizeSquadID(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function squadKey(teamID, squadID) {
  return `${teamID ?? ""}:${squadID ?? ""}`;
}

function numericish(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 999999;
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
