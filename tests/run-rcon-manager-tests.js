import assert from "node:assert/strict";

import { resolveRconPassword } from "../core/rcon-manager.js";

function testResolveRconPasswordUsesEnvValue() {
  const previous = process.env.BZSS_RCON_PASSWORD;
  process.env.BZSS_RCON_PASSWORD = "super-secret";

  try {
    const logger = {
      warn() {
        throw new Error("warn should not be called when env password exists");
      },
    };

    const password = resolveRconPassword({
      password: "fallback",
      passwordFromEnv: "BZSS_RCON_PASSWORD",
    }, logger);

    assert.equal(password, "super-secret");
  } finally {
    if (previous === undefined) delete process.env.BZSS_RCON_PASSWORD;
    else process.env.BZSS_RCON_PASSWORD = previous;
  }
}

function testResolveRconPasswordFallsBackWhenEnvMissing() {
  const previous = process.env.BZSS_RCON_PASSWORD;
  delete process.env.BZSS_RCON_PASSWORD;

  try {
    let warned = false;
    const password = resolveRconPassword({
      password: "fallback",
      passwordFromEnv: "BZSS_RCON_PASSWORD",
    }, {
      warn(message) {
        warned = String(message).includes("BZSS_RCON_PASSWORD");
      },
    });

    assert.equal(password, "fallback");
    assert.equal(warned, true);
  } finally {
    if (previous === undefined) delete process.env.BZSS_RCON_PASSWORD;
    else process.env.BZSS_RCON_PASSWORD = previous;
  }
}

function testResolveRconPasswordUsesConfigWhenNoEnvConfigured() {
  const password = resolveRconPassword({
    password: "fallback",
    passwordFromEnv: "",
  }, null);

  assert.equal(password, "fallback");
}

testResolveRconPasswordUsesEnvValue();
testResolveRconPasswordFallsBackWhenEnvMissing();
testResolveRconPasswordUsesConfigWhenNoEnvConfigured();

console.log("rcon manager tests passed");
