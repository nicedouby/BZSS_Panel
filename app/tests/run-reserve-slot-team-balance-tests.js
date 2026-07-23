import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildReserveMemberUpdate,
  calculateProjectedTeamDelta,
  calculateRemainingReserveDays,
  calculateReserveSlotSwitchCost,
  createPlugin,
  formatReserveExpireAt,
  normalizeTriggerMessage,
  parseReserveExpireAt,
} from "../plugins/fair-team-balance-reserve-slot.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const STEAM_ID = "76561198194428818";

function createPlayers(team1Count, team2Count) {
  return [
    ...Array.from({ length: team1Count }, (_, index) => ({
      name: index === 0 ? "ReserveTester" : `Team1-${index + 1}`,
      steamId: index === 0 ? STEAM_ID : `76561198000${String(index + 1).padStart(6, "0")}`,
      teamId: 1,
      squadId: index === 0 ? 7 : 0,
    })),
    ...Array.from({ length: team2Count }, (_, index) => ({
      name: `Team2-${index + 1}`,
      steamId: `76561199000${String(index + 1).padStart(6, "0")}`,
      teamId: 2,
      squadId: 0,
    })),
  ];
}

async function createHarness(options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-reserve-slot-tb-"));
  const nowMs = Date.now();
  const member = {
    steamId: STEAM_ID,
    group: "SpecialVIP",
    name: "ReserveTester",
    expireAt: options.expireAt ?? formatReserveExpireAt(nowMs + 40 * DAY_MS + 60 * 60 * 1000),
    reasons: ["暖服奖励", "测试保留"],
    remark: "暖服奖励，测试保留",
  };
  const upsertCalls = [];
  const switchCalls = [];
  const warnings = [];
  const broadcasts = [];
  let chatHandler = null;

  const plugin = createPlugin({
    core: {
      webStatus: { serverId: "test-server" },
      pluginSubscriptions: {
        isSubscribed() {
          return true;
        },
      },
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
    },
    modules: {
      pluginSubscriptions: {
        isSubscribed() {
          return true;
        },
      },
      chatManager: {
        on(eventName, handler) {
          assert.equal(eventName, "message");
          chatHandler = handler;
          return () => {
            chatHandler = null;
          };
        },
      },
      squadManagement: {
        getState() {
          return {
            serverId: "test-server",
            players: options.players ?? createPlayers(5, 5),
          };
        },
      },
      reserveSlots: {
        async getState() {
          return { members: [{ ...member }] };
        },
        async upsertMember(input) {
          upsertCalls.push({ ...input });
          member.expireAt = input.expireAt;
          member.group = input.group;
          member.name = input.name;
          member.remark = input.reason;
          member.reasons = input.reason ? [input.reason] : [];
          return { ok: true, savedMember: { ...member } };
        },
      },
      teamBalance: {
        async forceTeamChange(payload) {
          switchCalls.push(payload);
          if (typeof options.forceTeamChange === "function") {
            return options.forceTeamChange(payload);
          }
          return {
            ok: true,
            message: "Team switch requested.",
            command: `AdminForceTeamChange ${payload.steamId}`,
          };
        },
      },
      adminWarn: {
        async sendAdminWarn(payload) {
          warnings.push(payload);
          return { success: true };
        },
        async sendAdminBroadcast(payload) {
          broadcasts.push(payload);
          return { success: true };
        },
      },
    },
    config: {
      get(key, fallback) {
        if (key === "plugins.fairTeamBalanceReserveSlot") {
          return {
            enabled: true,
            directory: tempDir,
            minReserveDays: 15,
            maxProjectedTeamDelta: 8,
            varianceDays: 3,
          };
        }
        return fallback;
      },
    },
  });

  await plugin.start();
  assert.equal(typeof chatHandler, "function");

  return {
    plugin,
    member,
    upsertCalls,
    switchCalls,
    warnings,
    broadcasts,
    async emit(message = "YLW TB", extra = {}) {
      return chatHandler({
        id: extra.id ?? `event-${Date.now()}-${Math.random()}`,
        serverId: "test-server",
        message,
        playerName: "ReserveTester",
        steamId: STEAM_ID,
        teamId: 1,
        ...extra,
      });
    },
    async stop() {
      await plugin.stop();
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

function testTriggerNormalization() {
  assert.equal(normalizeTriggerMessage("  ylw   tb  "), "ylw tb");
  assert.equal(normalizeTriggerMessage("YLW\u3000TB"), "YLW TB");
}

function testCostTiers() {
  const low = { random: () => 0, varianceDays: 3 };
  const high = { random: () => 0.999999, varianceDays: 3 };

  assert.equal(calculateReserveSlotSwitchCost(15, low), 2);
  assert.equal(calculateReserveSlotSwitchCost(15, high), 8);
  assert.equal(calculateReserveSlotSwitchCost(30, low), 2);
  assert.equal(calculateReserveSlotSwitchCost(31, low), 7);
  assert.equal(calculateReserveSlotSwitchCost(31, high), 13);
  assert.equal(calculateReserveSlotSwitchCost(60, low), 12);
  assert.equal(calculateReserveSlotSwitchCost(60, high), 18);
  assert.equal(calculateReserveSlotSwitchCost(90, low), 17);
  assert.equal(calculateReserveSlotSwitchCost(90, high), 23);
  assert.equal(calculateReserveSlotSwitchCost(91, low), 6);
  assert.equal(calculateReserveSlotSwitchCost(91, high), 12);
  assert.equal(calculateReserveSlotSwitchCost(200, low), 17);
  assert.equal(calculateReserveSlotSwitchCost(200, high), 23);
}

function testProjectedTeamDelta() {
  const balanced = calculateProjectedTeamDelta(createPlayers(5, 5), 1);
  assert.equal(balanced.currentDelta, 0);
  assert.equal(balanced.projectedDelta, 2);

  const blocked = calculateProjectedTeamDelta(createPlayers(1, 8), 1);
  assert.equal(blocked.currentDelta, 7);
  assert.equal(blocked.projectedDelta, 9);
}

function testDateAndMetadataHelpers() {
  const value = "2026-12-31 23:59:59";
  const parsed = parseReserveExpireAt(value);
  assert.ok(parsed > 0);
  assert.equal(formatReserveExpireAt(parsed), value);
  assert.equal(calculateRemainingReserveDays(parsed, parsed - 15 * DAY_MS), 15);

  assert.deepEqual(buildReserveMemberUpdate({
    group: "SpecialVIP",
    name: "Tester",
    remark: "reason-a，reason-b",
    reasons: ["reason-a", "reason-b"],
  }, STEAM_ID, value), {
    steamId: STEAM_ID,
    group: "SpecialVIP",
    name: "Tester",
    reason: "reason-a，reason-b",
    expireAt: value,
  });
}

async function testSuccessfulSwitchDeductsAndPreservesMetadata() {
  const harness = await createHarness();
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const oldExpireAt = harness.member.expireAt;
    const result = await harness.emit("ylw    tb", { id: "success-1" });

    assert.equal(result.matched, true);
    assert.equal(result.ok, true);
    assert.equal(result.costDays, 10);
    assert.equal(result.projectedTeamDelta, 2);
    assert.equal(harness.switchCalls.length, 1);
    assert.equal(harness.upsertCalls.length, 1);
    assert.equal(harness.upsertCalls[0].group, "SpecialVIP");
    assert.equal(harness.upsertCalls[0].name, "ReserveTester");
    assert.equal(harness.upsertCalls[0].reason, "暖服奖励，测试保留");
    assert.equal(
      parseReserveExpireAt(oldExpireAt) - parseReserveExpireAt(harness.upsertCalls[0].expireAt),
      10 * DAY_MS,
    );
    assert.equal(harness.broadcasts.length, 1);
    assert.ok(harness.warnings.some((entry) => entry.reason === "reserve_slot_tb_success"));
  } finally {
    Math.random = originalRandom;
    await harness.stop();
  }
}

async function testFailedSwitchRefundsOriginalExpiry() {
  const harness = await createHarness({
    forceTeamChange: async () => ({
      ok: false,
      error: "RconRejected",
      message: "RCON rejected switch",
    }),
  });
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const oldExpireAt = harness.member.expireAt;
    const result = await harness.emit("YLW TB", { id: "refund-1" });

    assert.equal(result.ok, false);
    assert.equal(result.refundOk, true);
    assert.equal(harness.switchCalls.length, 1);
    assert.equal(harness.upsertCalls.length, 2);
    assert.notEqual(harness.upsertCalls[0].expireAt, oldExpireAt);
    assert.equal(harness.upsertCalls[1].expireAt, oldExpireAt);
    assert.equal(harness.upsertCalls[1].group, "SpecialVIP");
    assert.equal(harness.upsertCalls[1].name, "ReserveTester");
    assert.equal(harness.broadcasts.length, 0);
  } finally {
    Math.random = originalRandom;
    await harness.stop();
  }
}

async function testProjectedDeltaBlocksWithoutDeduction() {
  const harness = await createHarness({ players: createPlayers(1, 8) });
  try {
    const result = await harness.emit("YLW TB", { id: "blocked-delta-1" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "ProjectedTeamDeltaExceeded");
    assert.equal(harness.upsertCalls.length, 0);
    assert.equal(harness.switchCalls.length, 0);
  } finally {
    await harness.stop();
  }
}

async function testMinimumReserveDaysBlocksWithoutDeduction() {
  const harness = await createHarness({
    expireAt: formatReserveExpireAt(Date.now() + 14 * DAY_MS + 60 * 60 * 1000),
  });
  try {
    const result = await harness.emit("YLW TB", { id: "blocked-days-1" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "ReserveDaysInsufficient");
    assert.equal(harness.upsertCalls.length, 0);
    assert.equal(harness.switchCalls.length, 0);
  } finally {
    await harness.stop();
  }
}

async function testDuplicateEventIsIgnored() {
  const harness = await createHarness();
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const first = await harness.emit("YLW TB", { id: "same-event" });
    const second = await harness.emit("YLW TB", { id: "same-event" });
    assert.equal(first.ok, true);
    assert.equal(second.skipped, true);
    assert.equal(second.reason, "duplicate_event");
    assert.equal(harness.switchCalls.length, 1);
    assert.equal(harness.upsertCalls.length, 1);
  } finally {
    Math.random = originalRandom;
    await harness.stop();
  }
}

async function main() {
  testTriggerNormalization();
  testCostTiers();
  testProjectedTeamDelta();
  testDateAndMetadataHelpers();
  await testSuccessfulSwitchDeductsAndPreservesMetadata();
  await testFailedSwitchRefundsOriginalExpiry();
  await testProjectedDeltaBlocksWithoutDeduction();
  await testMinimumReserveDaysBlocksWithoutDeduction();
  await testDuplicateEventIsIgnored();
  console.log("reserve slot team balance tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
