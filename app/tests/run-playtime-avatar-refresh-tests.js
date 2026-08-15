import assert from "node:assert/strict";

import { createPlaytimeAvatarRefreshModule } from "../modules/playtime-avatar-refresh/index.js";
import { SteamGameDurationService } from "../modules/playtime/index.js";

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

function createBaseModuleFactory() {
  const jobs = new Map();
  return () => ({
    manifest: {
      id: "module.playtime",
      name: "Playtime Module",
      kind: "module",
      version: "test",
    },
    apiName: "playtime",
    api: {
      async refreshPlayer(payload = {}) {
        const id = `job-${payload.steamID}`;
        const job = {
          id,
          status: "completed",
          result: { lookup: { steamID: payload.steamID, gameHours: 12.5 } },
          progress: { phase: "completed", message: "刷新完成" },
        };
        jobs.set(id, job);
        return job;
      },
      createLookupJob(payload = {}) {
        const id = `lookup-${payload.steamID}`;
        const job = {
          id,
          status: "completed",
          result: { lookup: { steamID: payload.steamID, gameHours: 1 } },
          progress: { phase: "completed", message: "刷新完成" },
        };
        jobs.set(id, job);
        return job;
      },
      getJob(jobId) {
        return jobs.get(jobId) ?? null;
      },
      async waitForJob(jobId) {
        return jobs.get(jobId) ?? null;
      },
    },
    async init() {},
    async stop() {},
  });
}

async function testManualAvatarPersistenceCompatibility() {
  const steamID = "76561198000000001";
  let databaseReads = 0;
  const playerDatabase = {
    async getCachedPlayer({ steamID: requestedSteamID }) {
      assert.equal(requestedSteamID, steamID);
      databaseReads += 1;
      if (databaseReads < 3) return { steam_id: steamID, steam_avatar: null };
      return {
        id: 7,
        steam_id: steamID,
        steam_avatar: "https://avatars.steamstatic.com/new-avatar_medium.jpg",
      };
    },
  };

  const module = createPlaytimeAvatarRefreshModule({
    modules: { playerDatabase },
    config: {
      get(key) {
        if (key === "modules.playtime") {
          return {
            manualAvatarWaitMs: 250,
            manualAvatarPollMs: 5,
            manualAvatarPollResponseWaitMs: 500,
            manualRefreshJobWaitMs: 500,
          };
        }
        return {};
      },
    },
  }, createBaseModuleFactory());

  const started = await module.api.refreshPlayer({ steamID, name: "Alpha" });
  assert.equal(started.id, `job-${steamID}`);

  const completed = await module.api.waitForJob(started.id, 500);
  assert.equal(completed.status, "completed");
  assert.equal(completed.result.lookup.gameHours, 12.5);
  assert.equal(completed.result.avatar, "https://avatars.steamstatic.com/new-avatar_medium.jpg");
  assert.equal(completed.result.avatarUpdated, true);
  assert.equal(completed.result.avatarPersisted, true);
  assert.equal(completed.result.player.id, 7);
  assert.ok(databaseReads >= 3, "manual refresh must wait until the avatar is persisted");

  databaseReads = 0;
  const lookup = module.api.createLookupJob({ steamID, name: "Alpha" });
  const lookupCompleted = await module.api.waitForJob(lookup.id, 500);
  assert.equal(lookupCompleted.status, "completed");
  assert.equal(lookupCompleted.result.avatarPersisted, true);
}

async function testBaseBackfillStillProcessesEligibleRows() {
  let missingAvatarQueries = 0;
  const persistedAvatars = [];
  const service = new SteamGameDurationService({
    apiKey: "test-key",
    playerDatabase: {
      async listPlayersWithSteamID({ missingAvatarOnly }) {
        assert.equal(missingAvatarOnly, true);
        missingAvatarQueries += 1;
        return missingAvatarQueries === 1 ? [{ steam_id: "76561198000000002" }, { steam_id: "76561198000000003" }] : [];
      },
      async updateSteamAvatarBySteamID(id, avatar) {
        persistedAvatars.push({ id, avatar });
        return { id };
      },
    },
  });
  service.fetchSteamPlayerSummaries = async (ids) => ids.map((id) => ({
    steamid: id,
    avatarmedium: `https://avatars.steamstatic.com/${id}_medium.jpg`,
  }));

  const backfill = await service.backfillMissingSteamAvatars();
  assert.deepEqual(backfill, { requested: 2, updated: 2, skipped: false });
  assert.equal(persistedAvatars.length, 2);
  assert.equal(missingAvatarQueries, 1);

  let backfillBatch = 0;
  const attemptedBatches = [];
  const serviceWithEmptyFirstBatch = new SteamGameDurationService({
    apiKey: "test-key",
    avatarBackfillBatchSize: 2,
    playerDatabase: {
      async listPlayersWithSteamID({ missingAvatarOnly }) {
        assert.equal(missingAvatarOnly, true);
        return [
          { steam_id: "76561198000000011" },
          { steam_id: "76561198000000012" },
          { steam_id: "76561198000000013" },
          { steam_id: "76561198000000014" },
        ];
      },
      async updateSteamAvatarBySteamID(id, avatar) {
        persistedAvatars.push({ id, avatar });
        return { id };
      },
    },
  });
  serviceWithEmptyFirstBatch.fetchAndCacheSteamAvatars = async (ids) => {
    attemptedBatches.push(ids);
    backfillBatch += 1;
    return backfillBatch === 1
      ? { ok: true, requested: ids.length, updated: 0 }
      : { ok: true, requested: ids.length, updated: ids.length };
  };
  const continuedBackfill = await serviceWithEmptyFirstBatch.backfillMissingSteamAvatars();
  assert.deepEqual(continuedBackfill, { requested: 4, updated: 2, skipped: false });
  assert.deepEqual(attemptedBatches, [
    ["76561198000000011", "76561198000000012"],
    ["76561198000000013", "76561198000000014"],
  ]);
}

async function testAutomaticRefreshOwnershipAndInactiveBackfillGuard() {
  const now = Date.now();
  const activeSteamID = "76561198000000021";
  const inactiveSteamID = "76561198000000022";
  const migratedSteamID = "76561198000000023";
  let underlyingConnectRegistrations = 0;
  let filteredRows = null;

  const eventBus = {
    onCoreEvent() {
      underlyingConnectRegistrations += 1;
      return () => {};
    },
  };

  const playerDatabase = {
    async listPlayersWithSteamID(options = {}) {
      assert.equal(options.missingAvatarOnly, true);
      return [
        { id: 21, steam_id: activeSteamID },
        { id: 22, steam_id: inactiveSteamID },
        { id: 23, steam_id: migratedSteamID },
      ];
    },
    async listPlayerSessionHistory(playerId, options = {}) {
      assert.deepEqual(options, { limit: 1, offset: 0 });
      if (playerId === 21) return [{ joined_at: now - 2 * DAY_MS }];
      if (playerId === 22) return [{ joined_at: now - 16 * DAY_MS }];
      return [];
    },
    async listPlayerAliases(playerId, options = {}) {
      assert.deepEqual(options, { limit: 1, offset: 0 });
      if (playerId === 22) {
        throw new Error("stale session history must short-circuit alias fallback");
      }
      return [];
    },
  };

  const logger = {
    info() {},
    warn() {},
    error() {},
  };

  const guardProbeBaseFactory = (baseContext) => ({
    manifest: {
      id: "module.playtime",
      name: "Playtime Module",
      kind: "module",
      version: "guard-probe",
    },
    apiName: "playtime",
    api: {
      getStatus() {
        return { configured: true };
      },
    },
    async init() {
      // The real base playtime module registers exactly this unconditional
      // automatic refresh hook. The wrapper must consume it without registering
      // it on the shared event bus.
      baseContext.core.eventBus.onCoreEvent("On_PlayerConnected", () => {
        throw new Error("suppressed handler must never execute");
      });

      filteredRows = await baseContext.modules.playerDatabase.listPlayersWithSteamID({
        missingAvatarOnly: true,
      });
    },
  });

  const module = createPlaytimeAvatarRefreshModule({
    core: { eventBus },
    modules: { playerDatabase },
    config: {
      get() {
        return {};
      },
    },
    logger,
  }, guardProbeBaseFactory);

  await module.init();

  assert.equal(underlyingConnectRegistrations, 0);
  assert.deepEqual(
    filteredRows.map((row) => row.steam_id),
    [activeSteamID, migratedSteamID],
  );

  const status = module.api.getStatus();
  assert.equal(status.configured, true);
  assert.equal(status.automaticRefreshPolicy.owner, "plugin.player_duration_slow_refresh");
  assert.equal(status.automaticRefreshPolicy.playtimeCooldownMs, 10 * HOUR_MS);
  assert.equal(status.automaticRefreshPolicy.profileCooldownMs, 24 * HOUR_MS);
  assert.equal(status.automaticRefreshPolicy.inactivePlayerCutoffMs, 15 * DAY_MS);
  assert.equal(status.automaticRefreshPolicy.baseConnectRefreshSuppressed, true);
}

await testManualAvatarPersistenceCompatibility();
await testBaseBackfillStillProcessesEligibleRows();
await testAutomaticRefreshOwnershipAndInactiveBackfillGuard();

console.log("run-playtime-avatar-refresh-tests: ok");
