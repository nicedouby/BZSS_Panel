import assert from "assert";
import {
  createSquadBrowserPlayerLookupModule,
  evaluateLoyalPlayer,
  getSquadBrowserFailureBackoffMs,
  serializeSquadBrowserError,
} from "../modules/squadbrowser-player-lookup/index.js";

async function main() {
  console.log("Running SquadBrowser Player Lookup module tests...");

  let lookupCount = 0;
  const module = createSquadBrowserPlayerLookupModule({
    logger: { info: () => {}, error: () => {}, warn: () => {} },
    modules: {},
    async lookupFetcher(steam64) {
      lookupCount += 1;
      await Promise.resolve();
      return {
        ok: true,
        source: "SquadBrowser",
        sourceUrl: `https://example.invalid/${steam64}`,
        fetchedAt: new Date().toISOString(),
        player: { steamId: steam64, displayName: "Donald·DoubyBear", favoriteServers: [] },
        sessions: [],
      };
    },
  });

  assert.strictEqual(module.manifest.id, "module.squadBrowserPlayerLookup");
  assert.strictEqual(module.apiName, "squadBrowserPlayerLookup");
  assert.strictEqual(typeof module.api.lookup, "function");
  assert.deepStrictEqual(
    [1, 2, 3, 4, 5].map(getSquadBrowserFailureBackoffMs),
    [300_000, 900_000, 3_600_000, 21_600_000, 21_600_000],
  );
  const serializedObjectError = serializeSquadBrowserError({
    message: { upstream: "rate limited" },
    code: "UPSTREAM",
    httpStatus: 429,
    responseBody: "{\"retry\":true}",
  });
  assert.notStrictEqual(serializedObjectError.message, "[object Object]");
  assert.strictEqual(serializedObjectError.httpStatus, 429);

  // Loyalty requires BZSS to rank first and exceed 50% of the saved top-15 total.
  assert.strictEqual(evaluateLoyalPlayer([
    { serverId: "LICENSED-1008168", serverName: "[CN]步战鼠鼠", playtimeMinutes: 51 },
    { serverId: "OTHER", serverName: "其他服务器", playtimeMinutes: 49 },
  ]).qualified, true);
  assert.strictEqual(evaluateLoyalPlayer([
    { serverId: "OTHER", serverName: "BZSS 公益服", playtimeMinutes: 60 },
    { serverId: "OTHER-2", serverName: "其他服务器", playtimeMinutes: 40 },
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

  // Concurrent callers for the same Steam64 must share one upstream request.
  const [result, concurrentResult] = await Promise.all([
    module.api.lookup("76561198194428818"),
    module.api.lookup("76561198194428818"),
  ]);
  assert.strictEqual(lookupCount, 1);
  assert.deepStrictEqual(concurrentResult, result);
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

  // An automatic failure enters a five-minute cooldown; the next cycle must not retry.
  let failureRequestCount = 0;
  let shouldFail = true;
  let online = false;
  const candidate = { id: 1, steam_id: "76561198194428818" };
  const failureModule = createSquadBrowserPlayerLookupModule({
    core: { webStatus: { serverId: "test" } },
    logger: { info() {}, error() {}, warn() {} },
    modules: {
      playerState: {
        getOnlinePlayers() {
          return online ? [{ steamID: candidate.steam_id, name: "test" }] : [];
        },
      },
      playerDatabase: {
        async listSquadBrowserRefreshCandidates() { return [candidate]; },
        async listSquadBrowserRefreshCandidatesBySteamIDs(steamIDs) {
          return steamIDs.length ? [candidate] : [];
        },
        async recordSquadBrowserLookupFailure() {},
      },
    },
    async lookupFetcher(steam64) {
      failureRequestCount += 1;
      if (shouldFail) {
        const error = new Error("rate limited");
        error.httpStatus = 429;
        error.responseBody = "{\"retry\":true}";
        throw error;
      }
      return {
        ok: true,
        source: "SquadBrowser",
        sourceUrl: `https://example.invalid/${steam64}`,
        fetchedAt: new Date().toISOString(),
        player: { steamId: steam64, favoriteServers: [] },
        sessions: [],
      };
    },
  });
  await failureModule.api.runAutoRefresh();
  await failureModule.api.runAutoRefresh();
  assert.strictEqual(failureRequestCount, 1);
  assert.strictEqual(failureModule.api.getAutoRefreshStatus().failureCount, 1);
  shouldFail = false;
  online = true;
  const forced = await failureModule.api.refreshOnline({ force: true });
  assert.strictEqual(forced.updated, 1);
  assert.strictEqual(failureModule.api.getAutoRefreshStatus().failureCount, 0);
  assert.strictEqual(failureModule.api.getAutoRefreshStatus().inFlightCount, 0);

  console.log("SquadBrowser Player Lookup module tests PASSED! ✓");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
