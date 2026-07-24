import assert from "node:assert/strict";
import { TacticalReplayPlayerFormat } from "../modules/tactical-replay-player/index.js";

const payload = Buffer.from([
  0x82, 0xa1, 0x61, 0x01, 0xa1, 0x62, 0x92, 0xc3, 0xa1, 0x78,
]);
assert.deepEqual(TacticalReplayPlayerFormat.decodeMessagePack(payload), {
  a: 1,
  b: [true, "x"],
});
assert.equal(TacticalReplayPlayerFormat.crc32(Buffer.from("123456789")), 0xcbf43926);
assert.equal(TacticalReplayPlayerFormat.MAGIC, 0x50525a42);
console.log("run-tactical-replay-player-tests: ok");

assert.equal(TacticalReplayPlayerFormat.resolvePlayerName(7, { name: "Alpha" }), "Alpha");
assert.equal(TacticalReplayPlayerFormat.resolvePlayerName(7, { name: "Unknown Player", steamID: "76561198000000000" }), "76561198000000000");
assert.equal(TacticalReplayPlayerFormat.resolvePlayerName(7, {}), "Player 7");
