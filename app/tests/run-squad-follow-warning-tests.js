import assert from "node:assert/strict";
import { createSquadFollowWarningModule } from "../modules/squad-follow-warning/index.js";

function createEventBus() {
  const listeners = new Map();
  return {
    onModuleEvent(moduleId, eventName, handler) {
      const key = `${moduleId}:${eventName}`;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(handler);
      return () => {
        const list = listeners.get(key) ?? [];
        const index = list.indexOf(handler);
        if (index >= 0) list.splice(index, 1);
      };
    },
    emitModuleEvent(moduleId, eventName, event) {
      const handlers = [
        ...(listeners.get(`${moduleId}:${eventName}`) ?? []),
      ];
      for (const handler of handlers) {
        handler(event);
      }
    },
  };
}

async function testExitAndEnterWarnings() {
  const calls = [];
  const eventBus = createEventBus();
  const adminWarn = {
    async sendAdminWarn(req) {
      calls.push(req);
      return { success: true, skipped: false, commandText: `AdminWarn "${req.targetName}" "${req.message}"` };
    },
  };

  const mod = createSquadFollowWarningModule({
    core: {
      createLogger() {
        return console;
      },
      logger: console,
      eventBus,
    },
    modules: {
      adminWarn,
    },
    config: {
      get(key, fallback) {
        if (key === "modules.squadFollowWarning") return {};
        return fallback;
      },
    },
    logger: console,
  });

  mod.start();

  eventBus.emitModuleEvent("module.squadFollowState", "playerExitedLeaderRadius", {
    eventId: "evt-1",
    serverId: "server-1",
    player: {
      name: "Alpha",
      steamID: "steam-1",
    },
  });

  eventBus.emitModuleEvent("module.squadFollowState", "playerEnteredLeaderRadius", {
    eventId: "evt-2",
    serverId: "server-1",
    player: {
      name: "Alpha",
      steamID: "steam-1",
    },
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 2);
  assert.equal(calls[0].targetName, "Alpha");
  assert.equal(calls[0].message, "[BZSS]你脱离了你的队长。");
  assert.equal(calls[0].reason, "squad_follow_warning_exit");
  assert.equal(calls[1].message, "[BZSS]团队合作才能胜利。");
  assert.equal(calls[1].reason, "squad_follow_warning_enter");

  const state = mod.api.getState();
  assert.equal(state.recentWarnings.length, 2);
  assert.equal(state.recentWarnings[0].type, "enter");
  assert.equal(state.recentWarnings[1].type, "exit");

  mod.stop();
}

async function main() {
  await testExitAndEnterWarnings();
  console.log("run-squad-follow-warning-tests: ok");
}

main();
