// -*- coding: utf-8 -*-

export async function handleTacticalStateV2Routes({
  modules,
  url,
  req,
  res,
  user,
  json,
  coreClient,
  webServer,
}) {
  if (!url.pathname.startsWith("/api/tactical-state-v2")) {
    return false;
  }

  if (coreClient) {
    if (url.pathname === "/api/tactical-state-v2/snapshot" && req.method === "GET") {
      json(200, await coreClient.getTacticalStateV2Snapshot());
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
      webServer?.beginSse?.();
      const controller = new AbortController();
      const response = await fetch(`${coreClient.baseUrl}/internal/tactical-state-v2/stream`, {
        headers: coreClient.headers,
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        webServer?.endSse?.();
        json(502, {
          error: "CoreStreamFailed",
          message: `Core tactical stream failed with ${response.status}.`,
        });
        return true;
      }

      req.on("close", () => {
        controller.abort();
        webServer?.endSse?.();
      });

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value).toString("utf8"));
      }
      webServer?.endSse?.();
      return true;
    }
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
