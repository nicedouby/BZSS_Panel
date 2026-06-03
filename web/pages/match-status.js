// -*- coding: utf-8 -*-

import { renderPlayerDetailContent } from "../components/player-detail-content.js";
import {
  closeActivePlayerWindow,
  getActivePlayerWindow,
  setActivePlayerWindow,
} from "../components/floating-player-window.js";

export async function renderPage({ root, api, apiFetch, openDrawer, onNavigate }) {
  if (root.__matchStatusTimer) {
    window.clearTimeout(root.__matchStatusTimer);
    root.__matchStatusTimer = null;
  }

  const scrollTop = root.scrollTop;
  let data;
  try {
    data = await fetchMatchOverview(apiFetch);
  } catch (error) {
    root.innerHTML = renderMatchStatusError(error);
    root.querySelector("#match-status-retry")?.addEventListener("click", () => {
      renderPage({ root, api, apiFetch, openDrawer, onNavigate }).catch(() => {});
    });
    return root.__pageCleanup;
  }

  const status = data.status ?? {};
  const players = data.players ?? [];
  const squads = data.squads ?? [];
  const playtimeState = root.__playtimeRefreshState || createPlaytimeRefreshState();
  const teams = buildTeams({ players, squads });

  root.innerHTML = `
    <section class="page">
      <div class="page-title-row">
        <div>
          <div class="page-title">对局状态</div>
          <div class="page-subtitle">小队列表会显示已缓存的 Steam Squad 总时长，刷新后写入独立时长数据库。</div>
        </div>
        <div class="match-toolbar-actions">
          <span id="playtime-status" class="status-text" data-tone="idle">Steam 时长待刷新</span>
          <button id="refresh-playtime">检测在场玩家时长</button>
          <button id="refresh">刷新</button>
        </div>
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

  root.querySelector("#playtime-status")?.setAttribute("data-tone", playtimeState.tone || "idle");
  root.querySelector("#refresh-playtime")?.replaceChildren(document.createTextNode("智能刷新时长"));
  if (!root.querySelector("#refresh-playtime-force")) {
    const forceButton = document.createElement("button");
    forceButton.id = "refresh-playtime-force";
    forceButton.type = "button";
    forceButton.textContent = "强制刷新全部时长";
    root.querySelector(".match-toolbar-actions")?.insertBefore(forceButton, root.querySelector("#refresh"));
  }
  renderPlaytimePanel(root, playtimeState);

  root.querySelector("#refresh").addEventListener("click", () => renderPage({ root, api, apiFetch, openDrawer, onNavigate }));
  root.querySelector("#refresh-playtime").addEventListener("click", async () => {
    await refreshAllPlaytime({ root, api, apiFetch, openDrawer, onNavigate, force: false });
  });
  root.querySelector("#refresh-playtime-force")?.addEventListener("click", async () => {
    await refreshAllPlaytime({ root, api, apiFetch, openDrawer, onNavigate, force: true });
  });
  root.querySelector("#playtime-panel-refresh")?.addEventListener("click", async () => {
    await refreshAllPlaytime({ root, api, apiFetch, openDrawer, onNavigate, force: false });
  });
  root.querySelector("#playtime-panel-force")?.addEventListener("click", async () => {
    await refreshAllPlaytime({ root, api, apiFetch, openDrawer, onNavigate, force: true });
  });

  root.querySelectorAll("[data-player-index]").forEach((el) => {
    el.addEventListener("click", (event) => {
      const player = players[Number(el.dataset.playerIndex)];
      if (!player) return;

      openFloatingPlayerWindow(player, {
        apiFetch,
        onNavigate,
        onRefresh: () => renderPage({ root, api, apiFetch, openDrawer, onNavigate }),
        anchorX: event.clientX,
        anchorY: event.clientY,
        squad: player._resolvedSquadRef || null,
        team: player._resolvedTeamRef || null,
      });
    });
  });

  syncFloatingPlayerWindow({
    players,
    teams,
    apiFetch,
    onNavigate,
    onRefresh: () => renderPage({ root, api, apiFetch, openDrawer, onNavigate }),
  });

  root.scrollTop = scrollTop;

  root.__pageCleanup = () => {
    if (root.__matchStatusTimer) {
      window.clearTimeout(root.__matchStatusTimer);
      root.__matchStatusTimer = null;
    }
    closeFloatingPlayerWindow();
  };

  if (!root.__playtimeRefreshState?.active) {
    root.__matchStatusTimer = window.setTimeout(() => {
      renderPage({ root, api, apiFetch, openDrawer, onNavigate }).catch(() => {});
    }, 3000);
  }

  return root.__pageCleanup;
}

async function fetchMatchOverview(apiFetch, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await apiFetch("/api/match/overview", {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`对局状态请求失败 (${response.status})`);
    }
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`对局状态加载超时（>${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function renderMatchStatusError(error) {
  return `
    <section class="page">
      <div class="card">
        <div class="page-title">对局状态暂时不可用</div>
        <div class="page-subtitle">页面没有卡住，当前是该页数据加载失败。</div>
        <p style="margin-top:12px; color: var(--muted);">${esc(error?.message || "未知错误")}</p>
        <div style="margin-top:16px; display:flex; gap:10px; flex-wrap:wrap;">
          <button id="match-status-retry" type="button">重新加载</button>
        </div>
      </div>
    </section>
  `;
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
      _resolvedTeamRef: placement.team,
      _resolvedSquadRef: placement.squad,
    });
  });

  for (const team of teamMap.values()) {
    team.squads.sort(compareSquads);
    team.playerCount = team.squads.reduce((sum, squad) => sum + squad.members.length, 0);
    if (!team.teamName) team.teamName = `Team ${team.teamID}`;
  }

  return [teamMap.get("1"), teamMap.get("2")];

  function createTeam(teamID) {
    return { teamID, teamName: `Team ${teamID}`, squads: [], playerCount: 0 };
  }

  function ensureTeam(map, teamID, teamName) {
    const key = String(teamID);
    if (!map.has(key)) map.set(key, createTeam(teamID));
    const team = map.get(key);
    if (teamName && !team.teamName) team.teamName = teamName;
    return team;
  }

  function resolvePlacement(player) {
    const teamID = normalizeTeamID(player.teamID);
    const squadID = normalizeSquadID(player.squadID);
    const normalizedName = normalizeName(player.name);

    if (teamID != null && squadID != null) {
      const exact = squadMap.get(squadKey(teamID, squadID));
      if (exact) return { team: ensureTeam(teamMap, teamID, ""), squad: exact };
    }

    if (squadID != null) {
      const candidates = squadsById.get(squadID) || [];
      const byName = candidates.find((candidate) => normalizeName(candidate.creatorName) === normalizedName);
      if (byName) return { team: ensureTeam(teamMap, byName.teamID, ""), squad: byName };
      if (candidates.length === 1) return { team: ensureTeam(teamMap, candidates[0].teamID, ""), squad: candidates[0] };
      if (teamID != null) {
        const fallback = squadMap.get(squadKey(teamID, squadID));
        if (fallback) return { team: ensureTeam(teamMap, teamID, ""), squad: fallback };
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
          <div class="match-squad-title-row">
            ${squad.unassigned ? "" : `<span class="match-squad-id">#${esc(squad.squadID)}</span>`}
            <div class="match-squad-name">${esc(squad.squadName)}</div>
          </div>
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

function formatTimeOnly(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return "未知时间";
  const date = new Date(time);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function renderMember(member) {
  const stats = getMatchStats(member);
  const stateLabel = formatState(member.state);
  const roleLabel = member.role || "未知角色";
  const teamLabel = member._resolvedUnassigned ? "待确认队伍" : `Team ${member._resolvedTeamID ?? "?"}`;
  const squadLabel = member._resolvedUnassigned ? "未编队" : `Squad ${member._resolvedSquadID ?? "?"}`;
  const squadlessText = member._resolvedUnassigned ? formatSquadlessSeconds(member?.squadlessSeconds) : "";

  return `
    <button class="match-member-row" type="button" data-player-index="${member._playerIndex}">
      <div class="match-member-main">
        <span class="match-member-name">${esc(displayName(member.name))}</span>
        ${member.isLeader ? '<span class="match-badge leader">队长</span>' : ""}
      </div>
      <div class="match-member-meta">
        <span class="match-member-stat playtime-stat">${esc(formatPlaytime(member))}</span>
        ${member._resolvedUnassigned ? "" : `<span class="match-member-squad-id">#${esc(member._resolvedSquadID)}</span>`}
        ${squadlessText ? `<span class="match-member-stat">${esc(squadlessText)}</span>` : ""}
        <span class="match-member-stat">${esc(stateLabel)}</span>
        <span class="match-member-stat">${esc(roleLabel)}</span>
        <span class="match-member-stat">${esc(teamLabel)} / ${esc(squadLabel)}</span>
        <span class="match-member-stat">K ${stats.kills} / D ${stats.downs} / 死 ${stats.deaths}</span>
      </div>
    </button>
  `;
}

function openPlayerRealtimeWindow(player, { apiFetch, onNavigate, onRefresh } = {}) {
  closePlayerFloatingWindow();

  const root = document.createElement("div");
  root.id = "bzss-player-floating-root";

  const stats = getMatchStats(player);
  const steamID = getPlayerSteamID(player);
  const eosID = player.eosID || player.eos || player.EOSID || "";
  const teamValue = player._resolvedTeamID ?? player.teamID ?? "N/A";
  const squadValue = player._resolvedUnassigned ? "未编队" : (player._resolvedSquadID ?? player.squadID ?? "N/A");

  root.innerHTML = `
    <div class="bzss-player-float-backdrop" data-close-player-window="1"></div>

    <div class="bzss-player-float-window" role="dialog" aria-modal="true">
      <div class="bzss-player-float-header">
        <div>
          <div class="bzss-player-float-title">${esc(displayName(player.name))}</div>
          <div class="bzss-player-float-subtitle">
            玩家实况 · ${esc(formatState(player.state))} · ${esc(player.role || "未知角色")}
          </div>
        </div>

        <button class="bzss-player-float-close" type="button" data-close-player-window="1">x</button>
      </div>

      <div class="bzss-player-float-body">
        <div class="bzss-player-id-block">
          <button type="button" class="bzss-copy-field" data-copy-value="${escAttr(steamID)}" data-copy-label="Steam ID">
            <span>Steam ID</span>
            <strong>${esc(steamID || "未记录")}</strong>
          </button>
          <button type="button" class="bzss-copy-field" data-copy-value="${escAttr(eosID)}" data-copy-label="EOS ID">
            <span>EOS ID</span>
            <strong>${esc(eosID || "未记录")}</strong>
          </button>
        </div>

        <div class="bzss-player-detail-grid">
          <div><span>Player ID</span><strong>${esc(player.playerID ?? "N/A")}</strong></div>
          <div><span>Team</span><strong>${esc(teamValue)}</strong></div>
          <div><span>Squad</span><strong>${esc(squadValue)}</strong></div>
          <div class="bzss-player-combat-detail-stats" style="grid-column: 1 / -1;">
            <div class="bzss-player-combat-stat-card wound">
              <span>击倒</span>
              <strong>${stats.downs}</strong>
            </div>
            <div class="bzss-player-combat-stat-card kill">
              <span>击杀</span>
              <strong>${stats.kills}</strong>
            </div>
            <div class="bzss-player-combat-stat-card death">
              <span>死亡</span>
              <strong>${stats.deaths}</strong>
            </div>
            <div class="bzss-player-combat-stat-card tk">
              <span>TK</span>
              <strong>${stats.tk}</strong>
            </div>
            <div class="bzss-player-combat-stat-card revive">
              <span>复苏</span>
              <strong>${stats.revives}</strong>
            </div>
          </div>
          <div><span>Steam Squad 时长</span><strong id="player-playtime-value">${esc(formatPlaytime(player))}</strong></div>
          <div><span>最后出现</span><strong>${esc(player.lastSeenTime || "未知")}</strong></div>
        </div>

        <div class="bzss-player-float-actions">
          <button type="button" id="refresh-player-playtime">刷新时长</button>
          <button type="button" id="warn-player">警告</button>
          <button type="button" id="kick-player">踢出</button>
          <button type="button" id="remove-player-from-squad">移除队伍</button>
          <button type="button" id="open-player-database">玩家数据库</button>
        </div>

        <div class="bzss-player-float-note" id="player-playtime-status">
          Steam 时长刷新会写入 data/steam_playtime.db，并同步玩家档案的游戏时长。
        </div>

        <section class="bzss-player-combat-panel">
          <div class="bzss-player-combat-panel-head">
            <div>
              <div class="bzss-player-combat-title">Recent clean combat</div>
              <div class="bzss-player-combat-subtitle">按时间切片查看伤害 / 击倒 / 击杀频率，点击区间可以展开事件和原始记录。</div>
            </div>
            <div class="bzss-player-combat-range" id="player-combat-range-label">最近 60 分钟</div>
          </div>
          <div id="player-combat-chart" class="bzss-player-combat-chart">Loading...</div>
          <div id="player-combat-detail" class="bzss-player-combat-detail">选择一个时间点查看详情。</div>
          <div id="player-clean-combat-list" class="bzss-player-combat-list">Loading...</div>
        </section>
      </div>
    </div>
  `;

  document.body.appendChild(root);
  loadPlayerCombatTimeline(root, { apiFetch, player }).catch(() => {});

  root.querySelectorAll("[data-close-player-window]").forEach((el) => {
    el.addEventListener("click", closePlayerFloatingWindow);
  });

  root.querySelector("#refresh-player-playtime")?.addEventListener("click", async () => {
    const btn = root.querySelector("#refresh-player-playtime");
    const status = root.querySelector("#player-playtime-status");
    const value = root.querySelector("#player-playtime-value");
    btn.disabled = true;
    status.textContent = "正在刷新该玩家 Steam 时长...";
    try {
      const job = await refreshPlayerPlaytime({ apiFetch, player });
      const lookup = job?.result?.lookup;
      if (!lookup) throw new Error("Steam 返回结果为空");
      value.textContent = formatSecondsAsHours(lookup.gameSeconds);
      status.textContent = `刷新完成：${formatSecondsAsHours(lookup.gameSeconds)}`;
      showToast(`Steam 时长已刷新：${formatSecondsAsHours(lookup.gameSeconds)}`);
      await onRefresh?.();
    } catch (error) {
      status.textContent = error?.message || "刷新失败";
      showToast(status.textContent);
    } finally {
      btn.disabled = false;
    }
  });

  root.querySelectorAll("[data-copy-value]").forEach((el) => {
    el.addEventListener("click", async () => {
      const value = String(el.dataset.copyValue || "").trim();
      if (!value) return;
      const label = el.dataset.copyLabel || "ID";
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
        } else {
          const input = document.createElement("input");
          input.value = value;
          document.body.appendChild(input);
          input.select();
          document.execCommand("copy");
          input.remove();
        }
        showToast(`${label} 已复制`);
      } catch {
        showToast(`${label} 复制失败`);
      }
    });
  });

  root.querySelector("#open-player-database")?.addEventListener("click", () => {
    const playerQuery = getPlayerDatabaseQuery(player);
    closePlayerFloatingWindow();
    if (typeof onNavigate === "function") {
      onNavigate(`/player-database?player=${encodeURIComponent(playerQuery)}`);
      return;
    }
    location.hash = `#/player-database?player=${encodeURIComponent(playerQuery)}`;
  });

  root.querySelector("#warn-player")?.addEventListener("click", async () => {
    const message = window.prompt("输入警告消息 (Input warning message):", "请遵守服务器规则 (Please follow server rules)");
    if (message === null) return;
    try {
      const response = await apiFetch("/api/admin-warns/warn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetName: player.name,
          targetSteamId: steamID,
          targetEosId: eosID,
          message: message.trim() || "Admin Warning",
          reason: "manual_warn",
          sourceModule: "web.legacy.matchStatus",
        }),
      });
      const data = await readJsonSafe(response);
      if (!response.ok || !data.success) throw new Error(data?.errorMessage || "警告发送失败");
      showToast("警告已发送");
    } catch (e) {
      showToast(String(e));
    }
  });

  root.querySelector("#kick-player")?.addEventListener("click", async () => {
    if (!window.confirm(`确定要将玩家 ${player.name} 踢出服务器吗？`)) return;
    try {
      const response = await apiFetch("/api/squad-management/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "kick_player",
          anyId: steamID || eosID || player.name,
          reason: "manual_kick",
          source: "web.legacy.matchStatus",
        }),
      });
      const data = await readJsonSafe(response);
      if (!response.ok || !data.ok) throw new Error(data?.message || "踢出执行失败");
      showToast("踢出请求已下达");
      await onRefresh?.();
    } catch (e) {
      showToast(String(e));
    }
  });

  root.querySelector("#remove-player-from-squad")?.addEventListener("click", async () => {
    if (!window.confirm(`确定要将玩家 ${player.name} 移出小队吗？`)) return;
    try {
      const response = await apiFetch("/api/squad-management/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "remove_from_squad",
          anyId: steamID || eosID || player.name,
          reason: "manual_remove",
          source: "web.legacy.matchStatus",
        }),
      });
      const data = await readJsonSafe(response);
      if (!response.ok || !data.ok) throw new Error(data?.message || "移除执行失败");
      showToast("移除请求已下达");
      await onRefresh?.();
    } catch (e) {
      showToast(String(e));
    }
  });

  const onKeyDown = (event) => {
    if (event.key === "Escape") closePlayerFloatingWindow();
  };

  window.addEventListener("keydown", onKeyDown);
  root.__onKeyDown = onKeyDown;
}

function closePlayerFloatingWindow() {
  const root = document.querySelector("#bzss-player-floating-root");
  closePlayerCleanCombatDetailModal();
  if (!root) return;
  if (root.__onKeyDown) window.removeEventListener("keydown", root.__onKeyDown);
  root.remove();
}

async function loadPlayerCombatTimeline(root, { apiFetch, player }) {
  const chart = root.querySelector("#player-combat-chart");
  const detail = root.querySelector("#player-combat-detail");
  const list = root.querySelector("#player-clean-combat-list");
  const rangeLabel = root.querySelector("#player-combat-range-label");
  if (!chart || !detail || !list) return;
  const requestSeq = (root.__playerCombatLoadSeq = (root.__playerCombatLoadSeq || 0) + 1);

  const params = new URLSearchParams({
    steam64ID: getPlayerSteamID(player),
    eosID: String(player.eosID || player.eos || player.EOSID || "").trim(),
    name: String(player.name || "").trim(),
    limit: "180",
  });

  try {
    const response = await apiFetch(`/api/combat-clean/player-events?${params.toString()}`);
    const data = await readJsonSafe(response);
    if (root.__playerCombatLoadSeq !== requestSeq) return;
    if (!response.ok) throw new Error(data?.error || `combat clean request failed (${response.status})`);
    const events = Array.isArray(data?.events) ? data.events : [];
    if (!events.length) {
      chart.innerHTML = `<div class="bzss-player-combat-empty">No clean combat records</div>`;
      detail.innerHTML = `<div class="bzss-player-combat-empty">暂无可视化数据</div>`;
      list.innerHTML = `<div class="bzss-player-combat-empty">No clean combat records</div>`;
      return;
    }

    const timeline = buildPlayerCombatTimeline(events);
    if (rangeLabel) {
      rangeLabel.textContent = `${formatCombatWindowLabel(timeline.windowMinutes)} · ${formatCleanCombatTime(timeline.rangeStart)} ~ ${formatCleanCombatTime(timeline.rangeEnd)}`;
    }

    const state = {
      selectedIndex: timeline.initialSelectedIndex,
    };

    const renderSelected = () => {
      const bucket = timeline.buckets[state.selectedIndex] || timeline.buckets[timeline.buckets.length - 1];
      if (!bucket) {
        detail.innerHTML = `<div class="bzss-player-combat-empty">暂无可视化数据</div>`;
        return;
      }
      detail.innerHTML = renderPlayerCombatBucketDetail(bucket, state.selectedIndex, timeline.buckets.length);
      detail.querySelectorAll("[data-player-trace-event-index]").forEach((button) => {
        button.addEventListener("click", () => {
          const event = bucket.events[Number(button.dataset.playerTraceEventIndex)];
          if (event) openPlayerCleanCombatDetailModal(event);
        });
      });
    };

    const updateChartSelection = (index) => {
      state.selectedIndex = Math.max(0, Math.min(timeline.buckets.length - 1, Number(index) || 0));
      chart.querySelectorAll("[data-combat-bucket-index]").forEach((button) => {
        button.classList.toggle("is-selected", Number(button.dataset.combatBucketIndex) === state.selectedIndex);
      });
      renderSelected();
    };

    chart.innerHTML = renderPlayerCombatChart(timeline);
    if (root.__playerCombatLoadSeq !== requestSeq) return;
    chart.querySelectorAll("[data-combat-bucket-index]").forEach((button) => {
      const index = Number(button.dataset.combatBucketIndex);
      button.addEventListener("mouseenter", () => updateChartSelection(index));
      button.addEventListener("focus", () => updateChartSelection(index));
      button.addEventListener("click", () => updateChartSelection(index));
    });

    list.innerHTML = renderPlayerCombatEventList(events);
    if (root.__playerCombatLoadSeq !== requestSeq) return;
    list.querySelectorAll("[data-player-clean-combat-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const event = events[Number(button.dataset.playerCleanCombatIndex)];
        if (event) openPlayerCleanCombatDetailModal(event);
      });
    });

    updateChartSelection(timeline.initialSelectedIndex);
  } catch (error) {
    if (root.__playerCombatLoadSeq !== requestSeq) return;
    const message = esc(error?.message || "Failed to load clean combat");
    chart.innerHTML = `<div class="bzss-player-combat-empty">${message}</div>`;
    detail.innerHTML = `<div class="bzss-player-combat-empty">${message}</div>`;
    list.innerHTML = `<div class="bzss-player-combat-empty">${message}</div>`;
  }
}

function renderPlayerCombatEventList(events = []) {
  const items = [...events].slice(0, 20);
  if (!items.length) return `<div class="bzss-player-combat-empty">No clean combat records</div>`;

  return items.map((event, index) => `
    <button type="button" class="bzss-player-combat-row ${event.relation?.isFriendlyFire ? "is-friendly" : ""}" data-player-clean-combat-index="${index}">
      <span>${esc(cleanCombatTypeLabel(event.type))}</span>
      <strong>${esc(event.displayText || "-")}</strong>
      <em>${esc(formatCleanCombatTime(event.time))}</em>
    </button>
  `).join("");
}

function renderPlayerCombatChart(timeline = {}) {
  const buckets = Array.isArray(timeline.buckets) ? timeline.buckets : [];
  if (!buckets.length) return `<div class="bzss-player-combat-empty">暂无曲线数据</div>`;

  const width = 720;
  const height = 180;
  const padding = { top: 18, right: 18, bottom: 28, left: 28 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...buckets.flatMap((bucket) => [bucket.damage, bucket.wound, bucket.kill]));
  const points = {
    damage: buildCombatSeriesPoints(buckets, innerWidth, innerHeight, padding, maxValue, "damage"),
    wound: buildCombatSeriesPoints(buckets, innerWidth, innerHeight, padding, maxValue, "wound"),
    kill: buildCombatSeriesPoints(buckets, innerWidth, innerHeight, padding, maxValue, "kill"),
  };

  return `
    <div class="bzss-player-combat-chart-frame">
      <svg class="bzss-player-combat-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="player combat frequency chart" role="img">
        <g class="bzss-player-combat-chart-grid">
          ${Array.from({ length: 4 }, (_, index) => {
            const y = padding.top + (innerHeight / 3) * index;
            return `<line x1="${padding.left}" y1="${y.toFixed(2)}" x2="${width - padding.right}" y2="${y.toFixed(2)}" />`;
          }).join("")}
        </g>
        ${renderCombatSeriesLine(points.damage, "damage")}
        ${renderCombatSeriesLine(points.wound, "wound")}
        ${renderCombatSeriesLine(points.kill, "kill")}
        ${buckets.map((bucket, index) => renderCombatSeriesPoint(bucket, index, points, maxValue, padding, innerWidth, innerHeight)).join("")}
      </svg>
      <div class="bzss-player-combat-legend">
        <span class="damage">伤害 ${formatCombatSeriesTotal(buckets, "damage")}</span>
        <span class="wound">击倒 ${formatCombatSeriesTotal(buckets, "wound")}</span>
        <span class="kill">击杀 ${formatCombatSeriesTotal(buckets, "kill")}</span>
      </div>
    </div>
  `;
}

function buildPlayerCombatTimeline(events = []) {
  const normalized = events
    .map((event, index) => ({
      ...event,
      _timelineIndex: index,
      _timeMs: toCombatTimeMs(event.time ?? event.eventTime ?? event.logTime ?? event.raw?.time),
    }))
    .filter((event) => Number.isFinite(event._timeMs) && event._timeMs > 0)
    .sort((a, b) => a._timeMs - b._timeMs);

  const now = Date.now();
  const recentCutoff = now - 60 * 60 * 1000;
  const recent = normalized.filter((event) => event._timeMs >= recentCutoff);
  const source = recent.length ? recent : normalized.slice(-60);
  const rangeEvents = source.length ? source : normalized;
  const rangeStart = rangeEvents.length ? rangeEvents[0]._timeMs : now - 60 * 60 * 1000;
  const rangeEnd = rangeEvents.length ? rangeEvents[rangeEvents.length - 1]._timeMs : now;
  const spanMinutes = Math.max(60, Math.ceil(Math.max(1, rangeEnd - rangeStart) / 60000));
  const windowMinutes = chooseCombatWindowMinutes(spanMinutes);
  const bucketMinutes = windowMinutes / 12;
  const bucketMs = bucketMinutes * 60000;
  const chartEnd = Math.ceil(rangeEnd / bucketMs) * bucketMs || now;
  const chartStart = chartEnd - (bucketMs * 12);
  const buckets = Array.from({ length: 12 }, (_, index) => ({
    index,
    start: chartStart + index * bucketMs,
    end: chartStart + (index + 1) * bucketMs,
    damage: 0,
    wound: 0,
    kill: 0,
    events: [],
  }));

  for (const event of source) {
    const bucketIndex = Math.floor((event._timeMs - chartStart) / bucketMs);
    if (bucketIndex < 0 || bucketIndex >= buckets.length) continue;
    const bucket = buckets[bucketIndex];
    bucket.events.push(event);
    if (event.type === "damage") bucket.damage += 1;
    else if (event.type === "wound") bucket.wound += 1;
    else if (event.type === "kill") bucket.kill += 1;
  }

  const nonEmptyIndex = buckets.findIndex((bucket) => bucket.damage || bucket.wound || bucket.kill);
  const initialSelectedIndex = nonEmptyIndex >= 0 ? nonEmptyIndex : buckets.length - 1;

  return {
    buckets,
    rangeStart,
    rangeEnd: Math.max(rangeEnd, chartEnd),
    windowMinutes,
    bucketMinutes,
    initialSelectedIndex,
  };
}

function renderPlayerCombatBucketDetail(bucket, index, totalBuckets) {
  const recentEvents = [...bucket.events].slice().reverse().slice(0, 6);
  return `
    <div class="bzss-player-combat-detail-head">
      <div>
        <div class="bzss-player-combat-detail-title">区间 ${index + 1} / ${totalBuckets}</div>
        <div class="bzss-player-combat-detail-range">${esc(formatCombatBucketRange(bucket))}</div>
      </div>
      <div class="bzss-player-combat-detail-stats">
        <span class="damage">伤害 ${bucket.damage}</span>
        <span class="wound">击倒 ${bucket.wound}</span>
        <span class="kill">击杀 ${bucket.kill}</span>
      </div>
    </div>
    <div class="bzss-player-combat-detail-summary">
      该区间共 ${bucket.events.length} 条 clean combat 记录，可直接点开原始详情。后续追述功能可以从这里继续扩展。
    </div>
    <div class="bzss-player-combat-detail-events">
      ${recentEvents.length
        ? recentEvents.map((event, eventIndex) => `
          <button type="button" class="bzss-player-combat-detail-event ${event.relation?.isFriendlyFire ? "is-friendly" : ""}" data-player-trace-event-index="${eventIndex}">
            <span>${esc(cleanCombatTypeLabel(event.type))}</span>
            <strong>${esc(event.displayText || "-")}</strong>
            <em>${esc(formatCleanCombatTime(event.time))}</em>
          </button>
        `).join("")
        : `<div class="bzss-player-combat-empty">该时间点没有事件</div>`}
    </div>
  `;
}

function renderCombatSeriesLine(points = [], type) {
  if (!points.length) return "";
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  return `<path class="bzss-combat-series-line ${type}" d="${path}" />`;
}

function renderCombatSeriesPoint(bucket, index, points, maxValue, padding, innerWidth, innerHeight) {
  const centerX = padding.left + (innerWidth / Math.max(1, points.damage.length - 1 || 1)) * index;
  const label = `${formatCombatBucketRange(bucket)} · 伤害 ${bucket.damage} / 击倒 ${bucket.wound} / 击杀 ${bucket.kill}`;
  return `
    <g class="bzss-combat-bucket" data-combat-bucket-index="${index}" tabindex="0" role="button" aria-label="${esc(label)}">
      <circle class="bzss-combat-point damage ${bucket.damage ? "" : "is-empty"}" cx="${centerX.toFixed(2)}" cy="${scaleCombatValue(bucket.damage, maxValue, padding.top, innerHeight).toFixed(2)}" r="${bucket.damage ? 4.5 : 3.25}">
        <title>${esc(label)}</title>
      </circle>
      <circle class="bzss-combat-point wound ${bucket.wound ? "" : "is-empty"}" cx="${centerX.toFixed(2)}" cy="${scaleCombatValue(bucket.wound, maxValue, padding.top, innerHeight).toFixed(2)}" r="${bucket.wound ? 4.5 : 3.25}">
        <title>${esc(label)}</title>
      </circle>
      <circle class="bzss-combat-point kill ${bucket.kill ? "" : "is-empty"}" cx="${centerX.toFixed(2)}" cy="${scaleCombatValue(bucket.kill, maxValue, padding.top, innerHeight).toFixed(2)}" r="${bucket.kill ? 4.5 : 3.25}">
        <title>${esc(label)}</title>
      </circle>
      <title>${esc(label)}</title>
    </g>
  `;
}

function buildCombatSeriesPoints(buckets, innerWidth, innerHeight, padding, maxValue, key) {
  const step = buckets.length > 1 ? innerWidth / (buckets.length - 1) : 0;
  return buckets.map((bucket, index) => ({
    x: padding.left + (step * index),
    y: scaleCombatValue(bucket[key], maxValue, padding.top, innerHeight),
    value: bucket[key],
  }));
}

function scaleCombatValue(value, maxValue, top, innerHeight) {
  const ratio = Number(value) / Math.max(1, maxValue);
  return top + innerHeight - (Math.max(0, ratio) * innerHeight);
}

function chooseCombatWindowMinutes(spanMinutes) {
  if (spanMinutes <= 60) return 60;
  if (spanMinutes <= 120) return 120;
  if (spanMinutes <= 180) return 180;
  return 240;
}

function formatCombatWindowLabel(windowMinutes) {
  if (windowMinutes >= 60) return `最近 ${windowMinutes / 60} 小时`;
  return `最近 ${windowMinutes} 分钟`;
}

function formatCombatBucketRange(bucket) {
  return `${formatCleanCombatTime(bucket.start)} ~ ${formatCleanCombatTime(bucket.end)}`;
}

function formatCombatSeriesTotal(buckets, key) {
  const total = buckets.reduce((sum, bucket) => sum + Number(bucket[key] || 0), 0);
  return `${total}`;
}

function toCombatTimeMs(value) {
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isFinite(time)) return time;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function openPlayerCleanCombatDetailModal(event) {
  closePlayerCleanCombatDetailModal();

  const root = document.createElement("div");
  root.id = "bzss-player-clean-combat-record-root";
  root.innerHTML = `
    <div class="kill-record-backdrop" data-close-player-clean-combat="1"></div>
    <section class="kill-record-window combat-record-window" role="dialog" aria-modal="true" aria-label="clean combat detail">
      <header class="kill-record-header">
        <div>
          <div class="kill-record-title">Clean Combat</div>
          <div class="kill-record-subtitle">${esc(event.displayText || event.id || "")}</div>
        </div>
        <button class="kill-record-close" type="button" data-close-player-clean-combat="1">x</button>
      </header>

      <div class="kill-record-body">
        <div class="kill-record-grid">
          ${cleanCombatDetailCell("displayText", event.displayText)}
          ${cleanCombatDetailCell("eventName", event.eventName)}
          ${cleanCombatDetailCell("type", event.type)}
          ${cleanCombatDetailCell("attacker", formatCleanCombatPlayerRef(event.attacker))}
          ${cleanCombatDetailCell("victim", formatCleanCombatPlayerRef(event.victim))}
          ${cleanCombatDetailCell("weapon", formatCleanCombatWeapon(event.weapon))}
          ${cleanCombatDetailCell("relation", formatCleanCombatRelation(event.relation))}
          ${cleanCombatDetailCell("warnings", formatCleanCombatWarnings(event.parse?.warnings))}
          ${cleanCombatDetailCell("parse", `${event.parse?.status || "-"} / ${event.parse?.confidence || "-"}`)}
        </div>

        <div class="kill-record-raw-card">
          <h3>Raw Log</h3>
          <pre class="kill-record-pre">${esc(event.raw?.rawLog || "No rawLog")}</pre>
        </div>
      </div>
    </section>
  `;

  document.body.appendChild(root);
  root.querySelectorAll("[data-close-player-clean-combat]").forEach((el) => {
    el.addEventListener("click", closePlayerCleanCombatDetailModal);
  });
  const onKeyDown = (keyboardEvent) => {
    if (keyboardEvent.key === "Escape") closePlayerCleanCombatDetailModal();
  };
  window.addEventListener("keydown", onKeyDown);
  root.__onKeyDown = onKeyDown;
}

function closePlayerCleanCombatDetailModal() {
  const root = document.querySelector("#bzss-player-clean-combat-record-root");
  if (!root) return;
  if (root.__onKeyDown) window.removeEventListener("keydown", root.__onKeyDown);
  root.remove();
}

function cleanCombatDetailCell(label, value) {
  return `<div><span>${esc(label)}</span><strong>${esc(value ?? "-")}</strong></div>`;
}

function openFloatingPlayerWindow(player, { apiFetch, onNavigate, onRefresh, anchorX, anchorY, squad, team } = {}) {
  const state = createFloatingPlayerWindowState(player, {
    squad: squad || player._resolvedSquadRef || null,
    team: team || player._resolvedTeamRef || null,
    anchorX,
    anchorY,
  });

  setActivePlayerWindow({
    ...state,
    apiFetch,
    onNavigate,
    onRefresh,
    contentHtml: renderPlayerDetailContent(state),
    onRendered: (root, nextState) => {
      bindFloatingPlayerWindowInteractions(root, nextState, { apiFetch, onNavigate, onRefresh });
      loadPlayerCombatTimeline(root, { apiFetch, player: nextState.player }).catch(() => {});
    },
  });
}

function syncFloatingPlayerWindow({ teams = [], apiFetch, onNavigate, onRefresh } = {}) {
  const current = getActivePlayerWindow();
  if (!current) return;

  const resolved = resolveFloatingPlayerWindowSnapshot(current, teams);
  const base = resolved
    ? createFloatingPlayerWindowState(resolved.player, {
      squad: resolved.squad,
      team: resolved.team,
      anchorX: current.anchorX,
      anchorY: current.anchorY,
    })
    : {
      ...current,
      missingNotice: "该玩家可能已离线或数据已刷新，当前显示的是最近一次快照。",
    };

  setActivePlayerWindow({
    ...current,
    ...base,
    apiFetch,
    onNavigate,
    onRefresh,
    contentHtml: renderPlayerDetailContent({
      ...base,
      missingNotice: base.missingNotice || "",
    }),
    onRendered: (root, nextState) => {
      bindFloatingPlayerWindowInteractions(root, nextState, { apiFetch, onNavigate, onRefresh });
      loadPlayerCombatTimeline(root, { apiFetch, player: nextState.player }).catch(() => {});
    },
  });
}

function bindFloatingPlayerWindowInteractions(root, state, { apiFetch, onNavigate, onRefresh } = {}) {
  const player = state.player || {};
  const steamID = getPlayerSteamID(player);
  const eosID = String(player.eosID || player.eos || player.EOSID || "").trim();

  root.querySelector("#refresh-player-playtime")?.addEventListener("click", async () => {
    const btn = root.querySelector("#refresh-player-playtime");
    const status = root.querySelector("#player-playtime-status");
    const value = root.querySelector("#player-playtime-value");
    if (!btn || !status || !value) return;

    btn.disabled = true;
    status.textContent = "正在刷新该玩家 Steam 时长...";
    try {
      const job = await refreshPlayerPlaytime({ apiFetch, player });
      const lookup = job?.result?.lookup;
      if (!lookup) throw new Error("Steam 返回结果为空");
      value.textContent = formatSecondsAsHours(lookup.gameSeconds);
      status.textContent = `刷新完成：${formatSecondsAsHours(lookup.gameSeconds)}`;
      showToast(`Steam 时长已刷新：${formatSecondsAsHours(lookup.gameSeconds)}`);
      await onRefresh?.();
    } catch (error) {
      status.textContent = error?.message || "刷新失败";
      showToast(status.textContent);
    } finally {
      btn.disabled = false;
    }
  });

  root.querySelectorAll("[data-copy-value]").forEach((el) => {
    el.addEventListener("click", async () => {
      const value = String(el.dataset.copyValue || "").trim();
      if (!value || value === "—") return;
      const label = el.dataset.copyLabel || "ID";
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
        } else {
          const input = document.createElement("input");
          input.value = value;
          document.body.appendChild(input);
          input.select();
          document.execCommand("copy");
          input.remove();
        }
        showToast(`${label} 已复制`);
      } catch {
        showToast(`${label} 复制失败`);
      }
    });
  });

  root.querySelector("#open-player-database")?.addEventListener("click", () => {
    const playerQuery = getPlayerDatabaseQuery(player);
    closeFloatingPlayerWindow();
    if (typeof onNavigate === "function") {
      onNavigate(`/player-database?player=${encodeURIComponent(playerQuery)}`);
      return;
    }
    location.hash = `#/player-database?player=${encodeURIComponent(playerQuery)}`;
  });

  root.querySelector("#warn-player")?.addEventListener("click", async () => {
    const message = window.prompt("输入警告消息:", "请遵守服务器规则");
    if (message === null) return;
    try {
      const response = await apiFetch("/api/admin-warns/warn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetName: player.name,
          targetSteamId: steamID,
          targetEosId: eosID,
          message: message.trim() || "Admin Warning",
          reason: "manual_warn",
          sourceModule: "web.legacy.matchStatus",
        }),
      });
      const data = await readJsonSafe(response);
      if (!response.ok || !data.success) throw new Error(data?.errorMessage || "警告发送失败");
      showToast("警告已发送");
    } catch (e) {
      showToast(String(e));
    }
  });

  root.querySelector("#kick-player")?.addEventListener("click", async () => {
    if (!window.confirm(`确定要将玩家 ${player.name} 踢出服务器吗？`)) return;
    try {
      const response = await apiFetch("/api/squad-management/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "kick_player",
          anyId: steamID || eosID || player.name,
          reason: "manual_kick",
          source: "web.legacy.matchStatus",
        }),
      });
      const data = await readJsonSafe(response);
      if (!response.ok || !data.ok) throw new Error(data?.message || "踢出执行失败");
      showToast("踢出请求已下发");
      await onRefresh?.();
    } catch (e) {
      showToast(String(e));
    }
  });

  root.querySelector("#remove-player-from-squad")?.addEventListener("click", async () => {
    if (!window.confirm(`确定要将玩家 ${player.name} 移出小队吗？`)) return;
    try {
      const response = await apiFetch("/api/squad-management/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "remove_from_squad",
          anyId: steamID || eosID || player.name,
          reason: "manual_remove",
          source: "web.legacy.matchStatus",
        }),
      });
      const data = await readJsonSafe(response);
      if (!response.ok || !data.ok) throw new Error(data?.message || "移除执行失败");
      showToast("移除请求已下发");
      await onRefresh?.();
    } catch (e) {
      showToast(String(e));
    }
  });

  root.querySelectorAll("[data-floating-member-index]").forEach((el) => {
    el.addEventListener("click", () => {
      const index = Number(el.dataset.floatingMemberIndex);
      const member = state.squad?.members?.[index];
      if (!member) return;
      openFloatingPlayerWindow(member, {
        apiFetch,
        onNavigate,
        onRefresh,
        anchorX: state.anchorX,
        anchorY: state.anchorY,
        squad: member._resolvedSquadRef || state.squad,
        team: member._resolvedTeamRef || state.team,
      });
    });
  });
}

function createFloatingPlayerWindowState(player, { squad = null, team = null, anchorX, anchorY, missingNotice = "" } = {}) {
  const stats = getMatchStats(player);
  const steamID = getPlayerSteamID(player);
  const eosID = String(player?.eosID || player?.eos || player?.EOSID || "").trim();
  const squadMembers = Array.isArray(squad?.members) ? squad.members : [];

  const state = {
    player,
    squad,
    team,
    anchorX: Number.isFinite(Number(anchorX)) ? Number(anchorX) : (window.innerWidth / 2),
    anchorY: Number.isFinite(Number(anchorY)) ? Number(anchorY) : (window.innerHeight / 2),
    playerName: displayName(player?.name),
    playerSubtitle: `玩家实况 · ${formatState(player?.state)} · ${player?.role || "未知角色"}`,
    missingNotice,
    isLeader: Boolean(player?.isLeader),
    stateLabel: formatState(player?.state),
    steamID: steamID || "—",
    eosID: eosID || "—",
    playerID: player?.playerID ?? "—",
    currentIp: String(player?.ip || player?.currentIp || player?.current_ip || player?.network?.ip || "—"),
    permissionGroup: String(player?.permission_group || player?.permissionGroup || player?.permission || "default"),
    teamSquadLabel: buildTeamSquadLabel(player, squad, team),
    factionLabel: String(player?.faction || player?.side || player?.teamName || `Team ${team?.teamID ?? player?.teamID ?? "?"}`),
    roleLabel: String(player?.role || player?.class || "未知角色"),
    playtimeLabel: formatPlaytime(player),
    lastSeenLabel: String(player?.lastSeenTime || player?.lastSeen || player?.updatedAt || "未知"),
    combatStats: stats,
    statsLabel: `击倒 ${stats.downs} / 击杀 ${stats.kills} / 死亡 ${stats.deaths} / TK ${stats.tk} / 复苏 ${stats.revives}`,
    historyEntryLabel: "打开玩家数据库",
    playtimeStatus: "Steam 时长刷新会写入本地时长缓存，并同步玩家档案。",
    squadSubtitle: "当前玩家所属小队",
    squadBadge: squad && !squad.unassigned ? `#${squad.squadID}` : "",
    squadName: displayName(squad?.squadName || "未编队"),
    squadStateLabel: squad?.unassigned ? "未编队" : (squad?.locked ? "锁队" : "公开"),
    squadCreatorLabel: displayName(squad?.creatorName || squad?.leaderName || "未知"),
    squadSizeLabel: String(squadMembers.length || squad?.size || 0),
    combatSubtitle: "按时间切片查看伤害、击倒、击杀频率",
    squadMembers: squadMembers.map((member) => {
      const memberStats = getMatchStats(member);
      return {
        name: displayName(member.name),
        isLeader: Boolean(member.isLeader),
        playtime: formatPlaytime(member),
        squadLabel: member._resolvedUnassigned ? "未编队" : `#${member._resolvedSquadID}`,
        roleLabel: String(member.role || "未知角色"),
        stateLabel: formatState(member.state),
        combatStats: memberStats,
        statsLabel: `击倒 ${memberStats.downs} / 击杀 ${memberStats.kills} / 死亡 ${memberStats.deaths} / TK ${memberStats.tk} / 复苏 ${memberStats.revives}`,
      };
    }),
  };

  state.identity = buildPlayerIdentity(player);
  state.contentHtml = renderPlayerDetailContent(state);
  return state;
}

function resolveFloatingPlayerWindowSnapshot(current, teams = []) {
  const identity = current?.identity;
  if (!identity) return null;

  for (const team of Array.isArray(teams) ? teams : []) {
    for (const squad of team?.squads || []) {
      for (const member of squad?.members || []) {
        if (!matchesPlayerIdentity(member, identity)) continue;
        return { player: member, squad, team };
      }
    }
  }

  return null;
}

function buildTeamSquadLabel(player, squad, team) {
  const teamLabel = `Team ${team?.teamID ?? player?.teamID ?? "?"}`;
  const squadLabel = squad?.unassigned ? "未编队" : `Squad ${squad?.squadID ?? player?.squadID ?? "?"}`;
  return `${teamLabel} / ${squadLabel}`;
}

function buildPlayerIdentity(player = {}) {
  return {
    playerID: String(player?.playerID ?? "").trim(),
    steamID: getPlayerSteamID(player),
    eosID: String(player?.eosID || player?.eos || player?.EOSID || "").trim(),
    name: normalizeName(player?.name),
  };
}

function matchesPlayerIdentity(candidate = {}, identity = {}) {
  const candidateIdentity = buildPlayerIdentity(candidate);
  return Boolean(
    (identity.playerID && candidateIdentity.playerID && candidateIdentity.playerID === identity.playerID)
    || (identity.steamID && candidateIdentity.steamID && candidateIdentity.steamID === identity.steamID)
    || (identity.eosID && candidateIdentity.eosID && candidateIdentity.eosID === identity.eosID)
    || (identity.name && candidateIdentity.name && candidateIdentity.name === identity.name),
  );
}

function closeFloatingPlayerWindow() {
  closeActivePlayerWindow();
}

function cleanCombatTypeLabel(type) {
  if (type === "damage") return "伤害";
  if (type === "wound") return "击倒";
  if (type === "kill") return "击杀";
  return type || "-";
}

function formatCleanCombatPlayerRef(player = {}) {
  if (player.isBot) return player.displayName || "bot";
  return [
    player.displayName || player.name || "Unknown",
    `team=${blankCleanCombatValue(player.teamID)}`,
    `squad=${blankCleanCombatValue(player.squadID)}`,
    player.steam64ID ? `steam=${player.steam64ID}` : "",
    player.eosID ? `eos=${player.eosID}` : "",
    player.resolved ? `resolved:${player.resolutionSource}` : "unresolved",
    player.isFallback ? `fallback:${player.fallbackReason}` : "",
  ].filter(Boolean).join(" / ");
}

function formatCleanCombatWeapon(weapon = {}) {
  return [
    weapon.displayName || weapon.cleaned || weapon.raw || "Unknown",
    weapon.category ? `category=${weapon.category}` : "",
    weapon.sourceType ? `source=${weapon.sourceType}` : "",
    weapon.raw ? `raw=${weapon.raw}` : "",
  ].filter(Boolean).join(" / ");
}

function formatCleanCombatRelation(relation = {}) {
  if (relation.teamSource === "bot") return "bot / normal";
  return [
    `attackerTeam=${blankCleanCombatValue(relation.attackerTeamID)}`,
    `victimTeam=${blankCleanCombatValue(relation.victimTeamID)}`,
    relation.sameTeam ? "sameTeam" : "notSameTeam",
    relation.isFriendlyFire ? `friendlyFire:${relation.friendlyFireType || "yes"}` : "normal",
    `confidence=${relation.teamConfidence || "low"}`,
  ].join(" / ");
}

function formatCleanCombatWarnings(warnings) {
  return Array.isArray(warnings) && warnings.length ? warnings.join(" / ") : "-";
}

function blankCleanCombatValue(value) {
  return value === "" || value == null ? "?" : String(value);
}

function formatCleanCombatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("zh-CN", { hour12: false });
}

async function legacyRefreshAllPlaytime({ root, api, apiFetch, openDrawer, onNavigate }) {
  const status = root.querySelector("#playtime-status");
  const button = root.querySelector("#refresh-playtime");
  button.disabled = true;
  status.dataset.tone = "pending";
  status.textContent = "正在检测在场玩家时长...";
  try {
    const response = await apiFetch("/api/playtime/online/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waitMs: 0 }),
    });
    const job = await readJsonSafe(response);
    if (!response.ok) throw new Error(job?.error || `请求失败 (${response.status})`);
    const finalJob = job.status === "completed" || job.status === "failed"
      ? job
      : await waitForPlaytimeJob(apiFetch, job.id, 45_000);
    if (finalJob.status !== "completed") throw new Error(finalJob?.error?.message || "Steam 时长批量刷新失败");

    const result = finalJob.result || {};
    status.dataset.tone = "success";
    status.textContent = `已刷新 ${Number(result.updated || 0)}/${Number(result.total || 0)} 名玩家`;
    showToast(status.textContent);
    await renderPage({ root, api, apiFetch, openDrawer, onNavigate });
  } catch (error) {
    status.dataset.tone = "error";
    status.textContent = error?.message || "Steam 时长刷新失败";
    showToast(status.textContent);
  } finally {
    button.disabled = false;
  }
}

async function refreshPlayerPlaytime({ apiFetch, player }) {
  const steamID = getPlayerSteamID(player);
  if (!steamID) throw new Error("该玩家没有 Steam ID");
  const response = await apiFetch("/api/playtime/players/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      steamID,
      name: player.name || null,
      eosID: player.eosID || player.eos || null,
      waitMs: 0,
    }),
  });
  const job = await readJsonSafe(response);
  if (!response.ok) throw new Error(job?.error || `请求失败 (${response.status})`);
  const finalJob = job.status === "completed" || job.status === "failed"
    ? job
    : await waitForPlaytimeJob(apiFetch, job.id, 30_000);
  if (finalJob.status !== "completed") throw new Error(finalJob?.error?.message || "Steam 时长查询失败");
  return finalJob;
}

async function legacyWaitForPlaytimeJob(apiFetch, jobId, waitMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitMs) {
    const response = await apiFetch(`/api/playtime/jobs/${encodeURIComponent(jobId)}?waitMs=5000`);
    const job = await readJsonSafe(response);
    if (!response.ok) throw new Error(job?.error || `Steam 任务查询失败 (${response.status})`);
    if (job?.status === "completed" || job?.status === "failed") return job;
  }
  throw new Error("等待 Steam 时长任务超时");
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getPlayerDatabaseQuery(player) {
  const steamID = getPlayerSteamID(player);
  const eosID = String(player.eosID || player.eos || player.EOSID || "").trim();
  const name = String(player.name || "").trim();
  return steamID || eosID || name || "";
}

function getPlayerSteamID(player) {
  return String(player?.steamID || player?.steam64 || player?.SteamID || "").trim();
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

function formatPlaytime(player) {
  const seconds = Number(player?.steamPlaytime?.gameSeconds ?? player?.gameSeconds ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "Steam 时长 --";
  return `Steam ${formatSecondsAsHours(seconds)}`;
}

function formatSquadlessSeconds(value) {
  const seconds = Number(value ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";

  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) return `游离 ${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `游离 ${m}m${String(s).padStart(2, "0")}s`;
  return `游离 ${s}s`;
}

function formatSecondsAsHours(seconds) {
  return `${(Number(seconds || 0) / 3600).toFixed(1)}h`;
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

function escAttr(value) {
  return esc(value).replace(/`/g, "&#96;");
}

function showToast(message) {
  const id = "bzss-app-toast";
  let toast = document.getElementById(id);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = id;
    toast.className = "app-toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 1400);
}

function createPlaytimeRefreshState() {
  return {
    active: false,
    jobId: null,
    tone: "idle",
    statusText: "Steam 时长待刷新",
    summaryText: "成功 0，跳过 0，失败 0",
    progressLabel: "等待开始",
    countText: "0 / 0",
    percent: 0,
    events: [],
  };
}

function renderPlaytimeEvents(events = []) {
  const items = [...events].slice(-8).reverse();
  if (!items.length) return '<div class="match-playtime-empty">最近没有刷新事件</div>';

  return items.map((event) => {
    const tone = event.status === "failed"
      ? "failed"
      : event.status === "skipped"
        ? "skipped"
        : "success";
    const time = event.at ? new Date(event.at).toLocaleTimeString("zh-CN", { hour12: false }) : "";
    return `
      <div class="match-playtime-event ${tone}">
        <span class="phase">${esc(event.phase || event.status || "event")}</span>
        <strong>${esc(event.message || "")}</strong>
        <em>${esc(time)}</em>
      </div>
    `;
  }).join("");
}

function renderPlaytimePanel(root, state = createPlaytimeRefreshState()) {
  const statsGrid = root.querySelector(".grid.cols-3");
  if (!statsGrid) return;
  root.querySelector("#playtime-panel")?.remove();

  const panel = document.createElement("section");
  panel.id = "playtime-panel";
  panel.className = "card match-playtime-card";
  panel.innerHTML = `
    <div class="match-playtime-header">
      <div>
        <div class="match-playtime-title">Steam 时长刷新</div>
        <div class="page-subtitle">智能刷新会跳过 30 分钟内已成功刷新的玩家；强制刷新会处理全部在线玩家。</div>
      </div>
      <div class="match-playtime-actions">
        <button id="playtime-panel-refresh" type="button">智能刷新时长</button>
        <button id="playtime-panel-force" type="button">强制刷新全部时长</button>
      </div>
    </div>
    <div class="match-playtime-summary-row">
      <span id="playtime-summary">${esc(state.summaryText || "成功 0，跳过 0，失败 0")}</span>
      <span id="playtime-progress-label">${esc(state.progressLabel || "等待开始")}</span>
    </div>
    <div class="match-playtime-progress">
      <div class="match-playtime-progress-track">
        <div id="playtime-progress-fill" class="match-playtime-progress-fill" style="width:${Math.max(0, Math.min(100, Number(state.percent || 0)))}%"></div>
      </div>
      <div class="match-playtime-progress-meta">
        <span id="playtime-progress-percent">${Math.max(0, Math.min(100, Number(state.percent || 0)))}%</span>
        <span id="playtime-progress-count">${esc(state.countText || "0 / 0")}</span>
      </div>
    </div>
    <div id="playtime-events" class="match-playtime-events">${renderPlaytimeEvents(state.events || [])}</div>
  `;
  statsGrid.insertAdjacentElement("afterend", panel);
}

function applyPlaytimeJobState(root, job, { active = false, tone = null, statusText = null } = {}) {
  const progress = job?.progress ?? {};
  const state = {
    active,
    jobId: job?.id || null,
    tone: tone || (job?.status === "failed" ? "error" : job?.status === "completed" ? "success" : "pending"),
    statusText: statusText || (job?.status === "completed"
      ? "Steam 时长刷新完成"
      : job?.status === "failed"
        ? job?.error?.message || "Steam 时长刷新失败"
        : "正在刷新 Steam 时长"),
    summaryText: `成功 ${Number(progress.updated || 0)}，跳过 ${Number(progress.skipped || 0)}，失败 ${Number(progress.failed || 0)}`,
    progressLabel: progress.message || "处理中",
    countText: `${Number(progress.selected || 0)} / ${Number(progress.total || 0)}`,
    percent: Math.max(0, Math.min(100, Number(progress.percent || 0))),
    events: Array.isArray(progress.events) ? progress.events : [],
  };
  root.__playtimeRefreshState = state;

  const status = root.querySelector("#playtime-status");
  if (status) {
    status.dataset.tone = state.tone;
    status.textContent = state.statusText;
  }
  const summary = root.querySelector("#playtime-summary");
  if (summary) summary.textContent = state.summaryText;
  const label = root.querySelector("#playtime-progress-label");
  if (label) label.textContent = state.progressLabel;
  const percent = root.querySelector("#playtime-progress-percent");
  if (percent) percent.textContent = `${state.percent}%`;
  const count = root.querySelector("#playtime-progress-count");
  if (count) count.textContent = state.countText;
  const fill = root.querySelector("#playtime-progress-fill");
  if (fill) fill.style.width = `${state.percent}%`;
  const events = root.querySelector("#playtime-events");
  if (events) events.innerHTML = renderPlaytimeEvents(state.events);

  for (const selector of [
    "#refresh-playtime",
    "#refresh-playtime-force",
    "#playtime-panel-refresh",
    "#playtime-panel-force",
  ]) {
    const button = root.querySelector(selector);
    if (button) button.disabled = Boolean(active);
  }

  return state;
}

async function refreshAllPlaytime({ root, api, apiFetch, openDrawer, onNavigate, force = false }) {
  if (force && !window.confirm("确定强制刷新全部在线玩家时长？")) return;

  applyPlaytimeJobState(root, {
    id: "pending",
    status: "queued",
    type: "online-refresh",
    progress: {
      total: 0,
      selected: 0,
      skipped: 0,
      queued: 0,
      running: 0,
      updated: 0,
      failed: 0,
      percent: 0,
      message: force ? "正在强制刷新全部在线玩家时长..." : "正在智能刷新在线玩家时长...",
      events: [],
    },
  }, { active: true, tone: "pending", statusText: force ? "正在强制刷新全部在线玩家时长..." : "正在智能刷新在线玩家时长..." });

  try {
    const response = await apiFetch("/api/playtime/online/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force, waitMs: 0 }),
    });
    const job = await readJsonSafe(response);
    if (!response.ok) throw new Error(job?.message || job?.error || `请求失败 (${response.status})`);

    applyPlaytimeJobState(root, job, {
      active: job.status !== "completed" && job.status !== "failed",
      tone: job.status === "failed" ? "error" : "pending",
      statusText: job.status === "completed"
        ? "Steam 时长刷新完成"
        : job.status === "failed"
          ? job.error?.message || "Steam 时长刷新失败"
          : force
            ? "强制刷新进行中"
            : "智能刷新进行中",
    });

    const finalJob = job.status === "completed" || job.status === "failed"
      ? job
      : await waitForPlaytimeJob(apiFetch, job.id, 45_000, (nextJob) => {
        applyPlaytimeJobState(root, nextJob, {
          active: nextJob.status !== "completed" && nextJob.status !== "failed",
          tone: nextJob.status === "failed" ? "error" : "pending",
        });
      });

    const state = applyPlaytimeJobState(root, finalJob, {
      active: false,
      tone: finalJob.status === "failed" ? "error" : "success",
      statusText: finalJob.status === "failed"
        ? finalJob.error?.message || "Steam 时长刷新失败"
        : `成功 ${Number(finalJob.result?.updated || 0)}，跳过 ${Number(finalJob.result?.skipped || 0)}，失败 ${Number(finalJob.result?.failed || 0)}`,
    });

    if (finalJob.status !== "completed") {
      throw new Error(finalJob?.error?.message || "Steam 时长批量刷新失败");
    }

    showToast(state.statusText);
    await renderPage({ root, api, apiFetch, openDrawer, onNavigate });
  } catch (error) {
    applyPlaytimeJobState(root, {
      id: "failed",
      status: "failed",
      type: "online-refresh",
      error: { message: error?.message || "Steam 时长刷新失败" },
      progress: {
        total: 0,
        selected: 0,
        skipped: 0,
        queued: 0,
        running: 0,
        updated: 0,
        failed: 0,
        percent: 0,
        message: error?.message || "Steam 时长刷新失败",
        events: [],
      },
    }, { active: false, tone: "error", statusText: error?.message || "Steam 时长刷新失败" });
    showToast(error?.message || "Steam 时长刷新失败");
  }
}

async function waitForPlaytimeJob(apiFetch, jobId, waitMs = 30_000, onUpdate = null) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitMs) {
    const response = await apiFetch(`/api/playtime/jobs/${encodeURIComponent(jobId)}?waitMs=3000`);
    const job = await readJsonSafe(response);
    if (!response.ok) throw new Error(job?.error || `Steam 浠诲姟鏌ヨ澶辫触 (${response.status})`);
    if (typeof onUpdate === "function") onUpdate(job);
    if (job?.status === "completed" || job?.status === "failed") return job;
  }
  throw new Error("绛夊緟 Steam 鏃堕暱浠诲姟瓒呮椂");
}
