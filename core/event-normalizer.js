// -*- coding: utf-8 -*-

/**
 * Core: EventNormalizer
 *
 * 把 Python RawGameEvent 转换成 JS 内部 NormalizedEvent。
 */

export function normalizeRawGameEvent(rawEvent) {
  const serverId = String(rawEvent.ServerID ?? "");
  const sessionId = String(rawEvent.SessionID ?? "");
  const seq = String(rawEvent.Seq ?? "");
  const eventName = String(rawEvent.Event ?? "UnknownEvent");

  return {
    eventId: `${serverId}:${sessionId}:${seq}`,
    eventName,
    layer: "core",
    source: "python-log-parser",

    serverId,
    sessionId,
    seq,

    time: String(rawEvent.Time ?? new Date().toISOString()),
    logTime: String(rawEvent.LogTime ?? ""),

    params: extractParams(rawEvent),

    rawEvent,
    rawLog: String(rawEvent.Raw ?? ""),
  };
}

function extractParams(rawEvent) {
  const params = [];

  for (const [key, value] of Object.entries(rawEvent)) {
    const match = key.match(/^Param(\d+)_(.+)$/);
    if (!match) continue;

    params.push({
      index: Number(match[1]),
      name: match[2],
      value: String(value ?? ""),
    });
  }

  params.sort((a, b) => a.index - b.index);
  return params;
}

export function getParam(event, name, defaultValue = "") {
  const found = event.params?.find((p) => p.name === name);
  return found ? found.value : defaultValue;
}
