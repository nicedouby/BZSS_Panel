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
        reminderEveryMinutes: 10,
        maxEligiblePlayers: 50,
        requireWarmupMode: true,
        group: "BZSSVIP",
        timeWindows: [{ enabled: true, start: "00:00", end: "23:59" }],
        clearOfflineAfterHours: 24,
        maxRecentRecords: 50,
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

async function testGrantUsesDurationDaysForRenewal() {
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
          return { isWarmup: true, playerCount: 1 };
        },
      },
      runtimeState: {
        getPlayers() {
          return {
            active: [
              { steamID: "76561198000000000", name: "WarmupPlayer", playerID: "42" },
            ],
          };
        },
      },
    },
    modules: {
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
  assert.match(upserts[0].reason, /暖服自动赠送/);
  assert.ok(warnings.some((item) => String(item.reason).includes("success")));

  const state = module.api.getState();
  assert.equal(state.progress[0].name, "DbWarmupPlayer");
  assert.equal(state.progress[0].grantCount, 1);
  assert.equal(state.progress[0].totalGrantedDays, 1);
  assert.equal(state.progress[0].eligibleSeconds, 0);

  await module.stop();
  await fs.rm(tempDir, { recursive: true, force: true });
}

await testCrossDayWindow();
await testGrantUsesDurationDaysForRenewal();

console.log("warmup reserve grant tests passed");
