// -*- coding: utf-8 -*-

import net from "node:net";

const DEFAULT_SAMPLE_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MULTIPLIER = 3;
const DEFAULT_FREEZE_SAMPLE_THRESHOLD = 15;
const DEFAULT_RECENT_SAMPLE_LIMIT = 50;
const DEFAULT_TICKET_HISTORY_LIMIT = 7_200;
const MAX_TICKET_HISTORY_LIMIT = 20_000;
const DEFAULT_COMMAND_PORT = 12765;
const DEFAULT_COMMAND_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_TRACKED_SOURCES = 32;
const MAX_TRACKED_SOURCES = 256;
const DEFAULT_MAX_CONNECTIONS = 64;
const MAX_CONNECTIONS = 512;
const DEFAULT_MAX_SOCKET_BUFFER_BYTES = 1024 * 1024;
const MAX_SOCKET_BUFFER_BYTES = 8 * 1024 * 1024;

export function createRemoteTelemetryModule({ core, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.remoteTelemetry",
    source: "module.remoteTelemetry",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config.get("modules.remoteTelemetry", {});
  const enabled = moduleConfig.enabled !== false;
  const host = String(moduleConfig.host ?? "0.0.0.0").trim() || "0.0.0.0";
  const port = normalizePositiveInteger(moduleConfig.port, 12764);
  const sampleIntervalMs = normalizePositiveInteger(moduleConfig.sampleIntervalMs, DEFAULT_SAMPLE_INTERVAL_MS);
  const timeoutMultiplier = normalizePositiveInteger(moduleConfig.timeoutMultiplier, DEFAULT_TIMEOUT_MULTIPLIER);
  const receiverTimeoutMs = normalizePositiveInteger(moduleConfig.receiverTimeoutMs, sampleIntervalMs * timeoutMultiplier);
  const freezeSampleThreshold = normalizePositiveInteger(moduleConfig.freezeSampleThreshold, DEFAULT_FREEZE_SAMPLE_THRESHOLD);
  const recentSampleLimit = normalizePositiveInteger(moduleConfig.recentSampleLimit, DEFAULT_RECENT_SAMPLE_LIMIT);
  const ticketHistoryLimit = Math.min(
    normalizePositiveInteger(moduleConfig.ticketHistoryLimit, DEFAULT_TICKET_HISTORY_LIMIT),
    MAX_TICKET_HISTORY_LIMIT,
  );
  const commandHost = normalizeText(moduleConfig.commandHost);
  const commandPort = normalizePositiveInteger(moduleConfig.commandPort, DEFAULT_COMMAND_PORT);
  const commandTimeoutMs = normalizePositiveInteger(moduleConfig.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS);
  const maxTrackedSources = Math.min(
    normalizePositiveInteger(moduleConfig.maxTrackedSources, DEFAULT_MAX_TRACKED_SOURCES),
    MAX_TRACKED_SOURCES,
  );
  const maxConnections = Math.min(
    normalizePositiveInteger(moduleConfig.maxConnections, DEFAULT_MAX_CONNECTIONS),
    MAX_CONNECTIONS,
  );
  const maxSocketBufferBytes = Math.min(
    normalizePositiveInteger(moduleConfig.maxSocketBufferBytes, DEFAULT_MAX_SOCKET_BUFFER_BYTES),
    MAX_SOCKET_BUFFER_BYTES,
  );

  const sources = new Map();
  const recentSamples = [];
  const ticketHistory = [];
  const sockets = new Set();

  let ticketHistoryRevision = 1;
  let ticketHistoryStartedAt = "";
  let ticketHistoryResetAt = new Date().toISOString();
  let ticketHistoryResetReason = "startup";
  let activeTicketSourceKey = "";
  let roundResetUnsubscribe = null;
  let started = false;
  let listening = false;
  let startedAt = "";
  let listeningAt = "";
  let server = null;
  let lastError = "";
  let lastMessageAt = "";
  let totalMessages = 0;
  let totalParseErrors = 0;

  function getSourceState(sourceKey) {
    if (!sources.has(sourceKey)) {
      sources.set(sourceKey, {
        sourceKey,
        firstSeenAt: "",
        lastMessageAt: "",
        remoteAddress: "",
        remotePort: null,
        type: "",
        projectDir: "",
        exe: "",
        pid: null,
        sampleIntervalMs,
        successCount: 0,
        failureCount: 0,
        totalCount: 0,
        latest: null,
        previous: null,
        unchangedTicketSamples: 0,
        unchangedTicketsSince: "",
        lastError: "",
        anomalyFlags: [],
      });
      pruneSources(sourceKey);
    }
    return sources.get(sourceKey);
  }

  function pruneSources(protectedSourceKey = "") {
    while (sources.size > maxTrackedSources) {
      let evictionKey = "";
      for (const key of sources.keys()) {
        if (key !== protectedSourceKey && key !== activeTicketSourceKey) {
          evictionKey = key;
          break;
        }
      }
      if (!evictionKey) break;
      sources.delete(evictionKey);
    }
  }

  function normalizeMessage(rawPayload, remoteInfo = {}) {
    const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
    const receivedAt = new Date().toISOString();
    const ok = Boolean(payload.ok);
    const payloadTimestampMs = normalizeTimestampMs(payload.timestamp, receivedAt);
    const projectDir = normalizeText(payload.project_dir ?? payload.projectDir);
    const exe = normalizeText(payload.exe);
    const remoteAddress = normalizeText(remoteInfo.address);
    const sourceKey = buildSourceKey(payload, remoteAddress);
    const team1 = firstFiniteNumber(
      payload.t1,
      payload.team1,
      payload.team_1,
      payload.tickets?.team1,
      payload.tickets?.t1,
    );
    const team2 = firstFiniteNumber(
      payload.t2,
      payload.team2,
      payload.team_2,
      payload.tickets?.team2,
      payload.tickets?.t2,
    );
    const intervalMs = normalizePositiveInteger(
      payload.interval_ms ?? payload.intervalMs ?? payload.sampleIntervalMs,
      sampleIntervalMs,
    );

    return {
      receivedAt,
      sourceKey,
      remoteAddress,
      remotePort: normalizeNullableInteger(remoteInfo.port),
      type: normalizeText(payload.type) || "remote_sample",
      timestamp: payloadTimestampMs ? new Date(payloadTimestampMs).toISOString() : "",
      timestampMs: payloadTimestampMs,
      ok,
      error: normalizeText(payload.error),
      projectDir,
      exe,
      pid: normalizeNullableInteger(payload.pid),
      intervalMs,
      tickets: {
        team1,
        team2,
      },
      layer: normalizeText(payload.layer ?? payload.layerName ?? payload.currentLayer),
      map: normalizeText(payload.map ?? payload.mapName),
      matchState: normalizeText(payload.match_state ?? payload.matchState ?? payload.phase),
      playerCount: firstFiniteNumber(payload.player_count, payload.playerCount, payload.players),
      metrics: clonePlainObject(payload.metrics),
      payload: clonePlainObject(payload),
    };
  }

  function ingestSample(sample) {
    const source = getSourceState(sample.sourceKey);
    const previous = source.latest;
    const anomalyFlags = [];

    if (!source.firstSeenAt) source.firstSeenAt = sample.receivedAt;
    source.lastMessageAt = sample.receivedAt;
    source.remoteAddress = sample.remoteAddress || source.remoteAddress;
    source.remotePort = sample.remotePort ?? source.remotePort;
    source.type = sample.type || source.type;
    source.projectDir = sample.projectDir || source.projectDir;
    source.exe = sample.exe || source.exe;
    source.pid = sample.pid ?? source.pid;
    source.sampleIntervalMs = sample.intervalMs || source.sampleIntervalMs || sampleIntervalMs;
    source.totalCount += 1;

    if (sample.ok) {
      source.successCount += 1;
      source.lastError = "";
    } else {
      source.failureCount += 1;
      source.lastError = sample.error || "Remote acquisition failed.";
      anomalyFlags.push("acquisition_failed");
    }

    if (previous?.ok && sample.ok) {
      const prevT1 = previous.tickets?.team1;
      const prevT2 = previous.tickets?.team2;
      const nextT1 = sample.tickets?.team1;
      const nextT2 = sample.tickets?.team2;

      if (isFiniteTicket(prevT1) && isFiniteTicket(nextT1) && nextT1 > prevT1) {
        anomalyFlags.push("ticket_increase_team1");
      }
      if (isFiniteTicket(prevT2) && isFiniteTicket(nextT2) && nextT2 > prevT2) {
        anomalyFlags.push("ticket_increase_team2");
      }

      if (isFiniteTicket(prevT1) && isFiniteTicket(prevT2) && isFiniteTicket(nextT1) && isFiniteTicket(nextT2)
        && nextT1 === prevT1 && nextT2 === prevT2) {
        source.unchangedTicketSamples += 1;
        source.unchangedTicketsSince = source.unchangedTicketsSince || previous.receivedAt || sample.receivedAt;
      } else {
        source.unchangedTicketSamples = 0;
        source.unchangedTicketsSince = "";
      }

      if (source.unchangedTicketSamples >= freezeSampleThreshold) {
        anomalyFlags.push("ticket_freeze");
      }
    } else if (!sample.ok) {
      source.unchangedTicketSamples = 0;
      source.unchangedTicketsSince = "";
    }

    source.previous = previous ? clonePlainObject(previous) : null;
    source.latest = clonePlainObject(sample);
    source.anomalyFlags = [...new Set(anomalyFlags)];
    lastMessageAt = sample.receivedAt;
    totalMessages += 1;

    recentSamples.push({
      sourceKey: sample.sourceKey,
      receivedAt: sample.receivedAt,
      ok: sample.ok,
      tickets: sample.tickets,
      layer: sample.layer,
      map: sample.map,
      matchState: sample.matchState,
      error: sample.error,
      payload: sample.payload,
    });
    if (recentSamples.length > recentSampleLimit) {
      recentSamples.splice(0, recentSamples.length - recentSampleLimit);
    }

    recordTicketHistorySample(sample);
    emitUpdated();
  }

  function recordTicketHistorySample(sample) {
    if (!sample?.ok || !isFiniteTicket(sample.tickets?.team1) || !isFiniteTicket(sample.tickets?.team2)) {
      return;
    }

    const now = Date.now();
    if (activeTicketSourceKey && activeTicketSourceKey !== sample.sourceKey) {
      const activeSource = sources.get(activeTicketSourceKey);
      const activeLastSeenMs = Date.parse(activeSource?.lastMessageAt || "");
      const activeTimeoutMs = Math.max(
        receiverTimeoutMs,
        normalizePositiveInteger(activeSource?.sampleIntervalMs, sampleIntervalMs) * timeoutMultiplier,
      );
      if (Number.isFinite(activeLastSeenMs) && now - activeLastSeenMs <= activeTimeoutMs) {
        return;
      }
    }

    activeTicketSourceKey = sample.sourceKey;
    const previousPoint = ticketHistory.at(-1) ?? null;
    const nextIdentity = normalizeText(sample.layer) || normalizeText(sample.map);
    const previousIdentity = normalizeText(previousPoint?.layer) || normalizeText(previousPoint?.map);
    const bothTeamsReset = previousPoint
      && Number(sample.tickets.team1) >= Number(previousPoint.team1) + 25
      && Number(sample.tickets.team2) >= Number(previousPoint.team2) + 25;

    if ((nextIdentity && previousIdentity && nextIdentity !== previousIdentity) || bothTeamsReset) {
      resetTicketHistory(nextIdentity && previousIdentity && nextIdentity !== previousIdentity
        ? "layer_changed"
        : "ticket_reset_detected");
      activeTicketSourceKey = sample.sourceKey;
    }

    const timestampMs = Date.parse(sample.receivedAt || "");
    const point = {
      timestamp: sample.receivedAt,
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : now,
      receivedAt: sample.receivedAt,
      team1: Number(sample.tickets.team1),
      team2: Number(sample.tickets.team2),
      layer: normalizeText(sample.layer),
      map: normalizeText(sample.map),
      matchState: normalizeText(sample.matchState),
    };

    const lastPoint = ticketHistory.at(-1);
    if (lastPoint && point.timestampMs <= lastPoint.timestampMs) {
      point.timestampMs = lastPoint.timestampMs + 1;
      point.timestamp = new Date(point.timestampMs).toISOString();
    }

    if (!ticketHistoryStartedAt) ticketHistoryStartedAt = point.receivedAt || point.timestamp;
    ticketHistory.push(point);
    if (ticketHistory.length > ticketHistoryLimit) {
      ticketHistory.splice(0, ticketHistory.length - ticketHistoryLimit);
      ticketHistoryStartedAt = ticketHistory[0]?.receivedAt || ticketHistory[0]?.timestamp || "";
    }
  }

  function resetTicketHistory(reason = "manual") {
    ticketHistory.splice(0, ticketHistory.length);
    ticketHistoryRevision += 1;
    ticketHistoryStartedAt = "";
    ticketHistoryResetAt = new Date().toISOString();
    ticketHistoryResetReason = normalizeText(reason) || "manual";
    activeTicketSourceKey = "";
  }

  function getTicketHistory(options = {}) {
    const sinceMs = Number(options.sinceMs ?? options.since ?? 0);
    const requestedLimit = normalizePositiveInteger(options.limit, ticketHistoryLimit);
    const limit = Math.min(requestedLimit, ticketHistoryLimit);
    const filtered = Number.isFinite(sinceMs) && sinceMs > 0
      ? ticketHistory.filter((point) => point.timestampMs > sinceMs)
      : ticketHistory;
    const points = filtered.length > limit ? filtered.slice(-limit) : filtered.slice();
    const activeSource = activeTicketSourceKey ? sources.get(activeTicketSourceKey) : null;
    const source = activeSource ? summarizeSource(activeSource) : getCurrentSourceSummary();
    const latestPoint = ticketHistory.at(-1) ?? null;

    return {
      generatedAt: new Date().toISOString(),
      revision: ticketHistoryRevision,
      resetAt: ticketHistoryResetAt,
      resetReason: ticketHistoryResetReason,
      startedAt: ticketHistoryStartedAt,
      sampleIntervalMs: normalizePositiveInteger(source?.sampleIntervalMs, sampleIntervalMs),
      maxPoints: ticketHistoryLimit,
      source: source ? {
        sourceKey: source.sourceKey,
        online: Boolean(source.online),
        lastMessageAt: source.lastMessageAt,
      } : null,
      currentTickets: {
        team1: latestPoint?.team1 ?? source?.latest?.tickets?.team1 ?? null,
        team2: latestPoint?.team2 ?? source?.latest?.tickets?.team2 ?? null,
      },
      points: points.map((point) => ({ ...point })),
    };
  }

  function getCurrentSourceSummary(now = Date.now()) {
    const list = [...sources.values()]
      .map((source) => summarizeSource(source, now))
      .sort((left, right) => right.lastMessageAtMs - left.lastMessageAtMs);
    return list[0] ?? null;
  }

  function summarizeSource(source, now = Date.now()) {
    const lastMessageAtMs = Date.parse(source.lastMessageAt || "");
    const timeoutMs = Math.max(
      receiverTimeoutMs,
      normalizePositiveInteger(source.sampleIntervalMs, sampleIntervalMs) * timeoutMultiplier,
    );
    const online = Number.isFinite(lastMessageAtMs) && lastMessageAtMs > 0
      ? (now - lastMessageAtMs) <= timeoutMs
      : false;
    return {
      sourceKey: source.sourceKey,
      firstSeenAt: source.firstSeenAt,
      lastMessageAt: source.lastMessageAt,
      lastMessageAtMs: Number.isFinite(lastMessageAtMs) ? lastMessageAtMs : 0,
      remoteAddress: source.remoteAddress,
      remotePort: source.remotePort,
      type: source.type,
      projectDir: source.projectDir,
      exe: source.exe,
      pid: source.pid,
      sampleIntervalMs: source.sampleIntervalMs,
      successCount: source.successCount,
      failureCount: source.failureCount,
      totalCount: source.totalCount,
      online,
      timeoutMs,
      latest: clonePlainObject(source.latest),
      previous: clonePlainObject(source.previous),
      unchangedTicketSamples: source.unchangedTicketSamples,
      unchangedTicketsSince: source.unchangedTicketsSince,
      lastError: source.lastError,
      anomalyFlags: [...source.anomalyFlags],
    };
  }

  function getState() {
    const now = Date.now();
    const sourceSummaries = [...sources.values()]
      .map((source) => summarizeSource(source, now))
      .sort((left, right) => right.lastMessageAtMs - left.lastMessageAtMs);
    const currentSource = sourceSummaries[0] ?? null;
    const commandTarget = getCommandTarget();

    return {
      enabled,
      started,
      listening,
      host,
      port,
      startedAt,
      listeningAt,
      lastError,
      lastMessageAt,
      totalMessages,
      totalParseErrors,
      sourceCount: sourceSummaries.length,
      sampleIntervalMs,
      receiverTimeoutMs,
      timeoutMultiplier,
      freezeSampleThreshold,
      currentSource,
      currentSample: currentSource?.latest ?? null,
      sources: sourceSummaries,
      recentSamples: recentSamples.slice().reverse(),
      resourceLimits: {
        maxTrackedSources,
        maxConnections,
        maxSocketBufferBytes,
        openConnections: sockets.size,
      },
      command: {
        host: commandHost || null,
        port: commandPort,
        timeoutMs: commandTimeoutMs,
      },
      commandTarget: {
        host: commandTarget.host || null,
        port: commandTarget.port,
        timeoutMs: commandTarget.timeoutMs,
        sourceKey: commandTarget.sourceKey,
        online: commandTarget.online,
      },
    };
  }

  function getCommandTarget(input = {}) {
    const currentSource = getCurrentSourceSummary();
    const payload = currentSource?.latest?.payload ?? {};
    const host = normalizeCommandHost(
      input.host
      || commandHost
      || payload.command_host
      || payload.commandHost
      || currentSource?.remoteAddress
      || "",
    );
    const port = normalizePositiveInteger(
      input.port
      ?? commandPort
      ?? payload.command_port
      ?? payload.commandPort,
      commandPort,
    );
    return {
      host,
      port,
      timeoutMs: commandTimeoutMs,
      sourceKey: currentSource?.sourceKey ?? "",
      online: Boolean(currentSource?.online),
    };
  }

  async function writeTickets(input = {}) {
    const request = buildSetTicketsRequest(input);
    const response = await sendTicketCommand({ request });

    return {
      ok: Boolean(response?.ok),
      request,
      response,
      target: response?.target ?? null,
    };
  }

  async function adjustTickets(input = {}) {
    const currentSource = getCurrentSourceSummary();
    const currentSample = currentSource?.latest ?? null;
    const before = {
      t1: firstFiniteNumber(
        input.beforeT1,
        input.before?.t1,
        input.before?.team1,
        currentSample?.tickets?.team1,
        currentSample?.t1,
      ),
      t2: firstFiniteNumber(
        input.beforeT2,
        input.before?.t2,
        input.before?.team2,
        currentSample?.tickets?.team2,
        currentSample?.t2,
      ),
    };
    const hasTeamDelta = input.team !== undefined || input.delta !== undefined;
    const hasLegacyDelta = input.addT1 !== undefined || input.addT2 !== undefined;

    let request;
    if (hasTeamDelta) {
      const team = Number(input.team) === 2 ? 2 : 1;
      const delta = requireInteger(input.delta, "delta");
      if (delta === 0) {
        throw new Error("delta cannot be 0.");
      }
      request = {
        action: "adjust_tickets",
        team,
        delta,
      };
      const deltaByTeam = { t1: 0, t2: 0 };
      deltaByTeam[team === 2 ? "t2" : "t1"] = delta;
      const next = {
        t1: applyTicketDelta(before.t1, deltaByTeam.t1, input),
        t2: applyTicketDelta(before.t2, deltaByTeam.t2, input),
      };
      const response = await sendTicketCommand({ request });
      return {
        ok: Boolean(response?.ok),
        mode: "adjust",
        before,
        delta: deltaByTeam,
        after: {
          t1: normalizeNullableInteger(response?.after?.t1 ?? response?.t1) ?? next.t1,
          t2: normalizeNullableInteger(response?.after?.t2 ?? response?.t2) ?? next.t2,
        },
        request,
        response,
        target: response?.target ?? null,
      };
    }

    if (!hasLegacyDelta) {
      throw new Error("At least one of team/delta or addT1/addT2 is required.");
    }

    const delta = buildAdjustTicketDelta(input);
    request = {
      action: "adjust_tickets",
    };
    if (delta.t1 !== 0) request.add_t1 = delta.t1;
    if (delta.t2 !== 0) request.add_t2 = delta.t2;
    const next = {
      t1: applyTicketDelta(before.t1, delta.t1, input),
      t2: applyTicketDelta(before.t2, delta.t2, input),
    };
    const response = await sendTicketCommand({ request });

    return {
      ok: Boolean(response?.ok),
      mode: "adjust",
      before,
      delta,
      after: {
        t1: normalizeNullableInteger(response?.after?.t1 ?? response?.t1) ?? next.t1,
        t2: normalizeNullableInteger(response?.after?.t2 ?? response?.t2) ?? next.t2,
      },
      request,
      response,
      target: response?.target ?? null,
    };
  }

  function getCurrentPid() {
    return getCurrentSourceSummary()?.pid ?? null;
  }

  async function readTickets(input = {}) {
    const response = await sendTicketCommand({
      request: { action: "read_tickets" },
    });
    return {
      ok: Boolean(response?.ok),
      response,
      target: response?.target ?? null,
    };
  }

  async function sendTicketCommand({ request }, input = {}) {
    const target = getCommandTarget();
    if (!target.host) {
      throw new Error("No command target host is available for the current sender.");
    }
    const response = await sendJsonLineCommand({
      host: target.host,
      port: target.port,
      payload: request,
      timeoutMs: target.timeoutMs,
    });
    return {
      ...response,
      target,
    };
  }

  function emitUpdated() {
    const state = getState();
    core.eventBus?.emitModuleEvent?.(
      "module.remoteTelemetry",
      "updated",
      {
        type: "module.remoteTelemetry.updated",
        time: new Date().toISOString(),
        source: "module.remoteTelemetry",
        layer: "module",
        payload: state,
        remoteTelemetry: state,
      },
    );
  }

  function handleSocket(socket) {
    if (sockets.size >= maxConnections) {
      lastError = `Remote telemetry connection limit reached (${maxConnections}).`;
      moduleLogger.warn?.(`[RemoteTelemetry] rejected connection: ${lastError}`, {
        operation: "remoteTelemetry.connectionLimit",
      });
      socket.destroy();
      return;
    }

    sockets.add(socket);
    let buffer = "";
    let oversized = false;
    const remoteInfo = {
      address: normalizeText(socket.remoteAddress),
      port: normalizeNullableInteger(socket.remotePort),
    };

    socket.setEncoding("utf8");
    if (typeof socket.setNoDelay === "function") socket.setNoDelay(true);

    function rejectOversizedPayload() {
      if (oversized) return;
      oversized = true;
      totalParseErrors += 1;
      lastError = `Remote telemetry payload exceeded ${maxSocketBufferBytes} bytes.`;
      moduleLogger.warn?.(`[RemoteTelemetry] rejected oversized payload: ${lastError}`, {
        operation: "remoteTelemetry.payloadTooLarge",
        data: {
          remoteAddress: remoteInfo.address,
          remotePort: remoteInfo.port,
          bufferedBytes: Buffer.byteLength(buffer, "utf8"),
        },
      });
      buffer = "";
      socket.destroy();
    }

    socket.on("data", (chunk) => {
      buffer += String(chunk ?? "");
      while (true) {
        const lineBreak = buffer.indexOf("\n");
        if (lineBreak < 0) {
          if (Buffer.byteLength(buffer, "utf8") > maxSocketBufferBytes) {
            rejectOversizedPayload();
          }
          break;
        }
        if (Buffer.byteLength(buffer.slice(0, lineBreak), "utf8") > maxSocketBufferBytes) {
          rejectOversizedPayload();
          return;
        }
        const line = buffer.slice(0, lineBreak).replace(/\r$/, "");
        buffer = buffer.slice(lineBreak + 1);
        if (!line.trim()) continue;
        try {
          const payload = JSON.parse(line);
          ingestSample(normalizeMessage(payload, remoteInfo));
        } catch (error) {
          totalParseErrors += 1;
          lastError = String(error?.message ?? error ?? "Invalid remote telemetry JSON.");
          moduleLogger.warn?.(`[RemoteTelemetry] failed to parse JSON line: ${lastError}`, {
            operation: "remoteTelemetry.parseLineFailed",
            data: {
              remoteAddress: remoteInfo.address,
              remotePort: remoteInfo.port,
            },
          });
        }
      }
    });

    socket.on("error", (error) => {
      lastError = String(error?.message ?? error ?? "Remote telemetry socket error.");
      moduleLogger.warn?.(`[RemoteTelemetry] socket error: ${lastError}`, {
        operation: "remoteTelemetry.socketError",
        data: {
          remoteAddress: remoteInfo.address,
          remotePort: remoteInfo.port,
        },
      });
    });

    socket.on("close", () => {
      sockets.delete(socket);
    });
  }

  async function startServer() {
    if (!enabled || started) return;
    started = true;
    startedAt = new Date().toISOString();
    server = net.createServer(handleSocket);
    server.on("error", (error) => {
      lastError = String(error?.message ?? error ?? "Remote telemetry server error.");
      moduleLogger.error?.(`[RemoteTelemetry] server error: ${lastError}`, {
        operation: "remoteTelemetry.serverError",
      });
    });

    try {
      await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
        server.listen(port, host);
      });
      listening = true;
      listeningAt = new Date().toISOString();
      lastError = "";
      moduleLogger.info?.(`[RemoteTelemetry] listening on ${host}:${port}`, {
        operation: "remoteTelemetry.listen",
        data: {
          host,
          port,
        },
      });
    } catch (error) {
      listening = false;
      lastError = String(error?.message ?? error ?? "Failed to start remote telemetry server.");
      moduleLogger.error?.(`[RemoteTelemetry] failed to listen on ${host}:${port}: ${lastError}`, {
        operation: "remoteTelemetry.listenFailed",
      });
    }
  }

  async function stopServer() {
    started = false;
    listening = false;
    for (const socket of sockets) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }
    sockets.clear();
    if (!server) return;
    const closingServer = server;
    server = null;
    await new Promise((resolve) => {
      try {
        closingServer.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  return {
    manifest: {
      id: "module.remoteTelemetry",
      name: "Remote Telemetry Module",
      kind: "module",
      version: "1.0.0",
      description: "Receives newline-delimited TCP JSON telemetry from remote senders, tracks health/anomalies, and exposes the latest remote match samples to web consumers.",
    },
    apiName: "remoteTelemetry",
  api: {
    getState,
    getCurrentSourceSummary,
    getTicketHistory,
    resetTicketHistory,
    ingestSample,
    normalizeMessage,
    getCommandTarget,
    readTickets,
    writeTickets,
    adjustTickets,
  },
    async start() {
      if (enabled && !roundResetUnsubscribe) {
        roundResetUnsubscribe = core.eventBus?.onCoreEvent?.("round.world_bring_up", () => {
          resetTicketHistory("round_world_bring_up");
        }) ?? null;
      }
      await startServer();
    },
    async stop() {
      if (typeof roundResetUnsubscribe === "function") {
        roundResetUnsubscribe();
      }
      roundResetUnsubscribe = null;
      await stopServer();
    },
  };
}

function buildSourceKey(payload, remoteAddress = "") {
  const projectDir = normalizeText(payload?.project_dir ?? payload?.projectDir);
  const exe = normalizeText(payload?.exe);
  const pid = normalizeNullableInteger(payload?.pid);
  const explicit = normalizeText(payload?.sourceKey ?? payload?.source_key);
  if (explicit) return explicit;
  if (projectDir || exe) return `${projectDir}|${exe}|${pid ?? ""}`;
  return remoteAddress || "remote";
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return Math.trunc(number);
  return fallback;
}

function normalizeNullableInteger(value) {
  const number = Number(value);
  if (Number.isFinite(number)) return Math.trunc(number);
  return null;
}

function normalizeTimestampMs(value, fallbackIso = "") {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? Math.trunc(value * 1000) : Math.trunc(value);
  }
  const parsed = Date.parse(String(value ?? "").trim() || fallbackIso);
  if (Number.isFinite(parsed)) return parsed;
  return Date.parse(fallbackIso || new Date().toISOString());
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeCommandHost(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return text.startsWith("::ffff:") ? text.slice("::ffff:".length) : text;
}

function buildSetTicketsRequest(input = {}) {
  const request = { action: "set_tickets" };
  if (input.t1 !== undefined && input.t1 !== null && input.t1 !== "") {
    request.t1 = requireInteger(input.t1, "t1");
  }
  if (input.t2 !== undefined && input.t2 !== null && input.t2 !== "") {
    request.t2 = requireInteger(input.t2, "t2");
  }
  if (request.t1 === undefined && request.t2 === undefined) {
    throw new Error("At least one of t1 or t2 is required.");
  }
  return request;
}

function buildAdjustTicketDelta(input = {}) {
  const delta = {
    t1: input.addT1 !== undefined && input.addT1 !== null && input.addT1 !== "" ? requireInteger(input.addT1, "addT1") : 0,
    t2: input.addT2 !== undefined && input.addT2 !== null && input.addT2 !== "" ? requireInteger(input.addT2, "addT2") : 0,
  };
  if (delta.t1 === 0 && delta.t2 === 0) {
    throw new Error("At least one of addT1 or addT2 is required.");
  }
  return delta;
}

function applyTicketDelta(beforeValue, deltaValue, input = {}) {
  if (!Number.isFinite(beforeValue)) return null;
  const next = beforeValue + deltaValue;
  if (input.noClamp) {
    return next;
  }
  let clamped = next;
  if (clamped < 0) clamped = 0;
  const clampMax = normalizeNullableInteger(input.clampMax);
  if (clampMax !== null) {
    clamped = Math.min(clampMax, clamped);
  }
  return clamped;
}

async function sendJsonLineCommand({ host, port, payload, timeoutMs }) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      finishWithError(new Error(`Ticket command timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.removeAllListeners();
      try {
        socket.end();
      } catch {
        // ignore
      }
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }

    function finishWithError(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function finishWithValue(value) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += String(chunk ?? "");
      const lineBreak = buffer.indexOf("\n");
      if (lineBreak < 0) return;
      const line = buffer.slice(0, lineBreak).trim();
      if (!line) return;
      try {
        finishWithValue(JSON.parse(line));
      } catch (error) {
        finishWithError(new Error(`Ticket command returned invalid JSON: ${String(error?.message ?? error)}`));
      }
    });
    socket.on("error", (error) => {
      finishWithError(error);
    });
    socket.on("close", () => {
      if (!settled) {
        finishWithError(new Error("Ticket command connection closed before a response was received."));
      }
    });
  });
}

function clonePlainObject(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function isFiniteTicket(value) {
  return Number.isFinite(Number(value));
}

function requireInteger(value, fieldName) {
  const text = String(value ?? "").trim();
  if (!/^-?\d+$/.test(text)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
  return Number(text);
}

export default createRemoteTelemetryModule;
