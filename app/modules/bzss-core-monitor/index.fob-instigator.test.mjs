import assert from "node:assert/strict";

import { parseBzssCoreLogLine } from "./index.js";

const frame = parseBzssCoreLogLine(
  "PIE: CPZ:,FOBI:{,X=42684.246 Y=14019.167 Z=310.761,1,Very_Small,300.0,10498.400391,3500.0,}"
  + "{,X=26355.048 Y=38469.101 Z=-71.341,2,Very_Small,300.0,0.0,0.0,Donald·DoubyBear}"
  + "{,X=28035.469 Y=37198.160 Z=364.397,2,Very_Small,300.0,7858.80127,3300.0,},"
  + "MainZone:{1,X=33661.309 Y=-18053.047 Z=-100.408}{2,X=19205.754 Y=53546.555 Z=-548.284}",
);

assert.ok(frame);
assert.equal(frame.type, "scene");
assert.equal(frame.fobs.length, 3);

const placedByDonald = frame.fobs[1];
assert.deepEqual(placedByDonald.position, {
  x: 26355.048,
  y: 38469.101,
  z: -71.341,
});
assert.equal(placedByDonald.teamId, 2);
assert.equal(placedByDonald.size, "Very_Small");
assert.equal(placedByDonald.health, 300);
assert.equal(placedByDonald.ammo, 0);
assert.equal(placedByDonald.construction, 0);
assert.equal(placedByDonald.instigator, "Donald·DoubyBear");

assert.equal(frame.fobs[0].instigator, "");
assert.equal(frame.fobs[2].instigator, "");
assert.equal(frame.mainZones.length, 2);

console.log("BZSS-Core compact FOBI instigator parser test passed.");
