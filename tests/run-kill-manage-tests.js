import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createKillManageModule } from "../modules/kill-manage/index.js";

async function testWritesOnlyRawLogLines() {
  const listeners = new Map();
  const moduleEvents = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-kill-manage-"));
  const rawLogFile = path.join(tempDir, "combat-raw.log");

  const core = {
    logger: { warn() {}, module() {}, info() {}, debug() {} },
    eventBus: {
      onCoreEvent(eventName, handler) {
        if (!listeners.has(eventName)) listeners.set(eventName, new Set());
        listeners.get(eventName).add(handler);
        return () => listeners.get(eventName)?.delete(handler);
      },
      emitModuleEvent(moduleId, eventName, event) {
        moduleEvents.push({ moduleId, eventName, event });
      },
    },
  };

  const config = {
    get(pathText, defaultValue) {
      if (pathText === "modules.killManage") {
        return { enabled: true, rawLogFile };
      }
      return defaultValue;
    },
  };

  const module = createKillManageModule({ core, modules: {}, config });
  await module.start();

  for (const handler of listeners.get("On_PlayerDamaged") ?? []) {
    handler({
      eventId: "combat:1",
      eventName: "On_PlayerDamaged",
      serverId: "BZSS_Main",
      time: "2026-05-09T10:00:00.000Z",
      logTime: "2026.05.09-10.00.00",
      rawLog: "[2026.05.09-10.00.00] LogSquadTrace: damage raw line",
      normalized: {
        combat: {
          type: "damaged",
          victimName: "Victim",
          attackerName: "Attacker",
          damage: 25,
          weapon: "BP_Rifle_C",
        },
      },
    });
  }

  await module.stop();

  const fileText = await fs.readFile(rawLogFile, "utf8");
  assert.equal(fileText, "[2026.05.09-10.00.00] LogSquadTrace: damage raw line\n");
  assert.equal(moduleEvents.length, 1);
  assert.equal(moduleEvents[0].event.record.rawLog, "[2026.05.09-10.00.00] LogSquadTrace: damage raw line");

  await fs.rm(tempDir, { recursive: true, force: true });
}

await testWritesOnlyRawLogLines();

console.log("kill manage tests passed");