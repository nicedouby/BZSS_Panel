// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.commander-impeachment";
export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger
    ?? core?.createLogger?.({
      moduleId: PLUGIN_ID,
      source: PLUGIN_ID,
      channel: "module",
    })
    ?? core?.logger
    ?? console;

  const runtimeConfig = readConfig(config);
  const stateByServerId = new Map();
  const timersByProcessId = new Map();
  const unsubscribers = [];
  let serial = Promise.resolve();

  function enqueue(task) {
    const next = serial.then(() => task(), () => task());
    serial = next.catch(() => {});
    return next;
  }

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
      && core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }

  function isActive() {
    return Boolean(runtimeConfig.enabled) && isSubscribed();
  }

  function getServerId(value = "") {
    return String(value || core?.webStatus?.serverId || "").trim();
  }

  function getAdminBroadcastApi() {
    return modules?.adminWarn?.sendAdminBroadcast ?? modules?.adminWarn?.broadcastMessage ?? null;
  }

  function getAdminWarnApi() {
    return modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer ?? null;
  }

  function getRconApi() {
    return core?.rconManager?.dispatchCommand ?? null;
  }

  function getSquadState(serverId = "") {
    const resolvedServerId = getServerId(serverId);
    return modules?.squadManagement?.getState?.(resolvedServerId) ?? null;
  }

  function getState(serverId = "") {
    const resolvedServerId = getServerId(serverId);
    const runtime = stateByServerId.get(resolvedServerId);
    return runtime ? clone(runtime) : createEmptyState(resolvedServerId);
  }

  function getRuntime(serverId = "") {
    const resolvedServerId = getServerId(serverId);
    if (!stateByServerId.has(resolvedServerId)) {
      stateByServerId.set(resolvedServerId, createEmptyState(resolvedServerId));
    }
    return stateByServerId.get(resolvedServerId);
  }

  function createEmptyState(serverId) {
    return {
      serverId,
      processes: [],
      activeProcesses: [],
      stats: {
        started: 0,
        succeeded: 0,
        failed: 0,
        votesCast: 0,
      },
    };
  }

  async function broadcast(message, reason, meta = {}) {
    const sender = getAdminBroadcastApi();
    const text = normalizeText(message);
    if (!text || typeof sender !== "function") return { success: false, skipped: true, skipReason: "admin_broadcast_unavailable" };
    try {
      return await sender.call(modules.adminWarn, {
        message: text,
        reason,
        sourceModule: PLUGIN_ID,
        relatedEventId: normalizeText(meta?.relatedEventId),
        system: true,
      });
    } catch (error) {
      pluginLogger?.warn?.(`[CommanderImpeachment] broadcast failed: ${error?.message ?? error}`);
      return { success: false, error: error?.message ?? String(error) };
    }
  }

  async function warnPlayer(player, message, reason, meta = {}) {
    const sender = getAdminWarnApi();
    const text = normalizeText(message);
    if (!text || !player || typeof sender !== "function") return { success: false, skipped: true, skipReason: "admin_warn_unavailable" };
    const targetName = normalizeText(player.playerName ?? player.name);
    if (!targetName) return { success: false, skipped: true, skipReason: "target_missing" };
    try {
      return await sender.call(modules.adminWarn, {
        targetName,
        targetSteamId: normalizeText(player.steamId ?? player.steamID),
        targetEosId: normalizeText(player.eosId ?? player.eosID),
        message: text,
        reason,
        sourceModule: PLUGIN_ID,
        relatedEventId: normalizeText(meta?.relatedEventId),
        system: true,
      });
    } catch (error) {
      pluginLogger?.warn?.(`[CommanderImpeachment] warn failed: ${error?.message ?? error}`);
      return { success: false, error: error?.message ?? String(error) };
    }
  }

  async function demoteCommander(command, meta = {}) {
    const sender = getRconApi();
    if (typeof sender !== "function") {
      return { success: false, skipped: true, skipReason: "rcon_unavailable" };
    }

    const commandText = normalizeText(command);
    pluginLogger?.info?.(`[CommanderImpeachment] Executing raw RCON command: ${commandText}`, {
      operation: "commanderImpeachment.demoteCommander",
      data: {
        command: commandText,
        reason: normalizeText(meta?.reason) || "commander_impeachment",
      },
    });

    try {
      const result = await sender.call(core.rconManager, {
        command: commandText,
        system: true,
        priority: "high",
        requestedBy: PLUGIN_ID,
        reason: normalizeText(meta?.reason) || "commander_impeachment",
      });

      pluginLogger?.info?.(`[CommanderImpeachment] RCON command finished: ${commandText}`, {
        operation: "commanderImpeachment.demoteCommander",
        data: {
          command: commandText,
          reason: normalizeText(meta?.reason) || "commander_impeachment",
          success: Boolean(result?.success),
          rconExecuted: Boolean(result?.rconExecuted),
          message: normalizeText(result?.message),
        },
      });

      return result;
    } catch (error) {
      pluginLogger?.warn?.(`[CommanderImpeachment] demote failed: ${error?.message ?? error}`, {
        operation: "commanderImpeachment.demoteCommander",
        data: {
          command: commandText,
          reason: normalizeText(meta?.reason) || "commander_impeachment",
        },
      });
      return { success: false, error: error?.message ?? String(error) };
    }
  }

  function resolveInitiator(event = {}, state = null) {
    const players = Array.isArray(state?.players) ? state.players : [];
    const steamId = normalizeText(event?.steamId ?? event?.steamID ?? event?.steamid);
    const eosId = normalizeText(event?.eosId ?? event?.eosID ?? event?.eosid);
    const playerName = normalizeText(event?.playerName ?? event?.name ?? event?.player_name);
    const playerKey = normalizeText(event?.playerKey);
    const teamId = normalizeOptionalNumber(event?.teamId ?? event?.teamID);
    const squadId = normalizeOptionalNumber(event?.squadId ?? event?.squadID);

    return players.find((player) => {
      if (playerKey && normalizeText(player.playerKey) === playerKey) return true;
      if (steamId && normalizeText(player.steamId ?? player.steamID) === steamId) return true;
      if (eosId && normalizeText(player.eosId ?? player.eosID) === eosId) return true;
      if (playerName && normalizeText(player.name) === playerName) return true;
      if (teamId != null && Number(player.teamId ?? player.teamID) !== Number(teamId)) return false;
      if (squadId != null && Number(player.squadId ?? player.squadID) !== Number(squadId)) return false;
      return false;
    }) ?? null;
  }

  function isLeaderRole(roleText) {
    const clean = String(roleText ?? "").toLowerCase();
    return clean.includes("squadleader") || clean.includes("officer") || clean.includes("sl") || clean.includes("leader") || clean.includes("lead_");
  }

  function findCommander(state, teamId) {
    const teamPlayers = Array.isArray(state?.players) ? state.players.filter((player) => sameTeam(player, { teamId })) : [];
    const commandSquads = Array.isArray(state?.squads) ? state.squads.filter((squad) => sameTeam(squad, { teamId }) && isCommandSquad(squad)) : [];

    for (const squad of commandSquads) {
      const leader = teamPlayers.find((player) => sameSquad(player, squad) && Boolean(player.isLeader));
      if (leader) {
        return {
          player: leader,
          squad,
        };
      }

      const member = teamPlayers.find((player) => sameSquad(player, squad));
      if (member) {
        return {
          player: member,
          squad,
        };
      }
    }

    const roleMatch = teamPlayers.find((player) => {
      const role = normalizeText(player.role).toLowerCase();
      return role.includes("commander") || role === "cmd" || role.includes(" cmd");
    });

    if (roleMatch) {
      return { player: roleMatch, squad: null };
    }

    return null;
  }


  function findCurrentLeader(state, teamId, squadId) {
    const players = Array.isArray(state?.players) ? state.players : [];
    return players.find((player) => Number(player.teamId ?? player.teamID ?? -1) === Number(teamId ?? -2)
      && Number(player.squadId ?? player.squadID ?? -1) === Number(squadId ?? -2)
      && Boolean(player.isLeader)
      && !isCommandSquadPlayer(player, state)) ?? null;
  }

  function getFactionName(state, teamId) {
    const team = Array.isArray(state?.teams)
      ? state.teams.find((item) => Number(item.teamId ?? item.teamID ?? -1) === Number(teamId ?? -2))
      : null;
    return normalizeText(team?.teamName ?? team?.factionName ?? team?.name) || `阵营 ${teamId}`;
  }

  function isCommandSquad(squad = {}) {
    const squadId = normalizeText(squad.squadId ?? squad.squadID);
    const squadName = normalizeText(squad.squadName ?? squad.name).toLowerCase();
    if (squadId === "10" || squadId.toLowerCase() === "cmd" || squadId.toLowerCase() === "command") return true;
    if (squadName === "command squad" || squadName === "cmd" || squadName === "command") return true;
    return /\bcommand\s*squad\b/i.test(squadName);
  }

  function isCommandSquadPlayer(player = {}, state = null) {
    const playerSquad = {
      squadId: player.squadId ?? player.squadID,
      squadName: player.squadName ?? player.name,
    };
    const squad = Array.isArray(state?.squads)
      ? state.squads.find((item) => Number(item.teamId ?? item.teamID ?? -1) === Number(player.teamId ?? player.teamID ?? -2)
        && Number(item.squadId ?? item.squadID ?? -1) === Number(player.squadId ?? player.squadID ?? -2))
      : null;
    return isCommandSquad(squad ?? playerSquad);
  }

  function sameTeam(left = {}, right = {}) {
    return Number(left.teamId ?? left.teamID ?? -1) === Number(right.teamId ?? right.teamID ?? -2);
  }

  function sameSquad(left = {}, right = {}) {
    return sameTeam(left, right)
      && Number(left.squadId ?? left.squadID ?? -1) === Number(right.squadId ?? right.squadID ?? -2);
  }

  function buildPlayersSnapshot(state, teamId) {
    const players = Array.isArray(state?.players) ? state.players : [];
    return players
      .filter((player) => Number(player.teamId ?? player.teamID ?? -1) === Number(teamId ?? -2))
      .map((player) => clone(player));
  }

  function buildSnapshotSquadMembers(playersSnapshot, voter) {
    return playersSnapshot.filter((player) => sameTeam(player, voter) && sameSquad(player, voter));
  }

  function getActiveProcess(runtime, teamId) {
    return runtime.processes.find((process) => process.teamId === Number(teamId ?? -1) && process.status === "active") ?? null;
  }

  function createProcess({ state, teamId, factionName, commander, initiator, serverId }) {
    const playersSnapshot = buildPlayersSnapshot(state, teamId);
    const snapshotByKey = new Map();
    const snapshotSquadsById = new Map();
    const playerVotes = {};
    for (const player of playersSnapshot) {
      const playerKey = resolvePlayerKey(player);
      if (playerKey) {
        snapshotByKey.set(playerKey, player);
        playerVotes[playerKey] = { vote: null, squadId: null };
      }
      const squadId = Number(player.squadId ?? player.squadID ?? -1);
      if (!snapshotSquadsById.has(squadId)) snapshotSquadsById.set(squadId, []);
      snapshotSquadsById.get(squadId).push(player);
    }

    return {
      id: `${PLUGIN_ID}:${serverId}:${teamId}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      serverId,
      teamId: Number(teamId),
      factionName,
      commander: clone(commander),
      initiator: clone(initiator),
      startedAt: nowIso(),
      startedAtMs: Date.now(),
      status: "active",
      playersSnapshot,
      snapshotByKey,
      snapshotSquadsById,
      playerVotes,
      votesBySquadId: new Map(),
      votedPlayerKeys: new Set(),
      logs: [],
      finishedAt: "",
      finishedAtMs: 0,
      outcome: "",
      yesCount: 0,
      totalCount: playersSnapshot.length,
    };
  }

  function resolvePlayerKey(player = {}) {
    const playerId = normalizeText(player.playerId ?? player.playerID);
    const steamId = normalizeText(player.steamId ?? player.steamID);
    const eosId = normalizeText(player.eosId ?? player.eosID);
    const name = normalizeText(player.name);
    if (playerId) return `player:${playerId}`;
    if (steamId) return `steam:${steamId}`;
    if (eosId) return `eos:${eosId}`;
    if (name) return `name:${name}`;
    return "";
  }

  async function executeEvaluation(process) {
    if (process.status !== "active") return;

    const timers = timersByProcessId.get(process.id);
    if (timers) {
      if (timers.timer) clearInterval(timers.timer);
      if (timers.timeout) clearTimeout(timers.timeout);
      timersByProcessId.delete(process.id);
    }    let yesCount = 0;
    let noCount = 0;
    for (const pKey in process.playerVotes) {
      const record = process.playerVotes[pKey];
      if (record.vote === "yes") yesCount++;
      else if (record.vote === "no") noCount++;
    }
    process.yesCount = yesCount;

    const threshold = Math.ceil(process.totalCount * 0.5);
    const passed = yesCount >= threshold;

    const runtime = getRuntime(process.serverId);

    const yesPercent = process.totalCount > 0 ? Math.round((yesCount / process.totalCount) * 100) : 0;

    if (passed) {
      const commanderPlayerId = normalizeText(process.commander.playerId ?? process.commander.playerID);
      const commanderSteamId = normalizeText(process.commander.steamId ?? process.commander.steamID);
      const commanderName = normalizeText(process.commander.name);
      const command = commanderPlayerId
        ? `AdminDemoteCommanderById ${commanderPlayerId}`
        : commanderSteamId
          ? `AdminDemoteCommander ${commanderSteamId}`
          : `AdminDemoteCommander ${commanderName}`;
      const commandResult = await demoteCommander(command, {
        reason: "commander_impeachment_success",
      });

      const gameHours = formatHours((Number(getSquadState(process.serverId)?.match?.logClockSeconds ?? 0) || Number(core?.webStatus?.getSnapshot?.()?.logClockSeconds ?? 0) || 0) / 3600);
      const successMessage = `指挥官 ${process.commander.name} 被罢免，游戏时长 ${gameHours} 小时。`;

      await warnPlayer(process.commander, "你已被罢免。", "commander_impeachment_commander_removed", {
        relatedEventId: process.id,
      });

      const currentState = getSquadState(process.serverId);
      const factionPlayers = currentState && Array.isArray(currentState.players)
        ? currentState.players.filter(p => Number(p.teamId ?? p.teamID ?? -1) === process.teamId)
        : [];
      
      for (const player of factionPlayers) {
        if (resolvePlayerKey(player) !== resolvePlayerKey(process.commander)) {
          await warnPlayer(player, successMessage, "commander_impeachment_success_broadcast", {
            relatedEventId: process.id,
          });
        }
      }

      process.status = "succeeded";
      process.outcome = "succeeded";
      runtime.stats.succeeded += 1;
    } else {
      const failMessage = `${process.factionName} 阵营未能完成罢免指挥官流程。最终赞成率 ${yesPercent}%。`;
      const currentState = getSquadState(process.serverId);
      const factionPlayers = currentState && Array.isArray(currentState.players)
        ? currentState.players.filter(p => Number(p.teamId ?? p.teamID ?? -1) === process.teamId)
        : [];
      
      for (const player of factionPlayers) {
        await warnPlayer(player, failMessage, "commander_impeachment_failed_broadcast", {
          relatedEventId: process.id,
        });
      }

      process.status = "failed";
      process.outcome = "failed";
      runtime.stats.failed += 1;
    }

    process.finishedAt = nowIso();
    process.finishedAtMs = Date.now();
    runtime.activeProcesses = runtime.processes.filter((item) => item.status === "active");
  }

  async function startImpeachment(event = {}) {
    const state = getSquadState(event.serverId);
    if (!state) {
      return { matched: false, skipped: true, reason: "state_unavailable" };
    }

    const initiator = resolveInitiator(event, state);
    if (!initiator) {
      return { matched: true, success: false, reason: "initiator_not_found" };
    }
    if (!Boolean(initiator.isLeader) || isCommandSquadPlayer(initiator, state)) {
      await warnPlayer(initiator, "只有当前小队长可以发起罢免指挥官流程。", "commander_impeachment_start_denied", {
        relatedEventId: event?.id,
      });
      return { matched: true, success: false, reason: "initiator_not_leader" };
    }

    const teamId = Number(initiator.teamId ?? initiator.teamID ?? -1);
    const factionName = getFactionName(state, teamId);
    const runtime = getRuntime(event.serverId);
    const active = getActiveProcess(runtime, teamId);
    if (active) {
      await warnPlayer(initiator, `${factionName} 阵营已有罢免指挥官流程正在进行。`, "commander_impeachment_already_active", {
        relatedEventId: event?.id,
      });
      return { matched: true, success: false, reason: "already_active" };
    }

    const commander = findCommander(state, teamId);
    if (!commander?.player) {
      await warnPlayer(initiator, "当前阵营没有可罢免的指挥官。", "commander_impeachment_no_commander", {
        relatedEventId: event?.id,
      });
      return { matched: true, success: false, reason: "commander_missing" };
    }

    const process = createProcess({
      state,
      teamId,
      factionName,
      commander: commander.player,
      initiator,
      serverId: getServerId(event.serverId),
    });

    // Automatically vote "yes" for initiator's squad
    const initiatorSquadId = Number(initiator.squadId ?? initiator.squadID ?? -1);
    const initiatorSquadMembers = Array.isArray(state.players)
      ? state.players.filter(p => Number(p.teamId ?? p.teamID ?? -1) === teamId && Number(p.squadId ?? p.squadID ?? -1) === initiatorSquadId)
      : [];
    for (const member of initiatorSquadMembers) {
      const memberKey = resolvePlayerKey(member);
      if (memberKey && process.playerVotes[memberKey]) {
        process.playerVotes[memberKey].vote = "yes";
        process.playerVotes[memberKey].squadId = initiatorSquadId;
      }
    }

    runtime.processes.push(process);
    runtime.activeProcesses = runtime.processes.filter((item) => item.status === "active");
    runtime.stats.started += 1;

    for (const player of process.playersSnapshot) {
      const pKey = resolvePlayerKey(player);
      if (pKey === resolvePlayerKey(process.commander)) {
        await warnPlayer(player, "你正在被罢免。请等待投票结果。", "commander_impeachment_commander_warned", {
          relatedEventId: process.id,
        });
      } else if (pKey === resolvePlayerKey(process.initiator)) {
        await warnPlayer(player, "你已发起罢免并代表本小队默认投票：赞成罢免。", "commander_impeachment_initiator_warned", {
          relatedEventId: process.id,
        });
      } else if (Number(player.squadId ?? player.squadID ?? -1) === initiatorSquadId) {
        await warnPlayer(player, "你所在小队已由队长代表投票：赞成罢免。", "commander_impeachment_squad_member_notified", {
          relatedEventId: process.id,
        });
      } else if (Boolean(player.isLeader) && !isCommandSquadPlayer(player, state)) {
        await warnPlayer(player, "罢免指挥官投票正在进行。输入 1 赞成罢免，输入 0 否决罢免。你的投票将代表本小队所有成员。", "commander_impeachment_vote_prompt", {
          relatedEventId: process.id,
        });
      } else {
        await warnPlayer(player, "罢免指挥官进程正在进行。", "commander_impeachment_member_warned", {
          relatedEventId: process.id,
        });
      }
    }

    const duration = runtimeConfig.durationMs ?? 60000;
    const interval = runtimeConfig.intervalMs ?? 15000;

    const timer = setInterval(async () => {
      const currentState = getSquadState(event.serverId);
      if (!currentState) return;
      
      const factionPlayers = Array.isArray(currentState.players)
        ? currentState.players.filter(p => Number(p.teamId ?? p.teamID ?? -1) === teamId)
        : [];
      
      let currentYesCount = 0;
      let currentNoCount = 0;
      for (const pKey in process.playerVotes) {
        const record = process.playerVotes[pKey];
        if (record.vote === "yes") currentYesCount++;
        else if (record.vote === "no") currentNoCount++;
      }
      process.yesCount = currentYesCount;

      const yesPercent = process.totalCount > 0 ? Math.round((currentYesCount / process.totalCount) * 100) : 0;
      const progressMsg = `罢免指挥官投票进行中：当前赞成率 ${yesPercent}% (通过需要达到 50%)。`;

      for (const player of factionPlayers) {
        await warnPlayer(player, progressMsg, "commander_impeachment_progress_broadcast", {
          relatedEventId: process.id,
        });
      }
    }, interval);

    const timeout = setTimeout(async () => {
      await executeEvaluation(process);
    }, duration);

    timersByProcessId.set(process.id, { timer, timeout });

    return { matched: true, success: true, process: clone(process) };
  }

  async function recordVote(event = {}, vote) {
    const state = getSquadState(event.serverId);
    if (!state) {
      return { matched: false, skipped: true, reason: "state_unavailable" };
    }

    const initiator = resolveInitiator(event, state);
    if (!initiator) {
      return { matched: true, success: false, reason: "initiator_not_found" };
    }

    const teamId = Number(initiator.teamId ?? initiator.teamID ?? -1);
    const runtime = getRuntime(event.serverId);
    const process = getActiveProcess(runtime, teamId);
    if (!process) {
      await warnPlayer(initiator, "当前没有进行中的罢免指挥官流程。", "commander_impeachment_no_active_process", {
        relatedEventId: event?.id,
      });
      return { matched: true, success: false, reason: "no_active_process" };
    }

    if (!Boolean(initiator.isLeader) || isCommandSquadPlayer(initiator, state)) {
      await warnPlayer(initiator, "只有小队长可以参与本次罢免投票。", "commander_impeachment_vote_denied", {
        relatedEventId: process.id,
      });
      return { matched: true, success: false, reason: "initiator_not_leader" };
    }

    const squadId = Number(initiator.squadId ?? initiator.squadID ?? -1);
    const currentLeader = findCurrentLeader(state, teamId, squadId);
    if (!currentLeader) {
      await warnPlayer(initiator, "只有小队长可以参与本次罢免投票。", "commander_impeachment_vote_denied", {
        relatedEventId: process.id,
      });
      return { matched: true, success: false, reason: "leader_missing" };
    }

    const voterKey = resolvePlayerKey(currentLeader);
    const squadMembers = Array.isArray(state?.players)
      ? state.players.filter((player) => Number(player.teamId ?? player.teamID ?? -1) === teamId && Number(player.squadId ?? player.squadID ?? -1) === squadId)
      : [];

    let updatedCount = 0;
    for (const member of squadMembers) {
      const memberKey = resolvePlayerKey(member);
      if (!memberKey) continue;
      const record = process.playerVotes[memberKey];
      if (record) {
        if (record.vote === null) {
          record.vote = vote;
          record.squadId = squadId;
          updatedCount++;
        } else if (record.squadId === squadId) {
          record.vote = vote;
          updatedCount++;
        }
      }
    }

    runtime.stats.votesCast += 1;

    const voteText = vote === "yes" ? "赞成罢免" : "否决罢免";
    await warnPlayer(currentLeader, `你已代表本小队投票：${voteText}。`, vote === "yes" ? "commander_impeachment_vote_yes" : "commander_impeachment_vote_no", {
      relatedEventId: process.id,
    });

    for (const member of squadMembers) {
      const pKey = resolvePlayerKey(member);
      if (pKey === voterKey) continue;
      const record = process.playerVotes[pKey];
      if (record && record.squadId === squadId) {
        await warnPlayer(member, `你所在小队已由队长代表投票：${voteText}。`, "commander_impeachment_squad_member_notified", {
          relatedEventId: process.id,
        });
      }
    }

    let yesCount = 0;
    let noCount = 0;
    for (const pKey in process.playerVotes) {
      const record = process.playerVotes[pKey];
      if (record.vote === "yes") yesCount++;
      else if (record.vote === "no") noCount++;
    }
    process.yesCount = yesCount;

    const threshold = Math.ceil(process.totalCount * 0.5);
    if (yesCount >= threshold) {
      await executeEvaluation(process);
    }

    return {
      matched: true,
      success: true,
      process: clone(process),
    };
  }

  function clone(value) {
    if (value == null || typeof value !== "object") return value;
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch {}
    }
    return JSON.parse(JSON.stringify(value));
  }

  function isStartTrigger(message = "") {
    const normalized = normalizeText(message).toLowerCase();
    return normalized === "罢免指挥官"
      || normalized === "开始罢免"
      || normalized === "commander impeachment"
      || normalized === "impeach commander"
      || normalized === "/impeach"
      || normalized === "!impeach";
  }

  function parseVote(message = "") {
    const normalized = normalizeText(message);
    if (normalized === "1" || normalized === "yes" || normalized === "y" || normalized === "赞成" || normalized === "赞成罢免") return "yes";
    if (normalized === "0" || normalized === "no" || normalized === "n" || normalized === "反对" || normalized === "反对罢免") return "no";
    return null;
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeOptionalNumber(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatHours(value) {
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours <= 0) return "0.0";
    return hours.toFixed(1);
  }

  async function handleChatMessage(event = {}) {
    return enqueue(async () => {
      if (!isActive()) {
        return { matched: false, skipped: true, reason: runtimeConfig.enabled ? "plugin_unsubscribed" : "plugin_disabled" };
      }

      const message = normalizeText(event?.message);
      if (!message) return { matched: false };

      const vote = parseVote(message);
      if (isStartTrigger(message)) {
        return await startImpeachment(event);
      }

      if (vote) {
        return await recordVote(event, vote);
      }

      return { matched: false };
    });
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "Commander Impeachment",
      kind: "plugin",
      version: "1.0.0",
      description: "监听聊天中的罢免指挥官流程，按小队代表投票并仅在开始、成功、失败时广播。",
      category: "Moderation",
    },
    apiName: "commanderImpeachment",
    api: {
      getState,
      async simulateChatMessage(payload = {}) {
        return handleChatMessage({
          ...payload,
          message: String(payload?.message ?? ""),
        });
      },
    },

    async init() {},

    async start() {
      if (modules?.chatManager?.on) {
        unsubscribers.push(modules.chatManager.on("message", handleChatMessage));
      } else if (core?.eventBus?.onModuleEvent) {
        unsubscribers.push(core.eventBus.onModuleEvent("module.chatManager", "CHAT_RECEIVED", handleChatMessage));
      }
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }
      for (const state of stateByServerId.values()) {
        for (const process of state.processes) {
          if (process.timer) {
            clearInterval(process.timer);
            process.timer = null;
          }
          if (process.timeout) {
            clearTimeout(process.timeout);
            process.timeout = null;
          }
        }
      }
    },
  };
}

function readConfig(config) {
  const raw = config?.get?.("plugins.commanderImpeachment", {});
  return {
    enabled: raw.enabled !== false,
    durationMs: raw.durationMs ?? 60000,
    intervalMs: raw.intervalMs ?? 15000,
  };
}
