import assert from "node:assert/strict";

import { LanOptimizedWebServer } from "../core/lan-optimized-web-server.js";

function createServer(performanceConfig = {}) {
  const warnings = [];
  const server = new LanOptimizedWebServer({
    config: {
      enabled: false,
      host: "127.0.0.1",
      port: 0,
      useVueClient: false,
    },
    logger: {
      warn(message) { warnings.push(message); },
      info() {},
      debug() {},
      error() {},
    },
    core: {
      config: {
        get(key) {
          return key === "performance" ? performanceConfig : undefined;
        },
      },
      bzssCoreCommandService: {},
    },
    modules: {},
  });

  return { server, warnings };
}

function createResponse(url = "/api/test") {
  const result = {
    status: null,
    headers: null,
    body: "",
  };

  return {
    result,
    res: {
      req: {
        url,
        headers: { host: "localhost" },
      },
      writeHead(status, headers) {
        result.status = status;
        result.headers = headers;
      },
      end(body) {
        result.body = String(body ?? "");
      },
    },
  };
}

function testLargeFastJsonDoesNotWarn() {
  const { server, warnings } = createServer({
    largeJsonBytes: 16,
    slowJsonMs: 1_000_000,
  });
  const { res, result } = createResponse("/api/bzss-core/player-info?all=1");

  server.json(res, 200, { payload: "x".repeat(2048) });

  assert.equal(result.status, 200);
  assert.equal(Number(result.headers["Content-Length"]), Buffer.byteLength(result.body));
  assert.equal(warnings.length, 0);
  assert.equal(server.lastLargeJsonResponse?.url, "/api/bzss-core/player-info?all=1");
  assert.ok(server.lastLargeJsonResponse?.sizeBytes > 16);
}

function testSlowJsonStillWarns() {
  const { server, warnings } = createServer({
    largeJsonBytes: 1024 * 1024,
    slowJsonMs: -1,
  });
  const { res } = createResponse("/api/test");

  server.json(res, 200, { ok: true });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^\[slow-json\]/);
}

function testSnapshotSizeTelemetryIsPreserved() {
  const { server } = createServer({
    largeJsonBytes: 1024 * 1024,
    slowJsonMs: 1_000_000,
  });
  const { res, result } = createResponse("/api/snapshot/all");

  server.json(res, 200, { ok: true, values: [1, 2, 3] });

  assert.equal(server.lastSnapshotSizeBytes, Buffer.byteLength(result.body));
}

testLargeFastJsonDoesNotWarn();
testSlowJsonStillWarns();
testSnapshotSizeTelemetryIsPreserved();

console.log("run-lan-optimized-web-server-json-tests: ok");
