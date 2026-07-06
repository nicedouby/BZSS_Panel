import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createWarmupReserveGrantModule,
  isMinuteWithinWindow,
} from "../modules/warmup-reserve-grant/index.js";

const tempDir = path.resolve(process.cwd(), "data/test-warmup-reserve-grant");

function createConfig() {
  const values = {
    modules: {
      warmupReserveGrant: {
        enabled: true,
        grantEveryMinutes: 1,
        grantDays: 1,
        reminderEveryMinutes: 1,
        maxEligiblePlayers: 50,
        requireWarmupMode: true,
        requireSquad: true,
        requireUnlockedSquad: true,
        group: "BZSSVIP",
        timeWindows: [{ enabled: true, start: "00:00", end: "23:59" }],
        clearOfflineAfterHours: 24,
        maxRecentRecords: 50,
        countMode: "accumulate_eligible_squad_member_time",
        storeFilePath: path.join(tempDir, "store.json"),
        grantsFilePath: path.join(tempDir, "grants.jsonl"),
      },
    },
  };
  return {
    get(pathText, fallback) {
      const parts = String(pathText ?? "").split(".");
      let current = values;
      for (const part of parts) {
        if (!current || typeof current !== "object" || !(part in current)) return fallback;
        current = current[part];
      }
      return current;
    },
    set(pathText, value) {
      const parts = String(pathText).split(".");
      let current = values;
      for (const part of parts.slice(0, -1)) {
        if (!current[part]) current[part] = {};
        current = current[part];
      }
      current[parts.at(-1)] = value;
    },
    async save() {},
  };
}

async function testCrossDayWindow() {
  assert.equal(isMinuteWithinWindow(23 * 60, { start: "22:00", end: "02:00" }), true);
  assert.equal(isMinuteWithinWindow(1 * 60 + 30, { start: "22:00", end: "02:00" }), true);
  assert.equal(isMinuteWithinWindow(12 * 60, { start: "22:00", end: "02:00" }), false);
  assert.equal(isMinuteWithinWindow(12 * 60, { start: "10:00", end: "14:00" }), true);
}

async function testGrantUsesQualifiedSquadMembers() {
  await fs.rm(tempDir, { recursive: true, force: true });
  const upserts = [];
  const warnings = [];
  const module = createWarmupReserveGrantModule({
    config: createConfig(),
    logger: console,
    core: {
      createLogger: () => console,
      webStatus: {
        getSnapshot() {
          return { isWarmup: true, playerCount: 3 };
        },
      },
    },
    modules: {
      squadManagement: {
        getCurrent() {
          return {
            players: [
              { steamID: "76561198000000000", name: "WarmupPlayer", playerID: "42", teamId: 1, squadId: 2 },
              { steamID: "76561198000000001", name: "LockedPlayer", playerID: "43", teamId: 1, squadId: 3 },
              { steamID: "76561198000000002", name: "SoloPlayer", playerID: "44", teamId: null, squadId: null },
            ],
            squads: [
              { teamId: 1, squadId: 2, squadName: "Alpha", locked: false, memberCount: 1 },
              { teamId: 1, squadId: 3, squadName: "Bravo", locked: true, memberCount: 1 },
            ],
          };
        },
      },
      reserveSlots: {
        async upsertMember(payload) {
          upserts.push(payload);
          return {
            savedMember: {
              steamId: payload.steamId,
              expireAt: "2099-01-02 00:00:00",
            },
          };
        },
      },
      playerDatabase: {
        async listPlayersBySteamIDs(steamIDs) {
          assert.deepEqual(steamIDs, ["76561198000000000"]);
          return [
            {
              steamID: "76561198000000000",
              current_name: "DbWarmupPlayer",
            },
          ];
        },
      },
      adminWarn: {
        async warnPlayer(payload) {
          warnings.push(payload);
          return { ok: true };
        },
      },
    },
  });

  await module.init();
  await module.api.tickNow();
  await module.api.tickNow();

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].steamId, "76561198000000000");
  assert.equal(upserts[0].name, "DbWarmupPlayer");
  assert.equal(upserts[0].durationDays, 1);
  assert.equal("expireAt" in upserts[0], false);
  assert.equal("reason" in upserts[0], false);
  assert.equal(upserts[0].group, "BZSSVIP");
  assert.ok(warnings.some((item) => item.reason === "warmup_reserve_grant_success"));
  assert.ok(warnings.some((item) => item.reason === "warmup_reserve_grant_invalid"));
  assert.ok(warnings.some((item) => String(item.message).includes("尚未进入小队")));
  assert.ok(warnings.some((item) => String(item.message).includes("锁队状态")));

  const state = module.api.getState();
  assert.equal(state.progress.find((item) => item.steamId === "76561198000000000")?.grantCount, 1);
  assert.equal(state.progress.find((item) => item.steamId === "76561198000000000")?.totalGrantedDays, 1);
  assert.equal(state.progress.find((item) => item.steamId === "76561198000000000")?.eligibleSeconds, 0);
  assert.equal(state.progress.find((item) => item.steamId === "76561198000000001")?.pauseReason, "squad_locked");
  assert.equal(state.progress.find((item) => item.steamId === "76561198000000002")?.pauseReason, "not_in_squad");

  await module.stop();
  await fs.rm(tempDir, { recursive: true, force: true });
}

await testCrossDayWindow();
await testGrantUsesQualifiedSquadMembers();

console.log("warmup reserve grant tests passed");
