import { CombatBatcher } from "./batcher.js";
import { CombatWsSession } from "./session.js";
import { compactCombatEvent, createCombatPacket, createMatchFinishedPacket, isReplayEvent } from "./protocol.js";

const MODULE_ID = "module.combatWsBridge";
const UNASSIGNED = "*";

export function createCombatWsBridgeModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.logger;
  const configured = config?.get?.("modules.combatWsBridge", {}) ?? {};
  const runtimeConfig = {
    enabled: configured.enabled !== false,
    apiToken: String(configured.apiToken ?? ""),
    websocket: {
      enabled: configured.websocket?.enabled !== false,
      path: configured.websocket?.path ?? "/ws/combat",
      authTimeoutMs: configured.websocket?.authTimeoutMs ?? 5000,
      heartbeatIntervalMs: configured.websocket?.heartbeatIntervalMs ?? 15000,
      heartbeatTimeoutMs: configured.websocket?.heartbeatTimeoutMs ?? 45000,
    },
    batch: { flushIntervalMs: configured.batch?.flushIntervalMs ?? 250, maxEvents: configured.batch?.maxEvents ?? 64 },
    delivery: {
      ackTimeoutMs: configured.delivery?.ackTimeoutMs ?? 3000,
      maxPendingBatches: configured.delivery?.maxPendingBatches ?? 4096,
      maxUnassignedEvents: configured.delivery?.maxUnassignedEvents ?? 4096,
    },
    monitor: { maxPackets: configured.monitor?.maxPackets ?? 300, maxEvents: configured.monitor?.maxEvents ?? 3000 },
  };
  const serverId = String(config?.get?.("server.id", core.webStatus?.serverId ?? "BZSS_Main") ?? "BZSS_Main");
  const sessions = new Set();
  const sessionsByClientId = new Map();
  const pendingPackets = new Map();
  const recentPackets = [];
  const recentEvents = [];
  const unassignedEvents = [];
  const finishedMatches = new Set();
  const unsubscribers = [];
  const stats = { accepted: 0, replayRejected: 0, sent: 0, retried: 0, acked: 0, failed: 0, pendingOverflow: 0, lastSentAt: null };
  let retryTimer = null;

  const batcher = new CombatBatcher({
    ...runtimeConfig.batch,
    onFlush({ matchId, events }) {
      const packet = createCombatPacket({ matchId, serverId, events });
      enqueuePacket(packet);
      return packet;
    },
  });

  function getMatchId() {
    const matchState = modules?.matchState;
    const value = matchState?.api?.getCurrentMatchId?.() ?? matchState?.getCurrentMatchId?.();
    const normalized = String(value ?? "").trim();
    return normalized || null;
  }

  function ingest(input, forcedKind = null) {
    if (!runtimeConfig.enabled || isReplayEvent(input)) {
      if (isReplayEvent(input)) stats.replayRejected += 1;
      return null;
    }
    const event = compactCombatEvent(input, forcedKind);
    if (!event) return null;
    stats.accepted += 1;
    const matchId = getMatchId();
    if (!matchId) {
      unassignedEvents.push(event);
      if (unassignedEvents.length > runtimeConfig.delivery.maxUnassignedEvents) unassignedEvents.shift();
      return event;
    }
    flushUnassigned(matchId);
    batcher.push(matchId, event);
    return event;
  }

  function flushUnassigned(matchId = getMatchId()) {
    if (!matchId || !unassignedEvents.length) return 0;
    const events = unassignedEvents.splice(0);
    for (const event of events) batcher.push(matchId, event);
    return events.length;
  }

  function enqueuePacket(packet) {
    const wire = JSON.stringify(packet);
    const clients = [...sessionsByClientId.values()].filter((session) => session.authenticated && !session.closed);
    const delivery = {
      packet,
      wire,
      bytes: Buffer.byteLength(wire),
      createdAt: Date.now(),
      outstanding: new Set(clients.length ? clients.map((session) => session.clientId) : [UNASSIGNED]),
      attempts: new Map(),
    };
    pendingPackets.set(packet.pid, delivery);
    recordPacket(delivery);
    while (pendingPackets.size > runtimeConfig.delivery.maxPendingBatches) {
      pendingPackets.delete(pendingPackets.keys().next().value);
      stats.pendingOverflow += 1;
    }
    for (const session of clients) sendDelivery(delivery, session, false);
    return packet;
  }

  function sendDelivery(delivery, session, retry) {
    if (!delivery.outstanding.has(session.clientId)) return false;
    try {
      session.send(delivery.packet);
      delivery.attempts.set(session.clientId, { sentAt: Date.now(), count: (delivery.attempts.get(session.clientId)?.count ?? 0) + 1 });
      stats.sent += 1;
      if (retry) stats.retried += 1;
      stats.lastSentAt = new Date().toISOString();
      updateMonitor(delivery.packet.pid, { deliveryState: retry ? "retrying" : "pending", retryCount: Math.max(0, (delivery.attempts.get(session.clientId)?.count ?? 1) - 1), lastSentAt: stats.lastSentAt });
      return true;
    } catch (error) {
      stats.failed += 1;
      moduleLogger?.warn?.(`[CombatWsBridge] send failed: ${error?.message ?? error}`);
      session.close(1011, "Send failed");
      return false;
    }
  }

  function retryPending() {
    flushUnassigned();
    const now = Date.now();
    for (const delivery of pendingPackets.values()) {
      for (const clientId of delivery.outstanding) {
        if (clientId === UNASSIGNED) continue;
        const session = sessionsByClientId.get(clientId);
        if (!session?.authenticated || session.closed) continue;
        const attempt = delivery.attempts.get(clientId);
        if (!attempt || now - attempt.sentAt >= runtimeConfig.delivery.ackTimeoutMs) sendDelivery(delivery, session, Boolean(attempt));
      }
    }
  }

  function acceptWebSocket(req, transport) {
    if (!runtimeConfig.enabled || !runtimeConfig.websocket.enabled) {
      transport.close(1013, "Combat WebSocket disabled");
      return null;
    }
    if (!runtimeConfig.apiToken) {
      transport.close(1013, "Combat WebSocket token is not configured");
      return null;
    }
    let session;
    session = new CombatWsSession({
      transport,
      token: runtimeConfig.apiToken,
      ...runtimeConfig.websocket,
      onAuthenticated(current) {
        const previous = sessionsByClientId.get(current.clientId);
        if (previous && previous !== current) previous.close(4009, "Client replaced");
        sessionsByClientId.set(current.clientId, current);
        for (const delivery of pendingPackets.values()) {
          if (delivery.outstanding.delete(UNASSIGNED)) delivery.outstanding.add(current.clientId);
          if (delivery.outstanding.has(current.clientId)) sendDelivery(delivery, current, Boolean(delivery.attempts.get(current.clientId)));
        }
      },
      onAck(current, ack) {
        const delivery = pendingPackets.get(String(ack?.pid ?? ""));
        if (!delivery || delivery.packet.mid !== String(ack?.mid ?? "") || !delivery.outstanding.delete(current.clientId)) return;
        stats.acked += 1;
        updateMonitor(delivery.packet.pid, { ack: true, deliveryState: delivery.outstanding.size ? "partially-acked" : "acked" });
        if (!delivery.outstanding.size) pendingPackets.delete(delivery.packet.pid);
      },
      onClose(current) {
        sessions.delete(current);
        if (sessionsByClientId.get(current.clientId) === current) sessionsByClientId.delete(current.clientId);
      },
    });
    sessions.add(session);
    return session;
  }

  function enqueueMatchFinished({ matchId, data, time } = {}) {
    const canonicalMatchId = String(matchId ?? getMatchId() ?? "").trim();
    if (!canonicalMatchId || finishedMatches.has(canonicalMatchId)) return null;
    finishedMatches.add(canonicalMatchId);
    while (finishedMatches.size > 500) finishedMatches.delete(finishedMatches.values().next().value);
    batcher.flush();
    return enqueuePacket(createMatchFinishedPacket({ matchId: canonicalMatchId, serverId, data, now: time ?? Date.now() }));
  }

  async function handleSnapshotReady(event = {}) {
    if (!runtimeConfig.enabled || !event.snapshotId) return;
    let snapshot = null;
    try {
      const instance = core.pluginManager?.instances?.find((item) => item?.manifest?.id === "match-end-snapshot");
      snapshot = await instance?.api?.readSnapshot?.(event.snapshotId) ?? await instance?.readSnapshot?.(event.snapshotId) ?? null;
    } catch (error) {
      moduleLogger?.warn?.(`[CombatWsBridge] snapshot read failed: ${error?.message ?? error}`);
    }
    enqueueMatchFinished({ matchId: event.matchId ?? snapshot?.matchId, data: snapshot ?? { ...event }, time: event.time });
  }

  function recordPacket(delivery) {
    recentPackets.unshift({ time: new Date(delivery.createdAt).toISOString(), pid: delivery.packet.pid, mid: delivery.packet.mid, type: delivery.packet.t, events: delivery.packet.e?.length ?? 0, bytes: delivery.bytes, ack: false, retryCount: 0, deliveryState: "queued", wire: delivery.wire });
    recentPackets.splice(runtimeConfig.monitor.maxPackets);
    for (const event of delivery.packet.e ?? []) recentEvents.unshift({ ...event, pid: delivery.packet.pid, mid: delivery.packet.mid, packetTs: delivery.packet.ts, wire: JSON.stringify(event) });
    recentEvents.splice(runtimeConfig.monitor.maxEvents);
  }

  function updateMonitor(pid, values) {
    const item = recentPackets.find((packet) => packet.pid === pid);
    if (item) Object.assign(item, values);
  }

  function getState({ packetId = null, limit = null } = {}) {
    const take = Math.max(1, Math.min(Number(limit) || runtimeConfig.monitor.maxEvents, runtimeConfig.monitor.maxEvents));
    const packet = packetId ? recentPackets.find((item) => item.pid === packetId) : null;
    return {
      enabled: runtimeConfig.enabled,
      configured: Boolean(runtimeConfig.apiToken),
      path: runtimeConfig.websocket.path,
      serverId,
      matchId: getMatchId(),
      clients: [...sessions].map((item) => ({ client: item.clientId, authenticated: item.authenticated, connected: !item.closed, lastPongAt: item.lastPongAt })),
      buffer: { batchEvents: batcher.events.length, batchMatchId: batcher.matchId, unassignedEvents: unassignedEvents.length },
      pending: { count: pendingPackets.size, max: runtimeConfig.delivery.maxPendingBatches },
      packets: { total: recentPackets.length, items: recentPackets.map(({ wire, ...item }) => item) },
      events: { total: recentEvents.length, items: recentEvents.slice(0, take) },
      packetDetail: packet ? { ...packet } : null,
      stats: { ...stats },
    };
  }

  const api = {
    acceptWebSocket,
    ingestCombatEvent: (event) => ingest(event),
    ingestReviveEvent: (event) => ingest(event, "revive"),
    ingestTeamKillEvent: (event) => ingest(event, "tk"),
    enqueueMatchFinished,
    notifyMatchAvailable: () => flushUnassigned(),
    flush: () => batcher.flush(),
    getState,
    getConfig: () => ({ ...runtimeConfig, apiToken: runtimeConfig.apiToken ? "***" : "" }),
  };

  return {
    manifest: { id: MODULE_ID, name: "Combat WebSocket Bridge", description: "Reliable BZSS Combat WS Protocol v1 bridge.", version: "1.0.0", defaultEnabled: true },
    apiName: "combatWsBridge",
    api,
    async start() {
      if (!runtimeConfig.enabled) return;
      unsubscribers.push(core.eventBus.onModuleEvent("module.combatCollector", "combatEvent", api.ingestCombatEvent));
      unsubscribers.push(core.eventBus.onModuleEvent("module.combatClean", "reviveResolved", api.ingestReviveEvent));
      unsubscribers.push(core.eventBus.onCoreEvent("TEAM_KILL", api.ingestTeamKillEvent));
      unsubscribers.push(core.eventBus.onCoreEvent("match.snapshot.ready", handleSnapshotReady));
      retryTimer = setInterval(retryPending, Math.max(25, Math.min(1000, runtimeConfig.delivery.ackTimeoutMs / 2)));
      moduleLogger?.info?.(`[CombatWsBridge] started on ${runtimeConfig.websocket.path}; token=${runtimeConfig.apiToken ? "configured" : "missing"}.`);
    },
    async stop() {
      batcher.stop();
      if (retryTimer) clearInterval(retryTimer);
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe?.();
      for (const session of [...sessions]) session.close(1001, "Server shutting down");
    },
  };
}
