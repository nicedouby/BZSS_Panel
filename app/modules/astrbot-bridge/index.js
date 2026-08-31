// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";

import { handleAstrbotBridgeRoutes } from "./routes.js";
import { createAstrbotWebSocketGateway } from "./websocket.js";

const MODULE_ID = "module.astrbotBridge";
const DEFAULT_ALLOWED_ACTIONS = ["bindProfile", "setWarmup", "toggleWarmup"];
const SHARP_BUNDLE_ROOT = "C:/Users/12703/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const SERVER_INFO_SNAPSHOT_CACHE_DIR = path.resolve(process.cwd(), "data", "astrbot-bridge", "cache");
const ICON_BASE_DIR = path.resolve(process.cwd(), "web-client/public");
const FACTION_ASSET_DATA_PATH = path.resolve(process.cwd(), "web-client", "src", "shared", "faction-assets", "faction-data.ts");
const MAP_SCENE_FILE_BY_KEY = {
  AlBasrah: "LoadingScreen_AlBasrah_DQHD.PNG",
  Anvil: "LoadingScreen_Anvil_DQHD.PNG",
  Belaya_Pass: "LoadingScreen_Belaya_Pass_DQHD.PNG",
  BlackCoast: "LoadingScreen_BlackCoast_DQHD.PNG",
  Chora: "LoadingScreen_Chora_DQHD.PNG",
  Fallujah: "LoadingScreen_Fallujah_DQHD.PNG",
  FoolsRoad: "LoadingScreen_FoolsRoad_DQHD.PNG",
  GooseBay: "LoadingScreen_GooseBay_DQHD.PNG",
  Gorodok: "LoadingScreen_Gorodok_DQHD.PNG",
  Harju: "LoadingScreen_Harju_DQHD.PNG",
  JensensRange: "LoadingScreen_JensensRange_DQHD.PNG",
  Kamdesh: "LoadingScreen_Kamdesh_DQHD.PNG",
  Kohat: "LoadingScreen_Kohat_DQHD.PNG",
  Kokan: "LoadingScreen_Kokan_DQHD.PNG",
  Lashkar: "LoadingScreen_Lashkar_DQHD.PNG",
  Manicouagan: "LoadingScreen_Manicouagan_DQHD.PNG",
  Mestia: "LoadingScreen_Mestia_DQHD.PNG",
  Mutaha: "LoadingScreen_Mutaha_DQHD.PNG",
  Narva: "LoadingScreen_Narva_DQHD.PNG",
  PacificProvingGrounds: "LoadingScreen_PacificProvingGrounds_DQHD.PNG",
  Sanxian: "LoadingScreen_Sanxian_DQHD.PNG",
  Skorpo: "LoadingScreen_Skorpo_DQHD.PNG",
  Sumari: "LoadingScreen_Sumari_DQHD.PNG",
  Tallil: "LoadingScreen_Tallil_DQHD.PNG",
  Yehorivka: "LoadingScreen_Yehorivka_DQHD.PNG",
};
const FACTION_FLAG_BY_CODE = {
  ADF: "ADF.PNG",
  AFU: "AFU.PNG",
  BAF: "BAF.PNG",
  CAF: "CAF.PNG",
  CRF: "CRF.PNG",
  GFI: "GFI.PNG",
  IMF: "IMF.PNG",
  MEA: "MEA.PNG",
  MEI: "MEI.PNG",
  PLA: "PLA.PNG",
  PLAAGF: "PLAAGF.PNG",
  PLANMC: "PLANMC.png",
  RGF: "RGF.PNG",
  TLF: "TLF.PNG",
  USA: "USA.PNG",
  USMC: "USMC.PNG",
  VDV: "VDV.png",
  WPMC: "WPMC.PNG",
};
const FACTION_GLOW_BY_CODE = {
  ADF: ["#012169", "#e4002b"],
  AFU: ["#0057b7", "#ffd700"],
  BAF: ["#012169", "#c8102e"],
  CAF: ["#ff0000", "#ffffff"],
  CRF: ["#1f2937", "#f97316"],
  GFI: ["#0f766e", "#fde047"],
  IMF: ["#166534", "#dc2626"],
  MEA: ["#b45309", "#111827"],
  MEI: ["#166534", "#eab308"],
  PLA: ["#de2910", "#ffde00"],
  PLAAGF: ["#de2910", "#ffde00"],
  PLANMC: ["#de2910", "#2563eb"],
  RGF: ["#ffffff", "#0039a6", "#d52b1e"],
  TLF: ["#e30a17", "#ffffff"],
  USA: ["#3c3b6e", "#b22234"],
  USMC: ["#b31942", "#facc15"],
  VDV: ["#2563eb", "#22d3ee"],
  WPMC: ["#111827", "#facc15"],
};
const sharpRequire = createRequire(import.meta.url);
let sharpLoaderPromise = null;

export function createAstrbotBridgeModule({ core, modules, config, logger }) {
  const moduleLogger =
    logger ??
    core?.createLogger?.({
      moduleId: MODULE_ID,
      source: MODULE_ID,
      channel: "module",
    }) ??
    core?.logger ??
    console;

  let runtimeConfig = readModuleConfig(config);
  let websocketGateway = null;
  let unsubscribeCoreEvents = null;
  let heartbeatTimer = null;
  let connectedAt = null;
  let lastHeartbeat = null;
  let eventsSent = 0;
  let eventsFailed = 0;
  let lastEvent = null;
  const recentEvents = [];
  const recentAcks = [];
  const recentInteractions = [];
  const pendingFinishedRounds = new Map();
  const publishedFinishedEvents = new Map();
  let ackReceived = 0;
  let delivered = 0;
  let deliveryFailed = 0;
  let lastAckAt = null;
  let lastDeliveredEventId = null;

  const api = {
    getState() {
      return buildState();
    },

    acceptWebSocket(req, socket, head) {
      if (!runtimeConfig.websocket.enabled) {
        socket.end("HTTP/1.1 503 Service Unavailable\\r\\nConnection: close\\r\\n\\r\\nAstrBot WebSocket disabled.");
        return;
      }
      websocketGateway?.acceptUpgrade(req, socket, head);
    },

    refreshConfig() {
      runtimeConfig = readModuleConfig(config);
      return buildState();
    },

    async query(input = {}) {
      return buildQueryResult(input);
    },

    async action(input = {}) {
      return performAction(input);
    },

    async resolveProfile(input = {}) {
      return resolveOrBindProfile(input);
    },

    async queryMe(input = {}) {
      return queryMe(input);
    },

    async queryMeSnapshot(input = {}) {
      return queryMeSnapshot(input);
    },

    async queryPlayerSnapshot(input = {}) {
      return queryPlayerSnapshot(input);
    },

    async queryServerInfoSnapshot(input = {}) {
      return queryServerInfoSnapshot(input);
    },

    async readLatestServerInfoSnapshot() {
      return readLatestServerInfoSnapshot();
    },

    async readEndSnapshotImage(id, input = {}) {
      return readEndSnapshotImage(id, input);
    },

    async readLatestEndSnapshotImage(input = {}) {
      return readLatestEndSnapshotImage(input);
    },

    async unbindMe(input = {}) {
      return unbindMe(input);
    },

    async dispatchMatchFinished(input = {}) {
      return dispatchMatchFinishedEvent(input);
    },

    getWebSocketClientCount() {
      return websocketGateway?.getClientCount?.() ?? 0;
    },

    recordDeliveryAck(input = {}) {
      return recordDeliveryAck(input);
    },

    recordInteraction(input = {}) {
      return recordInteraction(input);
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "AstrBot Bridge",
      kind: "module",
      version: "1.2.0",
      description: "Machine-to-machine bridge for AstrBot clients.",
    },
    apiName: "astrbotBridge",
    api,

    async init() {
      runtimeConfig = readModuleConfig(config);
    },

    async start() {
      websocketGateway = createAstrbotWebSocketGateway({
        getConfig: () => ({
          enabled: runtimeConfig.enabled && runtimeConfig.websocket.enabled,
          apiToken: runtimeConfig.apiToken,
          trustedIps: runtimeConfig.trustedIps,
        }),
        getState: () => buildState(),
        logger: moduleLogger,
      });
      unsubscribeCoreEvents = core?.eventBus?.onCoreEvent?.("*", publishEvent) ?? null;
      connectedAt = new Date().toISOString();
      lastHeartbeat = connectedAt;
      heartbeatTimer = setInterval(() => {
        lastHeartbeat = new Date().toISOString();
        websocketGateway?.publish({
          type: "astrbot.heartbeat",
          data: { time: lastHeartbeat, connectedAt, eventsSent, eventsFailed },
        });
      }, runtimeConfig.websocket.heartbeatIntervalMs);
      heartbeatTimer.unref?.();
      moduleLogger?.info?.(`[AstrBotBridge] started. enabled=${Boolean(runtimeConfig.enabled)} tokenConfigured=${Boolean(runtimeConfig.apiToken)} websocket=${runtimeConfig.websocket.path}`);
    },

    async stop() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      for (const pending of pendingFinishedRounds.values()) {
        if (pending?.timeout) clearTimeout(pending.timeout);
      }
      pendingFinishedRounds.clear();
      unsubscribeCoreEvents?.();
      unsubscribeCoreEvents = null;
      websocketGateway?.closeAll?.();
      websocketGateway = null;
      moduleLogger?.info?.("[AstrBotBridge] stopped.");
    },
  };

  function readModuleConfig(configManager) {
    const current = configManager?.get?.("modules.astrbotBridge", {}) ?? {};
    const allowedActions = Array.isArray(current.allowedActions) && current.allowedActions.length > 0
      ? current.allowedActions.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [...DEFAULT_ALLOWED_ACTIONS];

    return {
      enabled: Boolean(current.enabled ?? false),
      apiToken: String(current.apiToken ?? "").trim(),
      trustedIps: normalizeList(current.trustedIps),
      allowedActions,
      websocket: {
        enabled: current.websocket?.enabled !== false,
        path: String(current.websocket?.path ?? "/ws/astrbot").trim() || "/ws/astrbot",
        heartbeatIntervalMs: Math.max(5000, Number(current.websocket?.heartbeatIntervalMs ?? 30000) || 30000),
      },
      matchFinished: {
        enabled: current.matchFinished?.enabled !== false,
        snapshotWaitMs: clampNumber(current.matchFinished?.snapshotWaitMs, 10, 300_000, 30_000),
        dedupeTtlMs: clampNumber(current.matchFinished?.dedupeTtlMs, 100, 7 * 24 * 60 * 60_000, 86_400_000),
        dedupeMax: clampNumber(current.matchFinished?.dedupeMax, 1, 5000, 500),
        allowTextFallback: current.matchFinished?.allowTextFallback === true,
      },
      deliveryAck: {
        enabled: current.deliveryAck?.enabled !== false,
        maxRecent: clampNumber(current.deliveryAck?.maxRecent, 1, 1000, 100),
      },
      maxRecentEvents: Math.max(10, Math.min(1000, Number(current.maxRecentEvents ?? 100) || 100)),
      maxRecentInteractions: Math.max(50, Math.min(2000, Number(current.maxRecentInteractions ?? 500) || 500)),
    };
  }

  function normalizeList(values) {
    if (!Array.isArray(values)) return [];
    return values.map((value) => String(value ?? "").trim()).filter(Boolean);
  }

  function buildState(extra = {}) {
    return {
      ok: true,
      enabled: Boolean(runtimeConfig.enabled),
      tokenConfigured: Boolean(runtimeConfig.apiToken),
      trustedIps: [...runtimeConfig.trustedIps],
      allowedActions: [...runtimeConfig.allowedActions],
      websocket: {
        enabled: Boolean(runtimeConfig.websocket.enabled),
        path: runtimeConfig.websocket.path,
        connected: Boolean(websocketGateway?.getClientCount?.()),
        clients: websocketGateway?.getClientCount?.() ?? 0,
        connectedAt,
        lastHeartbeat,
      },
      metrics: { eventsSent, eventsFailed, lastEvent, recentEvents: [...recentEvents] },
      matchFinished: {
        enabled: Boolean(runtimeConfig.matchFinished.enabled),
        snapshotWaitMs: runtimeConfig.matchFinished.snapshotWaitMs,
        pending: pendingFinishedRounds.size,
        dedupeSize: publishedFinishedEvents.size,
      },
      delivery: {
        enabled: Boolean(runtimeConfig.deliveryAck.enabled),
        ackReceived,
        delivered,
        failed: deliveryFailed,
        lastAckAt,
        lastDeliveredEventId,
        recentAcks: [...recentAcks],
      },
      interactions: {
        total: recentInteractions.length,
        maxRecent: runtimeConfig.maxRecentInteractions,
        recent: [...recentInteractions],
      },
      ...extra,
    };
  }

  function publishBridgeEvent({
    type,
    version = 1,
    eventId,
    time = new Date().toISOString(),
    data = {},
  } = {}) {
    const normalizedType = firstText(type, "core.event");
    const normalizedTime = normalizeIsoTime(time);
    const normalizedEventId = firstText(
      eventId,
      `${normalizedType}:${normalizedTime}:${randomBytes(4).toString("hex")}`,
    );
    const event = {
      type: normalizedType,
      version: Number(version) || 1,
      eventId: normalizedEventId,
      time: normalizedTime,
      data: sanitizeBridgeEventData(data),
    };
    recentEvents.unshift(event);
    recentEvents.splice(runtimeConfig.maxRecentEvents);
    lastEvent = normalizedType;
    const websocketClients = websocketGateway?.getClientCount?.() ?? 0;
    let published = true;
    try {
      websocketGateway?.publish(event);
      eventsSent += 1;
    } catch (error) {
      published = false;
      eventsFailed += 1;
      moduleLogger?.warn?.(`[AstrBotBridge] event publish failed: ${error.message}`);
    }
    recordInteraction({
      kind: "event",
      direction: "outgoing",
      action: normalizedType,
      eventId: normalizedEventId,
      ok: published,
      summary: published ? "事件已推送至机器人" : "事件推送失败",
      detail: event.data,
    });
    return { event, websocketClients };
  }

  function publishEvent(event) {
    const eventType = String(
      event?.type
      ?? event?.eventName
      ?? event?.name
      ?? event?.rawEvent?.Event
      ?? event?.rawEvent?.EventName
      ?? "core.event",
    ).trim() || "core.event";
    const normalized = event?.normalized ?? {};
    const normalizedPayload = normalized?.roundWorldBringUp
      ?? normalized?.roundMatchWinner
      ?? normalized?.playerConnected
      ?? normalized?.serverTickRate
      ?? {};

    if (eventType === "round.world_bring_up") {
      const serverInfo = buildServerInfo({ includePlayers: false });
      publishBridgeEvent({
        type: "match.started",
        eventId: firstText(event?.eventId, event?.rawEvent?.EventId),
        time: firstText(event?.time, event?.logTime),
        data: {
          map: firstText(normalizedPayload?.mapName, serverInfo?.match?.map),
          mode: firstText(normalizedPayload?.gameMode, serverInfo?.match?.mode),
          players: Number(serverInfo?.population?.players ?? 0),
          serverId: firstText(event?.serverId, serverInfo?.server?.serverId),
        },
      });
      return;
    }

    if (eventType === "match.snapshot.ready") {
      void handleFinishedSnapshotReady(event);
      return;
    }

    if (eventType === "round.match_winner" || eventType === "MATCH_END") {
      queueFinishedRound(event, normalizedPayload);
      return;
    }

    if (eventType === "On_PlayerConnected" || eventType === "player.connected" || eventType === "player.join") {
      const serverInfo = buildServerInfo({ includePlayers: false });
      publishBridgeEvent({
        type: "player.join",
        eventId: firstText(event?.eventId, event?.rawEvent?.EventId),
        time: firstText(event?.time, event?.logTime),
        data: {
          serverId: firstText(event?.serverId, serverInfo?.server?.serverId),
          players: Number(serverInfo?.population?.players ?? 0),
        },
      });
      return;
    }

    if (eventType === "On_PlayerDisconnected" || eventType === "player.disconnected" || eventType === "player.leave") {
      const serverInfo = buildServerInfo({ includePlayers: false });
      publishBridgeEvent({
        type: "player.leave",
        eventId: firstText(event?.eventId, event?.rawEvent?.EventId),
        time: firstText(event?.time, event?.logTime),
        data: {
          serverId: firstText(event?.serverId, serverInfo?.server?.serverId),
          players: Number(serverInfo?.population?.players ?? 0),
        },
      });
      return;
    }

    if (normalized?.category === "server_status" || /server[._-].*(updated|status)|status[._-].*updated/i.test(eventType)) {
      const serverInfo = buildServerInfo({ includePlayers: false });
      publishBridgeEvent({
        type: "server.updated",
        eventId: firstText(event?.eventId, event?.rawEvent?.EventId),
        time: firstText(event?.time, event?.logTime),
        data: {
          players: Number(serverInfo?.population?.players ?? 0),
          maxPlayers: serverInfo?.population?.maxPlayers ?? null,
          queue: Number(serverInfo?.population?.queue ?? 0),
          map: serverInfo?.match?.map ?? "",
          mode: serverInfo?.match?.mode ?? "",
          serverId: serverInfo?.server?.serverId ?? "",
        },
      });
      return;
    }

    publishBridgeEvent({
      type: "core.event",
      eventId: firstText(event?.eventId, event?.rawEvent?.EventId),
      time: firstText(event?.time, event?.logTime),
      data: {
        sourceType: eventType,
        serverId: event?.serverId ?? "",
      },
    });
  }

  function queueFinishedRound(sourceEvent = {}, normalizedPayload = {}) {
    if (!runtimeConfig.matchFinished.enabled) return;
    prunePublishedFinishedEvents();
    const serverInfo = buildServerInfo({ includePlayers: false });
    const roundKey = resolveRoundKey(sourceEvent, normalizedPayload, serverInfo);
    const sourceType = firstText(sourceEvent?.eventName, sourceEvent?.type, sourceEvent?.name, "round.match_winner");
    const serverId = firstText(sourceEvent?.serverId, normalizedPayload?.serverId, serverInfo?.server?.serverId, "server");
    const duplicateWindowMs = Math.max(60_000, runtimeConfig.matchFinished.snapshotWaitMs);
    const now = Date.now();
    const alternatePending = [...pendingFinishedRounds.values()].some((item) =>
      item.serverId === serverId
      && item.sourceType !== sourceType
      && now - Date.parse(item.receivedAt) <= duplicateWindowMs
    );
    const alternatePublished = [...publishedFinishedEvents.values()].some((item) =>
      item.serverId === serverId
      && !item.simulated
      && item.sourceType
      && item.sourceType !== sourceType
      && now - Date.parse(item.publishedAt) <= duplicateWindowMs
    );
    if (
      !roundKey
      || hasPublishedRound(roundKey)
      || pendingFinishedRounds.has(roundKey)
      || alternatePending
      || alternatePublished
    ) return;

    const pending = {
      roundKey,
      serverId,
      sourceType,
      winner: firstText(
        normalizedPayload?.winner,
        sourceEvent?.winner,
        sourceEvent?.data?.winner,
        sourceEvent?.payload?.winner,
      ),
      receivedAt: new Date().toISOString(),
      sourceEvent,
      timeout: null,
    };
    pending.timeout = setTimeout(() => {
      const current = pendingFinishedRounds.get(roundKey);
      if (current !== pending) return;
      pendingFinishedRounds.delete(roundKey);
      if (!runtimeConfig.matchFinished.allowTextFallback || hasPublishedRound(roundKey)) return;
      void dispatchMatchFinishedEvent({
        sourceEvent,
        roundKey,
        serverId: pending.serverId,
        winner: pending.winner,
        snapshotId: null,
        snapshotReady: false,
        simulated: false,
        source: "round.match_winner.timeout",
      });
    }, runtimeConfig.matchFinished.snapshotWaitMs);
    pending.timeout.unref?.();
    pendingFinishedRounds.set(roundKey, pending);
  }

  async function handleFinishedSnapshotReady(sourceEvent = {}) {
    if (!runtimeConfig.matchFinished.enabled) return;
    const roundKey = firstText(
      sourceEvent?.roundKey,
      sourceEvent?.data?.roundKey,
      sourceEvent?.payload?.roundKey,
    );
    const pending = pendingFinishedRounds.get(roundKey);
    if (!roundKey || !pending) return;

    const snapshotApi = resolveMatchEndSnapshotApi();
    const snapshotId = String(sourceEvent?.snapshotId ?? sourceEvent?.data?.snapshotId ?? "").trim();
    if (!snapshotId || !snapshotApi?.readSnapshot) return;
    let snapshot = null;
    try {
      snapshot = await snapshotApi.readSnapshot(snapshotId);
    } catch (error) {
      moduleLogger?.warn?.(`[AstrBotBridge] failed to read finished snapshot: ${error.message}`);
      return;
    }

    const snapshotRoundKey = firstText(
      snapshot?.roundKey,
      snapshot?.source?.roundKey,
      snapshot?.trigger?.raw?.roundKey,
      sourceEvent?.roundKey,
    );
    if (snapshotRoundKey !== roundKey) {
      moduleLogger?.warn?.(`[AstrBotBridge] ignored snapshot ${snapshotId}: roundKey mismatch expected=${roundKey} actual=${snapshotRoundKey || "-"}`);
      return;
    }

    if (pending.timeout) clearTimeout(pending.timeout);
    pendingFinishedRounds.delete(roundKey);
    await dispatchMatchFinishedEvent({
      sourceEvent: pending.sourceEvent,
      roundKey,
      serverId: pending.serverId,
      winner: pending.winner,
      snapshotId,
      snapshot,
      snapshotReady: true,
      simulated: false,
      source: "match.snapshot.ready",
    });
  }

  async function dispatchMatchFinishedEvent(input = {}) {
    prunePublishedFinishedEvents();
    const serverInfo = buildServerInfo({ includePlayers: false });
    const simulated = input?.simulated === true;
    const snapshotApi = resolveMatchEndSnapshotApi();
    let snapshot = input?.snapshot && typeof input.snapshot === "object" ? input.snapshot : null;
    let snapshotId = firstText(input?.snapshotId);

    if (!snapshot && snapshotId && snapshotApi?.readSnapshot) {
      try {
        snapshot = await snapshotApi.readSnapshot(snapshotId);
      } catch (error) {
        moduleLogger?.warn?.(`[AstrBotBridge] failed to read snapshot ${snapshotId}: ${error.message}`);
      }
    }

    if (!snapshot && simulated && input?.useLatestSnapshot === true && snapshotApi?.listSnapshots && snapshotApi?.readSnapshot) {
      try {
        const snapshots = await snapshotApi.listSnapshots({ scope: "official", sort: "newest" });
        const latest = Array.isArray(snapshots) ? snapshots[0] : null;
        if (latest?.id) {
          snapshotId = firstText(latest.id);
          snapshot = await snapshotApi.readSnapshot(snapshotId);
        }
      } catch (error) {
        moduleLogger?.warn?.(`[AstrBotBridge] failed to read simulation snapshot template: ${error.message}`);
      }
    }

    const sourceEvent = input?.sourceEvent ?? {};
    const serverId = firstText(
      input?.serverId,
      snapshot?.server?.serverId,
      sourceEvent?.serverId,
      serverInfo?.server?.serverId,
      "server",
    );
    const randomId = randomBytes(6).toString("hex");
    const time = normalizeIsoTime(input?.time);
    const roundKey = firstText(
      input?.roundKey,
      simulated ? `test:${time}:${randomId}` : "",
      snapshot?.roundKey,
      snapshot?.source?.roundKey,
      snapshotId ? `${serverId}:${snapshotId}` : "",
    );
    if (!roundKey) {
      const error = new Error("A stable roundKey is required for match.finished.");
      error.code = "RoundKeyRequired";
      error.statusCode = 400;
      throw error;
    }

    const eventId = firstText(
      input?.eventId,
      simulated
        ? `test_match_finished:${serverId}:${Date.parse(time) || Date.now()}:${randomId}`
        : `match_finished:${serverId}:${roundKey}`,
    );
    const duplicate = findPublishedFinishedEvent(eventId, roundKey, simulated);
    if (duplicate) {
      return {
        ok: true,
        published: false,
        duplicate: true,
        event: duplicate.event,
        websocketClients: websocketGateway?.getClientCount?.() ?? 0,
      };
    }

    const snapshotReady = (input?.snapshotReady == null ? true : input.snapshotReady === true)
      && Boolean(snapshot && snapshotId);
    if (!snapshotReady) snapshotId = "";
    const data = {
      serverId,
      serverName: firstText(input?.serverName, snapshot?.server?.serverName, serverInfo?.server?.serverName),
      roundKey,
      map: firstText(input?.map, snapshot?.match?.map, serverInfo?.match?.map),
      layer: firstText(input?.layer, snapshot?.match?.layer, serverInfo?.match?.layer),
      mode: firstText(input?.mode, snapshot?.match?.mode, snapshot?.match?.gameMode, serverInfo?.match?.mode),
      winner: firstText(input?.winner, snapshot?.trigger?.winner, sourceEvent?.winner, sourceEvent?.data?.winner),
      players: Number(
        input?.players
        ?? snapshot?.summary?.recordedPlayerCount
        ?? snapshot?.summary?.playerCount
        ?? snapshot?.server?.playerCount
        ?? serverInfo?.population?.players
        ?? 0
      ),
      snapshotId: snapshotId || null,
      snapshotReady,
      simulated,
      source: firstText(input?.source, simulated ? "panel.manual-test" : "match.snapshot.ready"),
    };
    const published = publishBridgeEvent({
      type: "match.finished",
      version: 1,
      eventId,
      time,
      data,
    });
    publishedFinishedEvents.set(eventId, {
      eventId,
      roundKey,
      serverId,
      sourceType: firstText(
        sourceEvent?.eventName,
        sourceEvent?.type,
        sourceEvent?.name,
      ),
      snapshotId: data.snapshotId,
      publishedAt: time,
      simulated,
      event: published.event,
    });
    prunePublishedFinishedEvents();
    return {
      ok: true,
      published: true,
      duplicate: false,
      event: published.event,
      websocketClients: published.websocketClients,
    };
  }

  function resolveRoundKey(event = {}, normalizedPayload = {}, serverInfo = {}) {
    const explicit = firstText(
      event?.roundKey,
      event?.payload?.roundKey,
      event?.data?.roundKey,
      normalizedPayload?.roundKey,
      event?.eventId,
      event?.rawEvent?.EventId,
    );
    if (explicit) return explicit;

    const serverId = firstText(event?.serverId, normalizedPayload?.serverId, serverInfo?.server?.serverId, "server");
    const layer = firstText(
      event?.layerName,
      normalizedPayload?.layer,
      normalizedPayload?.mapName,
      serverInfo?.match?.layer,
      serverInfo?.match?.map,
      "unknown",
    );
    const eventTimeMs = Date.parse(firstText(event?.time, event?.logTime, new Date().toISOString()));
    const playtimeMs = Math.max(0, Number(serverInfo?.match?.rconTimeSeconds ?? 0) || 0) * 1000;
    const anchorMs = Math.floor(((Number.isFinite(eventTimeMs) ? eventTimeMs : Date.now()) - playtimeMs) / 60_000) * 60_000;
    return `${serverId}:${layer}:${new Date(anchorMs).toISOString().slice(0, 16)}`;
  }

  function findPublishedFinishedEvent(eventId, roundKey, simulated = false) {
    const byId = publishedFinishedEvents.get(eventId);
    if (byId) return byId;
    if (simulated) return null;
    for (const record of publishedFinishedEvents.values()) {
      if (!record.simulated && record.roundKey === roundKey) return record;
    }
    return null;
  }

  function hasPublishedRound(roundKey) {
    return Boolean(findPublishedFinishedEvent("", roundKey, false));
  }

  function prunePublishedFinishedEvents(now = Date.now()) {
    const ttlMs = runtimeConfig.matchFinished.dedupeTtlMs;
    for (const [eventId, record] of publishedFinishedEvents) {
      const publishedMs = Date.parse(record?.publishedAt ?? "");
      if (!Number.isFinite(publishedMs) || now - publishedMs > ttlMs) {
        publishedFinishedEvents.delete(eventId);
      }
    }
    while (publishedFinishedEvents.size > runtimeConfig.matchFinished.dedupeMax) {
      const oldestKey = publishedFinishedEvents.keys().next().value;
      if (!oldestKey) break;
      publishedFinishedEvents.delete(oldestKey);
    }
  }

  function recordDeliveryAck(input = {}) {
    const receivedAt = new Date().toISOString();
    const ack = {
      eventId: firstText(input?.eventId),
      eventType: firstText(input?.eventType),
      receivedAt,
      received: input?.received === true,
      delivered: input?.delivered === true,
      successCount: Math.max(0, Number(input?.successCount ?? 0) || 0),
      failureCount: Math.max(0, Number(input?.failureCount ?? 0) || 0),
      targets: Array.isArray(input?.targets) ? input.targets.map((item) => ({ ...item })) : [],
      error: input?.error == null ? null : String(input.error),
    };
    recentAcks.unshift(ack);
    recentAcks.splice(runtimeConfig.deliveryAck.maxRecent);
    ackReceived += 1;
    lastAckAt = receivedAt;
    if (ack.delivered) {
      delivered += 1;
      lastDeliveredEventId = ack.eventId;
    } else {
      deliveryFailed += 1;
    }
    recordInteraction({
      kind: "ack",
      direction: "incoming",
      action: ack.eventType || "event.ack",
      eventId: ack.eventId,
      ok: ack.delivered && ack.failureCount === 0,
      summary: ack.delivered ? "机器人已确认群消息送达" : "机器人报告群消息发送失败",
      detail: {
        received: ack.received,
        delivered: ack.delivered,
        successCount: ack.successCount,
        failureCount: ack.failureCount,
        error: ack.error,
      },
    });
    return ack;
  }

  function recordInteraction(input = {}) {
    const createdAt = normalizeIsoTime(input?.createdAt ?? new Date().toISOString());
    const interaction = {
      id: firstText(input?.id, `astrbot:${Date.now()}:${randomBytes(4).toString("hex")}`),
      createdAt,
      kind: firstText(input?.kind, "command"),
      direction: firstText(input?.direction, "incoming"),
      action: firstText(input?.action, "unknown"),
      qqNumber: firstText(input?.qqNumber),
      qqName: firstText(input?.qqName),
      steam64: firstText(input?.steam64),
      playerId: input?.playerId == null ? null : Number(input.playerId) || null,
      playerName: firstText(input?.playerName),
      clientIp: firstText(input?.clientIp),
      eventId: firstText(input?.eventId),
      ok: input?.ok !== false,
      summary: firstText(input?.summary),
      detail: sanitizeBridgeEventData(input?.detail ?? {}),
    };
    recentInteractions.unshift(interaction);
    recentInteractions.splice(runtimeConfig.maxRecentInteractions);
    return interaction;
  }

  function sanitizeBridgeEventData(data) {
    const allowed = {};
    for (const [key, value] of Object.entries(data ?? {})) {
      if (value === undefined) continue;
      if (["string", "number", "boolean"].includes(typeof value) || value === null) allowed[key] = value;
    }
    return allowed;
  }

  function buildQueryResult(input = {}) {
    const kind = String(input.kind ?? input.query ?? "snapshot").trim();
    if (kind === "health") {
      return {
        ...buildState(),
        data: {
          status: "ok",
          service: "BZSS Panel AstrBot Bridge",
          time: new Date().toISOString(),
          web: core?.webStatus?.getSnapshot?.() ?? null,
        },
      };
    }

    if (kind === "modules") {
      return {
        ...buildState(),
        data: {
          modules: buildModuleSummary(),
        },
      };
    }

    if (kind === "warmup") {
      return {
        ...buildState(),
        data: {
          warmup: core?.webStatus?.getWarmupState?.() ?? null,
        },
      };
    }

    if (isServerInfoQuery(kind)) {
      return {
        ...buildState(),
        data: {
          serverInfo: buildServerInfo(input),
        },
      };
    }

    if (kind === "me") {
      return queryMe(input);
    }

    if (kind === "unbindMe") {
      return unbindMe(input);
    }

    return {
      ...buildState(),
      data: {
        snapshot: core?.webStatus?.getSnapshot?.() ?? null,
        warmup: core?.webStatus?.getWarmupState?.() ?? null,
      },
    };
  }

  function buildModuleSummary() {
    const summary = [];
    for (const [name, moduleApi] of Object.entries(modules ?? {})) {
      if (!moduleApi) continue;
      summary.push({
        name,
        hasState: typeof moduleApi.getState === "function",
        hasApi: typeof moduleApi === "object",
      });
    }
    return summary.sort((a, b) => a.name.localeCompare(b.name));
  }

  function buildServerInfo(input = {}) {
    const runtimeSnapshot = core?.runtimeState?.getAll?.() ?? null;
    const runtimeServer = runtimeSnapshot?.server ?? null;
    const runtimeMatch = core?.runtimeState?.getMatch?.() ?? null;
    const runtimePlayers = core?.runtimeState?.getPlayers?.() ?? null;
    const runtimeSquads = core?.runtimeState?.getSquads?.() ?? null;
    const overview = getMatchOverview();
    const webStatus = core?.webStatus?.getSnapshot?.() ?? {};
    const matchState = overview?.matchState && typeof overview.matchState === "object" ? overview.matchState : {};
    const status = overview?.status && typeof overview.status === "object" ? overview.status : webStatus;
    const serverStatus = matchState.serverStatus && typeof matchState.serverStatus === "object" ? matchState.serverStatus : {};
    const match = runtimeMatch?.match && typeof runtimeMatch.match === "object"
      ? runtimeMatch.match
      : {
          ...(matchState.match && typeof matchState.match === "object" ? matchState.match : {}),
          ...(overview?.match && typeof overview.match === "object" ? overview.match : {}),
        };
    const players = normalizeMatchPlayers(
      Array.isArray(runtimePlayers?.active)
        ? runtimePlayers.active
        : Array.isArray(overview?.players)
          ? overview.players
          : Array.isArray(matchState.players?.list)
            ? matchState.players.list
            : Array.isArray(matchState.players)
              ? matchState.players
              : [],
    );
    const squads = normalizeMatchSquads(
      Array.isArray(runtimeSquads?.list)
        ? runtimeSquads.list
        : Array.isArray(overview?.squads)
          ? overview.squads
          : Array.isArray(matchState.squads?.list)
            ? matchState.squads.list
            : Array.isArray(matchState.squads)
              ? matchState.squads
              : [],
    );
    const teams = buildServerInfoTeams(players, squads);
    const currentPlayers = firstFiniteNumber(
      players.length || null,
      status.playerCount,
      serverStatus.playerCount,
      webStatus.playerCount,
      matchState.playerCount,
    ) ?? 0;
    const maxPlayers = firstFiniteNumber(status.maxPlayers, serverStatus.maxPlayers, webStatus.maxPlayers, match.maxPlayers) ?? null;
    const queueCount = firstFiniteNumber(status.queueCount, serverStatus.queueCount, webStatus.queueCount, matchState.queueCount) ?? 0;
    const rconTimeSeconds = firstFiniteNumber(
      status.rconTime,
      status.playtime,
      status.matchTimeSeconds,
      serverStatus.rconTime,
      serverStatus.playtime,
      serverStatus.matchTimeSeconds,
      match.rconTime,
      match.playtime,
    ) ?? 0;

    return {
      generatedAt: new Date().toISOString(),
      source: runtimeSnapshot ? "runtimeState" : overview ? "matchState" : "webStatus",
      server: {
        serverId: firstText(runtimeServer?.serverId, runtimeMatch?.serverId, matchState.serverId, overview?.serverId, status.serverId, webStatus.serverId),
        serverName: firstText(runtimeServer?.serverName, status.serverName, status.name, serverStatus.serverName, serverStatus.name, webStatus.serverName),
        rcon: firstText(runtimeServer?.rconStatus?.status, runtimeMatch?.rconStatus?.status, matchState.rconStatus?.status, status.rcon, serverStatus.rcon, webStatus.rcon),
      },
      match: {
        map: firstText(runtimeMatch?.server?.map, runtimeServer?.map, match.map, status.map, serverStatus.map, status.currentLayer, webStatus.map),
        layer: firstText(runtimeMatch?.server?.layer, runtimeServer?.layer, match.layer, status.layer, status.currentLayer, serverStatus.layer, webStatus.layer),
        mode: firstText(runtimeMatch?.server?.mode, runtimeServer?.mode, match.mode, match.gameMode, status.gameMode, status.mode, serverStatus.gameMode, webStatus.mode),
        nextLayer: firstText(runtimeMatch?.server?.nextLayer, runtimeServer?.nextLayer, match.nextLayer, status.nextLayer, serverStatus.nextLayer, webStatus.nextLayer),
        rconTimeSeconds,
        rconTime: formatDurationClock(rconTimeSeconds),
      },
      population: {
        players: firstFiniteNumber(runtimeServer?.playerCount, runtimeMatch?.server?.playerCount, currentPlayers) ?? currentPlayers,
        maxPlayers: firstFiniteNumber(runtimeServer?.maxPlayers, runtimeMatch?.server?.maxPlayers, maxPlayers) ?? maxPlayers,
        queue: firstFiniteNumber(runtimeServer?.queueCount, runtimeMatch?.server?.queueCount, queueCount) ?? queueCount,
        text: maxPlayers ? `${currentPlayers}/${maxPlayers}` : String(currentPlayers),
      },
      teams,
      commanders: Object.fromEntries(teams.map((team) => [String(team.teamId), team.commander])),
      warmup: runtimeServer?.isWarmup != null
        ? { isWarmup: Boolean(runtimeServer.isWarmup) }
        : core?.webStatus?.getWarmupState?.() ?? null,
      includePlayers: Boolean(input.includePlayers ?? input.players ?? false),
      players: input.includePlayers || input.players ? players : undefined,
    };
  }

  function getMatchOverview() {
    const api = modules?.matchState?.api ?? modules?.matchState;
    const overview = api?.getOverview?.();
    if (overview) return overview;
    const state = api?.getState?.();
    if (!state) return null;
    return {
      status: core?.webStatus?.getSnapshot?.() ?? {},
      matchState: state,
      serverStatus: state.serverStatus,
      match: state.match,
      players: Array.isArray(state.players?.list) ? state.players.list : [],
      squads: Array.isArray(state.squads?.list) ? state.squads.list : [],
    };
  }

  function normalizeMatchPlayers(players = []) {
    return (Array.isArray(players) ? players : []).map((player) => ({
      playerId: player?.playerID ?? player?.playerId ?? player?.id ?? null,
      name: firstText(player?.name, player?.playerName, "Unknown"),
      teamId: nullableNumber(player?.teamID ?? player?.teamId),
      squadId: nullableNumber(player?.squadID ?? player?.squadId),
      role: firstText(player?.role, player?.roleName, ""),
      isLeader: Boolean(player?.isLeader ?? player?.leader),
      isCommander: Boolean(player?.isCommander ?? player?.commander),
      steam64: firstText(player?.steamID, player?.steamId, player?.steam64ID, player?.steam64, ""),
      eosID: firstText(player?.eosID, player?.eosId, player?.EOSID, ""),
      steamAvatar: firstText(player?.steamAvatar, player?.steam_avatar, player?.avatar, player?.steamPlaytime?.steamAvatar, player?.steamPlaytime?.steam_avatar),
      gameSeconds: firstFiniteNumber(player?.gameSeconds, player?.playtimeSeconds, player?.steamPlaytime?.gameSeconds, player?.steamPlaytime?.game_seconds) ?? 0,
    }));
  }

  function normalizeMatchSquads(squads = []) {
    return (Array.isArray(squads) ? squads : []).map((squad) => ({
      teamId: nullableNumber(squad?.teamID ?? squad?.teamId),
      squadId: nullableNumber(squad?.squadID ?? squad?.squadId),
      teamName: firstText(squad?.teamName, squad?.raw?.teamName, squad?.raw?.faction, squad?.raw?.factionName, squad?.raw?.battlegroup, squad?.raw?.battleGroup, ""),
      squadName: firstText(squad?.squadName, squad?.name, squad?.raw?.squadName, squad?.raw?.name, ""),
      size: nullableNumber(squad?.size ?? squad?.memberCount),
    }));
  }

  function buildServerInfoTeams(players, squads) {
    const teamIds = new Set();
    for (const player of players) if (player.teamId != null) teamIds.add(player.teamId);
    for (const squad of squads) if (squad.teamId != null) teamIds.add(squad.teamId);
    if (!teamIds.size) {
      teamIds.add(1);
      teamIds.add(2);
    }

    return [...teamIds].sort((a, b) => Number(a) - Number(b)).map((teamId) => {
      const teamPlayers = players.filter((player) => Number(player.teamId) === Number(teamId));
      const teamSquads = squads.filter((squad) => Number(squad.teamId) === Number(teamId));
      const teamName = resolveTeamName(teamSquads, teamId);
      const commander = resolveCommander(teamPlayers, teamSquads);
      return {
        teamId,
        teamName,
        factionCode: resolveFactionCode(teamName),
        playerCount: teamPlayers.length,
        squadCount: teamSquads.length,
        commander,
      };
    });
  }

  function resolveTeamName(teamSquads, teamId) {
    const direct = teamSquads.map((squad) => squad.teamName).find(Boolean);
    if (direct) return direct;
    const squadNameFaction = teamSquads.map((squad) => squad.squadName).find((name) => resolveFactionCode(name));
    return squadNameFaction || `Team ${teamId}`;
  }

  function resolveCommander(teamPlayers, teamSquads) {
    const commandSquadIds = teamSquads
      .filter((squad) => isCommandSquadName(squad.squadName) || isCommandSquadId(squad.squadId))
      .map((squad) => String(squad.squadId ?? "").trim().toLowerCase())
      .filter(Boolean);
    const commandPlayers = commandSquadIds.length
      ? teamPlayers.filter((player) => commandSquadIds.includes(String(player.squadId ?? "").trim().toLowerCase()))
      : [];
    const commander = commandPlayers.find((player) => player.isLeader && player.name)
      ?? commandPlayers.find((player) => isCommanderRole(player) && player.name)
      ?? commandPlayers.find((player) => player.name)
      ?? teamPlayers.find((player) => player.isCommander && player.name)
      ?? teamPlayers.find((player) => isCommanderRole(player) && player.name)
      ?? null;
    return commander
      ? {
          name: commander.name,
          steam64: commander.steam64,
          eosID: commander.eosID,
          role: commander.role,
          gameSeconds: commander.gameSeconds,
          gameTime: formatDurationLong(commander.gameSeconds),
          steamAvatar: commander.steamAvatar,
        }
      : null;
  }

  async function performAction(input = {}) {
    const name = String(input.name ?? input.action ?? "").trim();
    if (!name) {
      return createActionError(400, "MissingAction", "Action name is required.");
    }

    if (!runtimeConfig.allowedActions.includes(name)) {
      return createActionError(403, "ActionNotAllowed", `Action is not allowed: ${name}`);
    }

    if (name === "toggleWarmup") {
      if (!core?.webStatus?.setWarmup) {
        return createActionError(503, "WarmupUnavailable", "Warmup control is unavailable.");
      }

      const current = Boolean(core.webStatus.getWarmupState?.().isWarmup);
      const result = await core.webStatus.setWarmup(!current, {
        updatedBy: "astrbot-bridge",
      });

      return {
        ok: true,
        data: {
          action: name,
          warmup: result,
        },
      };
    }

    if (name === "bindProfile") {
      return bindProfile(input);
    }

    if (name === "setWarmup") {
      if (!core?.webStatus?.setWarmup) {
        return createActionError(503, "WarmupUnavailable", "Warmup control is unavailable.");
      }

      const enabled = Boolean(input.enabled ?? input.value ?? input.warmup);
      const result = await core.webStatus.setWarmup(enabled, {
        updatedBy: "astrbot-bridge",
      });

      return {
        ok: true,
        data: {
          action: name,
          warmup: result,
        },
      };
    }

    return createActionError(400, "UnsupportedAction", `Unsupported action: ${name}`);
  }

  async function bindProfile(input = {}) {
    const qqNumber = String(input.qqNumber ?? input.qq ?? input.qq_number ?? "").trim();
    const qqName = String(input.qqName ?? input.qq_name ?? input.qqNick ?? "").trim();
    const steam64 = normalizeSteam64(input.steam64 ?? input.steamID ?? input.steamId ?? input.steam64ID);

    if (!qqNumber) return createActionError(400, "MissingQQNumber", "QQ number is required.");
    if (!qqName) return createActionError(400, "MissingQQName", "QQ name is required.");
    if (!steam64) return createActionError(400, "MissingSteam64", "Steam64 is required.");

    const playerDatabase = modules?.playerDatabase ?? null;
    if (!playerDatabase?.findByIdentity || !playerDatabase?.bindQQToPlayer) {
      return createActionError(503, "PlayerDatabaseUnavailable", "Player database is unavailable.");
    }

    const player = await playerDatabase.findByIdentity({ steamID: steam64 });
    if (!player?.id) return createActionError(404, "PlayerNotFound", "Player not found.");
    if (player.qq_number && player.qq_number !== qqNumber) {
      return createActionError(409, "QQAlreadyBound", "This player already has another QQ binding.");
    }

    const updated = await playerDatabase.bindQQToPlayer(player.id, { qqNumber, qqName });
    const playerInfo = serializePlayer(updated);
    return {
      ok: true,
      data: {
        action: "bindProfile",
        message: buildBindMessage(playerInfo, qqName, qqNumber),
        player: playerInfo,
        bound: true,
      },
    };
  }

  async function resolveOrBindProfile(input = {}) {
    const qqNumber = String(input.qqNumber ?? input.qq ?? input.qq_number ?? "").trim();
    const qqName = String(input.qqName ?? input.qq_name ?? input.qqNick ?? "").trim();
    const steam64 = normalizeSteam64(input.steam64 ?? input.steamID ?? input.steamId ?? input.steam64ID);

    if (!qqNumber) return createActionError(400, "MissingQQNumber", "QQ number is required.");
    if (!qqName) return createActionError(400, "MissingQQName", "QQ name is required.");

    const playerDatabase = modules?.playerDatabase ?? null;
    if (!playerDatabase?.findByIdentity || !playerDatabase?.bindQQToPlayer) {
      return createActionError(503, "PlayerDatabaseUnavailable", "Player database is unavailable.");
    }

    let player = await playerDatabase.findByIdentity({ qqNumber });
    if (!player && steam64) {
      player = await playerDatabase.findByIdentity({ steamID: steam64 });
    }

    if (!player?.id) return createActionError(404, "PlayerNotFound", "Player not found.");
    if (player.qq_number && player.qq_number !== qqNumber) {
      return createActionError(409, "QQAlreadyBound", "This player already has another QQ binding.");
    }

    const updated = await playerDatabase.bindQQToPlayer(player.id, { qqNumber, qqName });
    const playerInfo = serializePlayer(updated);
    return {
      message: buildBindMessage(playerInfo, qqName, qqNumber),
      player: playerInfo,
      bound: true,
    };
  }

  async function queryMe(input = {}) {
    const qqNumber = String(input.qqNumber ?? input.qq ?? input.qq_number ?? "").trim();
    const qqName = String(input.qqName ?? input.qq_name ?? input.qqNick ?? "").trim();
    if (!qqNumber) return createActionError(400, "MissingQQNumber", "QQ number is required.");
    if (!qqName) return createActionError(400, "MissingQQName", "QQ name is required.");

    const playerDatabase = modules?.playerDatabase ?? null;
    if (!playerDatabase?.findByIdentity || !playerDatabase?.getPlayerDetail) {
      return createActionError(503, "PlayerDatabaseUnavailable", "Player database is unavailable.");
    }

    const player = await playerDatabase.findByIdentity({ qqNumber });
    if (!player?.id) return createActionError(404, "PlayerNotFound", "QQ is not bound to any player.");

    const updated = await playerDatabase.bindQQToPlayer(player.id, { qqNumber, qqName });
    const detail = await playerDatabase.getPlayerDetail(player.id);
    const playerInfo = serializePlayer(updated);
    const sessionSeconds = Number(detail?.summary?.gameSeconds ?? detail?.summary?.steamGameSeconds ?? playerInfo?.gameSeconds ?? 0);

    return {
      ok: true,
      data: {
        action: "queryMe",
        player: {
          ...playerInfo,
          qqNumber,
          qqName,
          gameSeconds: sessionSeconds,
          gameHours: Number((sessionSeconds / 3600).toFixed(2)),
        },
        detail,
        message: buildMyInfoMessage(playerInfo, sessionSeconds),
      },
    };
  }

  async function queryMeSnapshot(input = {}) {
    const result = await queryMe(input);
    const player = result?.data?.player ?? null;
    if (!player) return createActionError(404, "PlayerNotFound", "QQ is not bound to any player.");
    return renderPlayerSnapshot(player, result?.data?.detail ?? null);
  }

  async function queryPlayerSnapshot(input = {}) {
    const playerDatabase = modules?.playerDatabase ?? null;
    if (!playerDatabase?.findByIdentity || !playerDatabase?.getPlayerDetail) {
      return createActionError(503, "PlayerDatabaseUnavailable", "Player database is unavailable.");
    }

    const playerInput = String(input.playerInput ?? input.steam64 ?? input.qqNumber ?? "").trim();
    if (!playerInput) return createActionError(400, "MissingPlayerInput", "请输入 Steam64、QQ 号或数据库玩家 ID。");

    let player = null;
    if (/^\d{17}$/.test(playerInput)) player = await playerDatabase.findByIdentity({ steamID: playerInput });
    if (!player && /^\\d+$/.test(playerInput)) player = await playerDatabase.findByIdentity({ qqNumber: playerInput });
    if (!player && /^\\d+$/.test(playerInput)) {
      const detailById = await playerDatabase.getPlayerDetail(Number(playerInput));
      player = detailById?.player ?? null;
    }
    if (!player?.id) return createActionError(404, "PlayerNotFound", "未找到该玩家。");

    const detail = await playerDatabase.getPlayerDetail(player.id);
    return renderPlayerSnapshot(serializePlayer(player), detail);
  }

  async function renderPlayerSnapshot(player, detail) {
    const sessionSeconds = Number(detail?.summary?.gameSeconds ?? detail?.summary?.steamGameSeconds ?? player?.gameSeconds ?? 0);
    const png = await renderPlayerSnapshotPng({
      qqNumber: player?.qqNumber,
      qqName: player?.qqName,
      gameName: player?.gameName ?? player?.name,
      steam64: player?.steam64,
      eosID: player?.eosID,
      steamAvatar: player?.steamAvatar ?? detail?.player?.steam_avatar ?? detail?.player?.steamAvatar ?? null,
      gameSeconds: sessionSeconds,
      gameHours: Number((sessionSeconds / 3600).toFixed(2)),
      serverSeconds: Number(detail?.summary?.serverSeconds ?? 0),
      warmupSeconds: Number(detail?.summary?.warmupSeconds ?? 0),
      serverRankings: detail?.squadBrowserServerRankings ?? [],
      serverSessions: detail?.squadBrowserSessions ?? [],
      updatedAt: player?.updatedAt ?? detail?.player?.updated_at,
    });

    return {
      ok: true,
      contentType: "image/png",
      fileName: `player-snapshot-${sanitizeFileToken(player?.qqNumber ?? player?.steam64 ?? player?.id ?? "unknown")}.png`,
      player,
      png,
    };
  }

  async function queryServerInfoSnapshot(input = {}) {
    try {
      const matchSnapshot = resolveMatchSnapshotApi();
      if (!matchSnapshot?.takeManualSnapshot || !matchSnapshot?.readSnapshotArtifact) {
        return {
          ok: false,
          error: "MATCH_SNAPSHOT_UNAVAILABLE",
          statusCode: 503,
          message: "match-snapshot plugin is not loaded.",
        };
      }

      const snapshotItem = await matchSnapshot.takeManualSnapshot({
        includeSteamID: true,
      });
      if (!snapshotItem?.id) {
        return {
          ok: false,
          error: "MATCH_SNAPSHOT_GENERATION_FAILED",
          statusCode: 500,
          message: "match-snapshot did not return a snapshot item.",
        };
      }

      const artifact = await matchSnapshot.readSnapshotArtifact(snapshotItem.id, "image");
      if (!artifact?.content?.length) {
        return {
          ok: false,
          error: "MATCH_SNAPSHOT_GENERATION_FAILED",
          statusCode: 500,
          message: "match-snapshot image artifact is empty.",
        };
      }

      const fileName = String(artifact.fileName ?? `${snapshotItem.id}.png`).trim() || `${snapshotItem.id}.png`;
      const png = Buffer.isBuffer(artifact.content) ? artifact.content : Buffer.from(artifact.content);
      const filePath = await persistServerInfoSnapshot(png, fileName);
      return {
        ok: true,
        contentType: "image/png",
        fileName,
        file_path: filePath,
        filePath,
        snapshotItem,
        artifact: {
          ...artifact,
          fileName,
          content: png,
        },
        png,
      };
    } catch (error) {
      const statusCode = Number(error?.statusCode ?? 500) || 500;
      return {
        ok: false,
        error: error?.code === "MATCH_SNAPSHOT_UNAVAILABLE"
          ? "MATCH_SNAPSHOT_UNAVAILABLE"
          : "MATCH_SNAPSHOT_GENERATION_FAILED",
        statusCode,
        message: String(error?.message ?? error ?? "Failed to render match snapshot."),
        stack: String(error?.stack ?? ""),
      };
    }
  }

  function resolveMatchSnapshotApi() {
    const moduleCandidate = modules?.matchSnapshot;
    const directApi = moduleCandidate?.api ?? moduleCandidate ?? null;
    if (directApi?.takeManualSnapshot && directApi?.readSnapshotArtifact) {
      return directApi;
    }

    const pluginManager = core?.pluginManager;
    const pluginInstance = Array.isArray(pluginManager?.instances)
      ? pluginManager.instances.find((instance) => instance?.manifest?.id === "match-snapshot")
      : null;
    const pluginApi = pluginInstance?.api ?? pluginInstance ?? null;
    if (pluginApi?.takeManualSnapshot && pluginApi?.readSnapshotArtifact) {
      return pluginApi;
    }

    return null;
  }

  function resolveMatchEndSnapshotApi() {
    const moduleCandidate = modules?.matchEndSnapshot;
    const directApi = moduleCandidate?.api ?? moduleCandidate ?? null;
    if (directApi?.listSnapshots && directApi?.readSnapshotImage) return directApi;

    const pluginManager = core?.pluginManager;
    const pluginInstance = Array.isArray(pluginManager?.instances)
      ? pluginManager.instances.find((instance) => instance?.manifest?.id === "match-end-snapshot")
      : null;
    const pluginApi = pluginInstance?.api ?? pluginInstance ?? null;
    return pluginApi?.listSnapshots && pluginApi?.readSnapshotImage ? pluginApi : null;
  }

  async function readEndSnapshotImage(id, input = {}) {
    const api = resolveMatchEndSnapshotApi();
    if (!api) return { ok: false, statusCode: 503, error: "MATCH_END_SNAPSHOT_UNAVAILABLE", message: "match-end-snapshot plugin is not loaded." };
    try {
      const image = await api.readSnapshotImage(id, {
        combined: input.combined === true || input.combined === "1",
        page: input.page,
      });
      return { ok: true, contentType: image.contentType ?? "image/png", fileName: image.fileName, png: Buffer.from(image.content ?? []) };
    } catch (error) {
      return { ok: false, statusCode: Number(error?.statusCode ?? 404) || 404, error: error?.code ?? "SNAPSHOT_NOT_FOUND", message: String(error?.message ?? error) };
    }
  }

  async function readLatestEndSnapshotImage(input = {}) {
    const api = resolveMatchEndSnapshotApi();
    if (!api) return { ok: false, statusCode: 503, error: "MATCH_END_SNAPSHOT_UNAVAILABLE", message: "match-end-snapshot plugin is not loaded." };
    try {
      const list = await api.listSnapshots();
      const latest = Array.isArray(list) ? list[0] : null;
      if (!latest?.id) return { ok: false, statusCode: 404, error: "SNAPSHOT_NOT_FOUND", message: "No finished snapshot was found." };
      return readEndSnapshotImage(latest.id, input);
    } catch (error) {
      return { ok: false, statusCode: Number(error?.statusCode ?? 404) || 404, error: error?.code ?? "SNAPSHOT_NOT_FOUND", message: String(error?.message ?? error) };
    }
  }

  async function readLatestServerInfoSnapshot() {
    await fs.mkdir(SERVER_INFO_SNAPSHOT_CACHE_DIR, { recursive: true });
    const entries = await fs.readdir(SERVER_INFO_SNAPSHOT_CACHE_DIR, { withFileTypes: true });
    const pngEntries = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/^(Match-|server-info-).+\.png$/i.test(entry.name)) continue;
      const filePath = path.join(SERVER_INFO_SNAPSHOT_CACHE_DIR, entry.name);
      try {
        const stat = await fs.stat(filePath);
        pngEntries.push({ filePath, name: entry.name, stat });
      } catch {
        // Skip files that disappear between readdir and stat.
      }
    }

    if (!pngEntries.length) {
      return null;
    }

    pngEntries.sort((left, right) => {
      const timeDiff = Number(right.stat.mtimeMs ?? 0) - Number(left.stat.mtimeMs ?? 0);
      if (timeDiff) return timeDiff;
      return String(right.name).localeCompare(String(left.name));
    });

    const latest = pngEntries[0];
    return {
      filePath: latest.filePath,
      fileName: latest.name,
      png: await fs.readFile(latest.filePath),
    };
  }

  async function unbindMe(input = {}) {
    const qqNumber = String(input.qqNumber ?? input.qq ?? input.qq_number ?? "").trim();
    const qqName = String(input.qqName ?? input.qq_name ?? input.qqNick ?? "").trim();
    if (!qqNumber) return createActionError(400, "MissingQQNumber", "QQ number is required.");
    if (!qqName) return createActionError(400, "MissingQQName", "QQ name is required.");

    const playerDatabase = modules?.playerDatabase ?? null;
    if (!playerDatabase?.findByIdentity || !playerDatabase?.unbindQQFromPlayer) {
      return createActionError(503, "PlayerDatabaseUnavailable", "Player database is unavailable.");
    }

    const player = await playerDatabase.findByIdentity({ qqNumber });
    if (!player?.id) return createActionError(404, "PlayerNotFound", "QQ is not bound to any player.");

    const updated = await playerDatabase.unbindQQFromPlayer(player.id);
    const playerInfo = serializePlayer(updated);
    return {
      ok: true,
      data: {
        action: "unbindMe",
        message: buildUnbindMessage(playerInfo, qqName, qqNumber),
        player: playerInfo,
        unbound: true,
      },
    };
  }

  function createActionError(statusCode, code, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    throw error;
  }

  async function persistServerInfoSnapshot(buffer, fileName) {
    const safeFileName = String(fileName ?? "server-info.png").trim() || "server-info.png";
    await fs.mkdir(SERVER_INFO_SNAPSHOT_CACHE_DIR, { recursive: true });
    const tempFilePath = path.join(
      SERVER_INFO_SNAPSHOT_CACHE_DIR,
      `${safeFileName}.${process.pid}.${Date.now()}.tmp`,
    );
    const finalFilePath = path.join(SERVER_INFO_SNAPSHOT_CACHE_DIR, safeFileName);
    await fs.writeFile(tempFilePath, buffer);
    await fs.rm(finalFilePath, { force: true });
    await fs.rename(tempFilePath, finalFilePath);
    return finalFilePath;
  }

  async function writeSnapshotHtml(serverInfo, input = {}) {
    const htmlPath = path.join(SERVER_INFO_SNAPSHOT_CACHE_DIR, `server-info-${process.pid}-${Date.now()}.html`);
    const content = renderServerInfoFallbackHtml(serverInfo, input);
    await fs.mkdir(path.dirname(htmlPath), { recursive: true });
    await fs.writeFile(htmlPath, content, "utf8");
    return htmlPath;
  }

  async function runChromeHeadlessScreenshot(htmlPath, screenshotPath) {
    const executablePath = await resolveChromiumExecutablePath();
    if (!executablePath) {
      throw new Error("Chrome or Edge executable was not found.");
    }
    await fs.rm(screenshotPath, { force: true });
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=1600,900",
      `--screenshot=${screenshotPath}`,
      `file:///${htmlPath.replace(/\\/g, "/")}`,
    ];
    await new Promise((resolve, reject) => {
      const child = execFile(executablePath, args, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          const message = `${error.message || error}${stderr ? ` ${stderr}` : ""}`.trim();
          reject(new Error(message));
          return;
        }
        resolve({ stdout, stderr });
      });
      child.on("error", reject);
    });
  }

  function renderServerInfoFallbackHtml(serverInfo, input = {}) {
    const map = String(serverInfo?.match?.map ?? "Unknown Map").trim();
    const layer = String(serverInfo?.match?.layer ?? "Unknown Layer").trim();
    const serverName = String(serverInfo?.server?.serverName ?? serverInfo?.server?.serverId ?? "BZSS Server").trim();
    const players = Array.isArray(serverInfo?.bzssCore?.players) ? serverInfo.bzssCore.players : [];
    const captureZones = Array.isArray(serverInfo?.bzssCore?.captureZones) ? serverInfo.bzssCore.captureZones : [];
    const fobs = Array.isArray(serverInfo?.bzssCore?.fobs) ? serverInfo.bzssCore.fobs : [];
    const playerDots = players.slice(0, 48).map((player, index) => {
      const top = 20 + ((index * 17) % 68);
      const left = 16 + ((index * 23) % 68);
      const team = Number(player.teamId) === 2 ? "team-2" : Number(player.teamId) === 1 ? "team-1" : "team-0";
      return `<span class="dot ${team}" style="top:${top}%;left:${left}%"></span>`;
    }).join("");
    const zoneTags = captureZones.slice(0, 8).map((zone) => `<span class="zone-tag">${escapeHtml(zone?.name ?? "OBJ")}</span>`).join("");
    const fobTags = fobs.slice(0, 8).map((fob) => `<span class="fob-tag">${escapeHtml(fob?.name ?? "FOB")} T${escapeHtml(fob?.teamId ?? "")}</span>`).join("");

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; background: #020617; color: #e2e8f0; font-family: Arial, sans-serif; }
    .frame { width: 1600px; height: 900px; padding: 18px; box-sizing: border-box; background: linear-gradient(180deg, #07101c, #02050c); }
    .hero { height: 214px; display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 16px; }
    .card { border: 1px solid rgba(148,163,184,.16); background: rgba(4,10,18,.72); border-radius: 18px; box-shadow: 0 24px 80px rgba(0,0,0,.4); }
    .copy { padding: 18px; }
    .eyebrow { font-size: 11px; letter-spacing: .24em; text-transform: uppercase; color: #67e8f9; }
    h1 { margin: 8px 0 0; font-size: 28px; }
    .badges { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
    .badge { padding:7px 11px; border-radius:999px; border:1px solid rgba(148,163,184,.16); background: rgba(15,23,42,.86); font-size:13px; }
    .grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:10px; margin-top:14px; }
    .grid div { padding:10px 12px; border-radius:14px; background: rgba(15,23,42,.56); border:1px solid rgba(148,163,184,.12); }
    .grid .k { display:block; font-size:11px; color:#94a3b8; text-transform:uppercase; letter-spacing:.18em; margin-bottom:4px; }
    .loading { border-radius:18px; background: linear-gradient(135deg, rgba(8,15,27,.8), rgba(15,23,42,.6)); overflow:hidden; display:grid; place-items:center; }
    .loading::before { content:"${escapeHtml(map)}"; font-size:32px; font-weight:800; color:rgba(226,232,240,.75); }
    .map { height: 648px; margin-top: 14px; position: relative; overflow:hidden; border-radius:18px; }
    .map-bg { position:absolute; inset:0; background:
      radial-gradient(circle at 30% 35%, rgba(34,197,94,.25), transparent 28%),
      radial-gradient(circle at 70% 60%, rgba(56,189,248,.25), transparent 30%),
      linear-gradient(135deg, #0f172a, #111827 55%, #0b3b2e); }
    .overlay { position:absolute; inset:0; }
    .dot { position:absolute; width:14px; height:14px; border-radius:50%; border:2px solid #fff; box-shadow: 0 0 18px rgba(255,255,255,.28); }
    .team-1 { background:#22c55e; }
    .team-2 { background:#f97316; }
    .team-0 { background:#38bdf8; }
    .zone-tag, .fob-tag { position:absolute; left:20px; padding:6px 10px; border-radius:999px; background: rgba(15,23,42,.82); border:1px solid rgba(148,163,184,.16); font-size:12px; }
    .zone-tag { top: 20px; display: inline-block; margin-right: 8px; position: relative; }
    .fob-tag { bottom: 20px; display: inline-block; margin-right: 8px; position: relative; }
    .meta { position:absolute; left:18px; bottom:18px; right:18px; display:flex; gap:8px; flex-wrap:wrap; }
  </style>
</head>
<body>
  <div class="frame">
    <section class="hero">
      <div class="card copy">
        <div class="eyebrow">BZSS / AstrBot Server Snapshot</div>
        <h1>${escapeHtml(serverName)}</h1>
        <div class="badges">
          <span class="badge">Players ${Number(serverInfo?.server?.playerCount ?? 0)}</span>
          <span class="badge">Queue ${Number(serverInfo?.server?.queueCount ?? 0)}</span>
          <span class="badge">TPS ${escapeHtml(formatTpsValue(serverInfo?.server?.tps))}</span>
          <span class="badge">${serverInfo?.server?.isWarmup ? "Warmup ON" : "Warmup OFF"}</span>
          <span class="badge">${escapeHtml(String(serverInfo?.source ?? "unknown"))}</span>
        </div>
        <div class="grid">
          <div><span class="k">Map</span><strong>${escapeHtml(map)}</strong></div>
          <div><span class="k">Layer</span><strong>${escapeHtml(layer)}</strong></div>
          <div><span class="k">Updated</span><strong>${escapeHtml(String(serverInfo?.generatedAt ?? ""))}</strong></div>
          <div><span class="k">Status</span><strong>ok</strong></div>
        </div>
      </div>
      <div class="card loading"></div>
    </section>
    <section class="card map">
        <div class="map-bg"></div>
        <div class="map-loading-screen">${escapeHtml(map)} / ${escapeHtml(layer)}</div>
        <div class="overlay">
          ${playerDots}
          <div class="meta">
            ${zoneTags}
            ${fobTags}
        </div>
      </div>
    </section>
  </div>
</body>
</html>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatTpsValue(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return "n/a";
    return numeric.toFixed(1);
  }

  function normalizeSteam64(value) {
    const text = String(value ?? "").trim();
    return /^\d{17}$/.test(text) ? text : "";
  }

  function isServerInfoQuery(kind) {
    const text = String(kind ?? "").trim().toLowerCase();
    return text === "serverinfo" || text === "server_info" || text === "server-info" || text === "server";
  }

  function firstText(...values) {
    for (const value of values) {
      const text = value === null || value === undefined ? "" : String(value).trim();
      if (text) return text;
    }
    return "";
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(number)));
  }

  function normalizeIsoTime(value) {
    const parsed = Date.parse(String(value ?? ""));
    return new Date(Number.isFinite(parsed) ? parsed : Date.now()).toISOString();
  }

  function firstFiniteNumber(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return null;
  }

  function nullableNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatDurationClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds ?? 0) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function formatDurationLong(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds ?? 0) || 0));
    if (!total) return "0m";
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }

  function isCommandSquadName(value) {
    const name = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    return name === "command squad" || name === "cmd" || name === "command" || /\bcommand\s*squad\b/i.test(name);
  }

  function isCommandSquadId(value) {
    const id = String(value ?? "").trim().toLowerCase();
    return id === "10" || id === "cmd" || id === "command";
  }

  function isCommanderRole(player) {
    const role = String(player?.role ?? "").trim().toLowerCase();
    return role.includes("commander") || role === "cmd" || role.includes(" cmd");
  }

  function resolveFactionCode(teamName) {
    const normalized = String(teamName ?? "").trim().toLowerCase();
    if (!normalized) return null;
    const rules = [
      ["ADF", ["adf", "australian"]],
      ["AFU", ["afu", "ukraine", "ukrainian"]],
      ["BAF", ["baf", "british", "uk armed forces"]],
      ["CAF", ["caf", "canadian", "canada"]],
      ["CRF", ["crf"]],
      ["GFI", ["gfi", "german", "federal"]],
      ["IMF", ["imf", "militia"]],
      ["MEA", ["mea", "middle east", "arab", "insurgent"]],
      ["MEI", ["mei", "irregular"]],
      ["PLA", ["pla", "people's liberation", "chinese", "china"]],
      ["PLAAGF", ["plaagf", "army group"]],
      ["PLANMC", ["planmc", "marine corps", "naval infantry"]],
      ["RGF", ["rgf", "russian ground", "russian", "combined arms army"]],
      ["TLF", ["tlf", "turkish", "turkey"]],
      ["USA", ["usa", "us army", "american", "united states", "u.s."]],
      ["USMC", ["usmc", "marines", "marine regiment", "marine"]],
      ["VDV", ["vdv", "airborne"]],
      ["WPMC", ["wpmc", "private military", "pmc"]],
    ];
    for (const [code, terms] of rules) {
      if (terms.some((term) => normalized.includes(term))) return code;
    }
    return null;
  }

  function serializePlayer(player) {
    if (!player) return null;
    return {
      id: player.id,
      name: player.current_name ?? null,
      gameName: player.current_name ?? null,
      steam64: player.steam_id ?? null,
      eosID: player.eos_id ?? null,
      steamAvatar: player.steam_avatar ?? player.steamAvatar ?? null,
      qqNumber: player.qq_number ?? null,
      qqName: player.qq_name ?? null,
      qqBoundAt: player.qq_bound_at ?? null,
      updatedAt: player.updated_at ?? null,
    };
  }

  function buildBindMessage(player, qqName, qqNumber) {
    const gameName = String(player?.gameName ?? player?.name ?? player?.steam64 ?? "未知玩家").trim();
    return `已成功为 ${qqName}（${qqNumber}）绑定至 ${gameName}（${player?.steam64 ?? "未知Steam64"}）`;
  }

  function buildMyInfoMessage(player, gameSeconds) {
    const gameName = String(player?.gameName ?? player?.name ?? "未知玩家").trim();
    const steam64 = String(player?.steam64 ?? "未知Steam64").trim();
    const eosID = String(player?.eosID ?? "未知EOSID").trim();
    const hours = Number(gameSeconds || 0) / 3600;
    return `玩家信息：${gameName} | Steam64: ${steam64} | EOS ID: ${eosID} | 游戏时长: ${hours.toFixed(2)} 小时`;
  }

  function buildUnbindMessage(player, qqName, qqNumber) {
    const gameName = String(player?.gameName ?? player?.name ?? "未知玩家").trim();
    return `已成功解除 ${qqName}（${qqNumber}）与 ${gameName} 的绑定`;
  }
}

export { handleAstrbotBridgeRoutes };

function sanitizeFileToken(value) {
  return String(value ?? "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function formatSnapshotHours(gameSeconds, gameHours) {
  const numericHours = Number.isFinite(Number(gameHours)) ? Number(gameHours) : Number(gameSeconds || 0) / 3600;
  return `${numericHours.toFixed(2)} 小时`;
}

function formatSnapshotTime(value) {
  if (!value) return "未知";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "未知";
  return new Date(numeric).toLocaleString("zh-CN", { hour12: false });
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

async function renderPlayerSnapshotPng(payload) {
  const avatarDataUrl = await resolveAvatarDataUrl(payload.steamAvatar);
  const sharp = await loadSharp();
  const svg = renderPlayerSnapshotSvg({
    ...payload,
    avatarDataUrl,
  });
  return sharp(Buffer.from(svg, "utf8"), { density: 144 }).png().toBuffer();
}

function formatSnapshotDuration(value) {
  const seconds = Math.max(0, Number(value ?? 0) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

function normalizeSnapshotServerRecords(rankings = [], sessions = []) {
  const ranked = (Array.isArray(rankings) ? rankings : []).map((item) => ({
    name: String(item?.server_name ?? item?.serverName ?? item?.name ?? item?.server_id ?? item?.serverId ?? "未知服务器").trim(),
    minutes: Math.max(0, Number(item?.playtime_minutes ?? item?.playtimeMinutes ?? item?.duration_minutes ?? item?.durationMinutes ?? 0) || 0),
  })).filter((item) => item.name);

  if (ranked.length) return ranked.slice(0, 5);
  return (Array.isArray(sessions) ? sessions : []).slice(0, 5).map((item) => ({
    name: String(item?.server_name ?? item?.serverName ?? item?.server_id ?? item?.serverId ?? "未知服务器").trim(),
    minutes: Math.max(0, Number(item?.duration_minutes ?? item?.durationMinutes ?? 0) || 0),
  }));
}

function renderPlayerSnapshotSvg(payload) {
  const width = 1280;
  const records = normalizeSnapshotServerRecords(payload.serverRankings, payload.serverSessions);
  const height = 780 + Math.max(0, records.length - 3) * 64;
  const rows = [
    ["Steam 游戏时长", formatSnapshotHours(payload.gameSeconds, payload.gameHours)],
    ["本服累计时长", formatSnapshotDuration(payload.serverSeconds)],
    ["暖服累计时长", formatSnapshotDuration(payload.warmupSeconds)],
    ["Steam64", payload.steam64 ?? "未绑定"],
    ["EOS ID", payload.eosID ?? "未记录"],
  ];
  const rowSvg = rows.map(([label, value], index) => {
    const y = 288 + index * 66;
    return `
      <text x="84" y="${y}" class="row-label">${escapeXml(label)}</text>
      <text x="310" y="${y}" class="row-value">${escapeXml(value)}</text>
      <path d="M84 ${y + 20} H676" class="row-line"/>
    `;
  }).join("");

  const recordSvg = records.length
    ? records.map((record, index) => {
      const y = 286 + index * 82;
      const rank = index + 1;
      return `
        <rect x="730" y="${y - 42}" width="468" height="62" rx="12" class="record-card"/>
        <rect x="746" y="${y - 29}" width="34" height="34" rx="8" class="rank-box"/>
        <text x="763" y="${y - 6}" text-anchor="middle" class="rank-text">${rank}</text>
        <text x="798" y="${y - 15}" class="record-name">${escapeXml(truncateText(record.name, 34))}</text>
        <text x="798" y="${y + 7}" class="record-sub">服务器游玩记录</text>
        <text x="1175" y="${y - 6}" text-anchor="end" class="record-time">${escapeXml(formatSnapshotDuration(record.minutes * 60))}</text>
      `;
    }).join("")
    : `<text x="730" y="300" class="empty-record">暂无服务器游玩记录</text>`;

  const avatarSvg = payload.avatarDataUrl
    ? `<image x="94" y="102" width="138" height="138" href="${payload.avatarDataUrl}" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice"/>`
    : `<text x="163" y="190" text-anchor="middle" class="avatar-letter">${escapeXml(String(payload.gameName ?? "?").trim().slice(0, 1) || "?")}</text>`;

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#081423"/><stop offset=".58" stop-color="#0d1b2e"/><stop offset="1" stop-color="#102e4b"/></linearGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#22d3ee"/><stop offset="1" stop-color="#818cf8"/></linearGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#020617" flood-opacity=".55"/></filter>
      <clipPath id="avatarClip"><circle cx="163" cy="171" r="69"/></clipPath>
      <style><![CDATA[
        text{font-family:'Microsoft YaHei','Noto Sans CJK SC','Segoe UI',sans-serif}
        .eyebrow{font-size:16px;font-weight:800;letter-spacing:3px;fill:#67e8f9}
        .name{font-size:42px;font-weight:900;fill:#f8fafc}.meta{font-size:17px;fill:#a5b4c8}
        .badge{font-size:14px;font-weight:800;fill:#dbeafe}.section{font-size:17px;font-weight:900;letter-spacing:2px;fill:#7dd3fc}
        .row-label{font-size:17px;font-weight:700;fill:#94a3b8}.row-value{font-size:22px;font-weight:800;fill:#e2e8f0}.row-line{stroke:#334155;stroke-opacity:.65}
        .record-name{font-size:17px;font-weight:800;fill:#e5efff}.record-sub{font-size:13px;fill:#94a3b8}.record-time{font-size:17px;font-weight:900;fill:#67e8f9}
        .rank-text{font-size:16px;font-weight:900;fill:#06111f}.empty-record{font-size:18px;fill:#94a3b8}.avatar-letter{font-size:58px;font-weight:900;fill:#cffafe}
      ]]></style>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <circle cx="1160" cy="100" r="250" fill="#38bdf8" opacity=".08"/><circle cx="80" cy="${height - 40}" r="230" fill="#6366f1" opacity=".10"/>
    <rect x="36" y="34" width="1208" height="${height - 68}" rx="28" fill="#06111f" fill-opacity=".68" stroke="#3b526e"/>
    <rect x="64" y="62" width="394" height="7" rx="4" fill="url(#accent)"/>
    <circle cx="163" cy="171" r="80" fill="#0d2036" stroke="#67e8f9" stroke-width="4" filter="url(#shadow)"/>${avatarSvg}
    <text x="270" y="126" class="eyebrow">BZSS / PLAYER INTEL</text>
    <text x="270" y="178" class="name">${escapeXml(truncateText(payload.gameName ?? "未知玩家", 26))}</text>
    <text x="270" y="212" class="meta">QQ ${escapeXml(payload.qqName ?? "未绑定")} · ${escapeXml(payload.qqNumber ?? "--")}</text>
    <rect x="1010" y="104" width="184" height="46" rx="23" fill="#0c3147" stroke="#38bdf8" stroke-opacity=".55"/>
    <text x="1102" y="134" text-anchor="middle" class="badge">玩家信息快照</text>
    <path d="M76 252 H676" stroke="#67e8f9" stroke-opacity=".55"/><path d="M730 252 H1198" stroke="#67e8f9" stroke-opacity=".55"/>
    <text x="84" y="250" class="section">账户与游玩时长</text><text x="730" y="250" class="section">服务器游玩记录 / TOP 5</text>
    ${rowSvg}
    ${recordSvg}
    <text x="84" y="${height - 70}" class="meta">更新时间  ${escapeXml(formatSnapshotTime(payload.updatedAt))}</text>
    <text x="1196" y="${height - 70}" text-anchor="end" class="meta">数据来源：BZSS 玩家数据库</text>
  </svg>`;
}

function renderServerInfoSvg(serverInfo) {
  return renderServerInfoP2Svg(serverInfo);
  const width = 1280;
  const height = 760;
  const serverName = String(serverInfo?.server?.serverName ?? serverInfo?.server?.serverId ?? "BZSS Server").trim();
  const serverId = String(serverInfo?.server?.serverId ?? "unknown").trim();
  const map = String(serverInfo?.match?.map ?? "未知地图").trim();
  const layer = String(serverInfo?.match?.layer ?? "未知层级").trim();
  const mode = String(serverInfo?.match?.mode ?? "未知模式").trim();
  const rconTime = String(serverInfo?.match?.rconTime ?? "00:00:00").trim();
  const population = serverInfo?.population ?? {};
  const teams = Array.isArray(serverInfo?.teams) ? serverInfo.teams : [];
  const warmup = Boolean(serverInfo?.warmup?.isWarmup);
  const generatedAt = String(serverInfo?.generatedAt ?? "").trim();

  const teamCards = teams.slice(0, 2).map((team, index) => {
    const teamX = 72 + index * 566;
    const teamY = 500;
    const commander = team.commander?.name ?? "Unknown";
    return `
      <rect x="${teamX}" y="${teamY}" width="526" height="168" rx="24" fill="#0b1120" fill-opacity="0.70" stroke="#334155" stroke-opacity="0.9"/>
      <rect x="${teamX + 20}" y="${teamY + 20}" width="84" height="84" rx="18" fill="${index === 0 ? "#1e3a8a" : "#9a3412"}" fill-opacity="0.9"/>
      <text x="${teamX + 62}" y="${teamY + 74}" text-anchor="middle" font-size="34" font-weight="900" fill="#f8fafc">${escapeXml(team.factionCode || "UNK")}</text>
      <text x="${teamX + 128}" y="${teamY + 52}" font-size="20" font-weight="800" fill="#e2e8f0">${escapeXml(team.teamName || `Team ${team.teamId ?? index + 1}`)}</text>
      <text x="${teamX + 128}" y="${teamY + 84}" font-size="18" font-weight="700" fill="#93c5fd">Players ${escapeXml(team.playerCount ?? 0)} / Squads ${escapeXml(team.squadCount ?? 0)}</text>
      <text x="${teamX + 128}" y="${teamY + 118}" font-size="16" font-weight="600" fill="#94a3b8">Commander: ${escapeXml(commander)}</text>
    `;
  }).join("");

  const metrics = [
    { label: "玩家", value: `${population.players ?? 0}` },
    { label: "上限", value: `${population.maxPlayers ?? "?"}` },
    { label: "队列", value: `${population.queue ?? 0}` },
    { label: "阵营", value: `${teams.length}` },
  ];
  const metricCards = metrics.map((metric, index) => {
    const mx = 72 + index * 286;
    return `
      <rect x="${mx}" y="288" width="262" height="108" rx="20" fill="#07111f" fill-opacity="0.75" stroke="#1f2937" stroke-opacity="0.9"/>
      <text x="${mx + 20}" y="320" font-size="16" font-weight="700" fill="#94a3b8">${escapeXml(metric.label)}</text>
      <text x="${mx + 20}" y="364" font-size="40" font-weight="900" fill="#f8fafc">${escapeXml(metric.value)}</text>
    `;
  }).join("");

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#07111f" />
        <stop offset="55%" stop-color="#111827" />
        <stop offset="100%" stop-color="#14532d" />
      </linearGradient>
      <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#22c55e" />
        <stop offset="100%" stop-color="#38bdf8" />
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#020617" flood-opacity="0.45"/>
      </filter>
    </defs>
    <rect width="${width}" height="${height}" rx="36" fill="url(#bg)"/>
    <circle cx="1080" cy="120" r="180" fill="#22c55e" opacity="0.12"/>
    <circle cx="150" cy="640" r="250" fill="#38bdf8" opacity="0.08"/>
    <rect x="34" y="34" width="${width - 68}" height="${height - 68}" rx="28" fill="#0b1120" fill-opacity="0.56" stroke="#334155" stroke-opacity="0.85"/>
    <rect x="58" y="56" width="320" height="10" rx="5" fill="url(#accent)"/>
    <text x="72" y="118" font-size="52" font-weight="800" fill="#f8fafc">BZSS 服务器信息</text>
    <text x="74" y="166" font-size="24" font-weight="500" fill="#93c5fd">${escapeXml(serverName)} / ${escapeXml(serverId)}</text>
    <rect x="72" y="196" width="1136" height="78" rx="18" fill="#082f49" fill-opacity="0.72" stroke="#38bdf8" stroke-opacity="0.35"/>
    <text x="96" y="230" font-size="22" font-weight="700" fill="#bae6fd">Map: ${escapeXml(map)}</text>
    <text x="96" y="258" font-size="18" font-weight="600" fill="#dbeafe">Layer: ${escapeXml(layer)}   Mode: ${escapeXml(mode)}   RCON: ${escapeXml(rconTime)}   Warmup: ${warmup ? "ON" : "OFF"}</text>
    ${metricCards}
    <rect x="72" y="424" width="1136" height="58" rx="18" fill="#052e16" fill-opacity="0.72" stroke="#22c55e" stroke-opacity="0.35"/>
    <text x="96" y="461" font-size="18" font-weight="700" fill="#bbf7d0">Generated ${escapeXml(generatedAt || new Date().toISOString())}   Source ${escapeXml(serverInfo?.source ?? "unknown")}</text>
    ${teamCards}
  </svg>`;
}

async function renderServerInfoP2Svg(serverInfo) {
  const width = 1600;
  const height = 900;
  const serverName = String(serverInfo?.server?.serverName ?? serverInfo?.server?.serverId ?? "BZSS Server").trim();
  const serverId = String(serverInfo?.server?.serverId ?? "unknown").trim();
  const map = String(serverInfo?.match?.map ?? "Unknown Map").trim();
  const layer = String(serverInfo?.match?.layer ?? "Unknown Layer").trim();
  const mode = String(serverInfo?.match?.mode ?? "Unknown Mode").trim();
  const rconTime = String(serverInfo?.match?.rconTime ?? "00:00:00").trim();
  const population = serverInfo?.population ?? {};
  const warmup = Boolean(serverInfo?.warmup?.isWarmup);
  const generatedAt = String(serverInfo?.generatedAt ?? "").trim();
  const teams = normalizeServerInfoTeams(Array.isArray(serverInfo?.teams) ? serverInfo.teams : []);
  const orderedTeams = teams.slice(0, 2).sort((left, right) => Number(left.teamId ?? 0) - Number(right.teamId ?? 0));
  const teamPanels = await Promise.all(orderedTeams.map(async (team, index) => ({
    ...team,
    factionCode: team.factionCode || await resolveFactionCodeFromTeamName(team.teamName) || "",
    flagDataUri: await resolveImageDataUri(await resolveFactionFlagAssetPath(team.teamName)),
    panelIndex: index,
  })));

  const topStats = [
    { x: 1104, label: "RCON TIME", value: rconTime, tone: "#8dd5ff" },
    { x: 1288, label: "SERVER", value: population.text ?? `${population.players ?? 0}/${population.maxPlayers ?? "?"}`, tone: "#cbd5e1" },
    { x: 1472, label: "QUEUE", value: String(population.queue ?? 0), tone: "#facc15" },
  ];
  const metricCards = topStats.map((stat) => `
    <path d="M ${stat.x} 64 H ${stat.x + 132} L ${stat.x + 148} 80 V 120 H ${stat.x} Z" fill="rgba(2,6,23,0.48)" stroke="${stat.tone}" stroke-opacity="0.55" stroke-width="1.5"/>
    <path d="M ${stat.x + 10} 72 H ${stat.x + 50}" stroke="${stat.tone}" stroke-width="2"/>
    <text x="${stat.x + 12}" y="93" class="chip-label">${escapeXml(stat.label)}</text>
    <text x="${stat.x + 12}" y="119" class="chip-value mono">${escapeXml(stat.value)}</text>
  `).join("");
  const teamSvg = teamPanels.map((team, index) => renderServerInfoTeamPanel(team, index)).join("");
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bgFallback" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#09111f" />
        <stop offset="55%" stop-color="#111827" />
        <stop offset="100%" stop-color="#14532d" />
      </linearGradient>
      <linearGradient id="topPlate" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.86" />
        <stop offset="50%" stop-color="#0f172a" stop-opacity="0.58" />
        <stop offset="100%" stop-color="#020617" stop-opacity="0.82" />
      </linearGradient>
      <linearGradient id="teamShade" x1="0%" y1="0%" x2="1" y2="0">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.58" />
        <stop offset="58%" stop-color="#020617" stop-opacity="0.32" />
        <stop offset="100%" stop-color="#020617" stop-opacity="0.06" />
      </linearGradient>
      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#020617" flood-opacity="0.45"/>
      </filter>
      <style><![CDATA[
        text{font-family:'Bahnschrift SemiCondensed','Bahnschrift','Agency FB','Arial Narrow','Microsoft YaHei',sans-serif;fill:#eef4ff;letter-spacing:.2px}
        .mono{font-family:'Cascadia Mono','Consolas',monospace}
        .eyebrow{font-size:13px;fill:#b8c7d8;font-weight:800}
        .title{font-size:48px;font-weight:900;fill:#ffffff}
        .sub{font-size:17px;fill:#d7e2ee}
        .meta{font-size:12px;fill:#a8b8c8}
        .chip-label{font-size:10px;fill:#b7c4d2;font-weight:900}
        .chip-value{font-size:23px;fill:#ffffff;font-weight:900}
      ]]></style>
    </defs>
    <rect width="${width}" height="${height}" fill="#020617" fill-opacity="0.42"/>
    <circle cx="1370" cy="180" r="280" fill="#22c55e" opacity="0.08"/>
    <circle cx="210" cy="782" r="300" fill="#38bdf8" opacity="0.08"/>
    <path d="M48 44 H1362 L1412 94 H1552 V162 H48 Z" fill="url(#topPlate)" filter="url(#softShadow)"/>
    <path d="M48 44 H1362 L1412 94 H1552" fill="none" stroke="#c9d8ea" stroke-opacity="0.24" stroke-width="1.5"/>
    <path d="M68 160 H642" stroke="#c9d8ea" stroke-opacity="0.24" stroke-width="1"/>
    <path d="M68 44 V76 M48 64 H86 M1532 162 V130 M1552 142 H1514" stroke="#76d7ff" stroke-opacity="0.7" stroke-width="2"/>
    <text x="76" y="72" class="eyebrow">LIVE MATCH / RCON SNAPSHOT</text>
    <text x="76" y="124" class="title">${escapeXml(map)}</text>
    <text x="78" y="151" class="sub">${escapeXml(layer)} | ${escapeXml(mode)} | ${escapeXml(serverName)} / ${escapeXml(serverId)}</text>
    <text x="1192" y="148" class="meta mono">CAPTURED ${escapeXml(formatSnapshotDateTime(generatedAt || new Date().toISOString()))}</text>
    <g filter="url(#softShadow)">
      ${metricCards}
    </g>
    <rect x="72" y="512" width="1456" height="64" rx="18" fill="#052e16" fill-opacity="0.66" stroke="#22c55e" stroke-opacity="0.32"/>
    <text x="96" y="551" font-size="18" font-weight="700" fill="#bbf7d0">Generated ${escapeXml(generatedAt || new Date().toISOString())}   Source ${escapeXml(serverInfo?.source ?? "unknown")}</text>
    ${teamSvg}
    <text x="1266" y="166" class="meta mono">WARMUP ${warmup ? "ON" : "OFF"}</text>
  </svg>`;
}

function renderServerInfoTeamPanel(team, index) {
  const panelX = index === 1 ? 816 : 64;
  const panelY = 540;
  const width = 720;
  const height = 268;
  const isRight = index === 1;
  const flagSize = 166;
  const flagX = isRight ? panelX + width - 206 : panelX + 34;
  const tagX = isRight ? panelX + width - 104 : panelX + 28;
  const textX = isRight ? panelX + 42 : panelX + 222;
  const textMaxWidth = isRight ? width - 292 : width - 270;
  const teamColor = isRight ? "#8b5cf6" : "#22d3ee";
  const glowColors = FACTION_GLOW_BY_CODE[team.factionCode] ?? [teamColor, "#ffffff"];
  const commanderName = team.commander?.name ?? "";
  const commanderLabel = commanderName || "Pending";
  const commanderAvatar = `
    <path d="M ${textX} ${panelY + 160} H ${textX + 48} L ${textX + 58} ${panelY + 170} V ${panelY + 218} H ${textX} Z" fill="rgba(226,238,250,0.92)" stroke="${teamColor}" stroke-opacity="0.9" stroke-width="2"/>
    <text x="${textX + 29}" y="${panelY + 198}" text-anchor="middle" class="avatar-initial">${escapeXml(commanderName ? getPlayerInitials(commanderName) : "?")}</text>
  `;
  const flagOrFallback = team.flagDataUri
    ? `<image href="${team.flagDataUri}" x="${flagX}" y="${panelY + 64}" width="${flagSize}" height="${flagSize}" preserveAspectRatio="xMidYMid meet"/>`
    : `<path d="M ${flagX} ${panelY + 64} H ${flagX + flagSize} V ${panelY + 64 + flagSize} H ${flagX} Z" fill="${teamColor}" fill-opacity="0.28" stroke="${teamColor}" stroke-opacity="0.74"/>`;

  return `
    <defs>
      <filter id="flagGlow${index}" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="32"/>
      </filter>
    </defs>
    <path d="${isRight
      ? `M ${panelX} ${panelY + 22} H ${panelX + width - 42} L ${panelX + width} ${panelY + 72} V ${panelY + height - 22} H ${panelX + 54} L ${panelX} ${panelY + height - 74} Z`
      : `M ${panelX + 42} ${panelY + 22} H ${panelX + width} V ${panelY + height - 74} L ${panelX + width - 54} ${panelY + height - 22} H ${panelX} V ${panelY + 72} Z`}" fill="url(#teamShade)" stroke="${teamColor}" stroke-opacity="0.3" stroke-width="1.5"/>
    <ellipse cx="${flagX + flagSize / 2}" cy="${panelY + 64 + flagSize / 2}" rx="174" ry="88" fill="${glowColors[0]}" opacity="0.34" filter="url(#flagGlow${index})"/>
    <ellipse cx="${flagX + flagSize / 2 + (isRight ? 34 : -34)}" cy="${panelY + 64 + flagSize / 2 + 18}" rx="132" ry="68" fill="${glowColors[1] ?? glowColors[0]}" opacity="0.28" filter="url(#flagGlow${index})"/>
    ${glowColors[2] ? `<ellipse cx="${flagX + flagSize / 2}" cy="${panelY + 64 + flagSize / 2 - 28}" rx="110" ry="48" fill="${glowColors[2]}" opacity="0.22" filter="url(#flagGlow${index})"/>` : ""}
    <path d="M ${panelX + 18} ${panelY + 48} H ${panelX + 92} M ${panelX + width - 92} ${panelY + height - 46} H ${panelX + width - 18}" stroke="${teamColor}" stroke-opacity="0.9" stroke-width="3"/>
    <path d="M ${panelX + 18} ${panelY + height - 46} H ${panelX + 68} M ${panelX + width - 68} ${panelY + 48} H ${panelX + width - 18}" stroke="#d6e4f2" stroke-opacity="0.28" stroke-width="1.5"/>
    <rect x="${tagX}" y="${panelY + 36}" width="76" height="26" fill="${teamColor}"/>
    <text x="${tagX + 38}" y="${panelY + 55}" text-anchor="middle" class="team-tag">TEAM ${escapeXml(String(team.teamId ?? index + 1))}</text>
    ${flagOrFallback}
    ${renderFitText({ x: textX, y: panelY + 92, className: "team-name", maxWidth: textMaxWidth, charWidth: 13.8 }, truncateText(team.teamName || `Team ${team.teamId ?? index + 1}`, isRight ? 26 : 29))}
    <text x="${textX}" y="${panelY + 124}" class="team-meta mono">${escapeXml(team.factionCode || "UNKNOWN")} / ${escapeXml(String(team.playerCount ?? 0))} PAX / ${escapeXml(String(team.squadCount ?? 0))} squads</text>
    <path d="M ${textX} ${panelY + 148} H ${isRight ? panelX + width - 236 : panelX + width - 44}" stroke="#d6e4f2" stroke-opacity="0.24" stroke-width="1"/>
    ${commanderAvatar}
    <text x="${textX + 76}" y="${panelY + 174}" class="team-row">COMMANDER</text>
    ${renderFitText({ x: textX + 76, y: panelY + 204, className: "strong", maxWidth: textMaxWidth - 82, charWidth: 12.8 }, truncateText(commanderLabel, isRight ? 22 : 24))}
    <text x="${textX + 76}" y="${panelY + 228}" class="team-stat mono">GAME TIME ${escapeXml(team.commander?.gameTime || "0m")}</text>
    <text x="${textX}" y="${panelY + 240}" class="team-stat mono">READY ${escapeXml(String(team.playerCount ?? 0).padStart(2, "0"))} | SQUADS ${escapeXml(String(team.squadCount ?? 0).padStart(2, "0"))}</text>
  `;
}

function normalizeServerInfoTeams(teams) {
  return (Array.isArray(teams) ? teams : []).map((team) => ({
    teamId: Number(team?.teamId ?? team?.teamID ?? 0) || null,
    teamName: String(team?.teamName ?? "").trim(),
    factionCode: String(team?.factionCode ?? "").trim().toUpperCase(),
    playerCount: Number(team?.playerCount ?? 0) || 0,
    squadCount: Number(team?.squadCount ?? 0) || 0,
    commander: team?.commander && typeof team.commander === "object" ? {
      ...team.commander,
      name: String(team.commander.name ?? "Pending").trim(),
      steamAvatar: String(team.commander.steamAvatar ?? "").trim(),
      gameTime: String(team.commander.gameTime ?? "").trim(),
    } : null,
  }));
}

function formatSnapshotDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function truncateText(value, limit) {
  const text = String(value ?? "");
  if ([...text].length <= limit) return text;
  return `${[...text].slice(0, Math.max(0, limit - 1)).join("")}...`;
}

function getPlayerInitials(value) {
  const text = String(value ?? "").trim();
  if (!text) return "?";
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}
function renderFitText({ x, y, className, maxWidth, charWidth }, value) {
  const text = String(value ?? "");
  const attrs = [`x="${x}"`, `y="${y}"`, `class="${className}"`];
  if (estimateDisplayWidth(text, charWidth) > maxWidth) {
    attrs.push(`textLength="${Math.max(80, Math.floor(maxWidth))}"`, 'lengthAdjust="spacingAndGlyphs"');
  }
  return `<text ${attrs.join(" ")}>${escapeXml(text)}</text>`;
}

function estimateDisplayWidth(text, charWidth = 12) {
  return [...String(text ?? "")].reduce((total, char) => total + (/[\u4e00-\u9fff]/.test(char) ? charWidth * 1.35 : charWidth), 0);
}

async function resolveImageDataUri(source) {
  const value = String(source ?? "").trim();
  if (!value) return "";
  if (value.startsWith("data:image/")) return value;
  if (/^https?:\/\//i.test(value)) return readRemoteImageDataUri(value);
  return readAssetDataUri(value);
}

async function readAssetDataUri(assetPath) {
  const cleanPath = String(assetPath ?? "").replace(/^\//, "");
  const candidates = [
    path.join(ICON_BASE_DIR, cleanPath.replace(/\//g, path.sep)),
    path.resolve(process.cwd(), cleanPath.replace(/\//g, path.sep)),
    path.resolve(process.cwd(), "MapScene", path.basename(cleanPath)),
    path.join(process.cwd(), "web-client", "src", "shared", "faction-assets", path.basename(cleanPath)),
  ];

  for (const filePath of candidates) {
    try {
      const content = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
      return `data:${mime};base64,${content.toString("base64")}`;
    } catch {
      // Keep trying.
    }
  }

  return "";
}

async function readBinaryAsset(assetPath) {
  const cleanPath = String(assetPath ?? "").replace(/^\//, "");
  const candidates = [
    path.join(ICON_BASE_DIR, cleanPath.replace(/\//g, path.sep)),
    path.resolve(process.cwd(), cleanPath.replace(/\//g, path.sep)),
    path.resolve(process.cwd(), "MapScene", path.basename(cleanPath)),
    path.join(process.cwd(), "web-client", "src", "shared", "faction-assets", path.basename(cleanPath)),
  ];

  for (const filePath of candidates) {
    try {
      return await fs.readFile(filePath);
    } catch {
      // Keep trying.
    }
  }

  return null;
}

async function readRemoteImageDataUri(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2200);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("image/")) return "";
    const arrayBuffer = await response.arrayBuffer();
    return `data:${contentType.split(";")[0]};base64,${Buffer.from(arrayBuffer).toString("base64")}`;
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function resolveServerInfoBackgroundAssetPath(mapName, layerName) {
  const mapKey = resolveMapSceneKey(mapName, layerName);
  if (!mapKey) return null;
  return `MapScene/${MAP_SCENE_FILE_BY_KEY[mapKey] ?? `LoadingScreen_${mapKey}_DQHD.PNG`}`;
}

function resolveMapSceneKey(mapName, layerName) {
  const candidate = String(mapName ?? layerName ?? "").trim();
  if (!candidate) return null;
  const head = candidate.split(/[_\s-]/)[0];
  if (MAP_SCENE_FILE_BY_KEY[head]) return head;
  const compact = candidate.replace(/[^a-z0-9]/gi, "").toLowerCase();
  for (const key of Object.keys(MAP_SCENE_FILE_BY_KEY)) {
    if (key.replace(/[^a-z0-9]/gi, "").toLowerCase() === compact || compact.startsWith(key.toLowerCase())) {
      return key;
    }
  }
  return head;
}

async function resolveFactionFlagAssetPath(teamName) {
  const code = await resolveFactionCodeFromTeamName(teamName);
  if (!code) return null;
  const fileName = FACTION_FLAG_BY_CODE[code];
  return fileName ? `/assets/faction-assets/${fileName}` : null;
}

async function resolveFactionCodeFromTeamName(teamName) {
  const normalized = normalizeFactionLookupName(teamName);
  if (!normalized) return null;

  const visualCode = await getBattlegroupFactionLookup().then((lookup) => lookup.get(normalized) ?? null);
  if (visualCode) return visualCode;

  const rules = [
    ["ADF", ["adf", "australian", "royal australian"]],
    ["AFU", ["afu", "ukraine", "ukrainian"]],
    ["BAF", ["baf", "british", "uk armed forces", "british armed"]],
    ["CAF", ["caf", "canadian", "canada"]],
    ["CRF", ["crf"]],
    ["GFI", ["gfi", "ger", "german", "federal"]],
    ["IMF", ["imf", "insurgent mil", "militia"]],
    ["MEA", ["mea", "middle east", "arab", "insurgent"]],
    ["MEI", ["mei", "irregular", "militia"]],
    ["PLA", ["pla", "people's liberation", "people liberation", "chinese", "china"]],
    ["PLAAGF", ["plaagf", "agf", "army group"]],
    ["PLANMC", ["planmc", "marine corps", "naval infantry"]],
    ["RGF", ["rgf", "russian ground", "russian"]],
    ["TLF", ["tlf", "turkish", "turkey"]],
    ["USA", ["usa", "us army", "american", "united states", "u.s."]],
    ["USMC", ["usmc", "marine", "marines"]],
    ["VDV", ["vdv", "airborne", "guards airborne"]],
    ["WPMC", ["wpmc", "manticore", "private military", "pmc"]],
  ];

  for (const [code, terms] of rules) {
    if (terms.some((term) => normalized.includes(term))) return code;
  }

  return null;
}

let battlegroupFactionLookup = null;
let battlegroupFactionLookupPromise = null;

async function getBattlegroupFactionLookup() {
  if (battlegroupFactionLookup) return battlegroupFactionLookup;
  if (battlegroupFactionLookupPromise) return battlegroupFactionLookupPromise;

  battlegroupFactionLookupPromise = (async () => {
    const lookup = new Map();
    for (const code of Object.keys(FACTION_FLAG_BY_CODE)) {
      lookup.set(normalizeFactionLookupName(code), code);
    }

    try {
      const source = await fs.readFile(FACTION_ASSET_DATA_PATH, "utf8");
      const visualBlocks = source.match(/\{\s*name:\s*"[^"]+"[\s\S]*?unitIconBasename:\s*"[^"]*"[\s\S]*?\}/g) ?? [];
      for (const block of visualBlocks) {
        const faction = block.match(/faction:\s*"([A-Z]+)"/)?.[1];
        if (!faction || !FACTION_FLAG_BY_CODE[faction]) continue;

        const names = [];
        const primaryName = block.match(/name:\s*"([^"]+)"/)?.[1];
        if (primaryName) names.push(primaryName);

        const aliasesText = block.match(/aliases:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
        for (const aliasMatch of aliasesText.matchAll(/"([^"]+)"/g)) {
          names.push(aliasMatch[1]);
        }

        for (const name of names) {
          const key = normalizeFactionLookupName(name);
          if (key) lookup.set(key, faction);
        }
      }
    } catch {
      // Keep built-in fallback rules when the asset manifest is unavailable.
    }

    battlegroupFactionLookup = lookup;
    battlegroupFactionLookupPromise = null;
    return lookup;
  })();

  return battlegroupFactionLookupPromise;
}

function normalizeFactionLookupName(value) {
  return String(value ?? "")
    .trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function resolveAvatarDataUrl(url) {
  const avatarUrl = String(url ?? "").trim();
  if (!avatarUrl) return null;

  try {
    const response = await fetch(avatarUrl);
    if (!response.ok) return null;
    const contentType = String(response.headers.get("content-type") ?? "").trim() || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) return null;
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

async function loadSharp() {
  if (!sharpLoaderPromise) {
    const sharpRoots = [
      String(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?? "").trim(),
      SHARP_BUNDLE_ROOT,
    ].filter(Boolean);
    process.env.NODE_PATH = [
      ...sharpRoots,
      ...sharpRoots.map((root) => path.join(root, ".pnpm", "node_modules")),
      process.env.NODE_PATH || "",
    ]
      .filter(Boolean)
      .join(path.delimiter);
    sharpRequire("module")._initPaths();
    sharpLoaderPromise = Promise.resolve().then(() => sharpRequire("sharp"));
  }
  return sharpLoaderPromise;
}
