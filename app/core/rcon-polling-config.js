// -*- coding: utf-8 -*-

function hasOwnEntries(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function stableJson(value) {
  if (!value || typeof value !== "object") return "{}";
  return JSON.stringify(value, Object.keys(value).sort());
}

/**
 * Resolve the one canonical RCON polling configuration.
 *
 * Precedence:
 *   rcon.polling > rcon.matchStatePolling > modules.matchState.polling > defaults
 */
export function resolveRconPollingConfig({
  rconConfig = {},
  matchStateConfig = {},
  logger = null,
} = {}) {
  const canonical = rconConfig.polling ?? {};
  const legacyRcon = rconConfig.matchStatePolling ?? {};
  const legacyMatchState = matchStateConfig.polling ?? {};

  if (
    hasOwnEntries(canonical)
    && hasOwnEntries(legacyMatchState)
    && stableJson(canonical) !== stableJson(legacyMatchState)
  ) {
    logger?.warn?.(
      "[RconManager] Both rcon.polling and modules.matchState.polling are configured. "
      + "rcon.polling takes precedence. modules.matchState.polling player/squad settings are deprecated.",
      { operation: "resolveRconPollingConfig" },
    );
  }

  return {
    ...rconConfig,
    polling: {
      enabled:
        canonical.enabled
        ?? legacyRcon.enabled
        ?? legacyMatchState.enabled
        ?? (matchStateConfig.enabled !== false),
      playersIntervalMs:
        canonical.playersIntervalMs
        ?? legacyRcon.playersIntervalMs
        ?? legacyMatchState.playersIntervalMs
        ?? 3000,
      squadsIntervalMs:
        canonical.squadsIntervalMs
        ?? legacyRcon.squadsIntervalMs
        ?? legacyMatchState.squadsIntervalMs
        ?? 5000,
      dynamic: {
        ...(legacyMatchState.dynamic ?? {}),
        ...(legacyRcon.dynamic ?? {}),
        ...(canonical.dynamic ?? {}),
      },
    },
  };
}
