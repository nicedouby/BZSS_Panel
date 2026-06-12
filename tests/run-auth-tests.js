import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { hashPassword } from "../core/auth-crypto.js";
import { AuthManager } from "../core/auth-manager.js";
import { AuthUserStore } from "../core/auth-user-store.js";

async function testUserStorePreventsDuplicateUsernamesAndKeepsLastSuperAdmin() {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-auth-store-"));
  process.chdir(tempDir);

  try {
    const store = new AuthUserStore({
      config: {
        usersFilePath: "./data/auth/users.json",
      },
    });
    await store.start();

    const passwordHash = await hashPassword("Secret123");
    await store.createUser({ username: "Root", role: "SuperAdmin", passwordHash });

    await assert.rejects(
      () => store.createUser({ username: "root", role: "Admin", passwordHash }),
      (error) => error.code === "UserAlreadyExists",
    );

    await assert.rejects(
      () => store.setUserEnabled("Root", false),
      (error) => error.code === "LastSuperAdmin",
    );

    await assert.rejects(
      () => store.deleteUser("Root"),
      (error) => error.code === "LastSuperAdmin",
    );
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testAuthManagerBootstrapsLegacyDefaultSuperAdminOnEmptyStore() {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-auth-start-"));
  process.chdir(tempDir);

  try {
    const manager = new AuthManager({
      config: {
        enabled: true,
        usersFilePath: "./data/auth/users.json",
      },
      logger: { info() {}, warn() {}, error() {} },
    });

    await manager.start();

    const store = new AuthUserStore({
      config: {
        usersFilePath: "./data/auth/users.json",
      },
    });
    await store.start();
    const users = store.listUsers();
    assert.equal(users.length, 1);
    assert.equal(users[0].username, "DoubyBear");
    assert.equal(users[0].role, "SuperAdmin");
    assert.equal(users[0].enabled, true);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testAuthManagerRejectsNonEmptyStoreWithoutEnabledSuperAdmin() {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-auth-no-superadmin-"));
  process.chdir(tempDir);

  try {
    const store = new AuthUserStore({
      config: {
        usersFilePath: "./data/auth/users.json",
      },
    });
    await store.start();
    await store.createUser({
      username: "AdminOnly",
      role: "Admin",
      passwordHash: await hashPassword("Secret123"),
    });

    const manager = new AuthManager({
      config: {
        enabled: true,
        usersFilePath: "./data/auth/users.json",
      },
      logger: { info() {}, warn() {}, error() {} },
    });

    await assert.rejects(
      () => manager.start(),
      /no enabled SuperAdmin/i,
    );
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testAuthManagerInvalidatesSessionOnDisableAndPasswordReset() {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-auth-session-"));
  process.chdir(tempDir);

  try {
    const store = new AuthUserStore({
      config: {
        usersFilePath: "./data/auth/users.json",
      },
    });
    await store.start();
    await store.createUser({
      username: "AdminOne",
      role: "SuperAdmin",
      passwordHash: await hashPassword("Password1!"),
    });

    const manager = new AuthManager({
      config: {
        enabled: true,
        usersFilePath: "./data/auth/users.json",
      },
      logger: { info() {}, warn() {}, error() {} },
    });
    await manager.start();

    const login = await manager.login({
      username: "adminone",
      password: "Password1!",
      ip: "127.0.0.1",
    });
    assert.equal(login.ok, true);
    const req = {
      headers: {
        cookie: login.cookie.split(";", 1)[0],
      },
    };

    assert.equal(manager.getUserFromRequest(req)?.username, "AdminOne");

    await store.updatePassword("AdminOne", await hashPassword("Password2!"));
    assert.equal(manager.getUserFromRequest(req), null);

    const login2 = await manager.login({
      username: "AdminOne",
      password: "Password2!",
      ip: "127.0.0.1",
    });
    assert.equal(login2.ok, true);
    const req2 = {
      headers: {
        cookie: login2.cookie.split(";", 1)[0],
      },
    };
    assert.equal(manager.getUserFromRequest(req2)?.username, "AdminOne");

    await store.createUser({
      username: "BackupRoot",
      role: "SuperAdmin",
      passwordHash: await hashPassword("Password3!"),
    });
    await store.setUserEnabled("AdminOne", false);
    assert.equal(manager.getUserFromRequest(req2), null);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

await testUserStorePreventsDuplicateUsernamesAndKeepsLastSuperAdmin();
await testAuthManagerBootstrapsLegacyDefaultSuperAdminOnEmptyStore();
await testAuthManagerRejectsNonEmptyStoreWithoutEnabledSuperAdmin();
await testAuthManagerInvalidatesSessionOnDisableAndPasswordReset();

console.log("auth tests passed");
