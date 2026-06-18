import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { createDatabase } from "../core/database.js";
import { PlayerRepository } from "../repositories/player-repository.js";
import { WebServer } from "../core/web-server.js";

function createServer(overrides = {}) {
  return new WebServer({
    config: {
      enabled: false,
      ...overrides.config,
    },
    logger: {
      info() {},
      warn() {},
      error() {},
      ...overrides.logger,
    },
    core: {
      pluginManager: {
        instances: [],
      },
      ...overrides.core,
    },
    modules: overrides.modules ?? {},
  });
}

function createRecorder() {
  const state = {
    status: null,
    headers: null,
    body: null,
  };

  return {
    state,
    res: {
      writeHead(status, headers) {
        state.status = status;
        state.headers = headers;
      },
      end(body) {
        state.body = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "");
      },
    },
  };
}

async function createTempRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-steam-friends-"));
  const db = await createDatabase({ dir, filename: "test.db" });
  const repo = new PlayerRepository(db);
  await repo.hydrateCache();
  return { dir, db, repo };
}

async function testRepositorySteamFriendsLifecycle() {
  const { dir, db, repo } = await createTempRepo();

  try {
    const createdAt = Date.now();
    // 1. Insert two players: player A and player B
    const playerA = await db.run(
      `INSERT INTO players (current_name, steam_id, eos_id, current_ip, created_at, updated_at, server_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "PlayerA",
      "76561198000000001",
      "eos-a",
      "10.0.0.1",
      createdAt,
      createdAt,
      100
    );
    const playerIdA = playerA.lastID;

    const playerB = await db.run(
      `INSERT INTO players (current_name, steam_id, eos_id, current_ip, created_at, updated_at, server_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "PlayerB",
      "76561198000000002",
      "eos-b",
      "10.0.0.2",
      createdAt,
      createdAt,
      200
    );
    const playerIdB = playerB.lastID;

    // 2. Add friends list for Player A. One friend is Player B, another is an external player C
    const friends = [
      { steamID: "76561198000000002", name: "OldFriendB", avatar: "avatar-b" },
      { steamID: "76561198000000003", name: "FriendC", avatar: "avatar-c" },
    ];

    await repo.upsertSteamFriends(playerIdA, friends);

    // 3. Retrieve friends list and verify:
    // - Player B is matched in `players` table, so their name/avatar are retrieved (coalesced or direct) and dbPlayerId is set
    // - Friend C is not matched in players table, dbPlayerId is null
    const list = await repo.listSteamFriends(playerIdA);
    assert.equal(list.length, 2);

    const friendB = list.find(f => f.steamID === "76561198000000002");
    assert.ok(friendB);
    assert.equal(friendB.dbPlayerId, playerIdB);
    assert.equal(friendB.serverSeconds, 200);
    // Coalesced names/avatars
    assert.equal(friendB.name, "PlayerB");
    assert.equal(friendB.avatar, "avatar-b"); // Players doesn't have steam_avatar set in this insert, fallback to friends table

    const friendC = list.find(f => f.steamID === "76561198000000003");
    assert.ok(friendC);
    assert.equal(friendC.dbPlayerId, null);
    assert.equal(friendC.name, "FriendC");
    assert.equal(friendC.avatar, "avatar-c");

    // 4. Overwrite/upsert with empty list, verifying clear works
    await repo.upsertSteamFriends(playerIdA, []);
    const emptyList = await repo.listSteamFriends(playerIdA);
    assert.equal(emptyList.length, 0);

  } finally {
    await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testWebServerFriendsRoute() {
  const mockDatabase = {
    detailRecord: {
      player: {
        id: 10,
        steam_id: "76561198000000001",
      }
    },
    friendsList: [
      { steamID: "76561198000000002", name: "FriendB", avatar: "avatar-b", dbPlayerId: 2, serverSeconds: 50, updated_at: Date.now() }
    ],
    async getPlayerDetail(id) {
      assert.equal(id, "10");
      return this.detailRecord;
    },
    async listSteamFriends(id) {
      assert.equal(id, "10");
      return this.friendsList;
    },
    async upsertSteamFriends(id, friends) {
      assert.equal(id, "10");
      this.friendsList = friends.map(f => ({ ...f, updated_at: Date.now() }));
    }
  };

  const mockPlaytime = {
    api: {
      async fetchSteamFriends(steamID) {
        assert.equal(steamID, "76561198000000001");
        return [
          { steamID: "76561198000000002", name: "FriendB-New", avatar: "avatar-b-new" }
        ];
      }
    }
  };

  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "SuperAdmin", isSuperAdmin: true };
        },
        hasEverything() {
          return true;
        },
      },
    },
    modules: {
      playerDatabase: mockDatabase,
      playtime: mockPlaytime,
    }
  });

  // Test 1: Active cache (not stale). Should return cached friends list.
  const rec1 = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/player-database/detail/steam-friends?id=10",
    headers: { host: "localhost" },
    socket: {},
  }, rec1.res);

  assert.equal(rec1.state.status, 200);
  let body = JSON.parse(rec1.state.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].name, "FriendB");

  // Test 2: Stale cache (updated_at older than 24 hours). Should trigger fetchSteamFriends.
  mockDatabase.friendsList[0].updated_at = Date.now() - (25 * 60 * 60 * 1000);
  const rec2 = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/player-database/detail/steam-friends?id=10",
    headers: { host: "localhost" },
    socket: {},
  }, rec2.res);

  assert.equal(rec2.state.status, 200);
  body = JSON.parse(rec2.state.body);
  // Should list updated items returned from mocked fetchSteamFriends
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].name, "FriendB-New");
  // Test 3: Fresh cache, but force=true is supplied. Should trigger fetchSteamFriends and return updated list.
  mockDatabase.friendsList = [
    { steamID: "76561198000000002", name: "FriendB", avatar: "avatar-b", dbPlayerId: 2, serverSeconds: 50, updated_at: Date.now() }
  ];
  mockPlaytime.api.fetchSteamFriends = async (steamID) => {
    assert.equal(steamID, "76561198000000001");
    return [
      { steamID: "76561198000000002", name: "FriendB-Forced", avatar: "avatar-b-forced" }
    ];
  };

  const rec3 = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/player-database/detail/steam-friends?id=10&force=true",
    headers: { host: "localhost" },
    socket: {},
  }, rec3.res);

  assert.equal(rec3.state.status, 200);
  body = JSON.parse(rec3.state.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].name, "FriendB-Forced");
}

await testRepositorySteamFriendsLifecycle();
await testWebServerFriendsRoute();

console.log("steam friends unit tests passed");
