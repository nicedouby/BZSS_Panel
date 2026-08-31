import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { WebServer } from "../core/web-server.js";
import { createAstrbotBridgeModule } from "../modules/astrbot-bridge/index.js";

function createRecorder() {
  const state = { status: null, headers: null, body: null };
  return {
    state,
    res: {
      writeHead(status, headers) {
        state.status = status;
        state.headers = headers;
      },
      end(body) {
        state.body = Buffer.isBuffer(body) ? body : String(body ?? "");
      },
    },
  };
}

function createConfig(state) {
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
    set() {},
    async save() {},
  };
}

async function main() {
  const playerStore = [
    {
      id: 1,
      current_name: "Alpha",
      steam_id: "76561198000000001",
      eos_id: null,
      steam_avatar: "https://example.com/avatar.png",
      qq_number: null,
      qq_name: null,
      qq_bound_at: null,
      updated_at: Date.now(),
    },
  ];

  const state = {
    modules: {
      astrbotBridge: {
        enabled: true,
        apiToken: "astrbot-secret",
        trustedIps: [],
        allowedActions: ["bindProfile", "setWarmup", "toggleWarmup"],
      },
    },
  };

  const config = createConfig(state);
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const core = {
    config,
    logger,
    createLogger() {
      return logger;
    },
    webStatus: {
      getSnapshot() {
        return {
          serverId: "BZSS_Main",
          serverName: "BZSS Main Server",
          playerCount: 12,
          maxPlayers: 100,
          queueCount: 1,
          map: "Tallil",
          layer: "Tallil_RAAS_v1",
          gameMode: "RAAS",
          playtime: 3661,
          isWarmup: false,
        };
      },
      getWarmupState() {
        return { isWarmup: false };
      },
      async setWarmup(isWarmup, meta = {}) {
        return { isWarmup: Boolean(isWarmup), updatedBy: meta?.updatedBy ?? null };
      },
    },
    authManager: {
      getUserFromRequest() {
        return null;
      },
    },
  };

  const astrbotBridge = createAstrbotBridgeModule({
    core,
    modules: {
      matchState: {
        api: {
          getOverview() {
            const players = [
              {
                playerID: 1,
                name: "Alpha",
                teamID: 1,
                squadID: 10,
                role: "SquadLeader",
                isLeader: true,
                steamID: "76561198000000001",
                steamAvatar: "https://example.com/avatar.png",
                gameSeconds: 7200,
              },
              {
                playerID: 2,
                name: "Bravo",
                teamID: 2,
                squadID: 10,
                role: "Commander",
                isLeader: true,
                steamID: "76561198000000002",
                gameSeconds: 3600,
              },
            ];
            const squads = [
              { teamID: 1, squadID: 10, squadName: "Command Squad", teamName: "49th Combined Arms Army", size: 1 },
              { teamID: 2, squadID: 10, squadName: "Command Squad", teamName: "1st Marines Regiment", size: 1 },
            ];
            return {
              status: {
                serverId: "BZSS_Main",
                serverName: "BZSS Main Server",
                map: "Tallil",
                layer: "Tallil_RAAS_v1",
                gameMode: "RAAS",
                maxPlayers: 100,
                queueCount: 3,
                playtime: 3661,
              },
              matchState: {
                serverId: "BZSS_Main",
                players: { list: players },
                squads: { list: squads },
              },
              players,
              squads,
            };
          },
        },
      },
      matchSnapshot: {
        api: {
          async takeManualSnapshot() {
            return {
              id: "server-info-test-snapshot",
              fileName: "server-info-BZSS_Main.png",
            };
          },
          async readSnapshotArtifact() {
            return {
              contentType: "image/png",
              content: Buffer.from([
                0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
                0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
              ]),
              fileName: "server-info-BZSS_Main.png",
            };
          },
        },
      },
      playerDatabase: {
        async findByIdentity(identity = {}) {
          if (identity.steamID) {
            return playerStore.find((item) => item.steam_id === identity.steamID) ?? null;
          }
          if (identity.qqNumber) {
            return playerStore.find((item) => item.qq_number === identity.qqNumber) ?? null;
          }
          return null;
        },
        async bindQQToPlayer(playerId, binding = {}) {
          const row = playerStore.find((item) => item.id === Number(playerId));
          if (!row) return null;
          row.qq_number = String(binding.qqNumber ?? "").trim() || null;
          row.qq_name = String(binding.qqName ?? "").trim() || null;
          row.qq_bound_at = Date.now();
          row.updated_at = Date.now();
          return { ...row };
        },
        async unbindQQFromPlayer(playerId) {
          const row = playerStore.find((item) => item.id === Number(playerId));
          if (!row) return null;
          row.qq_number = null;
          row.qq_name = null;
          row.qq_bound_at = null;
          row.updated_at = Date.now();
          return { ...row };
        },
        async getPlayerDetail(playerId) {
          const row = playerStore.find((item) => item.id === Number(playerId));
          if (!row) return null;
          return {
            player: {
              id: row.id,
              current_name: row.current_name,
              steam_id: row.steam_id,
              eos_id: row.eos_id,
              qq_number: row.qq_number,
              qq_name: row.qq_name,
              qq_bound_at: row.qq_bound_at,
              updated_at: row.updated_at,
              game_seconds: 7200,
              steam_game_seconds: 7200,
            },
            summary: {
              gameSeconds: 7200,
              steamGameSeconds: 7200,
              gameSecondsOverride: null,
              serverSeconds: 7200,
            },
          };
        },
      },
    },
    config,
    logger,
  });
  await astrbotBridge.init();

  const server = new WebServer({
    config: { enabled: false, host: "127.0.0.1", port: 8899, staticDirectory: "./web-client/dist" },
    logger,
    core: {
      ...core,
      pluginManager: { instances: [] },
      authManager: {
        getUserFromRequest() {
          return null;
        },
      },
    },
    modules: {
      astrbotBridge: astrbotBridge.api,
    },
  });

  const health = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/astrbot/health",
    headers: { host: "localhost" },
    socket: { remoteAddress: "127.0.0.1" },
  }, health.res);
  assert.equal(health.state.status, 200);

  const denied = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/astrbot/status",
    headers: { host: "localhost" },
    socket: { remoteAddress: "127.0.0.1" },
  }, denied.res);
  assert.equal(denied.state.status, 401);

  const bindRecorder = createRecorder();
  const bindReq = Readable.from([JSON.stringify({
    qqNumber: "12345678",
    qqName: "AstrBotUser",
    steam64: "76561198000000001",
  })]);
  bindReq.method = "POST";
  bindReq.url = "/api/astrbot/bind";
  bindReq.headers = {
    host: "localhost",
    authorization: "Bearer astrbot-secret",
    "content-type": "application/json",
  };
  bindReq.socket = { remoteAddress: "127.0.0.1" };
  await server.handleRequest(bindReq, bindRecorder.res);
  assert.equal(bindRecorder.state.status, 200);
  const bindBody = JSON.parse(bindRecorder.state.body);
  assert.equal(bindBody.data.player.qqNumber, "12345678");
  assert.equal(bindBody.data.player.qqName, "AstrBotUser");
  assert.equal(bindBody.data.player.gameName, "Alpha");
  assert.equal(bindBody.data.player.steam64, "76561198000000001");
  assert.equal(bindBody.data.player.steamAvatar, "https://example.com/avatar.png");
  assert.equal(bindBody.data.message, "已成功为 AstrBotUser（12345678）绑定至 Alpha（76561198000000001）");

  const queryRecorder = createRecorder();
  const queryReq = Readable.from([JSON.stringify({
    qqNumber: "12345678",
    qqName: "AstrBotUser",
  })]);
  queryReq.method = "POST";
  queryReq.url = "/api/astrbot/query";
  queryReq.headers = {
    host: "localhost",
    authorization: "Bearer astrbot-secret",
    "content-type": "application/json",
  };
  queryReq.socket = { remoteAddress: "127.0.0.1" };
  await server.handleRequest(queryReq, queryRecorder.res);
  assert.equal(queryRecorder.state.status, 200);
  const queryBody = JSON.parse(queryRecorder.state.body);
  assert.equal(queryBody.binding.player.qqNumber, "12345678");

  const serverInfoRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/astrbot/server-info",
    headers: {
      host: "localhost",
      authorization: "Bearer astrbot-secret",
    },
    socket: { remoteAddress: "127.0.0.1" },
  }, serverInfoRecorder.res);
  assert.equal(serverInfoRecorder.state.status, 200);
  const serverInfoBody = JSON.parse(serverInfoRecorder.state.body);
  assert.equal(serverInfoBody.data.server.serverName, "BZSS Main Server");
  assert.equal(serverInfoBody.data.match.map, "Tallil");
  assert.equal(serverInfoBody.data.match.rconTime, "01:01:01");
  assert.equal(serverInfoBody.data.population.players, 2);
  assert.equal(serverInfoBody.data.population.maxPlayers, 100);
  assert.equal(serverInfoBody.data.population.queue, 3);
  assert.ok(["runtimeState", "matchState"].includes(serverInfoBody.data.source));
  assert.equal(serverInfoBody.data.teams[0].factionCode, "RGF");
  assert.equal(serverInfoBody.data.teams[1].factionCode, "USMC");
  assert.equal(serverInfoBody.data.commanders["1"].name, "Alpha");
  assert.equal(serverInfoBody.data.commanders["2"].name, "Bravo");

  const serverInfoQueryRecorder = createRecorder();
  const serverInfoQueryReq = Readable.from([JSON.stringify({
    kind: "serverInfo",
    qqNumber: "12345678",
    qqName: "AstrBotUser",
  })]);
  serverInfoQueryReq.method = "POST";
  serverInfoQueryReq.url = "/api/astrbot/query";
  serverInfoQueryReq.headers = {
    host: "localhost",
    authorization: "Bearer astrbot-secret",
    "content-type": "application/json",
  };
  serverInfoQueryReq.socket = { remoteAddress: "127.0.0.1" };
  await server.handleRequest(serverInfoQueryReq, serverInfoQueryRecorder.res);
  assert.equal(serverInfoQueryRecorder.state.status, 200);
  const serverInfoQueryBody = JSON.parse(serverInfoQueryRecorder.state.body);
  assert.equal(serverInfoQueryBody.data.data.serverInfo.match.layer, "Tallil_RAAS_v1");

  const meRecorder = createRecorder();
  const meReq = Readable.from([JSON.stringify({
    qqNumber: "12345678",
    qqName: "AstrBotUser",
  })]);
  meReq.method = "POST";
  meReq.url = "/api/astrbot/me";
  meReq.headers = {
    host: "localhost",
    authorization: "Bearer astrbot-secret",
    "content-type": "application/json",
  };
  meReq.socket = { remoteAddress: "127.0.0.1" };
  await server.handleRequest(meReq, meRecorder.res);
  assert.equal(meRecorder.state.status, 200);
  const meBody = JSON.parse(meRecorder.state.body);
  assert.equal(meBody.binding.player.qqNumber, "12345678");
  assert.equal(meBody.data.data.player.gameName, "Alpha");
  assert.equal(meBody.data.data.player.steam64, "76561198000000001");
  assert.equal(meBody.data.data.player.steamAvatar, "https://example.com/avatar.png");

  const meRecorder2 = createRecorder();
  const meReq2 = Readable.from([JSON.stringify({
    qqNumber: "12345678",
    qqName: "NewAstrBotUser",
  })]);
  meReq2.method = "POST";
  meReq2.url = "/api/astrbot/me";
  meReq2.headers = {
    host: "localhost",
    authorization: "Bearer astrbot-secret",
    "content-type": "application/json",
  };
  meReq2.socket = { remoteAddress: "127.0.0.1" };
  await server.handleRequest(meReq2, meRecorder2.res);
  assert.equal(meRecorder2.state.status, 200);
  const meBody2 = JSON.parse(meRecorder2.state.body);
  assert.equal(meBody2.binding.player.qqName, "NewAstrBotUser");
  assert.equal(playerStore[0].qq_name, "NewAstrBotUser");

  const meSnapshotRecorder = createRecorder();
  const meSnapshotReq = Readable.from([JSON.stringify({
    qqNumber: "12345678",
    qqName: "NewAstrBotUser",
  })]);
  meSnapshotReq.method = "POST";
  meSnapshotReq.url = "/api/astrbot/me/snapshot";
  meSnapshotReq.headers = {
    host: "localhost",
    authorization: "Bearer astrbot-secret",
    "content-type": "application/json",
  };
  meSnapshotReq.socket = { remoteAddress: "127.0.0.1" };
  await server.handleRequest(meSnapshotReq, meSnapshotRecorder.res);
  assert.equal(meSnapshotRecorder.state.status, 200);
  assert.equal(meSnapshotRecorder.state.headers["Content-Type"], "image/png");
  assert.ok(Buffer.isBuffer(meSnapshotRecorder.state.body));
  assert.ok(meSnapshotRecorder.state.body.length > 0);
  assert.equal(meSnapshotRecorder.state.body[0], 0x89);
  assert.equal(meSnapshotRecorder.state.body[1], 0x50);
  assert.equal(meSnapshotRecorder.state.body[2], 0x4E);
  assert.equal(meSnapshotRecorder.state.body[3], 0x47);

  const serverInfoSnapshotRecorder = createRecorder();
  const serverInfoSnapshotReq = Readable.from([]);
  serverInfoSnapshotReq.method = "GET";
  serverInfoSnapshotReq.url = "/api/astrbot/server-info/snapshot";
  serverInfoSnapshotReq.headers = {
    host: "localhost",
    authorization: "Bearer astrbot-secret",
  };
  serverInfoSnapshotReq.socket = { remoteAddress: "127.0.0.1" };
  await server.handleRequest(serverInfoSnapshotReq, serverInfoSnapshotRecorder.res);
  assert.equal(serverInfoSnapshotRecorder.state.status, 200);
  assert.equal(serverInfoSnapshotRecorder.state.headers["Content-Type"], "image/png");
  assert.ok(Buffer.isBuffer(serverInfoSnapshotRecorder.state.body));
  assert.ok(serverInfoSnapshotRecorder.state.body.length > 0);
  assert.equal(serverInfoSnapshotRecorder.state.body[0], 0x89);
  assert.equal(serverInfoSnapshotRecorder.state.body[1], 0x50);
  assert.equal(serverInfoSnapshotRecorder.state.body[2], 0x4E);
  assert.equal(serverInfoSnapshotRecorder.state.body[3], 0x47);
  const expectedServerInfoFile = path.resolve(process.cwd(), "data", "astrbot-bridge", "cache", "server-info-BZSS_Main.png");
  const savedServerInfo = await fs.readFile(expectedServerInfoFile);
  assert.equal(savedServerInfo[0], 0x89);
  assert.equal(savedServerInfo[1], 0x50);
  assert.equal(savedServerInfo[2], 0x4E);
  assert.equal(savedServerInfo[3], 0x47);

  const actionRecorder = createRecorder();
  const actionReq = Readable.from([JSON.stringify({
    qqNumber: "12345678",
    qqName: "AstrBotUser",
    name: "toggleWarmup",
  })]);
  actionReq.method = "POST";
  actionReq.url = "/api/astrbot/action";
  actionReq.headers = {
    host: "localhost",
    authorization: "Bearer astrbot-secret",
    "content-type": "application/json",
  };
  actionReq.socket = { remoteAddress: "127.0.0.1" };
  await server.handleRequest(actionReq, actionRecorder.res);
  assert.equal(actionRecorder.state.status, 200);
  const actionBody = JSON.parse(actionRecorder.state.body);
  assert.equal(actionBody.data.action, "toggleWarmup");
  assert.equal(actionBody.data.warmup.isWarmup, true);

  const unbindRecorder = createRecorder();
  const unbindReq = Readable.from([JSON.stringify({
    qqNumber: "12345678",
    qqName: "NewAstrBotUser",
  })]);
  unbindReq.method = "POST";
  unbindReq.url = "/api/astrbot/unbind";
  unbindReq.headers = {
    host: "localhost",
    authorization: "Bearer astrbot-secret",
    "content-type": "application/json",
  };
  unbindReq.socket = { remoteAddress: "127.0.0.1" };
  await server.handleRequest(unbindReq, unbindRecorder.res);
  assert.equal(unbindRecorder.state.status, 200);
  const unbindBody = JSON.parse(unbindRecorder.state.body);
  assert.equal(unbindBody.binding.bound, false);
  assert.equal(playerStore[0].qq_number, null);
  assert.equal(playerStore[0].qq_name, null);

  const interactionState = astrbotBridge.api.getState();
  assert.ok(interactionState.interactions.recent.length >= 7);
  assert.equal(interactionState.interactions.recent[0].action, "unbind");
  assert.equal(interactionState.interactions.recent[0].qqNumber, "12345678");
  assert.ok(interactionState.interactions.recent.some((item) => item.action === "bind"));
  assert.ok(interactionState.interactions.recent.some((item) => item.action === "queryMySnapshot"));
  assert.ok(interactionState.interactions.recent.some((item) => item.action === "serverInfoSnapshot"));

  console.log("astrbot bridge tests passed");
}

await main();
