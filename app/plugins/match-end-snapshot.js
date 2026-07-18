import fs from "node:fs/promises";
import path from "node:path";

const PLUGIN_ID = "match-end-snapshot";
const SNAPSHOT_DIR = path.join("data", "match-end-snapshots");
const AUTO_DEDUPE_MS = 15_000;

export function createPlugin({ core, modules, logger } = {}) {
  const pluginLogger = logger ?? core?.logger ?? console;
  const unsubscribers = [];
  let automaticCaptureInFlight = null;
  let lastAutomaticCaptureAt = 0;

  function getCurrentOverview() {
    const api = modules?.matchState?.api ?? modules?.matchState;
    const overview = api?.getOverview?.();
    if (overview) return overview;

    const state = api?.getState?.();
    if (!state) return null;
    return {
      status: core?.webStatus?.getSnapshot?.() ?? {},
      matchState: state,
      serverStatus: state.serverStatus,
      match: state.match,
      players: Array.isArray(state.players?.list) ? state.players.list : [],
      squads: Array.isArray(state.squads?.list) ? state.squads.list : [],
    };
  }

  async function captureSnapshot(triggerEvent = {}, options = {}) {
    const overview = options?.overview && typeof options.overview === "object"
      ? options.overview
      : getCurrentOverview();
    if (!overview) {
      pluginLogger.warn?.("[MatchEndSnapshot] match-state overview is unavailable.");
      return null;
    }

    const capturedAt = new Date().toISOString();
    const payload = buildSnapshotPayload({
      overview,
      triggerEvent,
      capturedAt,
      modules,
    });
    const id = buildSnapshotId(payload);
    await ensureSnapshotDir();
    await writeJsonAtomic(path.join(resolveSnapshotDir(), id + ".json"), payload);
    pluginLogger.info?.("[MatchEndSnapshot] saved " + id + ".");
    return describePayload(id, payload);
  }

  function captureAutomatic(triggerEvent = {}) {
    const now = Date.now();
    if (automaticCaptureInFlight) return automaticCaptureInFlight;
    if (now - lastAutomaticCaptureAt < AUTO_DEDUPE_MS) {
      pluginLogger.info?.("[MatchEndSnapshot] skipped duplicate match-end event.");
      return Promise.resolve(null);
    }

    const overview = getCurrentOverview();
    automaticCaptureInFlight = captureSnapshot(triggerEvent, { overview })
      .then((item) => {
        if (item) lastAutomaticCaptureAt = Date.now();
        return item;
      })
      .finally(() => {
        automaticCaptureInFlight = null;
      });
    return automaticCaptureInFlight;
  }

  async function listSnapshots() {
    await ensureSnapshotDir();
    const names = await fs.readdir(resolveSnapshotDir());
    const items = await Promise.all(
      names
        .filter((name) => name.endsWith(".json") && !name.endsWith(".tmp.json"))
        .map(async (name) => {
          try {
            const id = name.slice(0, -5);
            const filePath = path.join(resolveSnapshotDir(), name);
            const [text, stat] = await Promise.all([
              fs.readFile(filePath, "utf8"),
              fs.stat(filePath),
            ]);
            const payload = JSON.parse(text);
            return {
              ...describePayload(id, payload),
              size: stat.size,
              createdAt: payload?.capturedAt || stat.mtime.toISOString(),
            };
          } catch (error) {
            pluginLogger.warn?.("[MatchEndSnapshot] ignored unreadable snapshot " + name + ": " + (error?.message || error));
            return null;
          }
        }),
    );
    return items
      .filter(Boolean)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  async function readSnapshot(id) {
    await ensureSnapshotDir();
    const safeId = sanitizeId(id);
    const content = await fs.readFile(path.join(resolveSnapshotDir(), safeId + ".json"), "utf8");
    return JSON.parse(content);
  }

  async function deleteSnapshot(id) {
    await ensureSnapshotDir();
    const safeId = sanitizeId(id);
    try {
      await fs.unlink(path.join(resolveSnapshotDir(), safeId + ".json"));
      return { id: safeId, removed: true };
    } catch (error) {
      if (error?.code === "ENOENT") return { id: safeId, removed: false };
      throw error;
    }
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "对局结束数据快照",
      kind: "plugin",
      version: "1.0.0",
      description: "Persist versioned JSON records when a match ends.",
    },
    apiName: "matchEndSnapshot",
    api: {
      captureSnapshot,
      takeManualSnapshot: (options = {}) => captureSnapshot({ eventName: "MANUAL_TRIGGER" }, options),
      listSnapshots,
      readSnapshot,
      deleteSnapshot,
    },

    async start() {
      if (core?.eventBus?.onCoreEvent) {
        unsubscribers.push(core.eventBus.onCoreEvent("round.match_winner", (event) => {
          captureAutomatic(event).catch((error) => {
            pluginLogger.error?.("[MatchEndSnapshot] round.match_winner capture failed: " + (error?.stack || error));
          });
        }));
        unsubscribers.push(core.eventBus.onCoreEvent("MATCH_END", (event) => {
          captureAutomatic(event).catch((error) => {
            pluginLogger.error?.("[MatchEndSnapshot] MATCH_END capture failed: " + (error?.stack || error));
          });
        }));
      }
      pluginLogger.info?.("[MatchEndSnapshot] plugin started.");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe?.();
        } catch {}
      }
      pluginLogger.info?.("[MatchEndSnapshot] plugin stopped.");
    },
  };
}

function buildSnapshotPayload({ overview, triggerEvent, capturedAt, modules }) {
  const matchState = objectValue(overview?.matchState);
  const status = objectValue(overview?.status);
  const serverStatus = {
    ...objectValue(matchState?.serverStatus),
    ...objectValue(overview?.serverStatus),
  };
  const match = {
    ...objectValue(matchState?.match),
    ...objectValue(overview?.match),
  };
  const squads = normalizeSquads(
    Array.isArray(overview?.squads)
      ? overview.squads
      : Array.isArray(matchState?.squads?.list)
        ? matchState.squads.list
        : [],
  );
  let players = normalizePlayers(
    Array.isArray(overview?.players)
      ? overview.players
      : Array.isArray(matchState?.players?.list)
        ? matchState.players.list
        : [],
  );
  players = enrichPlayersWithBzssCore(players, modules);
  players = attachSquadInfo(players, squads);

  const nextLayer = firstText(match.nextLayer, status.nextLayer, serverStatus.nextLayer);
  const nextMap = firstText(
    match.nextMap,
    status.nextMap,
    serverStatus.nextMap,
    deriveMapNameFromLayer(nextLayer),
  );
  const currentMap = firstText(match.map, status.map, serverStatus.map, status.currentMap);
  const currentLayer = firstText(match.layer, status.layer, serverStatus.layer, status.currentLayer);
  const playerCount = firstNumber(
    status.playerCount,
    serverStatus.playerCount,
    match.playerCount,
    players.length,
  ) ?? players.length;

  return {
    schemaVersion: 1,
    snapshotType: "match-end-data",
    capturedAt,
    trigger: {
      eventName: firstText(triggerEvent?.eventName, triggerEvent?.type, "MATCH_END"),
      winner: firstText(triggerEvent?.winner, triggerEvent?.winningTeam, triggerEvent?.team),
    },
    server: {
      serverId: firstText(matchState?.serverId, overview?.serverId, status.serverId),
      serverName: firstText(status.serverName, status.name, serverStatus.serverName, serverStatus.name),
      playerCount,
      queueCount: firstNumber(status.queueCount, serverStatus.queueCount, match.queueCount) ?? 0,
    },
    match: {
      map: currentMap,
      layer: currentLayer,
      mode: firstText(match.mode, match.gameMode, status.mode, status.gameMode, serverStatus.mode, serverStatus.gameMode),
      nextMap,
      nextLayer,
      playtime: firstNumber(match.playtime, status.playtime, serverStatus.playtime, status.matchTimeSeconds),
    },
    summary: {
      playerCount,
      recordedPlayerCount: players.length,
      squadCount: squads.length,
      bzssCorePlayerCount: players.filter((player) => player.bzssCore?.available).length,
    },
    players,
    squads,
    source: {
      matchStateUpdatedAt: firstText(matchState?.updatedAt, matchState?.players?.lastUpdatedAt),
      bzssCoreUpdatedAt: firstText(
        (modules?.bzssCoreMonitor?.api ?? modules?.bzssCoreMonitor)?.getState?.()?.updatedAt,
      ),
    },
  };
}

function normalizePlayers(players) {
  return players.map((player) => ({
    playerID: nullableNumber(player?.playerID ?? player?.playerId ?? player?.id),
    name: firstText(player?.name, player?.playerName, "Unknown"),
    steamID: firstText(player?.steamID, player?.steamId, player?.steam64ID),
    eosID: firstText(player?.eosID, player?.eosId, player?.EOSID),
    teamID: nullableNumber(player?.teamID ?? player?.teamId),
    squadID: nullableNumber(player?.squadID ?? player?.squadId),
    role: firstText(player?.role, player?.roleName),
    isLeader: Boolean(player?.isLeader ?? player?.leader),
    isCommander: Boolean(player?.isCommander ?? player?.commander),
    health: nullableNumber(player?.health),
    bzssCore: null,
  }));
}

function normalizeSquads(squads) {
  return squads.map((squad) => ({
    teamID: nullableNumber(squad?.teamID ?? squad?.teamId),
    squadID: nullableNumber(squad?.squadID ?? squad?.squadId),
    teamName: firstText(squad?.teamName),
    squadName: firstText(squad?.squadName, squad?.name),
    size: nullableNumber(squad?.size ?? squad?.memberCount),
    locked: Boolean(squad?.locked),
    creatorName: firstText(squad?.creatorName),
  })).sort((left, right) =>
    compareNumbers(left.teamID, right.teamID)
    || compareNumbers(left.squadID, right.squadID));
}

function enrichPlayersWithBzssCore(players, modules) {
  const api = modules?.bzssCoreMonitor?.api ?? modules?.bzssCoreMonitor;
  const corePlayers = typeof api?.getPlayers === "function" ? api.getPlayers() : [];
  if (!Array.isArray(corePlayers) || corePlayers.length === 0) return players;

  const byId = new Map();
  const byIdentity = new Map();
  for (const corePlayer of corePlayers) {
    for (const value of [corePlayer?.playerId, corePlayer?.playerIndex]) {
      const id = nullableNumber(value);
      if (id != null) byId.set(id, corePlayer);
    }
    for (const value of [
      corePlayer?.steamID,
      corePlayer?.steamId,
      corePlayer?.eosID,
      corePlayer?.eosId,
      corePlayer?.playerGuid,
      corePlayer?.playerName,
      corePlayer?.name,
    ]) {
      const key = normalizeIdentity(value);
      if (key) byIdentity.set(key, corePlayer);
    }
  }

  return players.map((player) => {
    let corePlayer = player.playerID != null ? byId.get(player.playerID) : null;
    if (!corePlayer) {
      for (const value of [player.steamID, player.eosID, player.name]) {
        const key = normalizeIdentity(value);
        if (key && byIdentity.has(key)) {
          corePlayer = byIdentity.get(key);
          break;
        }
      }
    }
    if (!corePlayer) return player;

    const stats = objectValue(corePlayer?.playerScoreboard?.stats);
    const health = firstNumber(corePlayer?.soldierInfo?.health, corePlayer?.health, player.health);
    const soldierClass = firstText(corePlayer?.soldierInfo?.soldierClass, corePlayer?.soldierClass);
    return {
      ...player,
      role: firstText(player.role, soldierClass),
      health,
      bzssCore: {
        available: true,
        observedAt: firstText(
          corePlayer?.observedAt,
          corePlayer?.lastSeenAt,
          corePlayer?.runtimeObservedAt,
          corePlayer?.scoreboardObservedAt,
        ),
        stale: Boolean(corePlayer?.stale),
        health,
        soldierClass,
        kills: firstNumber(stats.numKills, corePlayer?.kills) ?? 0,
        downs: firstNumber(stats.numWoundeds, corePlayer?.woundeds) ?? 0,
        deaths: firstNumber(stats.numDeaths, corePlayer?.deaths) ?? 0,
        teamKills: firstNumber(stats.numTeamKills, corePlayer?.teamKills) ?? 0,
        vehicleKills: firstNumber(stats.vehicleKills, corePlayer?.vehicleKills) ?? 0,
        revives: firstNumber(stats.revivedPoints, corePlayer?.revivedPoints) ?? 0,
        healPoints: firstNumber(stats.healPoints, corePlayer?.healPoints) ?? 0,
        combatScore: firstNumber(stats.combatScore, corePlayer?.combatScore) ?? 0,
        objectiveScore: firstNumber(stats.objectiveScore, corePlayer?.objectiveScore) ?? 0,
        teamworkScore: firstNumber(stats.teamworkScore, corePlayer?.teamworkScore) ?? 0,
        ping: firstNumber(corePlayer?.ping, corePlayer?.playerScoreboard?.ping, stats.ping),
      },
    };
  });
}

function attachSquadInfo(players, squads) {
  const byKey = new Map(
    squads.map((squad) => [squadKey(squad.teamID, squad.squadID), squad]),
  );
  return players.map((player) => {
    const squad = player.squadID == null
      ? null
      : byKey.get(squadKey(player.teamID, player.squadID)) ?? null;
    return {
      ...player,
      squadInfo: squad
        ? {
            teamID: squad.teamID,
            squadID: squad.squadID,
            name: squad.squadName,
            size: squad.size,
            locked: squad.locked,
          }
        : null,
    };
  });
}

function describePayload(id, payload) {
  return {
    id,
    capturedAt: firstText(payload?.capturedAt),
    map: firstText(payload?.match?.map),
    layer: firstText(payload?.match?.layer),
    nextMap: firstText(payload?.match?.nextMap),
    nextLayer: firstText(payload?.match?.nextLayer),
    playerCount: firstNumber(payload?.server?.playerCount, payload?.summary?.playerCount) ?? 0,
    queueCount: firstNumber(payload?.server?.queueCount) ?? 0,
    winner: firstText(payload?.trigger?.winner),
    schemaVersion: firstNumber(payload?.schemaVersion) ?? 1,
  };
}

function buildSnapshotId(payload) {
  const time = String(payload.capturedAt || new Date().toISOString())
    .replace(/[-:]/g, "")
    .replace(".", "_")
    .replace("Z", "Z");
  const layer = sanitizeSegment(payload?.match?.layer || payload?.match?.map || "unknown");
  return time + "_" + layer;
}

function sanitizeId(value) {
  const safe = path.basename(String(value ?? "").trim()).replace(/\.json$/i, "");
  if (!safe || !/^[a-zA-Z0-9_.-]+$/.test(safe)) {
    const error = new Error("Invalid snapshot id.");
    error.code = "InvalidSnapshotId";
    error.statusCode = 400;
    throw error;
  }
  return safe;
}

function sanitizeSegment(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";
}

function deriveMapNameFromLayer(layer) {
  const value = String(layer ?? "").trim();
  if (!value) return "";
  return value.replace(/_(?:RAAS|AAS|Invasion|TC|Seed|Skirmish|Destruction|Insurgency|Jensen(?:sRange)?)(?:_v\d+)?$/i, "");
}

function normalizeIdentity(value) {
  return String(value ?? "").trim().toLowerCase();
}

function squadKey(teamID, squadID) {
  return String(teamID ?? "") + ":" + String(squadID ?? "");
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (value != null && value !== "" && Number.isFinite(number)) return number;
  }
  return null;
}

function nullableNumber(value) {
  const number = Number(value);
  return value == null || value === "" || !Number.isFinite(number) ? null : number;
}

function compareNumbers(left, right) {
  return Number(left ?? Number.MAX_SAFE_INTEGER) - Number(right ?? Number.MAX_SAFE_INTEGER);
}

function objectValue(value) {
  return value && typeof value === "object" ? value : {};
}

function resolveSnapshotDir() {
  return path.resolve(process.cwd(), SNAPSHOT_DIR);
}

async function ensureSnapshotDir() {
  await fs.mkdir(resolveSnapshotDir(), { recursive: true });
}

async function writeJsonAtomic(filePath, payload) {
  const tempPath = filePath + "." + process.pid + ".tmp";
  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2) + "\\n", "utf8");
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}
