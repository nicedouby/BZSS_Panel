// -*- coding: utf-8 -*-

const DEFAULT_MAX_RESUME_GAP_SECONDS = 120;

export function createMatchPlayerPresenceModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.matchPlayerPresence",
    source: "module.matchPlayerPresence",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config.get("modules.matchPlayerPresence", {});
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const resumeGapPolicy = String(moduleConfig.resumeGapPolicy ?? "bounded").trim();
  const maxResumeGapSeconds = normalizePositiveNumber(moduleConfig.maxResumeGapSeconds, DEFAULT_MAX_RESUME_GAP_SECONDS);
  const servers = new Map();
  const unsubscribers = [];

  function ensureServerState(serverId = currentServerId()) {
    const key = normalizeText(serverId || currentServerId());
    if (!servers.has(key)) {
      servers.set(key, {
        serverId: key,
        version: 1,
        updatedAt: "",
        players: new Map(),
      });
    }
    return servers.get(key);
  }

  function currentServerId() {
    return normalizeText(core.webStatus?.serverId ?? core.webStatus?.state?.serverId ?? "unknown") || "unknown";
  }

  function getStablePlayerKey(player = {}) {
    const steamID = normalizeText(player?.steamID ?? player?.steam64ID ?? "");
    if (steamID) return `steam:${steamID}`;

    const eosID = normalizeText(player?.eosID ?? "");
    if (eosID) return `eos:${eosID}`;

    const controllerID = normalizeText(player?.controllerID ?? "");
    if (controllerID) return `controller:${controllerID}`;

    return "";
  }

  function normalizeIdentityQuality(playerKey) {
    return playerKey.startsWith("steam:") || playerKey.startsWith("eos:") || playerKey.startsWith("controller:")
      ? "strong"
      : "weak";
  }

  function makeEmptyRecord(playerKey) {
    return {
      playerKey,
      steamID: "",
      eosID: "",
      controllerID: "",
      lastName: "",
      firstSeenAt: "",
      lastSeenAt: "",
      observedOnlineMs: 0,
      estimatedGapMs: 0,
      online: false,
      activeSegmentStartedAt: "",
      onlineAtLastSave: false,
      joinCount: 0,
      leaveCount: 0,
      identityQuality: normalizeIdentityQuality(playerKey),
    };
  }

  function ensurePlayerRecord(serverState, playerKey, player = {}, observedAt = new Date().toISOString()) {
    if (!serverState.players.has(playerKey)) {
      const record = makeEmptyRecord(playerKey);
      record.firstSeenAt = observedAt;
      serverState.players.set(playerKey, record);
    }

    const record = serverState.players.get(playerKey);
    record.steamID = normalizeText(player?.steamID ?? record.steamID);
    record.eosID = normalizeText(player?.eosID ?? record.eosID);
    record.controllerID = normalizeText(player?.controllerID ?? record.controllerID);
    record.lastName = normalizeText(player?.name ?? record.lastName);
    if (!record.firstSeenAt) record.firstSeenAt = observedAt;
    record.lastSeenAt = observedAt;
    return record;
  }

  function closeActiveSegment(record, observedAt) {
    if (!record?.activeSegmentStartedAt) {
      record.online = false;
      record.onlineAtLastSave = false;
      return;
    }

    const startedAt = Date.parse(record.activeSegmentStartedAt);
    const endedAt = Date.parse(observedAt);
    if (Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt) {
      record.observedOnlineMs += endedAt - startedAt;
    }
    record.activeSegmentStartedAt = "";
    record.online = false;
    record.onlineAtLastSave = false;
  }

  function updateSegmentOnImport(record, context = {}) {
    const savedAtMs = Date.parse(context.savedAt ?? record.lastSeenAt ?? "");
    const restoredAtMs = Date.parse(context.restoredAt ?? new Date().toISOString());
    const gapMs = Number.isFinite(savedAtMs) && Number.isFinite(restoredAtMs) && restoredAtMs >= savedAtMs
      ? restoredAtMs - savedAtMs
      : 0;
    if (resumeGapPolicy === "bounded" && gapMs > 0 && maxResumeGapSeconds > 0) {
      record.estimatedGapMs += Math.min(gapMs, maxResumeGapSeconds * 1000);
    }
  }

  function applyPlayersSnapshot(serverState, players, observedAt) {
    const currentKeys = new Set();

    for (const player of Array.isArray(players) ? players : []) {
      const playerKey = getStablePlayerKey(player);
      if (!playerKey) continue;

      currentKeys.add(playerKey);
      const record = ensurePlayerRecord(serverState, playerKey, player, observedAt);
      if (!record.online) {
        record.online = true;
        record.activeSegmentStartedAt = observedAt;
        record.joinCount += 1;
      }
      record.lastName = normalizeText(player?.name ?? record.lastName);
      record.onlineAtLastSave = true;
    }

    for (const record of serverState.players.values()) {
      if (currentKeys.has(record.playerKey) || !record.online) continue;
      closeActiveSegment(record, observedAt);
      record.leaveCount += 1;
    }

    serverState.updatedAt = observedAt;
    if (modules?.matchCache?.markDirty) {
      modules.matchCache.markDirty("playerMatchPresence");
    }
  }

  function exportState(serverId = currentServerId(), savedAt = new Date().toISOString()) {
    const state = ensureServerState(serverId);
    return {
      version: state.version,
      updatedAt: state.updatedAt,
      players: Object.fromEntries([...state.players.entries()].map(([playerKey, record]) => [
        playerKey,
        serializeRecord(record, { snapshotAt: savedAt }),
      ])),
    };
  }

  function importState(data, context = {}) {
    const serverId = normalizeText(context.serverId || currentServerId());
    const state = ensureServerState(serverId);
    state.players.clear();

    const rawPlayers = data?.players && typeof data.players === "object" ? data.players : {};
    for (const [playerKey, rawRecord] of Object.entries(rawPlayers)) {
      if (!playerKey) continue;
      const record = normalizeRecord(playerKey, rawRecord);
      if (!record) continue;
      const wasOnlineAtLastSave = record.onlineAtLastSave || record.online;
      record.online = false;
      record.activeSegmentStartedAt = "";
      record.onlineAtLastSave = false;
      if (wasOnlineAtLastSave) updateSegmentOnImport(record, context);
      state.players.set(playerKey, record);
    }

    state.updatedAt = normalizeText(data?.updatedAt ?? new Date().toISOString());
  }

  function resetState(context = {}) {
    const serverId = normalizeText(context.serverId || currentServerId());
    const state = ensureServerState(serverId);
    state.players.clear();
    state.updatedAt = new Date().toISOString();
  }

  function normalizeRecord(playerKey, rawRecord = {}) {
    if (!rawRecord || typeof rawRecord !== "object") return null;
    return {
      playerKey,
      steamID: normalizeText(rawRecord.steamID ?? ""),
      eosID: normalizeText(rawRecord.eosID ?? ""),
      controllerID: normalizeText(rawRecord.controllerID ?? ""),
      lastName: normalizeText(rawRecord.lastName ?? ""),
      firstSeenAt: normalizeText(rawRecord.firstSeenAt ?? ""),
      lastSeenAt: normalizeText(rawRecord.lastSeenAt ?? ""),
      observedOnlineMs: normalizePositiveNumber(rawRecord.observedOnlineMs, 0),
      estimatedGapMs: normalizePositiveNumber(rawRecord.estimatedGapMs, 0),
      online: Boolean(rawRecord.online),
      activeSegmentStartedAt: normalizeText(rawRecord.activeSegmentStartedAt ?? ""),
      onlineAtLastSave: Boolean(rawRecord.onlineAtLastSave),
      joinCount: normalizePositiveNumber(rawRecord.joinCount, 0),
      leaveCount: normalizePositiveNumber(rawRecord.leaveCount, 0),
      identityQuality: normalizeText(rawRecord.identityQuality ?? normalizeIdentityQuality(playerKey)),
    };
  }

  function serializeRecord(record, options = {}) {
    const snapshotAtMs = Date.parse(options?.snapshotAt ?? "");
    const activeSegmentStartedAtMs = Date.parse(record.activeSegmentStartedAt ?? "");
    const activeSegmentMs = record.online
      && Number.isFinite(snapshotAtMs)
      && Number.isFinite(activeSegmentStartedAtMs)
      && snapshotAtMs >= activeSegmentStartedAtMs
      ? snapshotAtMs - activeSegmentStartedAtMs
      : 0;
    return {
      playerKey: record.playerKey,
      steamID: record.steamID,
      eosID: record.eosID,
      controllerID: record.controllerID,
      lastName: record.lastName,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      observedOnlineMs: record.observedOnlineMs + activeSegmentMs,
      estimatedGapMs: record.estimatedGapMs,
      online: record.online,
      activeSegmentStartedAt: record.activeSegmentStartedAt,
      onlineAtLastSave: record.onlineAtLastSave,
      joinCount: record.joinCount,
      leaveCount: record.leaveCount,
      identityQuality: record.identityQuality,
    };
  }

  function getRecord(serverId, playerIdentity = {}) {
    const state = ensureServerState(serverId);
    const playerKey = resolvePlayerKey(state, playerIdentity);
    return playerKey ? state.players.get(playerKey) ?? null : null;
  }

  function resolvePlayerKey(serverState, identity = {}) {
    const directPlayerKey = normalizeText(identity?.playerKey ?? "");
    if (directPlayerKey && serverState.players.has(directPlayerKey)) return directPlayerKey;

    const steamID = normalizeText(identity?.steamID ?? identity?.steam64ID ?? "");
    if (steamID && [...serverState.players.keys()].some((key) => key === `steam:${steamID}`)) return `steam:${steamID}`;
    const eosID = normalizeText(identity?.eosID ?? "");
    if (eosID && [...serverState.players.keys()].some((key) => key === `eos:${eosID}`)) return `eos:${eosID}`;
    const controllerID = normalizeText(identity?.controllerID ?? "");
    if (controllerID && [...serverState.players.keys()].some((key) => key === `controller:${controllerID}`)) return `controller:${controllerID}`;

    const name = normalizeText(identity?.name ?? "");
    if (!name) return "";
    return [...serverState.players.values()].find((record) => normalizeText(record.lastName).toLowerCase() === name.toLowerCase())?.playerKey ?? "";
  }

  function getPlayers(serverId = currentServerId()) {
    const state = ensureServerState(serverId);
    return [...state.players.values()].map((record) => ({
      ...serializeRecord(record),
      matchOnlineMs: getMatchOnlineMs(serverId, { playerKey: record.playerKey }),
      matchObservedOnlineSeconds: Math.floor(record.observedOnlineMs / 1000),
      matchEstimatedOnlineSeconds: Math.floor(record.estimatedGapMs / 1000),
      matchFirstSeenAt: record.firstSeenAt,
      matchLastSeenAt: record.lastSeenAt,
      matchOnline: record.online,
      matchJoinCount: record.joinCount,
    }));
  }

  function getOnlinePlayers(serverId = currentServerId()) {
    return getPlayers(serverId).filter((player) => player.matchOnline === true);
  }

  function getMatchOnlineMs(serverId, playerIdentity = {}) {
    const record = getRecord(serverId, playerIdentity);
    if (!record) return 0;
    const activeSegmentStartedAtMs = Date.parse(record.activeSegmentStartedAt ?? "");
    const activeSegmentMs = record.online && Number.isFinite(activeSegmentStartedAtMs)
      ? Math.max(0, Date.now() - activeSegmentStartedAtMs)
      : 0;
    return Math.max(0, Math.floor(
      record.observedOnlineMs
      + record.estimatedGapMs
      + activeSegmentMs,
    ));
  }

  function getExchangeEligibility(playerIdentity = {}, options = {}) {
    const serverId = normalizeText(options?.serverId ?? currentServerId());
    const requiredSeconds = normalizePositiveNumber(options?.requiredSeconds, 0);
    const matchOnlineSeconds = Math.floor(getMatchOnlineMs(serverId, playerIdentity) / 1000);
    return {
      eligible: matchOnlineSeconds >= requiredSeconds,
      serverId,
      requiredSeconds,
      matchOnlineSeconds,
      remainingSeconds: Math.max(0, requiredSeconds - matchOnlineSeconds),
      player: getPlayer(playerIdentity, serverId),
    };
  }

  function getState(serverId = currentServerId()) {
    const state = ensureServerState(serverId);
    return {
      version: state.version,
      updatedAt: state.updatedAt,
      serverId: state.serverId,
      players: getPlayers(serverId),
    };
  }

  function applyEvent(event = {}) {
    if (!enabled) return;
    const serverId = normalizeText(event.serverId ?? currentServerId());
    const state = ensureServerState(serverId);
    applyPlayersSnapshot(state, Array.isArray(event.players) ? event.players : [], normalizeText(event.time ?? new Date().toISOString()));
  }

  function resetForRoundEvent(event = {}) {
    const serverId = normalizeText(event?.serverId ?? event?.record?.serverId ?? currentServerId());
    resetState({ serverId });
    modules?.matchCache?.markDirty?.("playerMatchPresence", serverId);
  }

  function bindListeners() {
    unsubscribers.push(core.eventBus.onCoreEvent("RCON_LIST_PLAYERS_UPDATED", applyEvent));
    // match-state emits roundUpdated after accepting a new world-brought-up record.
    // The previous newRoundDetected name was never emitted, so presence data
    // incorrectly survived map changes.
    unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "roundUpdated", resetForRoundEvent));
    // Keep compatibility with older match-state implementations.
    unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "newRoundDetected", resetForRoundEvent));
  }

  function registerWithMatchCache() {
    if (!modules?.matchCache?.registerProvider) return;
    modules.matchCache.registerProvider({
      id: "playerMatchPresence",
      version: 1,
      exportState(context = {}) {
        return exportState(
          normalizeText(context?.serverId ?? currentServerId()),
          normalizeText(context?.savedAt ?? new Date().toISOString()),
        );
      },
      importState,
      resetState,
    });
  }

  function getPlayer(playerIdentity = {}, serverId = currentServerId()) {
    const record = getRecord(serverId, playerIdentity);
    if (!record) return null;
    return {
      ...serializeRecord(record),
      matchOnlineMs: getMatchOnlineMs(serverId, playerIdentity),
      matchObservedOnlineSeconds: Math.floor(record.observedOnlineMs / 1000),
      matchEstimatedOnlineSeconds: Math.floor(record.estimatedGapMs / 1000),
      matchFirstSeenAt: record.firstSeenAt,
      matchLastSeenAt: record.lastSeenAt,
      matchOnline: record.online,
      matchJoinCount: record.joinCount,
    };
  }

  async function start() {
    if (!enabled) return;
    bindListeners();
    registerWithMatchCache();
    logWithFallback(moduleLogger, "info", "MatchPlayerPresence started.", {
      label: "MODULE",
      operation: "start",
    });
  }

  async function stop() {
    modules?.matchCache?.markDirty?.("playerMatchPresence", currentServerId());
    await modules?.matchCache?.flush?.(currentServerId(), { force: true });
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    logWithFallback(moduleLogger, "info", "MatchPlayerPresence stopped.", {
      label: "MODULE",
      operation: "stop",
    });
  }

  const api = {
    getPlayer,
    getPlayers,
    getOnlinePlayers,
    getMatchOnlineMs,
    getExchangeEligibility,
    getState,
    reset() {
      resetState();
    },
  };

  return {
    manifest: {
      id: "module.matchPlayerPresence",
      name: "Match Player Presence",
      kind: "module",
      version: "0.1.0",
      description: "当前对局玩家在线时长与在场状态聚合模块。",
      hidden: true,
    },
    apiName: "matchPlayerPresence",
    api,
    start,
    stop,
  };
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function logWithFallback(logger, method, message, context) {
  const fn = logger?.[method];
  if (typeof fn === "function") {
    fn.call(logger, message, context);
    return;
  }

  const rendered = typeof message === "function" ? message() : message;
  logger?.info?.(rendered, context);
}
