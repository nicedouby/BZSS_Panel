import assert from "node:assert/strict";

import { WebRegistry } from "../core/web-registry.js";

const messages = [];
const registry = new WebRegistry({
  config: { get(_key, fallback) { return fallback; } },
  logger: { web(message) { messages.push(String(message)); } },
});
const original = registry.pages.get("web.tacticalReport");
const result = registry.registerPage({
  id: "web.tacticalReport",
  title: "duplicate",
  route: "/different-route",
  source: "test.duplicate",
});
assert.equal(result, original);
assert.equal(registry.pages.get("web.tacticalReport"), original);
assert.equal(messages.some((message) => message.includes("Duplicate page registration ignored: web.tacticalReport")), true);

console.log("web registry duplicate tests passed");
