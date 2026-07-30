import fs from "node:fs/promises";
import path from "node:path";

import { generateMatchEndSnapshotBundle } from "./match-end-snapshot-pages.js";
import { resolvePlayerFireTeam } from "./match-end-snapshot-fireteam.js";

const PLUGIN_ID = "match-end-snapshot";
const SNAPSHOT_DIR = path.join("data", "match-end-snapshots");
const DEBUG_SNAPSHOT_DIR = path.join("data", "match-end-snapshot-debug");
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
      thumbnailImage: "",
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
      try {
        const bundle = await generateMatchEndSnapshotBundle(payload, { snapshotId: id });
        await persistBundle(id, bundle);
        payload.artifacts = {
          format: "single-scoreboard",
          status: "done",
          pageCount: bundle.pages?.length ?? 0,
          primaryImage: id + ".png",
          combinedImage: id + "-combined.png",
          thumbnailImage: id + "-thumb.png",
          manifest: id + "-manifest.json",
          pages: bundle.manifest?.pages ?? [],
          generatedAt: bundle.manifest?.generatedAt ?? new Date().toISOString(),
        };
        core?.eventBus?.emitCoreEvent?.("match.snapshot.ready", {
          snapshotId: id,
          roundKey: buildRoundKey(payload),
          pageCount: payload.artifacts.pageCount,
          pages: payload.artifacts.pages,
          primaryImage: payload.artifacts.primaryImage,
          combinedImage: payload.artifacts.combinedImage,
          taskId: null,
        });
      } catch (error) {
        payload.artifacts.status = "failed";
        payload.artifacts.error = String(error?.message ?? error);
      }
      await writeJsonAtomic(path.join(resolveSnapshotDir(), id + ".json"), payload);
    }

    const item = {
      ...describePayload(id, payload),
      imageAvailable: payload.artifacts.status === "done",
      thumbnailAvailable: payload.artifacts.status === "done",
      pageCount: Number(payload.artifacts.pageCount ?? 0),
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

  async function captureDebugSnapshot() {
    const overview = getCurrentOverview();
    if (!overview) {
      const error = new Error("match-state overview is unavailable.");
      error.code = "MatchStateUnavailable";
      error.statusCode = 409;
      throw error;
    }
    const payload = await buildSnapshotPayload({
      overview,
      triggerEvent: { eventName: "DEBUG_MANUAL_TRIGGER" },
      capturedAt: new Date().toISOString(),
      modules,
    });
    payload.snapshotType = "match-end-debug";
    payload.debug = { purpose: "manual-current-match-debug", capturedAt: payload.capturedAt };
    const id = "debug_" + buildSnapshotId(payload);
    const debugDir = resolveSnapshotDir(DEBUG_SNAPSHOT_DIR);
    await fs.mkdir(debugDir, { recursive: true });
    payload.artifacts = {
      format: "single-scoreboard",
      status: "rendering",
      pageCount: 0,
      primaryImage: "",
      combinedImage: "",
      thumbnailImage: "",
      manifest: "",
      pages: [],
    };
    await writeJsonAtomic(path.join(debugDir, id + ".json"), payload);
    try {
      const bundle = await generateMatchEndSnapshotBundle(payload, { snapshotId: id });
      await persistBundle(id, bundle, DEBUG_SNAPSHOT_DIR);
      payload.artifacts = {
        format: "single-scoreboard",
        status: "done",
        pageCount: bundle.pages?.length ?? 0,
        primaryImage: id + ".png",
        combinedImage: id + "-combined.png",
        thumbnailImage: id + "-thumb.png",
        manifest: id + "-manifest.json",
        pages: bundle.manifest?.pages ?? [],
        generatedAt: bundle.manifest?.generatedAt ?? new Date().toISOString(),
      };
      await writeJsonAtomic(path.join(debugDir, id + ".json"), payload);
      pluginLogger.info?.("[MatchEndSnapshot] debug snapshot written: " + id);
      return {
        ...describePayload(id, payload),
        snapshotType: payload.snapshotType,
        source: "debug",
        debug: true,
        imageAvailable: true,
        thumbnailAvailable: Boolean(bundle.thumbnailBuffer),
      };
    } catch (error) {
      payload.artifacts = {
        ...payload.artifacts,
        status: "failed",
        error: String(error?.message ?? error),
        failedAt: new Date().toISOString(),
      };
      await writeJsonAtomic(path.join(debugDir, id + ".json"), payload);
      error.debugSnapshotId = id;
      pluginLogger.error?.("[MatchEndSnapshot] debug snapshot render failed for " + id + ": " + (error?.stack || error));
      throw error;
    }
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
        thumbnailImage: task.result?.thumbnailImage ?? safeId + "-thumb.png",
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

  async function listSnapshots(options = {}) {
    const scope = normalizeScope(options?.scope);
    if (scope === "all") {
      const [official, debug] = await Promise.all([
        listSnapshotsInDirectory(SNAPSHOT_DIR, { ...options, scope: "official" }),
        listSnapshotsInDirectory(DEBUG_SNAPSHOT_DIR, { ...options, scope: "debug" }),
      ]);
      return filterAndSortSnapshots([...official, ...debug], options);
    }
    return listSnapshotsInDirectory(scope === "debug" ? DEBUG_SNAPSHOT_DIR : SNAPSHOT_DIR, {
      ...options,
      scope,
    });
  }

  async function listSnapshotsInDirectory(directory, options = {}) {
    await ensureSnapshotDir(directory);
    const dir = resolveSnapshotDir(directory);
    const names = await fs.readdir(dir);
    const items = await Promise.all(
      names
        .filter((name) => name.endsWith(".json") && !name.endsWith("-manifest.json") && !name.endsWith(".tmp.json"))
        .map(async (name) => {
          try {
            const id = name.slice(0, -5);
            const filePath = path.join(dir, name);
            const relatedNames = names.filter((item) =>
              item === name
              || item === id + ".png"
              || item === id + "-combined.png"
              || item === id + "-thumb.png"
              || item === id + "-manifest.json"
              || item.startsWith(id + "-") && item.endsWith(".png"),
            );
            const [text, stat, imageAvailable, thumbnailAvailable, manifest, relatedStats] = await Promise.all([
              fs.readFile(filePath, "utf8"),
              fs.stat(filePath),
              fileExists(path.join(dir, id + ".png")),
              fileExists(path.join(dir, id + "-thumb.png")),
              readManifestIfExists(id, directory),
              Promise.all(relatedNames.map(async (relatedName) => ({
                name: relatedName,
                stat: await fs.stat(path.join(dir, relatedName)),
              }))),
            ]);
            const payload = JSON.parse(text);
            const primaryImageStat = relatedStats.find((item) => item.name === id + ".png")?.stat;
            const generatedAt = firstText(
              manifest?.generatedAt,
              payload?.artifacts?.generatedAt,
              primaryImageStat?.mtime?.toISOString(),
              stat.mtime.toISOString(),
            );
            return {
              ...describePayload(id, payload),
              source: options.scope === "debug" ? "debug" : "official",
              debug: options.scope === "debug",
              jsonSize: stat.size,
              size: primaryImageStat?.size ?? stat.size,
              totalSize: relatedStats.reduce((sum, item) => sum + Number(item.stat?.size ?? 0), 0),
              imageAvailable,
              thumbnailAvailable,
              pageCount: Number(manifest?.pageCount ?? payload?.artifacts?.pageCount ?? 0),
              pages: Array.isArray(manifest?.pages) ? manifest.pages : payload?.artifacts?.pages ?? [],
              createdAt: payload?.capturedAt || stat.mtime.toISOString(),
              generatedAt,
              renderStatus: firstText(payload?.artifacts?.status, imageAvailable ? "done" : "missing"),
              renderError: firstText(payload?.artifacts?.error),
            };
          } catch (error) {
            pluginLogger.warn?.("[MatchEndSnapshot] ignored unreadable snapshot " + name + ": " + (error?.message || error));
            return null;
          }
        }),
    );
    return filterAndSortSnapshots(items.filter(Boolean), options);
  }

  async function readSnapshot(id, options = {}) {
    const directory = directoryForScope(options?.scope);
    await ensureSnapshotDir(directory);
    const safeId = sanitizeId(id);
    const content = await fs.readFile(path.join(resolveSnapshotDir(directory), safeId + ".json"), "utf8");
    return JSON.parse(content);
  }

  async function readSnapshotManifest(id, options = {}) {
    const directory = directoryForScope(options?.scope);
    await ensureSnapshotDir(directory);
    const safeId = sanitizeId(id);
    if (options?.force || !(await fileExists(path.join(resolveSnapshotDir(directory), safeId + "-manifest.json")))) {
      await regenerateBundle(safeId, options);
    }
    const content = await fs.readFile(path.join(resolveSnapshotDir(directory), safeId + "-manifest.json"), "utf8");
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
    const directory = directoryForScope(options?.scope);
    const content = await fs.readFile(path.join(resolveSnapshotDir(directory), path.basename(pageMeta.fileName)));
    return {
      ...pageMeta,
      id: safeId,
      contentType: "image/png",
      content,
    };
  }

  async function readSnapshotImage(id, options = {}) {
    const directory = directoryForScope(options?.scope);
    const safeId = sanitizeId(id);
    if (options?.page != null) {
      return readSnapshotPage(safeId, options.page, options);
    }
    const combined = Boolean(options?.combined);
    const fileName = combined ? safeId + "-combined.png" : safeId + ".png";
    const imagePath = path.join(resolveSnapshotDir(directory), fileName);
    if (options?.force || !(await fileExists(imagePath))) {
      await regenerateBundle(safeId, options);
    }
    return {
      id: safeId,
      fileName,
      contentType: "image/png",
      content: await fs.readFile(imagePath),
    };
  }

  async function readSnapshotThumbnail(id, options = {}) {
    const directory = directoryForScope(options?.scope);
    const safeId = sanitizeId(id);
    const fileName = safeId + "-thumb.png";
    const thumbnailPath = path.join(resolveSnapshotDir(directory), fileName);
    if (!(await fileExists(thumbnailPath))) {
      const image = await readSnapshotImage(safeId, options);
      const sharp = await loadSharp();
      const thumbnail = await sharp(image.content)
        .resize(640, 360, { fit: "cover", position: "centre" })
        .png({ compressionLevel: 9 })
        .toBuffer();
      await writeBufferAtomic(thumbnailPath, thumbnail);
    }
    return {
      id: safeId,
      fileName,
      contentType: "image/png",
      content: await fs.readFile(thumbnailPath),
    };
  }

  async function regenerateBundle(id, options = {}) {
    const directory = directoryForScope(options?.scope);
    const safeId = sanitizeId(id);
    const payload = await readSnapshot(safeId, options);

    // Historical snapshots must be rendered from their frozen JSON payload.
    // Do not enqueue a background task here: the HTTP caller needs a deterministic
    // result and the task event can race the manifest read during regeneration.
    payload.players = await enrichPlayersWithDatabaseAvatar(
      Array.isArray(payload?.players) ? payload.players : [],
      modules,
    );

    const bundle = await generateMatchEndSnapshotBundle(payload, { snapshotId: safeId });
    await persistBundle(safeId, bundle, directory);

    payload.artifacts = {
      format: "single-scoreboard",
      status: "done",
      pageCount: bundle.pages?.length ?? 0,
      primaryImage: safeId + ".png",
      combinedImage: safeId + "-combined.png",
      thumbnailImage: safeId + "-thumb.png",
      manifest: safeId + "-manifest.json",
      pages: bundle.manifest?.pages ?? [],
      regeneratedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(path.join(resolveSnapshotDir(directory), safeId + ".json"), payload);
    return bundle.manifest;
  }

  async function regenerateSnapshot(id, options = {}) {
    return regenerateBundle(id, options);
  }

  async function listDebugSnapshots() {
    return listSnapshots({ scope: "debug" });
  }

  async function getStatistics(options = {}) {
    const items = await listSnapshots({ ...options, search: "", sort: "newest" });
    const now = new Date();
    const thisMonth = items.filter((item) => {
      const date = new Date(item.capturedAt);
      return !Number.isNaN(date.getTime())
        && date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth();
    }).length;
    const totalSize = items.reduce((sum, item) => sum + Number(item.totalSize ?? item.size ?? 0), 0);
    return {
      total: items.length,
      size: totalSize,
      thisMonth,
      averageSize: items.length ? Math.round(totalSize / items.length) : 0,
      earliest: items.reduce((earliest, item) =>
        !earliest || String(item.capturedAt) < earliest ? String(item.capturedAt) : earliest, ""),
      official: items.filter((item) => item.source !== "debug").length,
      debug: items.filter((item) => item.source === "debug").length,
    };
  }

  async function deleteSnapshot(id, options = {}) {
    const directory = directoryForScope(options?.scope);
    await ensureSnapshotDir(directory);
    const safeId = sanitizeId(id);
    const dir = resolveSnapshotDir(directory);
    const names = await fs.readdir(dir);
    const targets = names.filter((name) =>
      name === safeId + ".json"
      || name === safeId + ".png"
      || name === safeId + "-combined.png"
      || name === safeId + "-thumb.png"
      || name === safeId + "-manifest.json"
      || /^\d{2}-/.test(name.slice(safeId.length + 1)) && name.startsWith(safeId + "-"),
    );
    const removedFiles = [];
    for (const name of targets) {
      try {
        await fs.unlink(path.join(dir, name));
        removedFiles.push(name);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    return {
      id: safeId,
      source: normalizeScope(options?.scope) === "debug" ? "debug" : "official",
      removed: removedFiles.length > 0,
      removedFiles,
    };
  }

  async function deleteSnapshots(records = []) {
    const normalized = Array.isArray(records) ? records.slice(0, 500) : [];
    const results = [];
    for (const record of normalized) {
      const id = typeof record === "string" ? record : record?.id;
      const scope = typeof record === "string" ? "official" : record?.scope ?? record?.source;
      if (!id) continue;
      results.push(await deleteSnapshot(id, { scope }));
    }
    return {
      requested: normalized.length,
      removed: results.filter((item) => item.removed).length,
      results,
    };
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
      readSnapshotThumbnail,
      regenerateSnapshot,
      deleteSnapshot,
      deleteSnapshots,
      getStatistics,
      takeDebugSnapshot: captureDebugSnapshot,
      listDebugSnapshots,
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
      teamTickets: extractTeamTickets(matchState, overview, match, status, serverStatus),
      factionIds: extractTeamFactionIds(matchState, overview, match, status, serverStatus),
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

function extractTeamFactionIds(...sources) {
  for (const source of sources) {
    const value = source?.factionIds ?? source?.factions ?? source?.teamFactionIds;
    if (value && typeof value === "object") {
      const team1 = firstText(value.team1, value["1"], value.teamOne, value.team1Id);
      const team2 = firstText(value.team2, value["2"], value.teamTwo, value.team2Id);
      if (team1 || team2) return { team1, team2 };
    }
    const fields = source?.fields;
    if (fields && typeof fields === "object") {
      const team1 = firstText(fields.TeamOneFaction_s, fields.TeamOneFactionID_s, fields.FactionOne_s);
      const team2 = firstText(fields.TeamTwoFaction_s, fields.TeamTwoFactionID_s, fields.FactionTwo_s);
      if (team1 || team2) return { team1, team2 };
    }
  }
  return { team1: "", team2: "" };
}

function extractTeamTickets(...sources) {
  for (const source of sources) {
    const result = findTeamTicketContainer(source);
    if (result != null) return result;
  }
  return null;
}

function findTeamTicketContainer(value, depth = 0) {
  if (depth > 5 || value == null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    const parsed = value
      .map((item) => ({
        teamID: nullableNumber(item?.teamID ?? item?.teamId ?? item?.id),
        tickets: firstNumber(item?.tickets, item?.ticket, item?.value, item?.count),
      }))
      .filter((item) => item.teamID != null && item.tickets != null);
    return parsed.length ? Object.fromEntries(parsed.map((item) => [String(item.teamID), item.tickets])) : null;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalized.includes("ticket")) {
      const parsed = parseTeamTicketContainer(entry);
      if (parsed != null) return parsed;
    }
  }
  for (const entry of Object.values(value)) {
    const nested = findTeamTicketContainer(entry, depth + 1);
    if (nested != null) return nested;
  }
  return null;
}

function parseTeamTicketContainer(value) {
  if (typeof value === "number" && Number.isFinite(value)) return null;
  if (Array.isArray(value)) {
    const parsed = value
      .map((item, index) => ({
        teamID: nullableNumber(item?.teamID ?? item?.teamId ?? item?.id ?? index + 1),
        tickets: firstNumber(item?.tickets, item?.ticket, item?.value, item?.count, typeof item === "number" ? item : null),
      }))
      .filter((item) => item.tickets != null);
    return parsed.length ? Object.fromEntries(parsed.map((item) => [String(item.teamID), item.tickets])) : null;
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      const teamMatch = String(key).match(/(?:team)?[_ -]?(1|2)(?:tickets?)?$/i);
      if (teamMatch) {
        const tickets = typeof entry === "object"
          ? firstNumber(entry?.tickets, entry?.ticket, entry?.value, entry?.count)
          : firstNumber(entry);
        if (tickets != null) result[teamMatch[1]] = tickets;
      }
    }
    return Object.keys(result).length ? result : null;
  }
  return null;
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

async function persistBundle(id, bundle, directory = SNAPSHOT_DIR) {
  const dir = resolveSnapshotDir(directory);
  await fs.mkdir(dir, { recursive: true });
  for (const page of bundle.pages) {
    await writeBufferAtomic(path.join(dir, page.fileName), page.buffer);
  }
  const cover = bundle.pages.find((page) => page.type === "cover") ?? bundle.pages[0];
  if (cover?.buffer) await writeBufferAtomic(path.join(dir, id + ".png"), cover.buffer);
  await writeBufferAtomic(path.join(dir, id + "-combined.png"), bundle.combinedBuffer);
  if (bundle.thumbnailBuffer) {
    await writeBufferAtomic(path.join(dir, id + "-thumb.png"), bundle.thumbnailBuffer);
  }
  await writeJsonAtomic(path.join(dir, id + "-manifest.json"), bundle.manifest);
}

async function readManifestIfExists(id, directory = SNAPSHOT_DIR) {
  try {
    const text = await fs.readFile(path.join(resolveSnapshotDir(directory), id + "-manifest.json"), "utf8");
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
  const capturedAt = firstText(payload?.capturedAt);
  const durationSeconds = firstNumber(
    payload?.match?.duration,
    payload?.match?.durationSeconds,
    payload?.match?.playtime,
    payload?.summary?.duration,
  ) ?? 0;
  const explicitStartedAt = firstText(
    payload?.match?.startedAt,
    payload?.match?.startTime,
    payload?.match?.matchStartedAt,
    payload?.source?.matchStartedAt,
  );
  const capturedMs = Date.parse(capturedAt);
  const startedAt = explicitStartedAt || (
    Number.isFinite(capturedMs) && durationSeconds > 0
      ? new Date(capturedMs - durationSeconds * 1000).toISOString()
      : ""
  );
  return {
    id,
    capturedAt,
    startedAt,
    endedAt: capturedAt,
    map: firstText(payload?.match?.map),
    layer: firstText(payload?.match?.layer),
    mode: firstText(payload?.match?.mode, payload?.match?.gameMode),
    nextMap: firstText(payload?.match?.nextMap),
    nextLayer: firstText(payload?.match?.nextLayer),
    duration: durationSeconds,
    playerCount: firstNumber(payload?.server?.playerCount, payload?.summary?.playerCount) ?? 0,
    queueCount: firstNumber(payload?.server?.queueCount) ?? 0,
    winner: firstText(payload?.trigger?.winner),
    snapshotType: firstText(payload?.snapshotType, "match-end-data"),
    schemaVersion: firstNumber(payload?.schemaVersion) ?? 2,
  };
}

function normalizeScope(value) {
  const scope = String(value ?? "official").trim().toLowerCase();
  if (scope === "debug" || scope === "all") return scope;
  return "official";
}

function directoryForScope(scope) {
  return normalizeScope(scope) === "debug" ? DEBUG_SNAPSHOT_DIR : SNAPSHOT_DIR;
}

function filterAndSortSnapshots(items, options = {}) {
  const search = String(options?.search ?? "").trim().toLowerCase();
  const map = String(options?.map ?? "").trim().toLowerCase();
  const mode = String(options?.mode ?? "").trim().toLowerCase();
  const winner = String(options?.winner ?? "").trim().toLowerCase();
  const fromMs = Date.parse(String(options?.from ?? ""));
  const toMs = Date.parse(String(options?.to ?? ""));
  const minPlayers = firstNumber(options?.minPlayers);
  const maxPlayers = firstNumber(options?.maxPlayers);
  const filtered = items.filter((item) => {
    const capturedMs = Date.parse(String(item.capturedAt ?? ""));
    if (Number.isFinite(fromMs) && (!Number.isFinite(capturedMs) || capturedMs < fromMs)) return false;
    if (Number.isFinite(toMs) && (!Number.isFinite(capturedMs) || capturedMs > toMs)) return false;
    if (map && !String(item.map ?? "").toLowerCase().includes(map)
      && !String(item.layer ?? "").toLowerCase().includes(map)) return false;
    if (mode && String(item.mode ?? "").toLowerCase() !== mode) return false;
    if (winner && String(item.winner ?? "").toLowerCase() !== winner) return false;
    if (minPlayers != null && Number(item.playerCount ?? 0) < minPlayers) return false;
    if (maxPlayers != null && Number(item.playerCount ?? 0) > maxPlayers) return false;
    if (search) {
      const haystack = [
        item.id,
        item.map,
        item.layer,
        item.mode,
        item.winner,
        item.source,
      ].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const sort = String(options?.sort ?? "newest").toLowerCase();
  return filtered.sort((left, right) => {
    if (sort === "oldest") return String(left.capturedAt).localeCompare(String(right.capturedAt));
    if (sort === "largest") return Number(right.totalSize ?? right.size ?? 0) - Number(left.totalSize ?? left.size ?? 0);
    if (sort === "longest") return Number(right.duration ?? 0) - Number(left.duration ?? 0);
    if (sort === "players") return Number(right.playerCount ?? 0) - Number(left.playerCount ?? 0);
    return String(right.capturedAt).localeCompare(String(left.capturedAt));
  });
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

function resolveSnapshotDir(directory = SNAPSHOT_DIR) {
  return path.resolve(process.cwd(), directory);
}

async function ensureSnapshotDir(directory = SNAPSHOT_DIR) {
  await fs.mkdir(resolveSnapshotDir(directory), { recursive: true });
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

async function loadSharp() {
  const imported = await import("sharp");
  return imported.default ?? imported;
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    if (typeof timer.unref === "function") timer.unref();
  });
}
