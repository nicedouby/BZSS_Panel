import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

async function startService({ failOnce = false } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reserve-exchange-test-"));
  const originalCwd = process.cwd();
  process.chdir(tempDir);

  const authManager = await createAuthManager(tempDir);
  const reserveSlots = createReserveSlotsMock({ failOnce });
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
      logger: { info() {}, warn() {}, error() {} },
    },
    modules: {
      reserveSlots: reserveSlots.api,
    },
    config,
    logger: { info() {}, warn() {}, error() {} },
  });

  await service.start();

  return {
    tempDir,
    originalCwd,
    authManager,
    reserveSlots,
    config,
    service,
    async stop() {
      await service.stop();
      await authManager.stop?.();
      process.chdir(originalCwd);
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
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
  } finally {
    await harness.stop();
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
  } finally {
    await harness.stop();
  }
}

async function main() {
  await testPickGrantPlanBoundaries();
  await testPublicClaimLoginAndSettingsFlow();
  await testFailedGrantCanRetry();
  console.log("reserve exchange tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
