import assert from "node:assert/strict";

import { createChatManagerService } from "../modules/chat-manager/service.js";

const warnings = [];
const service = createChatManagerService({
  core: {},
  config: { get(_key, fallback) { return fallback; } },
  logger: {
    info() {},
    debug() {},
    error() {},
    warn(message) { warnings.push(String(message)); },
  },
});

const unsubscribers = Array.from({ length: 12 }, () => service.api.on("message", () => {}));
assert.equal(service.api.getListenerCount("message"), 12);
assert.equal(warnings.filter((message) => message.includes("subscriber count=10")).length, 1);

for (const unsubscribe of unsubscribers) unsubscribe();
assert.equal(service.api.getListenerCount("message"), 0);

const unsubscribe = service.api.on("message", () => {});
assert.equal(service.api.getListenerCount("message"), 1);
unsubscribe();
assert.equal(service.api.getListenerCount("message"), 0);

console.log("chat manager listener tests passed");
