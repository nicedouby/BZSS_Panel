import fs from "node:fs/promises";
import path from "node:path";

import { generateMatchEndSnapshotBundle } from "./match-end-snapshot-pages.js";
import { resolvePlayerFireTeam } from "./match-end-snapshot-fireteam.js";

const PLUGIN_ID = "match-end-snapshot";
const SNAPSHOT_DIR = path.join("data", "match-end-snapshots");
const AUTO_DEDUPE_MS = 30_000;
const AUTO_SETTLE_MS = 1_800;

export function createPlugin({ core, modules, logger } = {}) {
  const pluginLogger = logger ?? core?.logger ?? console;
  const taskManager = core?.taskManager ?? null;
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
    const payload = await buildSnapshotPayload({
      overview,
      triggerEvent,
      capturedAt,
      modules,
    });
    const id = buildSnapshotId(payload);
    const coverage = payload.summary?.fireTeamCounts ?? {};
    pluginLogger.info?.("[MatchEndSnapshot] fireteam coverage: A=" + (coverage.A ?? 0)
      + " B=" + (coverage.B ?? 0) + " C=" + (coverage.C ?? 0)
      + " unknown=" + (coverage.unknown ?? 0) + " total=" + payload.players.length
      + " sources=" + JSON.stringify(payload.summary?.fireTeamSourceCounts ?? {}));
    await ensureSnapshotDir();

    let task = null;
    payload.artifacts = {
      format: "single-scoreboard",
      status: "queued",
      pageCount: 0,
      primaryImage: "",
      combinedImage: "",
      manifest: "",
      pages: [],
    };
    await writeJsonAtomic(path.join(resolveSnapshotDir(), id + ".json"), payload);

    if (taskManager) {
      try {
        task = await taskManager.enqueue({
          type: "snapshot.generate",
          priority: 5,
          maxRetry: 2,
          payload: {
            payload,
            snapshotId: id,
            snapshotDirectory: SNAPSHOT_DIR,
          },
        });
      } catch (error) {
        payload.artifacts.status = "failed";
        payload.artifacts.error = String(error?.message ?? error);
        pluginLogger.error?.("[MatchEndSnapshot] snapshot task enqueue failed for " + id + ": " + (error?.stack || error));
        await writeJsonAtomic(path.join(resolveSnapshotDir(), id + ".json"), payload);
      }
    } else {
      payload.artifacts.status = "failed";
      payload.artifacts.error = "TaskManager is unavailable.";
      await writeJsonAtomic(path.join(resolveSnapshotDir(), id + ".json"), payload);
    }

    const item = {
      ...describePayload(id, payload),
      imageAvailable: false,
      pageCount: 0,
      taskId: task?.taskId ?? null,
      pages: [],
    };
    pluginLogger.info?.(
      "[MatchEndSnapshot] queued " + id +
      " for scoreboard rendering" +
      (task?.taskId ? " (" + task.taskId + ")." : "."),
    );

    return item;
  }

  function captureAutomatic(triggerEvent = {}) {
    const now = Date.now();
    if (automaticCaptureInFlight) return automaticCaptureInFlight;
    if (now - lastAutomaticCaptureAt < AUTO_DEDUPE_MS) {
      pluginLogger.info?.("[MatchEndSnapshot] skipped duplicate match-end event.");
      return Promise.resolve(null);
    }

    const initialOverview = getCurrentOverview();
    automaticCaptureInFlight = (async () => {
      await delay(AUTO_SETTLE_MS);
      const settledOverview = getCurrentOverview();
      const overview = chooseOverview(initialOverview, settledOverview);
      const item = await captureSnapshot(triggerEvent, { overview });
      if (item) lastAutomaticCaptureAt = Date.now();
      return item;
    })().finally(() => {
      automaticCaptureInFlight = null;
    });
    return automaticCaptureInFlight;
  }

  async function handleSnapshotTaskDone(task) {
    if (task?.type !== "snapshot.generate") return;
    const snapshotId = String(task?.result?.snapshotId ?? task?.snapshotId ?? task?.payload?.snapshotId ?? "");
    if (!snapshotId) return;
    try {
      const safeId = sanitizeId(snapshotId);
      const snapshotPath = path.join(resolveSnapshotDir(), safeId + ".json");
      const payload = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
      payload.artifacts = {
        format: "single-scoreboard",
        status: "done",
        pageCount: Number(task.result?.pageCount ?? 0),
        primaryImage: task.result?.primaryImage ?? safeId + ".png",
        combinedImage: task.result?.combinedImage ?? safeId + "-combined.png",
        manifest: task.result?.manifest ?? safeId + "-manifest.json",
        pages: Array.isArray(task.result?.pages) ? task.result.pages : [],
      };
      await writeJsonAtomic(snapshotPath, payload);
      core?.eventBus?.emitCoreEvent?.("match.snapshot.ready", {
        snapshotId: safeId,
        roundKey: buildRoundKey(payload),
        pageCount: payload.artifacts.pageCount,
        pages: payload.artifacts.pages,
        primaryImage: payload.artifacts.primaryImage,
        combinedImage: payload.artifacts.combinedImage,
        taskId: task.id,
      });
    } catch (error) {
      pluginLogger.error?.("[MatchEndSnapshot] failed to finalize task " + task.id + ": " + (error?.stack || error));
    }
  }

  async function handleSnapshotTaskFailed(task) {
    if (task?.type !== "snapshot.generate") return;
    const snapshotId = String(task?.result?.snapshotId ?? task?.payload?.snapshotId ?? "");
    if (!snapshotId) return;
    try {
      const safeId = sanitizeId(snapshotId);
      const snapshotPath = path.join(resolveSnapshotDir(), safeId + ".json");
      const payload = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
      payload.artifacts = {
        ...(payload.artifacts ?? {}),
        status: "failed",
        error: task.error?.message ?? "Snapshot task failed.",
      };
      await writeJsonAtomic(snapshotPath, payload);
    } catch (error) {
      pluginLogger.error?.("[MatchEndSnapshot] failed to record task error: " + (error?.stack || error));
    }
  }

  async function listSnapshots() {
    await ensureSnapshotDir();
    const names = await fs.readdir(resolveSnapshotDir());
    const items = await Promise.all(
      names
        .filter((name) => name.endsWith(".json") && !name.endsWith("-manifest.json") && !name.endsWith(".tmp.json"))
        .map(async (name) => {
          try {
            const id = name.slice(0, -5);
            const filePath = path.join(resolveSnapshotDir(), name);
            const [text, stat, imageAvailable, manifest] = await Promise.all([
              fs.readFile(filePath, "utf8"),
              fs.stat(filePath),
              fileExists(path.join(resolveSnapshotDir(), id + ".png")),
              readManifestIfExists(id),
            ]);
            const payload = JSON.parse(text);
            return {
              ...describePayload(id, payload),
              size: stat.size,
              imageAvailable,
              pageCount: Number(manifest?.pageCount ?? payload?.artifacts?.pageCount ?? 0),
              pages: Array.isArray(manifest?.pages) ? manifest.pages : payload?.artifacts?.pages ?? [],
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

  async function readSnapshotManifest(id, options = {}) {
    await ensureSnapshotDir();
    const safeId = sanitizeId(id);
    if (options?.force || !(await fileExists(path.join(resolveSnapshotDir(), safeId + "-manifest.json")))) {
      await regenerateBundle(safeId);
    }
    const content = await fs.readFile(path.join(resolveSnapshotDir(), safeId + "-manifest.json"), "utf8");
    return JSON.parse(content);
  }

  async function readSnapshotPage(id, page = 0, options = {}) {
    const safeId = sanitizeId(id);
    const manifest = await readSnapshotManifest(safeId, options);
    const pageIndex = normalizePageIndex(page, manifest.pages);
    const pageMeta = manifest.pages[pageIndex];
    if (!pageMeta?.fileName) {
      const error = new Error("Snapshot page was not found.");
      error.code = "SnapshotPageNotFound";
      error.statusCode = 404;
      throw error;
    }
    const content = await fs.readFile(path.join(resolveSnapshotDir(), path.basename(pageMeta.fileName)));
    return {
      ...pageMeta,
      id: safeId,
      contentType: "image/png",
      content,
    };
  }

  async function readSnapshotImage(id, options = {}) {
    const safeId = sanitizeId(id);
    if (options?.page != null) {
      return readSnapshotPage(safeId, options.page, options);
    }
    const combined = Boolean(options?.combined);
    const fileName = combined ? safeId + "-combined.png" : safeId + ".png";
    const imagePath = path.join(resolveSnapshotDir(), fileName);
    if (options?.force || !(await fileExists(imagePath))) {
      await regenerateBundle(safeId);
    }
    return {
      id: safeId,
      fileName,
      contentType: "image/png",
      content: await fs.readFile(imagePath),
    };
  }

  async function regenerateBundle(id) {
    const safeId = sanitizeId(id);
    const payload = await readSnapshot(safeId);
    payload.players = await enrichPlayersWithDatabaseAvatar(
      Array.isArray(payload?.players) ? payload.players : [],
      modules,
    );

    if (taskManager) {
      const task = await taskManager.enqueue({
        type: "snapshot.generate",
        priority: 5,
        maxRetry: 2,
        payload: {
          payload,
          snapshotId: safeId,
          snapshotDirectory: SNAPSHOT_DIR,
        },
      });
      await taskManager.waitForTask(task.taskId);
      const manifest = JSON.parse(await fs.readFile(
        path.join(resolveSnapshotDir(), safeId + "-manifest.json"),
        "utf8",
      ));
      payload.artifacts = {
        format: "single-scoreboard",
        status: "done",
        pageCount: manifest.pageCount ?? manifest.pages?.length ?? 0,
        primaryImage: safeId + ".png",
        combinedImage: safeId + "-combined.png",
        manifest: safeId + "-manifest.json",
        pages: manifest.pages ?? [],
      };
      await writeJsonAtomic(path.join(resolveSnapshotDir(), safeId + ".json"), payload);
      return manifest;
    }

    const bundle = await generateMatchEndSnapshotBundle(payload, { snapshotId: safeId });
    await persistBundle(safeId, bundle);
    payload.artifacts = {
      format: "single-scoreboard",
      status: "done",
      pageCount: bundle.pages.length,
      primaryImage: safeId + ".png",
      combinedImage: safeId + "-combined.png",
      manifest: safeId + "-manifest.json",
      pages: bundle.manifest.pages,
    };
    await writeJsonAtomic(path.join(resolveSnapshotDir(), safeId + ".json"), payload);
    return bundle;
  }

  async function deleteSnapshot(id) {
    await ensureSnapshotDir();
    const safeId = sanitizeId(id);
    const names = await fs.readdir(resolveSnapshotDir());
    const targets = names.filter((name) =>
      name === safeId + ".json"
      || name === safeId + ".png"
      || name === safeId + "-combined.png"
      || name === safeId + "-manifest.json"
      || /^\d{2}-/.test(name.slice(safeId.length + 1)) && name.startsWith(safeId + "-"),
    );
    const removedFiles = [];
    for (const name of targets) {
      try {
        await fs.unlink(path.join(resolveSnapshotDir(), name));
        removedFiles.push(name);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    return { id: safeId, removed: removedFiles.length > 0, removedFiles };
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "对局结束数据快照",
      kind: "plugin",
      version: "1.2.0",
      description: "Persist versioned match-end data and generate fixed 1600x900 cover and paged team scoreboard images.",
    },
    apiName: "matchEndSnapshot",
    api: {
      captureSnapshot,
      takeManualSnapshot: (options = {}) => captureSnapshot({ eventName: "MANUAL_TRIGGER" }, options),
      listSnapshots,
      readSnapshot,
      readSnapshotManifest,
      readSnapshotPage,
      readSnapshotImage,
      deleteSnapshot,
    },

    async start() {
      if (taskManager) {
        taskManager.on("done", handleSnapshotTaskDone);
        taskManager.on("failed", handleSnapshotTaskFailed);
        unsubscribers.push(() => taskManager.off("done", handleSnapshotTaskDone));
        unsubscribers.push(() => taskManager.off("failed", handleSnapshotTaskFailed));
      }
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

async function buildSnapshotPayload({ overview, triggerEvent, capturedAt, modules }) {
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
  players = await enrichPlayersWithDatabaseAvatar(players, modules);
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
  const fireTeamCounts = { A: 0, B: 0, C: 0, unknown: 0 };
  const fireTeamSourceCounts = {};
  for (const player of players) {
    if (player.fireTeam === "A" || player.fireTeam === "B" || player.fireTeam === "C") fireTeamCounts[player.fireTeam] += 1;
    else fireTeamCounts.unknown += 1;
    const source = player.fireTeamSource || "unknown";
    fireTeamSourceCounts[source] = (fireTeamSourceCounts[source] || 0) + 1;
  }

  const playerCount = firstNumber(
    status.playerCount,
    serverStatus.playerCount,
    match.playerCount,
    players.length,
  ) ?? players.length;

  return {
    schemaVersion: 2,
    snapshotType: "match-end-data",
    capturedAt,
    trigger: {
      eventName: firstText(triggerEvent?.eventName, triggerEvent?.type, "MATCH_END"),
      winner: firstText(triggerEvent?.winner, triggerEvent?.winningTeam, triggerEvent?.team),
      raw: cloneJsonSafe(triggerEvent ?? {}),
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
      fireTeamCounts,
      fireTeamSourceCounts,
      teamCounts: Object.fromEntries(
        [...new Set(players.map((player) => player.teamID).filter((value) => value != null))]
          .map((teamID) => [String(teamID), players.filter((player) => player.teamID === teamID).length]),
      ),
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
  return players.map((player) => {
    const fireTeamInfo = resolvePlayerFireTeam(player, null);
    return {
      playerID: nullableNumber(player?.playerID ?? player?.playerId ?? player?.id),
      name: firstText(player?.name, player?.playerName, "Unknown"),
      steamID: firstText(player?.steamID, player?.steamId, player?.steam64ID, player?.steam64),
      eosID: firstText(player?.eosID, player?.eosId, player?.EOSID),
      controllerID: firstText(player?.controllerID, player?.controllerId),
      teamID: nullableNumber(player?.teamID ?? player?.teamId),
      squadID: nullableNumber(player?.squadID ?? player?.squadId),
      ...fireTeamInfo,
      role: firstText(player?.role, player?.roleName),
      isLeader: Boolean(player?.isLeader ?? player?.leader),
      isCommander: Boolean(player?.isCommander ?? player?.commander),
      online: player?.online !== false,
      health: nullableNumber(player?.health),
      steamAvatar: firstText(
        player?.steamAvatar,
        player?.steam_avatar,
        player?.avatarUrl,
        player?.avatar,
        player?.steamAvatarUrl,
        player?.steamProfile?.avatarFull,
        player?.steamProfile?.avatar_full,
        player?.steam?.avatar,
        player?.profile?.avatar,
      ),
      bzssCore: null,
    };
  });
}

function normalizeSquads(squads) {
  return squads.map((squad) => ({
    teamID: nullableNumber(squad?.teamID ?? squad?.teamId),
    squadID: nullableNumber(squad?.squadID ?? squad?.squadId),
    teamName: firstText(squad?.teamName),
    factionCode: firstText(squad?.factionCode, squad?.faction, squad?.teamFactionCode, squad?.teamFaction),
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
  const byStrongIdentity = new Map();
  const byTeamName = new Map();
  const byName = new Map();

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
      corePlayer?.controllerID,
      corePlayer?.controllerId,
    ]) {
      const key = normalizeIdentity(value);
      if (key) byStrongIdentity.set(key, corePlayer);
    }
    const name = normalizeIdentity(firstText(corePlayer?.playerName, corePlayer?.name));
    const teamID = nullableNumber(corePlayer?.teamId ?? corePlayer?.teamID);
    if (name && teamID != null) byTeamName.set(teamID + ":" + name, corePlayer);
    if (name) {
      if (!byName.has(name)) byName.set(name, corePlayer);
      else byName.set(name, null);
    }
  }

  return players.map((player) => {
    let corePlayer = null;
    for (const value of [player.steamID, player.eosID, player.controllerID]) {
      const key = normalizeIdentity(value);
      if (key && byStrongIdentity.has(key)) {
        corePlayer = byStrongIdentity.get(key);
        break;
      }
    }
    if (!corePlayer && player.playerID != null) corePlayer = byId.get(player.playerID) ?? null;
    if (!corePlayer) {
      const name = normalizeIdentity(player.name);
      const teamNameKey = player.teamID != null && name ? player.teamID + ":" + name : "";
      if (teamNameKey && byTeamName.has(teamNameKey)) corePlayer = byTeamName.get(teamNameKey);
      else if (name && byName.get(name)) corePlayer = byName.get(name);
    }
    if (!corePlayer) return player;

    const stats = objectValue(corePlayer?.playerScoreboard?.stats);
    const health = firstNumber(corePlayer?.soldierInfo?.health, corePlayer?.health, player.health);
    const soldierClass = firstText(corePlayer?.soldierInfo?.soldierClass, corePlayer?.soldierClass);
    const fireTeamInfo = resolvePlayerFireTeam(player, corePlayer);
    return {
      ...player,
      ...fireTeamInfo,
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
        fireTeamIndex: firstNumber(corePlayer?.ftIndex, corePlayer?.fireTeamIndex),
        fireTeamPosition: firstNumber(corePlayer?.ftPosition, corePlayer?.fireTeamPosition),
        dataLives: firstNumber(stats.dataLives, corePlayer?.dataLives),
        kills: firstNumber(stats.numKills, corePlayer?.kills) ?? 0,
        vehicleKills: firstNumber(stats.vehicleKills, corePlayer?.vehicleKills) ?? 0,
        deaths: firstNumber(stats.numDeaths, corePlayer?.deaths) ?? 0,
        downs: firstNumber(stats.numWoundeds, corePlayer?.woundeds) ?? 0,
        wounds: firstNumber(stats.numWounds, corePlayer?.wounds) ?? 0,
        teamKills: firstNumber(stats.numTeamKills, corePlayer?.teamKills) ?? 0,
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

async function enrichPlayersWithDatabaseAvatar(players, modules) {
  const api = modules?.playerDatabase?.api ?? modules?.playerDatabase;
  if (typeof api?.listPlayersByIdentities !== "function" || !players.length) return players;

  const steamIDs = players.map((player) => firstText(player?.steamID)).filter(Boolean);
  const eosIDs = players.map((player) => firstText(player?.eosID)).filter(Boolean);
  if (!steamIDs.length && !eosIDs.length) return players;

  try {
    const rows = await api.listPlayersByIdentities({ steamIDs, eosIDs });
    const bySteam = new Map();
    const byEos = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const steamID = firstText(row?.steam_id, row?.steamID);
      const eosID = firstText(row?.eos_id, row?.eosID);
      if (steamID) bySteam.set(steamID, row);
      if (eosID) byEos.set(eosID, row);
    }
    return players.map((player) => {
      const databasePlayer = bySteam.get(firstText(player?.steamID)) ?? byEos.get(firstText(player?.eosID)) ?? null;
      const databaseAvatar = firstText(
        databasePlayer?.steam_avatar,
        databasePlayer?.steamAvatar,
        databasePlayer?.avatar_full,
        databasePlayer?.avatarFull,
        databasePlayer?.avatar_medium,
        databasePlayer?.avatarMedium,
      );
      if (!databaseAvatar && !player?.steamAvatar) return player;
      return {
        ...player,
        steamAvatar: firstText(player?.steamAvatar, databaseAvatar),
        avatarSource: player?.steamAvatar ? "match-state" : "player-database",
      };
    });
  } catch {
    return players;
  }
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
            teamName: squad.teamName,
            factionCode: squad.factionCode,
            size: squad.size,
            locked: squad.locked,
            creatorName: squad.creatorName,
          }
        : null,
    };
  });
}

async function persistBundle(id, bundle) {
  const dir = resolveSnapshotDir();
  for (const page of bundle.pages) {
    await writeBufferAtomic(path.join(dir, page.fileName), page.buffer);
  }
  const cover = bundle.pages.find((page) => page.type === "cover") ?? bundle.pages[0];
  if (cover?.buffer) await writeBufferAtomic(path.join(dir, id + ".png"), cover.buffer);
  await writeBufferAtomic(path.join(dir, id + "-combined.png"), bundle.combinedBuffer);
  await writeJsonAtomic(path.join(dir, id + "-manifest.json"), bundle.manifest);
}

async function readManifestIfExists(id) {
  try {
    const text = await fs.readFile(path.join(resolveSnapshotDir(), id + "-manifest.json"), "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizePageIndex(page, pages) {
  const numeric = Number(page);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric < pages.length) return numeric;
  const text = String(page ?? "").trim().toLowerCase();
  const index = pages.findIndex((item) =>
    String(item?.fileName ?? "").toLowerCase() === text
    || String(item?.type ?? "").toLowerCase() === text
    || (item?.teamId != null && `team${item.teamId}` === text),
  );
  if (index >= 0) return index;
  const error = new Error("Invalid snapshot page.");
  error.code = "InvalidSnapshotPage";
  error.statusCode = 400;
  throw error;
}

function chooseOverview(initialOverview, settledOverview) {
  if (!initialOverview) return settledOverview;
  if (!settledOverview) return initialOverview;
  const initialCount = overviewPlayerCount(initialOverview);
  const settledCount = overviewPlayerCount(settledOverview);
  return settledCount >= initialCount ? settledOverview : initialOverview;
}

function overviewPlayerCount(overview) {
  if (Array.isArray(overview?.players)) return overview.players.length;
  if (Array.isArray(overview?.matchState?.players?.list)) return overview.matchState.players.list.length;
  return 0;
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
    schemaVersion: firstNumber(payload?.schemaVersion) ?? 2,
  };
}

function buildRoundKey(payload) {
  return [
    firstText(payload?.server?.serverId, "server"),
    firstText(payload?.match?.layer, payload?.match?.map, "unknown"),
    firstText(payload?.capturedAt).slice(0, 16),
  ].join(":");
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
  const safe = path.basename(String(value ?? "").trim()).replace(/\.(json|png)$/i, "");
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

function cloneJsonSafe(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function resolveSnapshotDir() {
  return path.resolve(process.cwd(), SNAPSHOT_DIR);
}

async function ensureSnapshotDir() {
  await fs.mkdir(resolveSnapshotDir(), { recursive: true });
}

async function writeJsonAtomic(filePath, payload) {
  const tempPath = filePath + "." + process.pid + ".tmp";
  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  try {
    await replaceFile(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function writeBufferAtomic(filePath, content) {
  const tempPath = filePath + "." + process.pid + ".tmp";
  await fs.writeFile(tempPath, content);
  try {
    await replaceFile(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function replaceFile(tempPath, filePath) {
  await fs.rm(filePath, { force: true });
  await fs.rename(tempPath, filePath);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    if (typeof timer.unref === "function") timer.unref();
  });
}
