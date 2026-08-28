import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { hashPassword } from "../core/auth-crypto.js";
import { AuthManager } from "../core/auth-manager.js";
import { AuthUserStore } from "../core/auth-user-store.js";
import { NewbieReserveExchangeService, pickGrantPlan } from "../services/newbie-reserve-exchange-service.js";

function createConfig(initial = {}) {
  const state = structuredClone(initial);
  return {
    get(pathText, defaultValue) {
      if (!pathText) return state;
      const parts = String(pathText).split(".");
      let current = state;
      for (const part of parts) {
        if (current == null || typeof current !== "object" || !(part in current)) {
          return defaultValue;
        }
        current = current[part];
      }
      return current;
    },
    set(pathText, value) {
      const parts = String(pathText).split(".");
      let current = state;
      for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index];
        if (current[part] == null || typeof current[part] !== "object" || Array.isArray(current[part])) {
          current[part] = {};
        }
        current = current[part];
      }
      current[parts[parts.length - 1]] = value;
    },
    async save() {},
    state,
  };
}

async function createAuthManager(tempDir) {
  const manager = new AuthManager({
    config: {
      enabled: true,
      usersFilePath: "./data/auth/users.json",
    },
    logger: { info() {}, warn() {}, error() {} },
  });
  await manager.start();
  await manager.userStore.createUser({
    username: "AdminOne",
    role: "SuperAdmin",
    passwordHash: await hashPassword("Password1!"),
    displayName: "Admin One",
    enabled: true,
  });
  return manager;
}

function createReserveSlotsMock({ failOnce = false } = {}) {
  const state = {
    members: [],
  };

  return {
    state,
    api: {
      async getState() {
        return {
          ok: true,
          members: state.members.slice(),
        };
      },
      async upsertMember(payload) {
        if (failOnce && state._failedOnce !== true) {
          state._failedOnce = true;
          throw new Error("reserve write failed");
        }

        const savedMember = {
          steamId: String(payload.steamId ?? "").trim(),
          group: String(payload.group ?? "").trim(),
          name: String(payload.name ?? "").trim(),
          expireAt: "2030-01-01 00:00:00",
          reasons: [],
          remark: String(payload.reason ?? "").trim(),
          rawLine: `Admin=${payload.steamId}:${payload.group}`,
          isExpired: false,
        };

        state.members = state.members.filter((item) => item.steamId !== savedMember.steamId);
        state.members.push(savedMember);
        return {
          ok: true,
          savedMember,
        };
      },
    },
  };
}

function createPlayerDatabaseMock() {
  const state = {
    players: [
      {
        id: "player:1",
        name: "Alpha",
        displayName: "Alpha",
        nickname: "Alpha",
        steam_id: "76561198000000003",
        qq_number: "",
        qq_name: "",
      },
    ],
  };
  return {
    state,
    async findByIdentity(identity = {}) {
      if (String(identity?.steamID ?? "").trim() === "76561198000000003") {
        return state.players[0];
      }
      return null;
    },
    async bindQQToPlayer(playerId, binding = {}) {
      const player = state.players.find((item) => item.id === playerId);
      if (!player) return null;
      player.qq_number = String(binding.qqNumber ?? "").trim();
      player.qq_name = String(binding.qqName ?? "").trim();
      return player;
    },
  };
}

function createCaptureLogger() {
  const entries = [];
  return {
    entries,
    info(message, context = {}) {
      entries.push({ level: "info", message: String(message), context });
    },
    warn(message, context = {}) {
      entries.push({ level: "warn", message: String(message), context });
    },
    error(message, context = {}) {
      entries.push({ level: "error", message: String(message), context });
    },
  };
}

async function startService({ failOnce = false, requiredMatchSeconds = 0, matchOnlineSeconds = 0 } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reserve-exchange-test-"));
  const originalCwd = process.cwd();
  process.chdir(tempDir);

  const authManager = await createAuthManager(tempDir);
  const reserveSlots = createReserveSlotsMock({ failOnce });
  const playerDatabase = createPlayerDatabaseMock();
  const logger = createCaptureLogger();
  const matchPresenceState = { matchOnlineSeconds };
  const config = createConfig({
    reserveExchange: {
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      sessionTtlMs: 60 * 60 * 1000,
      databaseFilePath: "./data/reserve-exchange/store.sqlite3",
      claimEnabled: true,
      claimLockMinutes: 1,
    },
  });

  const service = new NewbieReserveExchangeService({
    core: {
      authManager,
      logger,
    },
    modules: {
      reserveSlots: reserveSlots.api,
      playerDatabase,
      matchPlayerPresence: {
        getExchangeEligibility(_identity, options = {}) {
          const requiredSeconds = Math.max(0, Number(options.requiredSeconds ?? 0) || 0);
          return {
            eligible: matchPresenceState.matchOnlineSeconds >= requiredSeconds,
            serverId: String(options.serverId ?? "unknown"),
            requiredSeconds,
            matchOnlineSeconds: matchPresenceState.matchOnlineSeconds,
            remainingSeconds: Math.max(0, requiredSeconds - matchPresenceState.matchOnlineSeconds),
            player: null,
          };
        },
      },
    },
    config,
    logger,
  });

  await service.start();
  if (requiredMatchSeconds > 0) {
    await service.updateSettings({ requiredMatchSeconds });
  }

  return {
    tempDir,
    originalCwd,
    authManager,
    reserveSlots,
    playerDatabase,
    config,
    logger,
    matchPresenceState,
    service,
    async shutdown() {
      await service.stop();
      await authManager.stop?.();
    },
    async dispose() {
      process.chdir(originalCwd);
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function testMatchTimeRequirement() {
  const harness = await startService({ requiredMatchSeconds: 3600, matchOnlineSeconds: 1800 });
  try {
    const base = `http://${harness.service.host}:${harness.service.port}`;
    const eligibility = await fetchJson(`${base}/api/public/eligibility?steam64=76561198000000003`);
    assert.equal(eligibility.response.status, 200);
    assert.equal(eligibility.body.eligible, false);
    assert.equal(eligibility.body.remainingSeconds, 1800);

    const denied = await fetchJson(`${base}/api/public/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qq_number: "88776655", steam64: "76561198000000003" }),
    });
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.error, "InsufficientMatchTime");
    assert.equal(denied.body.eligibility.remainingSeconds, 1800);

    harness.matchPresenceState.matchOnlineSeconds = 3600;
    const granted = await fetchJson(`${base}/api/public/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qq_number: "88776655", steam64: "76561198000000003" }),
    });
    assert.equal(granted.response.status, 200);
    assert.equal(granted.body.ok, true);
  } finally {
    await harness.shutdown().catch(() => {});
    await harness.dispose().catch(() => {});
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  return {
    response,
    body,
  };
}

function createRecorder() {
  const state = {
    status: null,
    headers: {},
    body: "",
  };
  return {
    state,
    res: {
      writeHead(status, headers = {}) {
        state.status = status;
        state.headers = headers;
      },
      end(body = "") {
        state.body = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "");
      },
    },
  };
}

async function readDbSnapshot(dbFilePath) {
  const db = await open({
    filename: dbFilePath,
    driver: sqlite3.Database,
  });
  try {
    const [claimCount, auditCount, settingsRow, claimRow] = await Promise.all([
      db.get("SELECT COUNT(*) AS value FROM exchange_claims"),
      db.get("SELECT COUNT(*) AS value FROM exchange_audits"),
      db.get("SELECT enabled, claim_enabled, default_days, random_min_days, random_max_days, default_weight, random_weight FROM exchange_settings WHERE id = 1"),
      db.get("SELECT qq_number, steam64, status, selected_mode, selected_days, expire_at, reserve_group, reserve_name FROM exchange_claims ORDER BY id DESC LIMIT 1"),
    ]);

    return {
      claimCount: Number(claimCount?.value ?? 0),
      auditCount: Number(auditCount?.value ?? 0),
      settingsRow,
      claimRow,
    };
  } finally {
    await db.close();
  }
}

async function testPickGrantPlanBoundaries() {
  const settings = {
    defaultDays: 7,
    randomMinDays: 3,
    randomMaxDays: 60,
    defaultWeight: 0,
    randomWeight: 100,
  };

  const low = pickGrantPlan(settings, () => 0);
  assert.equal(low.mode, "random");
  assert.equal(low.days, 3);

  const high = pickGrantPlan(settings, () => 0.999999);
  assert.equal(high.mode, "random");
  assert.equal(high.days, 60);
}

async function testPublicClaimLoginAndSettingsFlow() {
  const harness = await startService();
  try {
    const base = `http://${harness.service.host}:${harness.service.port}`;

    const publicState = await fetchJson(`${base}/api/public/state`);
    assert.equal(publicState.response.status, 200);
    assert.equal(publicState.body.ok, true);
    assert.equal(publicState.body.settings.claimEnabled, true);
    assert.ok(harness.logger.entries.some((entry) => entry.message.includes("listening on")));

    const claim = await fetchJson(`${base}/api/public/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        qq_number: "123456789",
        steam64: "76561198000000001",
      }),
    });
    assert.equal(claim.response.status, 200);
    assert.equal(claim.body.ok, true);
    assert.equal(claim.body.status, "granted");
    assert.equal(claim.body.alreadyRedeemed, false);
    assert.equal(claim.body.expireAt, "2030-01-01 00:00:00");
    assert.ok(harness.logger.entries.some((entry) => entry.message.includes("claim request received") && entry.context?.data?.qqNumber === "123456789"));
    assert.ok(harness.logger.entries.some((entry) => entry.message.includes("claim processing started") && entry.context?.data?.claimId === claim.body.claimId));
    assert.ok(harness.logger.entries.some((entry) => entry.message.includes("claim granted") && entry.context?.data?.expireAt === "2030-01-01 00:00:00"));

    const duplicate = await fetchJson(`${base}/api/public/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        qq_number: "123456789",
        steam64: "76561198000000001",
      }),
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.ok, false);
    assert.equal(duplicate.body.alreadyRedeemed, true);
    assert.ok(harness.logger.entries.some((entry) => entry.message.includes("already redeemed")));

    const invalid = await fetchJson(`${base}/api/public/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        qq_number: "abc",
        steam64: "76561198000000001",
      }),
    });
    assert.equal(invalid.response.status, 400);
    assert.ok(harness.logger.entries.some((entry) => entry.message.includes("invalid input")));

    const login = await fetchJson(`${base}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "AdminOne",
        password: "Password1!",
      }),
    });
    assert.equal(login.response.status, 200);
    const cookie = String(login.response.headers.get("set-cookie") ?? "").split(";", 1)[0];
    assert.ok(cookie.includes("reserve_exchange_session="));
    assert.ok(harness.logger.entries.some((entry) => entry.message.includes("login success username=AdminOne")));

    const adminHtmlRecorder = createRecorder();
    const adminReq = Readable.from([]);
    adminReq.method = "GET";
    adminReq.url = "/admin";
    adminReq.headers = { host: "localhost", cookie };
    adminReq.socket = {};
    await harness.service.handleRequest(adminReq, adminHtmlRecorder.res);
    assert.equal(adminHtmlRecorder.state.status, 200);
    assert.match(adminHtmlRecorder.state.body, /admin-card/);
    assert.doesNotMatch(adminHtmlRecorder.state.body, /登录失败，请检查账号或密码后重试。/);

    const failedLoginRecorder = createRecorder();
    const failedLoginReq = Readable.from("username=AdminOne&password=wrong");
    failedLoginReq.method = "POST";
    failedLoginReq.url = "/api/auth/login";
    failedLoginReq.headers = {
      host: "localhost",
      "content-type": "application/x-www-form-urlencoded",
    };
    failedLoginReq.socket = {};
    await harness.service.handleRequest(failedLoginReq, failedLoginRecorder.res);
    assert.equal(failedLoginRecorder.state.status, 303);
    assert.equal(failedLoginRecorder.state.headers.Location, "/admin?login=failed");

    const adminState = await fetchJson(`${base}/api/admin/state`, {
      headers: {
        Cookie: cookie,
      },
    });
    assert.equal(adminState.response.status, 200);
    assert.equal(adminState.body.ok, true);
    assert.equal(adminState.body.canManage, true);
    assert.ok(Array.isArray(adminState.body.claims));

    const update = await fetchJson(`${base}/api/admin/settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        enabled: true,
        claimEnabled: true,
        defaultDays: 12,
        randomMinDays: 4,
        randomMaxDays: 8,
        defaultWeight: 70,
        randomWeight: 30,
      }),
    });
    assert.equal(update.response.status, 200);
    assert.equal(update.body.settings.defaultDays, 12);
    assert.equal(update.body.settings.randomMinDays, 4);
    assert.equal(update.body.settings.randomMaxDays, 8);
    assert.ok(harness.logger.entries.some((entry) => entry.message.includes("settings updated by AdminOne")));

    await fetchJson(`${base}/api/admin/settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        enabled: true,
        claimEnabled: true,
        defaultDays: 12,
        randomMinDays: 4,
        randomMaxDays: 8,
        defaultWeight: 0,
        randomWeight: 100,
      }),
    });

    const preview = await fetchJson(`${base}/api/admin/random-preview?count=20`, {
      headers: {
        Cookie: cookie,
      },
    });
    assert.equal(preview.response.status, 200);
    assert.equal(preview.body.ok, true);
    assert.equal(preview.body.count, 20);
    assert.equal(preview.body.samples.length, 20);
    assert.equal(preview.body.summary.defaultCount, 0);
    assert.equal(preview.body.summary.randomCount, 20);
    assert.ok(preview.body.samples.every((item) => item.mode === "random"));
    assert.ok(preview.body.samples.every((item) => item.days >= 4 && item.days <= 8));

    const liveSettings = await harness.service.db.get(
      "SELECT enabled, claim_enabled, default_days, random_min_days, random_max_days, default_weight, random_weight FROM exchange_settings WHERE id = 1",
    );
    const liveAuditCount = await harness.service.db.get("SELECT COUNT(*) AS value FROM exchange_audits");
    assert.equal(liveSettings?.default_days, 12);
    assert.equal(liveSettings?.random_min_days, 4);
    assert.equal(liveSettings?.random_max_days, 8);
    assert.ok(Number(liveAuditCount?.value ?? 0) >= 3);

    await harness.shutdown();
    const snapshot = await readDbSnapshot(path.join(harness.tempDir, "data/reserve-exchange/store.sqlite3"));
    assert.ok(snapshot.claimCount >= 1);
    assert.equal(snapshot.settingsRow?.default_days, 12);
    assert.equal(snapshot.settingsRow?.random_min_days, 4);
    assert.equal(snapshot.settingsRow?.random_max_days, 8);
    assert.equal(snapshot.claimRow?.qq_number, "123456789");
    assert.equal(snapshot.claimRow?.steam64, "76561198000000001");
    assert.equal(snapshot.claimRow?.status, "granted");
    assert.ok(Number(snapshot.claimRow?.selected_days ?? 0) >= 3);
    assert.ok(Number(snapshot.claimRow?.selected_days ?? 0) <= 60);
    assert.ok(["default", "random"].includes(snapshot.claimRow?.selected_mode));
  } finally {
    await harness.shutdown().catch(() => {});
    await harness.dispose().catch(() => {});
  }
}

async function testFailedGrantCanRetry() {
  const harness = await startService({ failOnce: true });
  try {
    const base = `http://${harness.service.host}:${harness.service.port}`;
    const first = await fetchJson(`${base}/api/public/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        qq_number: "1987654321",
        steam64: "76561198000000002",
      }),
    });
    assert.equal(first.response.status, 500);
    assert.equal(first.body.ok, false);
    assert.ok(harness.logger.entries.some((entry) => entry.level === "error" && entry.message.includes("claim grant failed")));

    const retry = await fetchJson(`${base}/api/public/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        qq_number: "1987654321",
        steam64: "76561198000000002",
      }),
    });
    assert.equal(retry.response.status, 200);
    assert.equal(retry.body.ok, true);
    assert.equal(retry.body.status, "granted");
    assert.ok(harness.logger.entries.some((entry) => entry.message.includes("claim granted") && entry.context?.data?.claimId === retry.body.claimId));
  } finally {
    await harness.shutdown().catch(() => {});
    await harness.dispose().catch(() => {});
  }
}

async function testExistingReserveSlotStillAllowsNewGrant() {
  const harness = await startService();
  try {
    harness.reserveSlots.state.members.push({
      steamId: "76561198000000003",
      group: "BZSSVIP",
      name: "Existing Slot",
      expireAt: "2035-01-01 00:00:00",
      reasons: ["预留位"],
      remark: "existing",
      rawLine: "Admin=76561198000000003:BZSSVIP",
      isExpired: false,
    });

    const base = `http://${harness.service.host}:${harness.service.port}`;
    const response = await fetchJson(`${base}/api/public/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        qq_number: "223344556",
        steam64: "76561198000000003",
      }),
    });

    assert.equal(response.response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.status, "granted");
    assert.ok(harness.logger.entries.some((entry) => entry.message.includes("found existing reserve slot")));
    assert.equal(harness.reserveSlots.state.members.length, 1);
    assert.equal(harness.reserveSlots.state.members[0].steamId, "76561198000000003");
  } finally {
    await harness.shutdown().catch(() => {});
    await harness.dispose().catch(() => {});
  }
}

async function testReserveNameUsesDatabaseName() {
  const harness = await startService();
  try {
    const base = `http://${harness.service.host}:${harness.service.port}`;
    const response = await fetchJson(`${base}/api/public/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        qq_number: "99887766",
        steam64: "76561198000000003",
      }),
    });

    assert.equal(response.response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(harness.reserveSlots.state.members[0].name, "Alpha");
    assert.equal(harness.playerDatabase.state.players[0].qq_number, "99887766");
    assert.equal(harness.playerDatabase.state.players[0].qq_name, "Alpha");

    const snapshot = await harness.service.db.get(
      "SELECT reserve_name FROM exchange_claims ORDER BY id DESC LIMIT 1",
    );
    assert.equal(snapshot?.reserve_name, "Alpha");
  } finally {
    await harness.shutdown().catch(() => {});
    await harness.dispose().catch(() => {});
  }
}

async function main() {
  await testPickGrantPlanBoundaries();
  await testPublicClaimLoginAndSettingsFlow();
  await testFailedGrantCanRetry();
  await testExistingReserveSlotStillAllowsNewGrant();
  await testReserveNameUsesDatabaseName();
  await testMatchTimeRequirement();
  console.log("reserve exchange tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
