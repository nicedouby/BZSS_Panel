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

export function buildSquadLifecycleKey(serverId, matchId, teamId, squadId) {
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
      const leftOrder = Number(left.order ?? 0);
      const rightOrder = Number(right.order ?? 0);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      const leftTime = Number(left.createdAtMs ?? 0);
      const rightTime = Number(right.createdAtMs ?? 0);
      if (leftTime !== rightTime) return leftTime - rightTime;
      return Number(left.squadId ?? 0) - Number(right.squadId ?? 0);
    })
    .map((record) => formatLifecycleRecord(record));
}

export function formatLifecycleRecord(record) {
  const createdAtMs = Number(record.createdAtMs ?? 0);
  const createdAtLabel = createdAtMs > 0 ? formatTimeLabel(createdAtMs) : "";
  const createdDisplayText = record.creationSource === "RCON_SNAPSHOT"
    ? `\u9996\u6b21\u53d1\u73b0\u4e8e ${createdAtLabel}`
    : `\u521b\u5efa\u4e8e ${createdAtLabel}`;

  return {
    ...record,
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
