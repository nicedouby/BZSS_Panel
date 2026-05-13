// -*- coding: utf-8 -*-

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

  root.querySelector("#refresh").addEventListener("click", () => renderPage({ root, api, apiFetch, openDrawer, onNavigate }));
  root.querySelector("#refresh-playtime").addEventListener("click", async () => {
    await refreshAllPlaytime({ root, api, apiFetch, openDrawer, onNavigate });
  });

  root.querySelectorAll("[data-player-index]").forEach((el) => {
    el.addEventListener("click", () => {
      const player = players[Number(el.dataset.playerIndex)];
      if (!player) return;

      openPlayerRealtimeWindow(player, {
        apiFetch,
        onNavigate,
        onRefresh: () => renderPage({ root, api, apiFetch, openDrawer, onNavigate }),
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
    renderPage({ root, api, apiFetch, openDrawer, onNavigate }).catch(() => {});
  }, 3000);

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

  return `
    <button class="match-member-row" type="button" data-player-index="${member._playerIndex}">
      <div class="match-member-main">
        <span class="match-member-name">${esc(displayName(member.name))}</span>
        ${member.isLeader ? '<span class="match-badge leader">队长</span>' : ""}
      </div>
      <div class="match-member-meta">
        <span class="match-member-stat playtime-stat">${esc(formatPlaytime(member))}</span>
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
          <div><span>K / 击倒 / 死亡</span><strong>${stats.kills} / ${stats.downs} / ${stats.deaths}</strong></div>
          <div><span>Steam Squad 时长</span><strong id="player-playtime-value">${esc(formatPlaytime(player))}</strong></div>
          <div><span>最后出现</span><strong>${esc(player.lastSeenTime || "未知")}</strong></div>
        </div>

        <div class="bzss-player-float-actions">
          <button type="button" id="refresh-player-playtime">刷新时长</button>
          <button type="button" disabled>警告</button>
          <button type="button" disabled>踢出小队</button>
          <button type="button" id="open-player-database">玩家数据库</button>
        </div>

        <div class="bzss-player-float-note" id="player-playtime-status">
          Steam 时长刷新会写入 data/steam_playtime.db，并同步玩家档案的游戏时长。
        </div>

        <section class="bzss-player-combat-panel">
          <div class="bzss-player-combat-title">Recent clean combat</div>
          <div id="player-clean-combat-list" class="bzss-player-combat-list">Loading...</div>
        </section>
      </div>
    </div>
  `;

  document.body.appendChild(root);
  loadPlayerCleanCombatEvents(root, { apiFetch, player }).catch(() => {});

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

async function loadPlayerCleanCombatEvents(root, { apiFetch, player }) {
  const list = root.querySelector("#player-clean-combat-list");
  if (!list) return;

  const params = new URLSearchParams({
    steam64ID: getPlayerSteamID(player),
    eosID: String(player.eosID || player.eos || player.EOSID || "").trim(),
    name: String(player.name || "").trim(),
    limit: "20",
  });

  try {
    const response = await apiFetch(`/api/combat-clean/player-events?${params.toString()}`);
    const data = await readJsonSafe(response);
    if (!response.ok) throw new Error(data?.error || `combat clean request failed (${response.status})`);
    const events = data?.events ?? [];
    if (!events.length) {
      list.innerHTML = `<div class="bzss-player-combat-empty">No clean combat records</div>`;
      return;
    }

    list.innerHTML = events.map((event, index) => `
      <button type="button" class="bzss-player-combat-row ${event.relation?.isFriendlyFire ? "is-friendly" : ""}" data-player-clean-combat-index="${index}">
        <span>${esc(cleanCombatTypeLabel(event.type))}</span>
        <strong>${esc(event.displayText || "-")}</strong>
        <em>${esc(formatCleanCombatTime(event.time))}</em>
      </button>
    `).join("");

    list.querySelectorAll("[data-player-clean-combat-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const event = events[Number(button.dataset.playerCleanCombatIndex)];
        if (event) openPlayerCleanCombatDetailModal(event);
      });
    });
  } catch (error) {
    list.innerHTML = `<div class="bzss-player-combat-empty">${esc(error?.message || "Failed to load clean combat")}</div>`;
  }
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

function cleanCombatTypeLabel(type) {
  if (type === "damage") return "伤害";
  if (type === "wound") return "击倒";
  if (type === "kill") return "击杀";
  return type || "-";
}

function formatCleanCombatPlayerRef(player = {}) {
  return [
    player.name || "Unknown",
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

async function refreshAllPlaytime({ root, api, apiFetch, openDrawer, onNavigate }) {
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

async function waitForPlaytimeJob(apiFetch, jobId, waitMs = 30_000) {
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
