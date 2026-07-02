import assert from "node:assert/strict";

import { ConsoleService } from "../core/console-service.js";

function createHarness() {
  const listeners = new Set();
  const service = new ConsoleService({ maxEntries: 100 });

  const core = {
    logger: {
      subscribe() {
        return () => {};
      },
    },
    eventBus: {
      onCoreEvent(eventName, handler) {
        assert.equal(eventName, "*");
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
    },
    rconManager: {},
  };

  service.attachCore(core);

  return {
    service,
    emit(event) {
      for (const handler of listeners) {
        handler(event);
      }
    },
  };
}

function testBzssCorePlayerEventsAppearInConsoleStream() {
  const harness = createHarness();

  harness.emit({
    eventId: "e1",
    eventName: "PLAYER_CONNECTED",
    serverId: "BZSS_Main",
    time: "2026-07-02T10:00:00.000Z",
    payload: {
      name: "Alice",
      playerName: "Alice",
      controllerId: "BP_PlayerController_C_1",
    },
  });

  harness.emit({
    eventId: "e2",
    eventName: "PLAYER_POST_LOGIN",
    serverId: "BZSS_Main",
    time: "2026-07-02T10:00:01.000Z",
    payload: {
      name: "Alice",
      playerName: "Alice",
      ip: "1.2.3.4",
      eosId: "0000000000000001",
      steam64Id: "76561198000000001",
      playerControllerId: "BP_PlayerController_C_1",
    },
  });

  harness.emit({
    eventId: "e3",
    eventName: "PLAYER_DISCONNECTED",
    serverId: "BZSS_Main",
    time: "2026-07-02T10:00:02.000Z",
    payload: {
      name: "Alice",
      playerName: "Alice",
      ip: "1.2.3.4",
      remoteAddr: "1.2.3.4:24049",
    },
  });

  const lines = harness.service.getLegacyLines({ stream: "modules" });
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((line) => line.eventName), [
    "player_connected",
    "player_post_login",
    "player_disconnected",
  ]);
  assert.match(lines[0].message, /玩家连接：Alice/);
  assert.match(lines[1].message, /玩家登录：Alice \/ 1\.2\.3\.4/);
  assert.match(lines[2].message, /玩家离开：Alice \(1\.2\.3\.4\)/);
}

testBzssCorePlayerEventsAppearInConsoleStream();

console.log("run-console-service-tests: OK");
