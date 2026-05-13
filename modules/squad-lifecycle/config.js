// -*- coding: utf-8 -*-

export const defaultSquadLifecycleConfig = {
  enabled: true,
  rconPollIntervalMs: 1000,
  rconTimeoutMs: 800,
  missingConfirmCount: 2,
  emptySnapshotGuard: true,
  suspiciousEmptySnapshotPlayerThreshold: 5,
  createFromRconSnapshot: true,
  preferLogCreateEvent: true,
  preferLogCreatedAt: true,
  closeSquadsOnMatchEnd: true,
  matchChangingGraceMs: 10000,
  debug: true,
};

export function normalizeSquadLifecycleConfig(input = {}) {
  return {
    ...defaultSquadLifecycleConfig,
    ...(input ?? {}),
    preferLogCreateEvent: Boolean(input?.preferLogCreateEvent ?? input?.preferLogCreatedAt ?? defaultSquadLifecycleConfig.preferLogCreateEvent),
    preferLogCreatedAt: Boolean(input?.preferLogCreatedAt ?? input?.preferLogCreateEvent ?? defaultSquadLifecycleConfig.preferLogCreatedAt),
    rconPollIntervalMs: Math.max(200, Number(input?.rconPollIntervalMs ?? defaultSquadLifecycleConfig.rconPollIntervalMs)),
    rconTimeoutMs: Math.max(100, Number(input?.rconTimeoutMs ?? defaultSquadLifecycleConfig.rconTimeoutMs)),
    missingConfirmCount: Math.max(1, Number(input?.missingConfirmCount ?? defaultSquadLifecycleConfig.missingConfirmCount)),
    suspiciousEmptySnapshotPlayerThreshold: Math.max(
      0,
      Number(input?.suspiciousEmptySnapshotPlayerThreshold ?? defaultSquadLifecycleConfig.suspiciousEmptySnapshotPlayerThreshold),
    ),
    matchChangingGraceMs: Math.max(0, Number(input?.matchChangingGraceMs ?? defaultSquadLifecycleConfig.matchChangingGraceMs)),
  };
}
