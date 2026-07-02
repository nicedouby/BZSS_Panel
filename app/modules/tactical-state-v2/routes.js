// -*- coding: utf-8 -*-

export async function handleTacticalStateV2Routes({
  modules,
  url,
  req,
  res,
  user,
  json,
}) {
  if (!url.pathname.startsWith("/api/tactical-state-v2")) {
    return false;
  }

  const tacticalStateV2 = modules.tacticalStateV2;
  if (!tacticalStateV2) {
    json(404, {
      error: "ModuleNotFound",
      message: "tacticalStateV2 module is not loaded.",
    });
    return true;
  }

  if (url.pathname === "/api/tactical-state-v2/snapshot" && req.method === "GET") {
    const snapshot = await tacticalStateV2.getSnapshot?.({ user });
    json(200, {
      ok: true,
      snapshot,
    });
    return true;
  }

  if (url.pathname === "/api/tactical-state-v2/stream" && req.method === "GET") {
    req.socket.setTimeout(0);
    req.socket.setKeepAlive(true);

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    });

    const snapshot = await tacticalStateV2.getSnapshot?.({ user });
    res.write(`data: ${JSON.stringify({
      type: "snapshot",
      revision: snapshot.meta?.revision ?? 0,
      snapshot,
    })}\n\n`);

    const unsubscribe = tacticalStateV2.subscribe?.((patchPayload) => {
      res.write(`data: ${JSON.stringify(patchPayload)}\n\n`);
    });

    req.on("close", () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    });
    return true;
  }

  return false;
}
