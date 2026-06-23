import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import createPublicInterfaceModule from "../modules/public-interface/index.js";

function createConfig(publicInterfaceConfig) {
  return {
    get(key, fallback) {
      if (key === "modules.publicInterface") {
        return publicInterfaceConfig;
      }
      return fallback;
    },
  };
}

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

function createModule({
  publicInterfaceConfig = {},
  webStatusSnapshot = {},
  matchStateSnapshot = null,
  rconStatus = null,
  tacticalPlayers = [],
  playerStateSnapshot = null,
  playerDatabaseRows = [],
} = {}) {
  const core = {
    webStatus: {
      getSnapshot() {
        return { ...webStatusSnapshot };
      },
      ...webStatusSnapshot,
    },
    rconManager: rconStatus == null
      ? null
      : {
          getStatus() {
            return { ...rconStatus };
          },
        },
  };

  const modules = {
    playerState: playerStateSnapshot == null
      ? null
      : {
          getState(serverId) {
            return {
              serverId,
              updatedAt: playerStateSnapshot.updatedAt ?? "2026-06-23T05:00:00.000Z",
              players: clone(playerStateSnapshot.players ?? []),
            };
          },
          getPlayerList(serverId) {
            return clone(playerStateSnapshot.players ?? []);
          },
          getPlayerBySteamID(serverId, steamID) {
            return (playerStateSnapshot.players ?? []).find((player) => String(player.steamID ?? player.steam64ID ?? "") === String(steamID)) ?? null;
          },
          getPlayerByEOSID(serverId, eosID) {
            return (playerStateSnapshot.players ?? []).find((player) => String(player.eosID ?? player.eosId ?? "") === String(eosID)) ?? null;
          },
          findPlayer(serverId, identity = {}) {
            const playerID = String(identity.playerID ?? identity.playerId ?? "").trim().replace(/^#\s*/, "");
            const steamID = String(identity.steam64ID ?? identity.steamID ?? identity.steamId ?? "").trim();
            const eosID = String(identity.eosID ?? identity.eosId ?? "").trim();
            const name = String(identity.name ?? identity.playerName ?? "").trim().toLowerCase();
            return (playerStateSnapshot.players ?? []).find((player) => {
              if (playerID && String(player.playerID ?? "") !== playerID) return false;
              if (steamID && String(player.steamID ?? player.steam64ID ?? "") !== steamID) return false;
              if (eosID && String(player.eosID ?? player.eosId ?? "") !== eosID) return false;
              if (name && !String(player.name ?? player.playerName ?? "").toLowerCase().includes(name)) return false;
              return true;
            }) ?? null;
          },
        },
    matchState: matchStateSnapshot == null
      ? null
      : {
          getState() {
            return clone(matchStateSnapshot);
          },
          getOverview() {
            return { matchState: clone(matchStateSnapshot) };
          },
        },
    bzssCoreMonitor: {
      getPlayers() {
        return tacticalPlayers.map((item) => ({ ...item }));
      },
      getState() {
        return { updatedAt: "2026-06-23T05:01:00.000Z" };
      },
    },
    playerDatabase: playerDatabaseRows.length
      ? {
          async listPlayersByIdentities({ steamIDs = [], eosIDs = [] } = {}) {
            return playerDatabaseRows.filter((row) => {
              const steam = String(row.steam_id ?? row.steamID ?? row.steam64ID ?? "").trim();
              const eos = String(row.eos_id ?? row.eosID ?? row.eosId ?? "").trim();
              return (steam && steamIDs.includes(steam)) || (eos && eosIDs.includes(eos));
            });
          },
          async listPlayersBySteamIDs(steamIDs = []) {
            return playerDatabaseRows.filter((row) => steamIDs.includes(String(row.steam_id ?? row.steamID ?? row.steam64ID ?? "").trim()));
          },
        }
      : null,
  };

  return createPublicInterfaceModule({
    config: createConfig(publicInterfaceConfig),
    logger: createLogger(),
    core,
    modules,
  });
}

function createJsonRecorder() {
  const state = {
    status: null,
    payload: null,
  };

  return {
    state,
    json(status, payload) {
      state.status = status;
      state.payload = payload;
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSocketMock() {
  const emitter = new EventEmitter();
  const writes = [];
  return {
    writes,
    destroyed: false,
    headers: {},
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
    write(chunk) {
      writes.push(chunk);
      return true;
    },
    end(chunk) {
      if (chunk) writes.push(chunk);
      this.destroyed = true;
      emitter.emit("close");
    },
    destroy() {
      this.destroyed = true;
      emitter.emit("close");
    },
  };
}

function encodeClientWsText(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = [];
  header.push(0x81);
  if (payload.length < 126) {
    header.push(0x80 | payload.length);
  } else if (payload.length < 65536) {
    header.push(0x80 | 126);
    header.push((payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    throw new Error("Test payload unexpectedly large.");
  }
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) {
    masked[i] ^= mask[i % 4];
  }
  return Buffer.concat([Buffer.from(header), mask, masked]);
}

function decodeServerWsFrame(chunk) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const second = buffer[1];
  let offset = 2;
  let length = second & 0x7f;
  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    const big = buffer.readBigUInt64BE(offset);
    length = Number(big);
    offset += 8;
  }
  const payload = buffer.subarray(offset, offset + length);
  return payload.toString("utf8");
}

async function testServerSnapshotIncludesSummary() {
  const module = createModule({
    publicInterfaceConfig: {
      enabled: true,
      allowAnonymous: false,
      tokens: [
        {
          token: "token-1",
          scopes: ["server:read", "players:read", "squads:read", "match:read", "tactical:read", "ws:read"],
        },
      ],
    },
    webStatusSnapshot: {
      serverId: "BZSS_Test",
      serverName: "Test Server",
      playerCount: null,
      queueCount: null,
      tps: null,
      tpsStatus: "unknown",
      playtime: null,
      updatedAt: "2026-06-23T05:10:00.000Z",
    },
    matchStateSnapshot: {
      updatedAt: "2026-06-23T05:12:00.000Z",
      serverStatus: {
        map: "Narva",
        layer: "Narva RAAS v1",
        playerCount: 48,
        queueCount: 6,
        playtime: 1234,
        tps: 29,
        tpsStatus: "good",
      },
      match: {
        map: "Narva",
        layer: "Narva RAAS v1",
        playtime: 1234,
      },
      players: {
        count: 48,
        list: Array.from({ length: 48 }, (_, index) => ({ playerID: String(index + 1), name: `Player ${index + 1}` })),
      },
      squads: { count: 3, list: [] },
    },
    rconStatus: {
      lastPlayersRefresh: "2026-06-23T05:11:00.000Z",
      lastSquadsRefresh: "2026-06-23T05:11:30.000Z",
    },
  });

  const summary = module.api.getPublicServerSummary();
  assert.equal(summary.serverId, "BZSS_Test");
  assert.equal(summary.serverName, "Test Server");
  assert.equal(summary.playerCount, 48);
  assert.equal(summary.queueCount, 6);
  assert.equal(summary.currentMap, "Narva");
  assert.equal(summary.currentLayer, "Narva RAAS v1");
  assert.equal(summary.tps, 29);
  assert.equal(summary.tpsStatus, "good");
  assert.equal(summary.rconTime, 1234);
  assert.equal(summary.updatedAt, "2026-06-23T05:12:00.000Z");

  const serverRecorder = createJsonRecorder();
  await module.api.handleHttp({
    url: new URL("http://127.0.0.1/api/public/v1/server"),
    req: { headers: { authorization: "Bearer token-1" } },
    json: serverRecorder.json,
    ip: "127.0.0.1",
  });

  assert.equal(serverRecorder.state.status, 200);
  assert.equal(serverRecorder.state.payload.data.summary.currentMap, "Narva");
  assert.equal(serverRecorder.state.payload.data.summary.rconTime, 1234);

  const allRecorder = createJsonRecorder();
  await module.api.handleHttp({
    url: new URL("http://127.0.0.1/api/public/v1/all"),
    req: { headers: { authorization: "Bearer token-1" } },
    json: allRecorder.json,
    ip: "127.0.0.1",
  });

  assert.equal(allRecorder.state.status, 200);
  assert.equal(allRecorder.state.payload.data.server.summary.playerCount, 48);
  assert.equal(allRecorder.state.payload.data.server.summary.currentLayer, "Narva RAAS v1");
}

async function testSummaryFallsBackWhenSnapshotsAreMissing() {
  const module = createModule({
    publicInterfaceConfig: {
      enabled: true,
      allowAnonymous: false,
      tokens: [
        {
          token: "token-2",
          scopes: ["server:read", "ws:read"],
        },
      ],
    },
    webStatusSnapshot: {
      serverId: "BZSS_Fallback",
      serverName: "Fallback Server",
      playerCount: 7,
      queueCount: 2,
      tps: 26,
      tpsStatus: "warning",
      playtime: 88,
      map: "Yehorivka",
      layer: "Yehorivka_RAAS_v1",
      updatedAt: "2026-06-23T06:00:00.000Z",
    },
    matchStateSnapshot: null,
    rconStatus: null,
  });

  const summary = module.api.getPublicServerSummary();
  assert.equal(summary.serverId, "BZSS_Fallback");
  assert.equal(summary.serverName, "Fallback Server");
  assert.equal(summary.playerCount, 7);
  assert.equal(summary.queueCount, 2);
  assert.equal(summary.currentMap, "Yehorivka");
  assert.equal(summary.currentLayer, "Yehorivka_RAAS_v1");
  assert.equal(summary.tps, 26);
  assert.equal(summary.tpsStatus, "warning");
  assert.equal(summary.rconTime, 88);
  assert.equal(summary.updatedAt, "2026-06-23T06:00:00.000Z");

  const recorder = createJsonRecorder();
  await module.api.handleHttp({
    url: new URL("http://127.0.0.1/api/public/v1/server"),
    req: { headers: { authorization: "Bearer token-2" } },
    json: recorder.json,
    ip: "127.0.0.1",
  });

  assert.equal(recorder.state.status, 200);
  assert.equal(recorder.state.payload.data.summary.currentMap, "Yehorivka");
  assert.equal(recorder.state.payload.data.summary.rconTime, 88);
}

async function testWsPlayersSnapshotAndDetailQueries() {
  const module = createModule({
    publicInterfaceConfig: {
      enabled: true,
      allowAnonymous: true,
    },
    webStatusSnapshot: {
      serverId: "BZSS_WS",
      serverName: "WS Test Server",
      updatedAt: "2026-06-23T06:10:00.000Z",
    },
    matchStateSnapshot: {
      updatedAt: "2026-06-23T06:11:00.000Z",
      players: {
        count: 3,
        list: [
          { playerID: "1", name: "Alpha One", steamID: "steam-1", eosID: "eos-1", teamID: "1", squadID: "2", isLeader: true, role: "Squad Leader", ping: 35, health: 92, weaponClass: "M4", ammoValues: [30, 90], position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 90, z: 0 } },
          { playerID: "2", name: "Alpha Two", steamID: "steam-2", eosID: "eos-2", teamID: "1", squadID: "2", isLeader: false, role: "Rifleman", ping: 48, health: 86, weaponClass: "AK", ammoValues: [25, 75], position: { x: 4, y: 5, z: 6 }, rotation: { x: 0, y: 180, z: 0 } },
          { playerID: "3", name: "Bravo", steamID: "steam-3", eosID: "eos-3", teamID: "2", squadID: "4", isLeader: false, role: "Medic", ping: 61, health: 100, weaponClass: "M16", ammoValues: [20, 60], position: { x: 7, y: 8, z: 9 }, rotation: { x: 0, y: 270, z: 0 } },
        ],
      },
    },
    playerStateSnapshot: {
      updatedAt: "2026-06-23T06:12:00.000Z",
      players: [
        { playerID: "1", name: "Alpha One", steamID: "steam-1", eosID: "eos-1", teamID: "1", squadID: "2", isLeader: true, role: "Squad Leader", ping: 35, health: 92, weaponClass: "M4", ammoValues: [30, 90], position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 90, z: 0 } },
        { playerID: "2", name: "Alpha Two", steamID: "steam-2", eosID: "eos-2", teamID: "1", squadID: "2", isLeader: false, role: "Rifleman", ping: 48, health: 86, weaponClass: "AK", ammoValues: [25, 75], position: { x: 4, y: 5, z: 6 }, rotation: { x: 0, y: 180, z: 0 } },
        { playerID: "3", name: "Bravo", steamID: "steam-3", eosID: "eos-3", teamID: "2", squadID: "4", isLeader: false, role: "Medic", ping: 61, health: 100, weaponClass: "M16", ammoValues: [20, 60], position: { x: 7, y: 8, z: 9 }, rotation: { x: 0, y: 270, z: 0 } },
      ],
    },
    playerDatabaseRows: [
      { steam_id: "steam-1", eos_id: "eos-1", current_ip: "10.0.0.1" },
      { steam_id: "steam-2", eos_id: "eos-2", current_ip: "10.0.0.2" },
      { steam_id: "steam-3", eos_id: "eos-3", current_ip: "10.0.0.3" },
    ],
    tacticalPlayers: [
      {
        playerGuid: "eos-1",
        playerName: "Alpha One",
        ftIndex: 11,
        ftPosition: 21,
        ping: 35,
        soldierInfo: {
          health: 92,
          weaponClass: "M4",
          ammoValues: [30, 90],
          position: { x: 1, y: 2, z: 3 },
          rotation: { x: 0, y: 90, z: 0 },
        },
      },
      {
        playerGuid: "eos-2",
        playerName: "Alpha Two",
        ftIndex: 12,
        ftPosition: 22,
        ping: 48,
        soldierInfo: {
          health: 86,
          weaponClass: "AK",
          ammoValues: [25, 75],
          position: { x: 4, y: 5, z: 6 },
          rotation: { x: 0, y: 180, z: 0 },
        },
      },
      {
        playerGuid: "eos-3",
        playerName: "Bravo",
        ftIndex: 13,
        ftPosition: 23,
        ping: 61,
        soldierInfo: {
          health: 100,
          weaponClass: "M16",
          ammoValues: [20, 60],
          position: { x: 7, y: 8, z: 9 },
          rotation: { x: 0, y: 270, z: 0 },
        },
      },
    ],
  });

  const socket = createSocketMock();
  const req = {
    headers: {
      host: "localhost",
      "sec-websocket-key": "dGVzdC1rZXk=",
    },
    url: "/ws/public/v1",
  };

  const accepted = module.api.handleUpgrade({ req, socket, head: Buffer.alloc(0) });
  assert.equal(accepted, true);
  assert.match(String(socket.writes[0]), /101 Switching Protocols/);

  socket.emit("data", encodeClientWsText({ type: "players:list" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  let payload = decodeServerWsFrame(socket.writes.at(-1));
  let response = JSON.parse(payload);
  assert.equal(response.type, "players:list");
  assert.equal(response.ok, true);
  assert.equal(response.matchedCount, 3);
  assert.equal(response.players[0].playerIdLabel, "# 1");
  assert.equal(response.players[0].ip, "10.0.0.1");
  assert.equal(response.players[0].latency, 35);
  assert.equal(response.players[0].ftIndex, 11);
  assert.equal(response.players[0].ftPosition, 21);
  assert.deepEqual(response.players[0].ammoValues, [30, 90]);
  assert.deepEqual(response.players[0].position, { x: 1, y: 2, z: 3 });

  socket.emit("data", encodeClientWsText({ type: "players:detail", query: { playerID: "# 2" } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  payload = decodeServerWsFrame(socket.writes.at(-1));
  response = JSON.parse(payload);
  assert.equal(response.type, "players:detail");
  assert.equal(response.ok, true);
  assert.equal(response.matchedCount, 1);
  assert.equal(response.players[0].name, "Alpha Two");
  assert.equal(response.players[0].ip, "10.0.0.2");
  assert.equal(response.players[0].currentWeapon, "AK");

  socket.emit("data", encodeClientWsText({ type: "players:detail", query: { steam64ID: "steam-3" } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  payload = decodeServerWsFrame(socket.writes.at(-1));
  response = JSON.parse(payload);
  assert.equal(response.matchedCount, 1);
  assert.equal(response.players[0].eosID, "eos-3");
  assert.equal(response.players[0].health, 100);

  socket.emit("data", encodeClientWsText({ type: "players:detail", query: { name: "Alpha" } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  payload = decodeServerWsFrame(socket.writes.at(-1));
  response = JSON.parse(payload);
  assert.equal(response.matchedCount, 2);
  assert.deepEqual(response.players.map((player) => player.name), ["Alpha One", "Alpha Two"]);

  socket.emit("data", encodeClientWsText({ type: "players:detail", query: { name: "Nobody" } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  payload = decodeServerWsFrame(socket.writes.at(-1));
  response = JSON.parse(payload);
  assert.equal(response.matchedCount, 0);
  assert.deepEqual(response.players, []);
}

async function testWsPlayersFallbackToMatchStateWhenPlayerStateEmpty() {
  const module = createModule({
    publicInterfaceConfig: {
      enabled: true,
      allowAnonymous: true,
    },
    matchStateSnapshot: {
      updatedAt: "2026-06-23T07:00:00.000Z",
      players: {
        list: [
          { playerID: "9", name: "Fallback Player", steamID: "steam-fallback", eosID: "eos-fallback", teamID: "1", squadID: "0", isLeader: false, role: "Rifleman", ping: 55 },
        ],
      },
      squads: { list: [] },
    },
    playerStateSnapshot: {
      updatedAt: "2026-06-23T07:00:00.000Z",
      players: [],
    },
  });

  const snapshot = await module.api.getPublicPlayerSnapshot();
  assert.equal(snapshot.matchedCount, 1);
  assert.equal(snapshot.players[0].name, "Fallback Player");
  assert.equal(snapshot.players[0].playerID, "9");
}

await testServerSnapshotIncludesSummary();
await testSummaryFallsBackWhenSnapshotsAreMissing();
await testWsPlayersSnapshotAndDetailQueries();
await testWsPlayersFallbackToMatchStateWhenPlayerStateEmpty();

console.log("public interface tests passed");
