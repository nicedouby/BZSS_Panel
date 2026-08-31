import assert from "node:assert/strict";

import { createAstrbotBridgeModule } from "../modules/astrbot-bridge/index.js";

let chatHandler = null;
let issued = null;
let consumed = null;
const warnings = [];

const config = {
  get(path, fallback) {
    if (path === "modules.astrbotBridge") {
      return {
        enabled: true,
        apiToken: "test-token",
        binding: { codeTtlMs: 60_000 },
        websocket: { enabled: false },
      };
    }
    return fallback;
  },
};

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const core = {
  logger,
  createLogger() { return logger; },
  eventBus: { onCoreEvent() { return () => {}; } },
};
const modules = {
  chatManager: {
    on(name, handler) {
      assert.equal(name, "message");
      chatHandler = handler;
      return () => { chatHandler = null; };
    },
  },
  playerDatabase: {
    async findByIdentity() { return null; },
    async createQQBindingCode(input) {
      issued = input;
      return { id: 7, expiresAt: input.expiresAt };
    },
    async consumeQQBindingCode(input) {
      consumed = input;
      return {
        ok: true,
        qqNumber: "123456",
        player: { id: 9, current_name: "Binding Tester" },
      };
    },
  },
  adminWarn: {
    async warnPlayer(input) { warnings.push(input); },
  },
};

const bridgeModule = createAstrbotBridgeModule({ core, modules, config, logger });
await bridgeModule.init();
await bridgeModule.start();

try {
  const result = await bridgeModule.api.createBindingCode({
    qqNumber: "123456",
    qqName: "Tester",
  });
  assert.equal(result.ok, true);
  assert.match(result.data.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(result.data.command, `/bind ${result.data.code}`);
  assert.equal(issued.qqNumber, "123456");
  assert.equal(issued.codeHash.length, 64);
  assert.ok(!JSON.stringify(issued).includes(result.data.code), "plain binding code must not be persisted");

  assert.equal(typeof chatHandler, "function");
  await chatHandler({
    message: result.data.command,
    playerName: "Binding Tester",
    playerId: 9,
    steamId: "76561198000000001",
    eosId: "eos-binding-tester",
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(consumed.codeHash, issued.codeHash);
  assert.equal(consumed.steamID, "76561198000000001");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /绑定成功/);
} finally {
  await bridgeModule.stop();
}

console.log("astrbot binding flow tests passed");
