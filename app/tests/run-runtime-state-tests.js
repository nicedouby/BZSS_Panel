import assert from "node:assert/strict";

import { RuntimeState } from "../core/runtime-state.js";

function createEventBus() {
  const coreListeners = new Map();
  const moduleListeners = new Map();

  return {
    onCoreEvent(eventName, handler) {
      if (!coreListeners.has(eventName)) coreListeners.set(eventName, []);
      coreListeners.get(eventName).push(handler);
      return () => removeListener(coreListeners, eventName, handler);
    },
    onModuleEvent(moduleId, eventName, handler) {
      const key = `${moduleId}:${eventName}`;
      if (!moduleListeners.has(key)) moduleListeners.set(key, []);
      moduleListeners.get(key).push(handler);
      return () => removeListener(moduleListeners, key, handler);
    },
    emitCoreEvent(eventName, event) {
      for (const handler of coreListeners.get(eventName) ?? []) handler(event);
      for (const handler of coreListeners.get("*") ?? []) handler(event);
    },
    emitModuleEvent(moduleId, eventName, event) {
      for (const handler of moduleListeners.get(`${moduleId}:${eventName}`) ?? []) handler(event);
      for (const handler of moduleListeners.get(`${moduleId}:*`) ?? []) handler(event);
    },
  };
}

function removeListener(map, key, handler) {
  const listeners = map.get(key) ?? [];
  const index = listeners.indexOf(handler);
  if (index >= 0) listeners.splice(index, 1);
}

function createRuntimeState() {
  return new RuntimeState({
    eventBus: createEventBus(),
    webStatus: {
      state: {},
      getSnapshot() {
        return {};
      },
    },
    config: {
      get(_path, fallback) {
        return fallback;
      },
    },
  });
}

function testEmptyTeamHeaderSurvivesRuntimeSnapshot() {
  const runtime = createRuntimeState();

  runtime.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", {
    squads: [
      {
        teamID: 1,
        teamName: "118th Combined Arms Brigade",
        squadID: 1,
        squadName: "Squad 1",
        size: 1,
      },
    ],
    teams: [
      { teamID: 1, teamName: "118th Combined Arms Brigade" },
      { teamID: 2, teamName: "Manticore Security Task Force" },
    ],
  });

  let snapshot = runtime.getAll();
  assert.deepEqual(snapshot.squads.teams, [
    { teamID: 1, teamName: "118th Combined Arms Brigade" },
    { teamID: 2, teamName: "Manticore Security Task Force" },
  ]);
  assert.equal(snapshot.teams.find((team) => team.teamID === 2)?.teamName, "Manticore Security Task Force");
  assert.equal(snapshot.teams.find((team) => team.teamID === 2)?.playerCount, 0);
  assert.deepEqual(snapshot.teams.find((team) => team.teamID === 2)?.squads, []);

  runtime.eventBus.emitCoreEvent("RCON_LIST_PLAYERS_UPDATED", {
    players: [
      {
        playerID: 1,
        name: "Braovo",
        teamID: 1,
        squadID: 1,
        online: true,
      },
    ],
  });

  snapshot = runtime.getAll();
  assert.equal(snapshot.teams.find((team) => team.teamID === 2)?.teamName, "Manticore Security Task Force");
  assert.equal(snapshot.teams.find((team) => team.teamID === 2)?.playerCount, 0);
  runtime.stop();
}

testEmptyTeamHeaderSurvivesRuntimeSnapshot();
console.log("RuntimeState tests passed.");
