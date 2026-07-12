import assert from "node:assert/strict";
import { createTacticalStateModule } from "../modules/tactical-state/index.js";

function createEventBus() {
  const moduleListeners = new Map();
  return {
    onModuleEvent(moduleId, eventName, handler) {
      const key = `${moduleId}:${eventName}`;
      if (!moduleListeners.has(key)) moduleListeners.set(key, new Set());
      moduleListeners.get(key).add(handler);
      return () => moduleListeners.get(key)?.delete(handler);
    },
    emitModuleEvent(moduleId, eventName, event) {
      const key = `${moduleId}:${eventName}`;
      for (const handler of moduleListeners.get(key) ?? []) {
        handler(event);
      }
    },
  };
}

function makeModule() {
  const eventBus = createEventBus();
  const tacticalModule = createTacticalStateModule({
    core: {
      webStatus: {
        serverId: "server-1",
        getSnapshot() {
          return { serverId: "server-1", serverName: "Test Server" };
        },
      },
      eventBus,
      createLogger() {
        return console;
      },
    },
    modules: {
      matchState: {
        getState() {
          return {
            updatedAt: "2026-07-01T10:00:00.000Z",
            serverStatus: {
              map: "Jensens Range",
              layer: "Jensens Range AAS",
              mode: "AAS",
              playerCount: 2,
            },
            match: {
              map: "Jensens Range",
              layer: "Jensens Range AAS",
              mode: "AAS",
              tickets: { team1: 320, team2: 295 },
            },
            players: {
              list: [
                { playerID: 11, name: "Alpha", steamID: "76561198000000001", eosID: "", teamID: 1, squadID: 2, isLeader: true, role: "SL", state: "online", firstSeenAt: "2026-07-01T09:00:00.000Z", lastSeenAt: "2026-07-01T10:00:00.000Z" },
                { playerID: 22, name: "Bravo", steamID: "76561198000000002", controllerID: "controller-bravo", eosID: "", teamID: 2, squadID: 4, isLeader: false, role: "Medic", state: "online", firstSeenAt: "2026-07-01T09:10:00.000Z", lastSeenAt: "2026-07-01T10:00:00.000Z" },
              ],
              lastUpdatedAt: "2026-07-01T10:00:00.000Z",
            },
            squads: {
              list: [],
              teams: [
                { teamID: 1, teamName: "United States Army" },
                { teamID: 2, teamName: "Russian Ground Forces" },
              ],
              lastUpdatedAt: "2026-07-01T10:00:00.000Z",
            },
            rconStatus: { connected: true },
          };
        },
      },
      playerState: {
        getState() {
          return {
            updatedAt: "2026-07-01T10:00:00.000Z",
            players: [
              { playerID: 11, name: "Alpha", steamID: "76561198000000001", teamID: 1, squadID: 2, isLeader: true, role: "SL", state: "online", squadlessSince: "", squadlessSeconds: 0, lastSeenAt: "2026-07-01T10:00:00.000Z" },
              { playerID: 22, name: "Bravo", steamID: "76561198000000002", teamID: 2, squadID: 4, isLeader: false, role: "Medic", state: "online", squadlessSince: "", squadlessSeconds: 0, lastSeenAt: "2026-07-01T10:00:00.000Z" },
            ],
          };
        },
        getOnlinePlayers() {
          return this.getState().players;
        },
      },
      bzssCoreMonitor: {
        getTelemetryPlayers() {
          return [
            {
              playerId: 11,
              playerIndex: 11,
              playerName: "Alpha",
              playerGuid: "76561198000000001",
              presenceHint: "noPawn",
              teamId: 1,
              squadId: 2,
              isLeader: true,
              role: "SL",
              ping: 42,
              playerScoreboard: { ping: 42, stats: { numKills: 3, numDeaths: 1, numWounds: 0, numWoundeds: 0, numTeamKills: 0, revivedPoints: 0, healPoints: 0, objectiveScore: 0, teamworkScore: 0, combatScore: 8 } },
              soldierInfo: { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 90 }, health: 87, soldierClass: "Rifleman", weaponClass: "Rifle" },
              vehicleInfo: null,
              observedAt: "2026-07-01T10:00:00.000Z",
            },
            {
              playerId: 33,
              playerIndex: 33,
              playerName: "Bravo Telemetry",
              playerGuid: "76561198000000002",
              controllerID: "controller-bravo",
              teamId: 1,
              squadId: 5,
              isLeader: false,
              role: "Rifleman",
              ping: null,
              playerScoreboard: { ping: null, stats: { numKills: 0, numDeaths: 0, numWounds: 0, numWoundeds: 0, numTeamKills: 0, revivedPoints: 0, healPoints: 0, objectiveScore: 0, teamworkScore: 0, combatScore: 0 } },
              soldierInfo: { position: { x: 9, y: 8, z: 7 }, rotation: { x: 0, y: 0, z: 180 }, health: 100, soldierClass: "Rifleman", weaponClass: "Rifle" },
              vehicleInfo: null,
              observedAt: "2026-07-01T10:00:00.000Z",
            },
            {
              playerId: 44,
              playerIndex: 44,
              playerName: "Ghost BZSS",
              playerGuid: "76561198000000004",
              teamId: 1,
              squadId: 6,
              isLeader: false,
              role: "Rifleman",
              ping: null,
              playerScoreboard: { ping: null, stats: { numKills: 0, numDeaths: 0, numWounds: 0, numWoundeds: 0, numTeamKills: 0, revivedPoints: 0, healPoints: 0, objectiveScore: 0, teamworkScore: 0, combatScore: 0 } },
              soldierInfo: { position: { x: 5, y: 6, z: 7 }, rotation: { x: 0, y: 0, z: 45 }, health: 100, soldierClass: "Rifleman", weaponClass: "Rifle" },
              vehicleInfo: null,
              observedAt: "2026-07-01T10:00:00.000Z",
            },
          ];
        },
        getPlayers() {
          return this.getTelemetryPlayers();
        },
        getRawSnapshot() {
          return {
            updatedAt: "2026-07-01T10:00:00.000Z",
            captureZones: [{ name: "A", position: { x: 10, y: 20, z: 0 } }],
            fobs: [],
            mainZones: [],
            explosions: [],
          };
        },
      },
      playerDatabase: {
        async listPlayersBySteamIDs(steamIDs) {
          return steamIDs.map((steamID) => ({
            steam_id: steamID,
            steam_avatar: `avatar-${steamID}`,
            steam_game_seconds: 7200,
            permission_group: "default",
            updated_at: "2026-07-01T09:55:00.000Z",
          }));
        },
      },
      networkStats: {
        getPlayerStats(steamID) {
          if (steamID === "76561198000000001") {
            return { ping: 55, packetLoss: 2 };
          }
          return null;
        },
      },

    },
    logger: console,
  });

  return { tacticalModule, eventBus };
}

async function main() {
  const { tacticalModule, eventBus } = makeModule();
  await tacticalModule.start();
  const snapshot = await tacticalModule.api.getSnapshot();

  assert.equal(snapshot.server.serverId, "server-1");
  assert.equal(snapshot.server.map, "Jensens Range");
  assert.equal(snapshot.players.length, 3);

  const alpha = snapshot.players.find((player) => player.identity.name === "Alpha");
  assert.ok(alpha);
  assert.equal(alpha.presence.state, "noPawn");
  assert.equal(alpha.telemetry.position?.x, 1);
  assert.equal(alpha.telemetry.position?.y, 2);
  assert.equal(alpha.telemetry.yaw, 90);
  assert.equal(alpha.telemetry.rotation?.z, 90);
  assert.equal(alpha.network.gamePing, 42);
  assert.equal(alpha.network.icmpPing, 55);
  assert.equal(alpha.profile.playtimeHours, 2);
  assert.equal(alpha.link.confidence, "high");

  const bravo = snapshot.players.find((player) => player.identity.name === "Bravo");
  assert.ok(bravo);
  assert.equal(bravo.link.method, "controllerID");
  assert.equal(bravo.network.gamePing, null);

  const ghost = snapshot.players.find((player) => player.identity.name === "Ghost BZSS");
  assert.ok(ghost);
  assert.equal(ghost.presence.online, false);
  assert.equal(ghost.telemetry.position?.x, 5);
  assert.equal(ghost.telemetry.position?.y, 6);
  assert.equal(ghost.telemetry.yaw, 45);
  assert.equal(ghost.telemetry.health, 100);
  assert.equal(ghost.match.teamId, 1);

  assert.equal(snapshot.assets.captureZones.length, 1);
  assert.equal(snapshot.teams.find((team) => team.teamId === 1)?.factionName, "United States Army");
  assert.equal(snapshot.teams.find((team) => team.teamId === 2)?.factionName, "Russian Ground Forces");
  assert.equal(snapshot.diagnostics.unlinkedBzssPlayers.length, 1);
  assert.equal(snapshot.diagnostics.unlinkedBzssPlayers[0].identity.name, "Ghost BZSS");

  const diagnosticsBeforeRead = tacticalModule.api.getDiagnostics();
  await tacticalModule.api.getSnapshot();
  await tacticalModule.api.getSnapshot();
  assert.equal(tacticalModule.api.getDiagnostics().composeCount, diagnosticsBeforeRead.composeCount);

  const initialStream = await tacticalModule.api.getStreamSnapshot();
  assert.equal(initialStream.envelope.type, "tactical-state.snapshot");
  assert.equal(initialStream.envelope.snapshot.meta.revision, snapshot.meta.revision);

  const received = [];
  const unsubscribeA = tacticalModule.api.subscribeStream((message) => received.push(message.serialized));
  const unsubscribeB = tacticalModule.api.subscribeStream((message) => received.push(message.serialized));
  eventBus.emitModuleEvent("module.playerState", "playersSnapshotUpdated", {});
  await new Promise((resolve) => setTimeout(resolve, 180));
  const latestStream = await tacticalModule.api.getStreamSnapshot();
  const cacheDiagnostics = tacticalModule.api.getDiagnostics();
  assert.equal(cacheDiagnostics.profileDatabaseQueryCount, 1);
  assert.equal(cacheDiagnostics.profileCacheSize, 2);
  assert.ok(latestStream.envelope.snapshot.meta.revision > initialStream.envelope.snapshot.meta.revision);
  assert.equal(JSON.parse(latestStream.serialized).type, "tactical-state.snapshot");
  assert.ok(received.length >= 2);
  assert.equal(received[0], received[1]);
  unsubscribeA();
  unsubscribeB();

  await tacticalModule.stop();
  assert.equal(tacticalModule.api.getDiagnostics().subscriberCount, 0);
  console.log("run-tactical-state-tests: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});