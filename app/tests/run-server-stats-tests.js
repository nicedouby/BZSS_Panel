// -*- coding: utf-8 -*-

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ServerMetricStore } from "../modules/server-stats/store.js";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-server-stats-"));
const logger = { warn() {}, error() {} };

try {
  const store = new ServerMetricStore({ dataDir, logger });
  await store.init();

  const startMs = Date.UTC(2026, 6, 1, 0, 0, 0);
  const endMs = startMs + 10_000 * 1000;
  const filePath = path.join(dataDir, "S1-2026-07-01.jsonl");
  const lines = [];
  for (let index = 0; index < 10_000; index += 1) {
    lines.push(JSON.stringify({
      t: startMs + index * 1000,
      m: {
        players: index % 100,
        queue: index % 20,
        tps: 30 + (index % 10) / 10,
      },
      h: String(index),
    }));
  }
  await fs.writeFile(filePath, lines.join("\n") + "\n", "utf8");

  const history = await store.getHistory({
    serverId: "S1",
    fromMs: startMs,
    toMs: endMs,
    maxPoints: 100,
  });
  assert.ok(history.samples.length <= 100);
  assert.equal(history.summary.sourceSampleCount, 10_000);
  assert.equal(history.summary.downsampled, true);

  let readCount = 0;
  const originalRead = store.readHistoryStream.bind(store);
  store.readHistoryStream = async (options) => {
    readCount += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return originalRead(options);
  };

  const sharedQuery = {
    serverId: "S1",
    fromMs: startMs,
    toMs: endMs,
    maxPoints: 80,
  };
  const [left, right] = await Promise.all([
    store.getHistory(sharedQuery),
    store.getHistory(sharedQuery),
  ]);
  assert.equal(readCount, 1);
  assert.deepEqual(left, right);

  await assert.rejects(
    store.getHistory({
      serverId: "S1",
      fromMs: startMs,
      toMs: startMs + 32 * 24 * 60 * 60 * 1000,
      maxPoints: 100,
    }),
    /cannot exceed 31 days/,
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    store.getHistory({
      serverId: "S1",
      fromMs: startMs,
      toMs: endMs,
      maxPoints: 100,
      signal: controller.signal,
    }),
    (error) => error?.name === "AbortError",
  );

  console.log("server stats streaming tests passed");
} finally {
  await fs.rm(dataDir, { recursive: true, force: true });
}
