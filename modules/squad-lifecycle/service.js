// -*- coding: utf-8 -*-

export const CREATION_SOURCE_LABELS = {
  LOG: "\u65e5\u5fd7\u786e\u8ba4",
  RCON_SNAPSHOT: "RCON\u9996\u6b21\u53d1\u73b0",
};

export const CREATION_CONFIDENCE_LABELS = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

export function buildSquadLifecycleKey(serverId, matchId, teamId, squadId, generation = null) {
  const slotKey = buildSquadLifecycleSlotKey(serverId, matchId, teamId, squadId);
  const generationText = normalizeGeneration(generation);
  if (generationText == null) return slotKey;
  return [
    slotKey,
    `G${generationText}`,
  ].join(":");
}

export function buildSquadLifecycleSlotKey(serverId, matchId, teamId, squadId) {
  return [
    String(serverId ?? "").trim(),
    String(matchId ?? "").trim(),
    `T${teamId ?? ""}`,
    `S${squadId ?? ""}`,
  ].join(":");
}

export function formatOrderedSquads(records) {
  return [...records]
    .sort((left, right) => {
      const leftSourceRank = getCreationSourceRank(left.creationSource);
      const rightSourceRank = getCreationSourceRank(right.creationSource);
      if (leftSourceRank !== rightSourceRank) return leftSourceRank - rightSourceRank;

      const leftTime = Number(left.createdAtMs ?? 0);
      const rightTime = Number(right.createdAtMs ?? 0);
      if (leftTime !== rightTime) return leftTime - rightTime;

      const leftGeneration = Number(left.generation ?? 0);
      const rightGeneration = Number(right.generation ?? 0);
      if (leftGeneration !== rightGeneration) return leftGeneration - rightGeneration;

      return Number(left.squadId ?? 0) - Number(right.squadId ?? 0);
    })
    .map((record) => formatLifecycleRecord(record));
}

export function formatLifecycleRecord(record) {
  const createdAtMs = Number(record.createdAtMs ?? 0);
  const createdAtLabel = createdAtMs > 0 ? formatTimeLabel(createdAtMs) : "";
  const generation = normalizeGeneration(record.generation) ?? 1;
  const createdDisplayText = record.creationSource === "RCON_SNAPSHOT"
    ? `\u9996\u6b21\u53d1\u73b0\u4e8e ${createdAtLabel}`
    : `\u521b\u5efa\u4e8e ${createdAtLabel}`;

  return {
    ...record,
    generation,
    slotKey: record.slotKey ?? buildSquadLifecycleSlotKey(record.serverId, record.matchId, record.teamId, record.squadId),
    createdAtMs,
    createdAt: record.createdAt ?? (createdAtMs > 0 ? new Date(createdAtMs).toISOString() : null),
    createdAtLabel,
    createdDisplayText,
    sourceLabel: CREATION_SOURCE_LABELS[record.creationSource] ?? "",
  };
}

export function formatTimeLabel(value) {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "";

  const parts = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ];
  return parts.join(":");
}

export function createCurrentSnapshot({ serverId, matchId, records, updatedAt }) {
  const list = formatOrderedSquads(records);
  const byKey = {};

  for (const item of list) {
    byKey[item.key] = item;
  }

  return {
    serverId,
    matchId: matchId ?? null,
    updatedAt: updatedAt ?? new Date().toISOString(),
    list,
    byKey,
  };
}

function normalizeGeneration(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.trunc(number);
}

function getCreationSourceRank(value) {
  return value === "LOG" ? 0 : 1;
}
