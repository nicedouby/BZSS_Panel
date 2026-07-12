import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { handleTacticalStateRoutes } from "../modules/tactical-state/routes.js";

async function main() {
  const req = new EventEmitter();
  req.method = "GET";
  req.socket = { setTimeout() {}, setKeepAlive() {} };

  const res = new EventEmitter();
  const writes = [];
  let blockNext = false;
  res.writableEnded = false;
  res.writeHead = () => {};
  res.write = (text) => {
    writes.push(String(text));
    if (blockNext) {
      blockNext = false;
      return false;
    }
    return true;
  };

  let streamListener = null;
  let unsubscribed = false;
  let latestRevision = 10;
  const tacticalState = {
    async getStreamSnapshot() {
      const envelope = {
        ok: true,
        type: "tactical-state.snapshot",
        snapshot: { meta: { revision: latestRevision }, players: [] },
      };
      return { envelope, serialized: JSON.stringify(envelope) };
    },
    subscribeStream(listener) {
      streamListener = listener;
      return () => { unsubscribed = true; };
    },
  };

  const handled = await handleTacticalStateRoutes({
    modules: { tacticalState },
    url: new URL("http://localhost/api/tactical-state/stream"),
    req,
    res,
    user: null,
    json() {},
  });
  assert.equal(handled, true);
  assert.match(writes[0], /tactical-state\.snapshot/);

  blockNext = true;
  streamListener({ serialized: JSON.stringify({ type: "tactical-state.delta", revision: 11 }) });
  latestRevision = 12;
  streamListener({ serialized: JSON.stringify({ type: "tactical-state.delta", revision: 12 }) });
  res.emit("drain");
  await new Promise((resolve) => setTimeout(resolve, 10));

  const last = writes.at(-1);
  assert.match(last, /tactical-state\.snapshot/);
  assert.match(last, /"revision":12/);
  assert.doesNotMatch(last, /tactical-state\.delta/);

  req.emit("close");
  assert.equal(unsubscribed, true);
  console.log("run-tactical-state-route-tests: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
