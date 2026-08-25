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

async function testAuthManagerMigratesDefaultSteam64ToExistingSuperAdmin() {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-auth-steam-migration-"));
  process.chdir(tempDir);

  try {
    const store = new AuthUserStore({
      config: {
        usersFilePath: "./data/auth/users.json",
      },
    });
    await store.start();
    await store.createUser({
      username: "Root",
      role: "SuperAdmin",
      passwordHash: await hashPassword("Secret123"),
    });

    const manager = new AuthManager({
      config: {
        enabled: true,
        usersFilePath: "./data/auth/users.json",
        defaultSteam64: "76561198194428818",
        viewerTeamAutoSwapEnabled: false,
      },
      logger: { info() {}, warn() {}, error() {} },
    });
    await manager.start();

    const reloaded = new AuthUserStore({
      config: {
        usersFilePath: "./data/auth/users.json",
      },
    });
    await reloaded.start();
    const user = reloaded.findByUsername("Root");
    assert.equal(user.steam64, "76561198194428818");
    assert.equal(user.viewerTeamAutoSwapEnabled, false);
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

async function testUserStorePersistsAdminProfileFieldsAndSteamBinding() {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-auth-profile-"));
  process.chdir(tempDir);

  try {
    const store = new AuthUserStore({
      config: {
        usersFilePath: "./data/auth/users.json",
      },
    });
    await store.start();
    await store.createUser({
      username: "Root",
      role: "SuperAdmin",
      passwordHash: await hashPassword("Secret123"),
      displayName: "Root User",
      steam64: "76561198194428818",
      viewerTeamAutoSwapEnabled: false,
      note: "primary account",
    });

    const reloaded = new AuthUserStore({
      config: {
        usersFilePath: "./data/auth/users.json",
      },
    });
    await reloaded.start();
    const user = reloaded.findByUsername("root");
    assert.equal(user.displayName, "Root User");
    assert.equal(user.steam64, "76561198194428818");
    assert.equal(user.viewerTeamAutoSwapEnabled, false);
    assert.equal(user.note, "primary account");

    await assert.rejects(
      () => reloaded.createUser({
        username: "Other",
        role: "Admin",
        passwordHash: user.passwordHash,
        steam64: "bad",
      }),
      (error) => error.code === "InvalidSteam64",
    );
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testUserStoreProtectsLastSuperAdminDowngrade() {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-auth-downgrade-"));
  process.chdir(tempDir);

  try {
    const store = new AuthUserStore({
      config: {
        usersFilePath: "./data/auth/users.json",
      },
    });
    await store.start();
    await store.createUser({
      username: "Root",
      role: "SuperAdmin",
      passwordHash: await hashPassword("Secret123"),
    });

    await assert.rejects(
      () => store.updateUser("Root", { role: "Admin" }),
      (error) => error.code === "LastSuperAdmin",
    );
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testPermissionGroupsPersistAndResolveForAdminUser() {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-auth-permission-groups-"));
  process.chdir(tempDir);

  try {
    const store = new AuthUserStore({
      config: {
        usersFilePath: "./data/auth/users.json",
      },
    });
    await store.start();

    const group = await store.createPermissionGroup({
      name: "Intern Admin",
      permissions: ["rcon.warn", "rcon.broadcast", "match_state.view", "player_database.view"],
    });
    await store.createUser({
      username: "Root",
      role: "SuperAdmin",
      passwordHash: await hashPassword("Secret123"),
    });
    await store.createUser({
      username: "Operator",
      role: "Admin",
      passwordHash: await hashPassword("Secret123"),
      permissionGroupId: group.id,
    });

    const reloaded = new AuthUserStore({
      config: {
        usersFilePath: "./data/auth/users.json",
      },
    });
    await reloaded.start();

    assert.equal(reloaded.listPermissionGroups().length, 1);
    assert.equal(reloaded.findByUsername("operator")?.permissionGroupId, group.id);

    const manager = new AuthManager({
      config: {
        enabled: true,
        usersFilePath: "./data/auth/users.json",
      },
      logger: { info() {}, warn() {}, error() {} },
    });
    await manager.start();

    const safeUser = manager.safeUser(reloaded.findByUsername("operator"));
    assert.equal(safeUser.permissionGroupId, group.id);
    assert.equal(safeUser.permissionGroupName, "Intern Admin");
    assert.deepEqual(safeUser.permissions, ["rcon.warn", "rcon.broadcast", "match_state.view", "player_database.view"]);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testUserStoreAcceptsAllPermissionEditorOptions() {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-auth-permission-editor-"));
  process.chdir(tempDir);

  try {
    const store = new AuthUserStore({
      config: { usersFilePath: "./data/auth/users.json" },
    });
    await store.start();

    const group = await store.createPermissionGroup({
      name: "Permission Editor Coverage",
      permissions: [
        "rcon.settickets",
        "tactical_map_replay.view",
        "tactical_map_replay.export",
      ],
    });

    assert.deepEqual(group.permissions, [
      "rcon.settickets",
      "tactical_map_replay.view",
      "tactical_map_replay.export",
    ]);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testUserStorePersistsPanelBanPermission() {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-auth-lianban-alias-"));
  process.chdir(tempDir);

  try {
    const store = new AuthUserStore({
      config: {
        usersFilePath: "./data/auth/users.json",
      },
    });
    await store.start();
    const group = await store.createPermissionGroup({
      name: "Legacy Alias Group",
      permissions: ["plugin:panel-ban:view", "rcon.warn"],
    });

    const reloaded = new AuthUserStore({
      config: {
        usersFilePath: "./data/auth/users.json",
      },
    });
    await reloaded.start();

    const savedGroup = reloaded.getPermissionGroupById(group.id);
    assert.deepEqual(savedGroup.permissions, ["plugin:panel-ban:view", "rcon.warn"]);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testPermissionGroupDeleteRejectsAssignedUsers() {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-auth-permission-group-in-use-"));
  process.chdir(tempDir);

  try {
    const store = new AuthUserStore({
      config: {
        usersFilePath: "./data/auth/users.json",
      },
    });
    await store.start();
    const group = await store.createPermissionGroup({
      name: "Senior Admin",
      permissions: ["rcon.tb"],
    });
    await store.createUser({
      username: "Root",
      role: "SuperAdmin",
      passwordHash: await hashPassword("Secret123"),
    });
    await store.createUser({
      username: "Operator",
      role: "Admin",
      passwordHash: await hashPassword("Secret123"),
      permissionGroupId: group.id,
    });

    await assert.rejects(
      () => store.deletePermissionGroup(group.id),
      (error) => error.code === "PermissionGroupInUse",
    );
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}


async function testAuthWatcherLifecycleAndExternalRefresh() {
  const originalCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-auth-watcher-"));
  process.chdir(tempDir);

  const store = new AuthUserStore({
    config: { usersFilePath: "./data/auth/users.json" },
    logger: { warn() {} },
  });
  try {
    await store.start();
    await store.createUser({
      username: "Root",
      role: "SuperAdmin",
      passwordHash: await hashPassword("Secret123"),
    });

    const firstWatcher = store.fileWatcher;
    await store.start();
    assert.equal(store.fileWatcher, firstWatcher);

    const usersPath = path.resolve("./data/auth/users.json");
    const originalStats = await fs.stat(usersPath);
    const document = JSON.parse(await fs.readFile(usersPath, "utf8"));
    document.users[0].username = "ExternallyEdited";
    document.users[0].usernameNormalized = "externallyedited";
    const changedText = `${JSON.stringify(document, null, 2)}\n`;
    await fs.writeFile(usersPath, changedText, "utf8");
    await fs.utimes(usersPath, originalStats.atime, originalStats.mtime);

    assert.equal(await store.refreshFromDiskIfChanged(), true);
    assert.equal(store.findByUsername("ExternallyEdited")?.username, "ExternallyEdited");

    await fs.writeFile(usersPath, "{", "utf8");
    setTimeout(() => {
      void fs.writeFile(usersPath, changedText, "utf8");
    }, 50);
    assert.equal(await store.refreshFromDiskIfChanged(), false);
    assert.equal(store.findByUsername("ExternallyEdited")?.username, "ExternallyEdited");

    await fs.rm(usersPath, { force: true });
    assert.equal(await store.refreshFromDiskIfChanged(), true);
    assert.equal(store.listUsers().length, 0);
  } finally {
    await store.stop();
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

await testUserStorePreventsDuplicateUsernamesAndKeepsLastSuperAdmin();
await testAuthManagerBootstrapsLegacyDefaultSuperAdminOnEmptyStore();
await testAuthManagerMigratesDefaultSteam64ToExistingSuperAdmin();
await testAuthManagerRejectsNonEmptyStoreWithoutEnabledSuperAdmin();
await testAuthManagerInvalidatesSessionOnDisableAndPasswordReset();
await testUserStorePersistsAdminProfileFieldsAndSteamBinding();
await testUserStoreProtectsLastSuperAdminDowngrade();
await testPermissionGroupsPersistAndResolveForAdminUser();
await testUserStorePersistsPanelBanPermission();
await testUserStoreAcceptsAllPermissionEditorOptions();
await testPermissionGroupDeleteRejectsAssignedUsers();
await testAuthWatcherLifecycleAndExternalRefresh();

console.log("auth tests passed");
