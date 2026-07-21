import assert from "node:assert/strict";

import {
  SteamGameDurationService,
  createProxyAgent,
  resolveProxyUrlForTarget,
  normalizeProxyMode,
  shouldBypassProxy,
} from "../modules/playtime/index.js";

function testResolveHttpsProxyFromEnv() {
  const resolved = resolveProxyUrlForTarget("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/", {
    env: {
      HTTPS_PROXY: "http://127.0.0.1:7890",
    },
  });

  assert.equal(resolved.proxyUrl, "http://127.0.0.1:7890");
  assert.equal(resolved.source, "env");
  assert.equal(resolved.bypassed, false);
}

function testNoProxyBypassesSteamHost() {
  assert.equal(
    shouldBypassProxy(new URL("https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/"), ".steampowered.com,localhost"),
    true,
  );

  const resolved = resolveProxyUrlForTarget("https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/", {
    env: {
      HTTPS_PROXY: "http://127.0.0.1:7890",
      NO_PROXY: ".steampowered.com",
    },
  });

  assert.equal(resolved.proxyUrl, null);
  assert.equal(resolved.source, "no_proxy");
  assert.equal(resolved.bypassed, true);
}

function testAgentCachingUsesProxy() {
  const service = new SteamGameDurationService({
    apiKey: "test-key",
    usePythonScript: false,
    proxyUrl: "http://127.0.0.1:7890",
  });

  const first = service._resolveSteamAgent("https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/");
  const second = service._resolveSteamAgent("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/");

  assert.ok(first);
  assert.equal(first, second);
}

function testExplicitProxyWinsWithoutNoProxy() {
  const resolved = resolveProxyUrlForTarget("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/", {
    proxyUrl: "socks5://127.0.0.1:1080",
    env: {
      HTTPS_PROXY: "http://127.0.0.1:7890",
    },
  });

  assert.equal(resolved.proxyUrl, "socks5://127.0.0.1:1080");
  assert.equal(resolved.source, "explicit");

  const agent = createProxyAgent(resolved.proxyUrl, "https:");
  assert.ok(agent);
}

function testProxyModes() {
  assert.equal(normalizeProxyMode("off", "http://127.0.0.1:7890"), "off");
  assert.equal(normalizeProxyMode("tun", "http://127.0.0.1:7890"), "tun");
  assert.equal(normalizeProxyMode(undefined, "http://127.0.0.1:7890"), "explicit");

  const off = resolveProxyUrlForTarget("https://api.steampowered.com/", {
    proxyMode: "off",
    proxyUrl: "http://127.0.0.1:7890",
    env: { HTTPS_PROXY: "http://127.0.0.1:9999" },
  });
  assert.equal(off.proxyUrl, null);
  assert.equal(off.source, "disabled");

  const tun = resolveProxyUrlForTarget("https://api.steampowered.com/", {
    proxyMode: "tun",
    proxyUrl: "http://127.0.0.1:7890",
    env: { HTTPS_PROXY: "http://127.0.0.1:9999" },
  });
  assert.equal(tun.proxyUrl, null);
  assert.equal(tun.source, "tun");
}

testResolveHttpsProxyFromEnv();
testNoProxyBypassesSteamHost();
testAgentCachingUsesProxy();
testExplicitProxyWinsWithoutNoProxy();
testProxyModes();

console.log("steam playtime proxy tests passed");
