import assert from "node:assert/strict";

import { resolveRconRefreshPolicy } from "../core/rcon-refresh-policy.js";

const config = {
  enabled: true,
  playersIntervalMs: 5000,
  squadsIntervalMs: 10000,
  dynamic: {
    fastUntilSeconds: 90,
    mediumUntilSeconds: 180,
    fastPlayersIntervalMs: 1000,
    fastSquadsIntervalMs: 1500,
    mediumPlayersIntervalMs: 2500,
    mediumSquadsIntervalMs: 3500,
  },
};

function testFastWindow() {
  const policy = resolveRconRefreshPolicy({
    logClockSeconds: 30,
    logClockHasAnchor: true,
    logClockManual: false,
    config,
  });

  assert.equal(policy.mode, "fast");
  assert.equal(policy.playersIntervalMs, 1000);
  assert.equal(policy.squadsIntervalMs, 1500);
}

function testMediumWindow() {
  const policy = resolveRconRefreshPolicy({
    logClockSeconds: 120,
    logClockHasAnchor: true,
    logClockManual: false,
    config,
  });

  assert.equal(policy.mode, "medium");
  assert.equal(policy.playersIntervalMs, 2500);
  assert.equal(policy.squadsIntervalMs, 3500);
}

function testFallbackAfterOpeningWindow() {
  const policy = resolveRconRefreshPolicy({
    logClockSeconds: 240,
    logClockHasAnchor: true,
    logClockManual: false,
    config,
  });

  assert.equal(policy.mode, "fallback");
  assert.equal(policy.playersIntervalMs, 5000);
  assert.equal(policy.squadsIntervalMs, 10000);
}

function testFallbackWithoutTrustedLogClock() {
  for (const input of [
    { logClockSeconds: 30, logClockHasAnchor: false, logClockManual: false },
    { logClockSeconds: 30, logClockHasAnchor: true, logClockManual: true },
  ]) {
    const policy = resolveRconRefreshPolicy({ ...input, config });
    assert.equal(policy.mode, "fallback");
    assert.equal(policy.playersIntervalMs, 5000);
    assert.equal(policy.squadsIntervalMs, 10000);
  }
}

function testDisabledDynamicRefreshUsesFallback() {
  const policy = resolveRconRefreshPolicy({
    logClockSeconds: 30,
    logClockHasAnchor: true,
    logClockManual: false,
    config: {
      ...config,
      enabled: false,
    },
  });

  assert.equal(policy.mode, "disabled");
  assert.equal(policy.playersIntervalMs, 5000);
  assert.equal(policy.squadsIntervalMs, 10000);
}

testFastWindow();
testMediumWindow();
testFallbackAfterOpeningWindow();
testFallbackWithoutTrustedLogClock();
testDisabledDynamicRefreshUsesFallback();

console.log("rcon refresh policy tests passed");
