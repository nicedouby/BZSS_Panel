import assert from "node:assert/strict";
import { createStepCalculator } from "../modules/step-counter/calculator.js";

const calculator = createStepCalculator();
const player = {
  identity: { steamID: "76561198000000000" },
  presence: { online: true, state: "online" },
  telemetry: { position: { x: 0, y: 0, z: 0 } },
  vehicle: { vehicleType: "" },
};
assert.equal(calculator.observe(player, "2026-07-31T00:00:00.000Z").valid, false);
player.telemetry.position = { x: 100, y: 0, z: 0 };
const result = calculator.observe(player, "2026-07-31T00:00:01.000Z");
assert.equal(result.valid, true);
assert.equal(Math.round(result.distanceMeters * 10), 10);
assert.ok(result.steps > 0);
console.log("step-counter tests passed");
