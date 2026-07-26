import assert from "node:assert/strict";

import { createPlaytimeAvatarRefreshModule } from "../modules/playtime-avatar-refresh/index.js";
import { SteamGameDurationService } from "../modules/playtime/index.js";

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

async function main() {
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

  let missingAvatarQueries = 0;
  const persistedAvatars = [];
  const service = new SteamGameDurationService({
    apiKey: "test-key",
    playerDatabase: {
      async listPlayersWithSteamID({ missingAvatarOnly, limit }) {
        assert.equal(missingAvatarOnly, true);
        assert.equal(limit, 100);
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
  assert.equal(missingAvatarQueries, 2);

  console.log("run-playtime-avatar-refresh-tests: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
