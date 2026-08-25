// -*- coding: utf-8 -*-

// Tactical snapshots are immutable after commit. The compact view can safely
// share normalized fields with the full snapshot instead of deep-cloning the
// entire graph every 100 ms. Public read APIs still clone their return values.
export function compactSnapshot(snapshot) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    meta: source.meta ?? {},
    server: source.server ?? {},
    match: source.match ?? {},
    teams: Array.isArray(source.teams) ? source.teams : [],
    players: (Array.isArray(source.players) ? source.players : []).map(compactPlayer),
    squadFollow: source.squadFollow ?? null,
    assets: source.assets ?? {},
    diagnostics: compactDiagnostics(source.diagnostics),
  };
}

function compactPlayer(player) {
  const source = player && typeof player === "object" ? player : {};
  return {
    identity: source.identity ?? {},
    presence: source.presence ?? {},
    match: source.match ?? {},
    telemetry: source.telemetry ?? {},
    combat: source.combat ?? {},
    vehicle: compactVehicle(source.vehicle),
    network: source.network ?? {},
    profile: source.profile ?? {},
    link: source.link ?? {},
    freshness: compactFreshness(source.freshness),
  };
}

function compactVehicle(vehicle) {
  if (!vehicle || typeof vehicle !== "object") return {};
  const { raw: _raw, ...rest } = vehicle;
  return rest;
}

function compactFreshness(freshness) {
  if (!freshness || typeof freshness !== "object") return {};
  const { generatedAt: _generatedAt, ...rest } = freshness;
  return rest;
}

function compactDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object") return {};
  return {
    unlinkedRconPlayers: diagnostics.unlinkedRconPlayers ?? [],
    unlinkedBzssPlayers: diagnostics.unlinkedBzssPlayers ?? [],
    stalePlayers: diagnostics.stalePlayers ?? [],
    sourceErrors: diagnostics.sourceErrors ?? [],
  };
}

export function buildSnapshotDelta(previous, next) {
  if (!previous) {
    return {
      replace: next,
      players: { upsert: [], remove: [] },
    };
  }

  const previousPlayers = new Map(
    (previous.players ?? []).map((player) => [playerKey(player), player]),
  );
  const nextPlayers = new Map(
    (next.players ?? []).map((player) => [playerKey(player), player]),
  );
  const upsert = [];
  const remove = [];

  for (const [key, player] of nextPlayers) {
    const before = previousPlayers.get(key);
    if (!before || stableJson(before) !== stableJson(player)) upsert.push(player);
  }
  for (const key of previousPlayers.keys()) {
    if (!nextPlayers.has(key)) remove.push(key);
  }

  const delta = {
    meta: next.meta,
    players: { upsert, remove },
  };

  for (const field of ["server", "match", "teams", "squadFollow", "assets", "diagnostics"]) {
    if (stableJson(previous[field]) !== stableJson(next[field])) {
      delta[field] = next[field];
    }
  }

  return delta;
}

export function hasMeaningfulDelta(delta) {
  if (delta?.replace) return true;
  if ((delta?.players?.upsert?.length ?? 0) > 0) return true;
  if ((delta?.players?.remove?.length ?? 0) > 0) return true;
  return ["server", "match", "teams", "squadFollow", "assets", "diagnostics"]
    .some((field) => Object.prototype.hasOwnProperty.call(delta ?? {}, field));
}

export function playerKey(player) {
  const identity = player?.identity ?? {};
  return String(
    identity.key
      ?? identity.steamID
      ?? identity.eosID
      ?? identity.controllerID
      ?? identity.playerID
      ?? identity.playerId
      ?? identity.name
      ?? "",
  );
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

