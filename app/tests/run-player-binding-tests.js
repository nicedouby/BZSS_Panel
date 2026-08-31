import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createDatabase } from "../core/database.js";
import { PlayerRepository } from "../repositories/player-repository.js";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-binding-test-"));
const db = await createDatabase({ dir: tempDir, filename: "binding.db" });
const repo = new PlayerRepository(db);

try {
  const player = await repo.upsertFromPresence({
    name: "Binding Tester",
    steamID: "76561198000000001",
    eosID: "eos-binding-tester",
  });

  const issued = await repo.createQQBindingCode({
    codeHash: "hash-one",
    qqNumber: "123456",
    qqName: "Tester",
    expiresAt: Date.now() + 60_000,
  });
  assert.ok(issued.id > 0);

  const consumed = await repo.consumeQQBindingCode({
    codeHash: "hash-one",
    name: "Binding Tester",
    steamID: "76561198000000001",
    eosID: "eos-binding-tester",
  });
  assert.equal(consumed.ok, true);
  assert.equal(consumed.player.id, player.id);
  assert.equal(consumed.player.qq_number, "123456");
  assert.ok(Number(consumed.player.qq_bound_at) > 0);

  const reused = await repo.consumeQQBindingCode({
    codeHash: "hash-one",
    steamID: "76561198000000001",
  });
  assert.equal(reused.ok, false);
  assert.equal(reused.error, "BindingCodeInvalidOrExpired");

  await repo.createQQBindingCode({
    codeHash: "hash-two",
    qqNumber: "654321",
    qqName: "Second Tester",
    expiresAt: Date.now() + 60_000,
  });
  const missingIdentity = await repo.consumeQQBindingCode({
    codeHash: "hash-two",
    name: "Name-only identity must not bind",
  });
  assert.equal(missingIdentity.ok, false);
  assert.equal(missingIdentity.error, "PlayerIdentityMissing");

  await repo.createQQBindingCode({
    codeHash: "hash-expired",
    qqNumber: "777777",
    qqName: "Expired Tester",
    expiresAt: Date.now() + 5,
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  const expired = await repo.consumeQQBindingCode({
    codeHash: "hash-expired",
    steamID: "76561198000000002",
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.error, "BindingCodeInvalidOrExpired");

  const cached = await repo.listPlayersBySteamIDs(["76561198000000001"]);
  assert.equal(cached.length, 1);
  assert.equal(cached[0].qq_number, "123456");

  const audit = await db.get(
    "SELECT event_name, payload_json FROM log_events WHERE event_name = ? ORDER BY id DESC LIMIT 1",
    "account.binding.completed",
  );
  assert.equal(audit.event_name, "account.binding.completed");
  assert.equal(JSON.parse(audit.payload_json).playerId, player.id);
} finally {
  await db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log("player binding tests passed");
