import assert from "assert";
import {
  createSquadBrowserPlayerLookupModule,
  evaluateLoyalPlayer,
} from "../modules/squadbrowser-player-lookup/index.js";

async function main() {
  console.log("Running SquadBrowser Player Lookup module tests...");

  const module = createSquadBrowserPlayerLookupModule({
    logger: { info: () => {}, error: () => {}, warn: () => {} },
    modules: {},
  });

  assert.strictEqual(module.manifest.id, "module.squadBrowserPlayerLookup");
  assert.strictEqual(module.apiName, "squadBrowserPlayerLookup");
  assert.strictEqual(typeof module.api.lookup, "function");

  // Loyalty requires BZSS to rank first and exceed 50% of the saved top-15 total.
  assert.strictEqual(evaluateLoyalPlayer([
    { serverId: "LICENSED-1008168", serverName: "[CN]步战鼠鼠", playtimeMinutes: 51 },
    { serverId: "OTHER", serverName: "其他服务器", playtimeMinutes: 49 },
  ]).qualified, true);
  assert.strictEqual(evaluateLoyalPlayer([
    { serverId: "LICENSED-1008168", serverName: "[CN]步战鼠鼠", playtimeMinutes: 50 },
    { serverId: "OTHER", serverName: "其他服务器", playtimeMinutes: 50 },
  ]).qualified, false);
  assert.strictEqual(evaluateLoyalPlayer([
    { serverId: "LICENSED-1008168", serverName: "[CN]步战鼠鼠", playtimeMinutes: 40 },
    { serverId: "OTHER-1", serverName: "其他服务器一", playtimeMinutes: 30 },
    { serverId: "OTHER-2", serverName: "其他服务器二", playtimeMinutes: 30 },
  ]).qualified, false);

  // Test invalid Steam64
  await assert.rejects(
    async () => {
      await module.api.lookup("invalid");
    },
    (err) => err?.code === "InvalidSteam64" && err?.statusCode === 400
  );

  // Test valid Steam64 lookup (Donald·DoubyBear)
  const result = await module.api.lookup("76561198194428818");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.source, "SquadBrowser");
  assert.strictEqual(typeof result.player, "object");
  assert.strictEqual(result.player.steamId, "76561198194428818");
  assert.strictEqual(result.player.displayName, "Donald·DoubyBear");
  assert.strictEqual(Array.isArray(result.sessions), true);

  // Test cache hit
  const cachedResult = await module.api.lookup("76561198194428818");
  assert.deepStrictEqual(cachedResult, result);

  // Test clearCache
  assert.deepStrictEqual(module.api.clearCache(), { ok: true });

  console.log("SquadBrowser Player Lookup module tests PASSED! ✓");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
