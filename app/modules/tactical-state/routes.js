// -*- coding: utf-8 -*-

export async function handleTacticalStateRoutes({
  modules,
  url,
  req,
  res,
  user,
  json,
}) {
  if (!url.pathname.startsWith("/api/tactical-state")) {
    return false;
  }

  const tacticalState = modules.tacticalState;
  if (!tacticalState) {
    json(404, {
      error: "ModuleNotFound",
      message: "tacticalState module is not loaded.",
    });
    return true;
  }

  if (url.pathname === "/api/tactical-state/snapshot" && req.method === "GET") {
    const snapshot = await tacticalState.getSnapshot?.({ user });
    json(200, {
      ok: true,
      snapshot,
    });
    return true;
  }

  if (url.pathname === "/api/tactical-state/players" && req.method === "GET") {
    const players = await tacticalState.getPlayers?.({ user });
    json(200, {
      ok: true,
      players,
    });
    return true;
  }

  if (url.pathname === "/api/tactical-state/player" && req.method === "GET") {
    const identity = {
      steamID: url.searchParams.get("steamID") ?? url.searchParams.get("steamId") ?? url.searchParams.get("steam64") ?? "",
      eosID: url.searchParams.get("eosID") ?? url.searchParams.get("eosId") ?? "",
      playerID: url.searchParams.get("playerID") ?? url.searchParams.get("playerId") ?? "",
      name: url.searchParams.get("name") ?? "",
    };
    const player = await tacticalState.getPlayer?.(identity, { allowLooseName: true });
    json(200, {
      ok: true,
      player,
    });
    return true;
  }

  if (url.pathname === "/api/tactical-state/stream" && req.method === "GET") {
    req.socket.setTimeout(0);
    req.socket.setKeepAlive(true);

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    });

    const sendSnapshot = async () => {
      const snapshot = await tacticalState.getSnapshot?.({ user });
      res.write(`data: ${JSON.stringify({
        ok: true,
        type: "tactical-state.snapshot",
        snapshot,
      })}\n\n`);
    };

    await sendSnapshot();
    const unsubscribe = tacticalState.subscribe?.(() => {
      void sendSnapshot();
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
