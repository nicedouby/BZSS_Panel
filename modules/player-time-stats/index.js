// -*- coding: utf-8 -*-

const MODULE_ID = "module.playerTimeStats";

function cleanId(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function identityFromPlayer(player) {
  return {
    name: player?.name ?? player?.current_name ?? null,
    steamID: player?.steamID ?? player?.steam64 ?? player?.steam_id ?? null,
    eosID: player?.eosID ?? player?.eos ?? player?.eos_id ?? null,
  };
}

function playerKey(player) {
  const steamID = cleanId(player?.steamID ?? player?.steam64 ?? player?.steam_id);
  if (steamID) return `steam:${steamID}`;
  const eosID = cleanId(player?.eosID ?? player?.eos ?? player?.eos_id);
  if (eosID) return `eos:${eosID}`;
  const name = cleanId(player?.name ?? player?.current_name);
  if (name) return `name:${name.toLowerCase()}`;
  return null;
}

function normalizePositiveInt(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function normalizeMultiplier(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
}

function isWarmupEnabled(core) {
  const snapshot = core?.webStatus?.getSnapshot?.() ?? core?.webStatus?.state ?? core?.webStatus ?? {};
  return Boolean(snapshot.isWarmup);
}

export function createPlayerTimeStatsModule({ core, modules, config, logger }) {
  const moduleConfig = config?.get?.("modules.playerTimeStats", {}) ?? {};
  const enabled = moduleConfig.enabled !== false;
  const tickMs = normalizePositiveInt(moduleConfig.tickMs, 10_000);
  const maxDeltaSeconds = normalizePositiveInt(moduleConfig.maxDeltaSeconds, 60);
  const warmupPointsMultiplier = normalizeMultiplier(moduleConfig.warmupPointsMultiplier, 1);
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  let timer = null;
  let running = false;
  let ticking = false;
  const lastSeenByKey = new Map();

  function getServerId() {
    return String(core?.webStatus?.serverId ?? core?.webStatus?.getSnapshot?.()?.serverId ?? "").trim();
  }

  async function performTick(nowMs = Date.now(), { force = false } = {}) {
    if ((!running && !force) || ticking) return;
    ticking = true;
    try {
      const playerDatabase = modules.playerDatabase;
      const playerState = modules.playerState;
      if (!playerDatabase?.upsertFromPresence || !playerDatabase?.addTimeStats || !playerState?.getOnlinePlayers) {
        return;
      }

      const serverId = getServerId();
      const players = playerState.getOnlinePlayers(serverId) ?? [];
      const onlineKeys = new Set();
      const warmup = isWarmupEnabled(core);

      for (const player of players) {
        const key = playerKey(player);
        if (!key) continue;
        onlineKeys.add(key);

        const previousMs = lastSeenByKey.get(key);
        lastSeenByKey.set(key, nowMs);
        if (!previousMs) continue;

        const deltaSeconds = Math.min(
          maxDeltaSeconds,
          Math.max(0, Math.floor((nowMs - previousMs) / 1000)),
        );
        if (deltaSeconds <= 0) continue;

        const profile = await playerDatabase.upsertFromPresence(identityFromPlayer(player));
        if (!profile?.id) continue;

        const warmupSeconds = warmup ? deltaSeconds : 0;
        await playerDatabase.addTimeStats(profile.id, {
          serverSeconds: deltaSeconds,
          warmupSeconds,
          warmupPoints: warmupSeconds * warmupPointsMultiplier,
        });
      }

      for (const key of [...lastSeenByKey.keys()]) {
        if (!onlineKeys.has(key)) lastSeenByKey.delete(key);
      }
    } catch (error) {
      moduleLogger?.error?.(`Player time stats tick failed: ${error.message}`);
    } finally {
      ticking = false;
    }
  }

  return {
    manifest: {
      id: MODULE_ID,
      name: "Player Time Stats Module",
      kind: "module",
      version: "0.1.0",
      description: "Tracks player server time, warmup time, and warmup point assets from online player snapshots.",
    },
    apiName: "playerTimeStats",
    api: {
      async tick(nowMs = Date.now()) {
        return performTick(nowMs, { force: true });
      },
      getStatus() {
        return {
          enabled,
          running,
          trackedPlayers: lastSeenByKey.size,
          tickMs,
          maxDeltaSeconds,
          warmupPointsMultiplier,
        };
      },
      reset() {
        lastSeenByKey.clear();
      },
    },

    async start() {
      if (!enabled) {
        moduleLogger?.info?.("Player Time Stats module disabled by config.");
        return;
      }
      running = true;
      await performTick();
      timer = setInterval(() => {
        void performTick();
      }, tickMs);
      moduleLogger?.info?.("Player Time Stats module started.");
    },

    async stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      lastSeenByKey.clear();
    },
  };
}
