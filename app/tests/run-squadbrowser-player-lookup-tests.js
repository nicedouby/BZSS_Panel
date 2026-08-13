import assert from "assert";
import { createSquadBrowserPlayerLookupModule } from "../modules/squadbrowser-player-lookup/index.js";

async function main() {
  console.log("Running SquadBrowser Player Lookup module tests...");

  const module = createSquadBrowserPlayerLookupModule({
    logger: { info: () => {}, error: () => {}, warn: () => {} },
    modules: {},
  });

  assert.strictEqual(module.manifest.id, "module.squadBrowserPlayerLookup");
  assert.strictEqual(module.apiName, "squadBrowserPlayerLookup");
  assert.strictEqual(typeof module.api.lookup, "function");

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
