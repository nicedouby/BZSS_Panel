// -*- coding: utf-8 -*-

function hasOwnEntries(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function pollingValuesConflict(canonical, legacy) {
  const scalarKeys = ["enabled", "playersIntervalMs", "squadsIntervalMs"];
  for (const key of scalarKeys) {
    if (
      canonical?.[key] !== undefined
      && legacy?.[key] !== undefined
      && canonical[key] !== legacy[key]
    ) {
      return true;
    }
  }

  const canonicalDynamic = canonical?.dynamic ?? {};
  const legacyDynamic = legacy?.dynamic ?? {};
  for (const key of Object.keys(legacyDynamic)) {
    if (
      canonicalDynamic[key] !== undefined
      && canonicalDynamic[key] !== legacyDynamic[key]
    ) {
      return true;
    }
  }
  return false;
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
    && pollingValuesConflict(canonical, legacyMatchState)
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
