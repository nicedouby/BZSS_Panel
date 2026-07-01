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
                { playerID: 22, name: "Bravo", steamID: "76561198000000002", eosID: "", teamID: 2, squadID: 4, isLeader: false, role: "Medic", state: "online", firstSeenAt: "2026-07-01T09:10:00.000Z", lastSeenAt: "2026-07-01T10:00:00.000Z" },
              ],
              lastUpdatedAt: "2026-07-01T10:00:00.000Z",
            },
            squads: { list: [], lastUpdatedAt: "2026-07-01T10:00:00.000Z" },
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
        getPlayers() {
          return [
            {
              playerId: 11,
              playerIndex: 11,
              playerName: "Alpha",
              playerGuid: "76561198000000001",
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
              playerName: "Charlie",
              playerGuid: "76561198000000003",
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
          ];
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
      squadFollowState: {
        composeFromPlayers({ serverId, generatedAt, players }) {
          return {
            enabled: true,
            serverId,
            generatedAt,
            radiusMeters: 200,
            radiusGameUnits: 20000,
            markerMode: "disengaged",
            squads: [],
            playerIndex: Object.fromEntries(players.map((player) => [player.identity?.key ?? "", { teamId: player.match?.teamId ?? null, squadId: player.match?.squadId ?? null, leaderKey: "", distanceMeters: null, inside: false, disengaged: false, reason: "" }])),
            diagnostics: { squadsWithoutLeader: [], playersWithoutPosition: [] },
          };
        },
      },
    },
    logger: console,
  });

  return { tacticalModule, eventBus };
}

async function main() {
  const { tacticalModule } = makeModule();
  await tacticalModule.start();
  const snapshot = await tacticalModule.api.getSnapshot();

  assert.equal(snapshot.server.serverId, "server-1");
  assert.equal(snapshot.server.map, "Jensens Range");
  assert.equal(snapshot.players.length, 3);

  const alpha = snapshot.players.find((player) => player.identity.name === "Alpha");
  assert.ok(alpha);
  assert.equal(alpha.network.gamePing, 42);
  assert.equal(alpha.network.icmpPing, 55);
  assert.equal(alpha.profile.playtimeHours, 2);
  assert.equal(alpha.link.confidence, "high");

  const charlie = snapshot.players.find((player) => player.identity.name === "Charlie");
  assert.ok(charlie);
  assert.equal(charlie.telemetry.position.x, 9);
  assert.equal(charlie.network.gamePing, null);

  assert.equal(snapshot.assets.captureZones.length, 1);
  assert.equal(snapshot.diagnostics.unlinkedBzssPlayers.length, 1);
  assert.equal(snapshot.squadFollow?.radiusGameUnits, 20000);
  assert.equal(snapshot.squadFollow?.squads.length, 0);

  await tacticalModule.stop();
  console.log("run-tactical-state-tests: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
