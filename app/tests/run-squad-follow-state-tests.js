import assert from "node:assert/strict";
import { createSquadFollowStateModule } from "../modules/squad-follow-state/index.js";

function makeModule(configValue = {}, extras = {}) {
  return createSquadFollowStateModule({
    core: {
      createLogger() {
        return console;
      },
      logger: console,
      eventBus: extras.eventBus ?? {
        emitModuleEvent() {},
      },
    },
    config: {
      get(key, fallback) {
        if (key === "modules.squadFollowState") return configValue;
        return fallback;
      },
    },
    logger: console,
  });
}

function makePlayer({
  key,
  teamId,
  squadId,
  name,
  x,
  y,
  health = 100,
  isLeader = false,
  role = "Rifleman",
  vehicleType = "",
}) {
  const player = {
    identity: {
      key,
      name,
      playerId: Number(String(key).split(":")[1] ?? 0) || null,
      steamID: "",
    },
    match: {
      teamId,
      squadId,
      isLeader,
      role,
      squadName: `Squad ${squadId}`,
    },
    telemetry: {
      position: x == null || y == null ? null : { x, y, z: 0 },
      health,
      soldierClass: role,
    },
    vehicle: {
      vehicleType: vehicleType || "None",
    },
    raw: {
      rcon: { isLeader },
      bzss: { isLeader },
    },
  };
  if (x == null || y == null) {
    delete player.telemetry.position;
  }
  return player;
}

function testInsideOutsideAndDiagnostics() {
  const mod = makeModule();
  const snapshot = mod.api.composeFromPlayers({
    serverId: "server-1",
    generatedAt: "2026-07-01T10:00:00.000Z",
    players: [
      makePlayer({ key: "player:1", teamId: 1, squadId: 3, name: "SL", x: 0, y: 0, isLeader: true, role: "SquadLeader" }),
      makePlayer({ key: "player:2", teamId: 1, squadId: 3, name: "Inside", x: 10000, y: 0 }),
      makePlayer({ key: "player:3", teamId: 1, squadId: 3, name: "Outside", x: 20100, y: 0 }),
      makePlayer({ key: "player:4", teamId: 1, squadId: 3, name: "Dead", x: 15000, y: 0, health: 0 }),
      makePlayer({ key: "player:5", teamId: 1, squadId: 9, name: "NoPos", x: null, y: null }),
      makePlayer({ key: "player:6", teamId: 1, squadId: 9, name: "NoLeader", x: 5000, y: 5000 }),
    ],
  });

  assert.ok(snapshot);
  assert.equal(snapshot.radiusMeters, 200);
  assert.equal(snapshot.radiusGameUnits, 20000);
  assert.equal(snapshot.squads.length, 2);

  const squad = snapshot.squads.find((entry) => entry.squadId === 3);
  assert.ok(squad);
  assert.equal(squad.totalMembers, 4);
  assert.equal(squad.aliveMembers, 3);
  assert.equal(squad.insideCount, 2);
  assert.equal(squad.outsideCount, 1);
  assert.deepEqual(squad.insidePlayerKeys, ["idx:1", "idx:2"]);
  assert.deepEqual(squad.outsidePlayerKeys, ["idx:3"]);
  assert.equal(squad.members.find((member) => member.key === "idx:3")?.reason, "outside_leader_radius");
  assert.equal(squad.members.find((member) => member.key === "idx:4")?.reason, "dead_ignored");
  assert.equal(snapshot.playerIndex["idx:3"].disengaged, true);
  assert.equal(snapshot.playerIndex["idx:2"].inside, true);
  assert.equal(snapshot.playerIndex["idx:4"].reason, "dead_ignored");
  assert.equal(snapshot.diagnostics.playersWithoutPosition.length, 1);
  assert.equal(snapshot.diagnostics.squadsWithoutLeader.length, 1);
}

function testVehicleCrewAndDisable() {
  const mod = makeModule({ ignoreVehicleCrew: true });
  const snapshot = mod.api.composeFromPlayers({
    players: [
      makePlayer({ key: "player:10", teamId: 2, squadId: 7, name: "SL", x: 0, y: 0, isLeader: true, role: "SL" }),
      makePlayer({ key: "player:11", teamId: 2, squadId: 7, name: "Crew", x: 10000, y: 0, vehicleType: "Truck" }),
    ],
  });

  assert.ok(snapshot);
  assert.equal(snapshot.squads[0].aliveMembers, 1);
  assert.equal(snapshot.squads[0].outsideCount, 0);
  assert.equal(snapshot.playerIndex["idx:11"].reason, "vehicle_ignored");

  const disabled = makeModule({ enabled: false });
  assert.equal(disabled.api.composeFromPlayers({ players: [] }), null);
}

function testTransitionCacheAndEvents() {
  const events = [];
  const mod = makeModule({}, {
    eventBus: {
      emitModuleEvent(moduleName, eventName, payload) {
        events.push({ moduleName, eventName, payload });
      },
    },
  });

  const first = mod.api.composeFromPlayers({
    serverId: "server-2",
    generatedAt: "2026-07-01T11:00:00.000Z",
    players: [
      makePlayer({ key: "player:20", teamId: 1, squadId: 4, name: "SL", x: 0, y: 0, isLeader: true, role: "SquadLeader" }),
      makePlayer({ key: "player:21", teamId: 1, squadId: 4, name: "Member", x: 10000, y: 0 }),
    ],
  });

  assert.ok(first);
  assert.equal(events.length, 0);
  assert.equal(mod.api.getState().recentEvents.length, 0);

  const second = mod.api.composeFromPlayers({
    serverId: "server-2",
    generatedAt: "2026-07-01T11:01:00.000Z",
    players: [
      makePlayer({ key: "player:20", teamId: 1, squadId: 4, name: "SL", x: 0, y: 0, isLeader: true, role: "SquadLeader" }),
      makePlayer({ key: "player:21", teamId: 1, squadId: 4, name: "Member", x: 20100, y: 0 }),
    ],
  });

  assert.ok(second);
  assert.equal(events.length, 2);
  assert.equal(events[0].eventName, "playerExitedLeaderRadius");
  assert.equal(events[1].eventName, "playerRadiusStateChanged");
  assert.equal(mod.api.getState().recentEvents[0].type, "exit");

  const third = mod.api.composeFromPlayers({
    serverId: "server-2",
    generatedAt: "2026-07-01T11:02:00.000Z",
    players: [
      makePlayer({ key: "player:20", teamId: 1, squadId: 4, name: "SL", x: 0, y: 0, isLeader: true, role: "SquadLeader" }),
      makePlayer({ key: "player:21", teamId: 1, squadId: 4, name: "Member", x: 20200, y: 0 }),
    ],
  });

  assert.ok(third);
  assert.equal(events.length, 2);
}

function main() {
  testInsideOutsideAndDiagnostics();
  testVehicleCrewAndDisable();
  testTransitionCacheAndEvents();
  console.log("run-squad-follow-state-tests: ok");
}

main();
