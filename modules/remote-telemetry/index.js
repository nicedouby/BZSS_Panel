// -*- coding: utf-8 -*-

import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_SAMPLE_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MULTIPLIER = 3;
const DEFAULT_FREEZE_SAMPLE_THRESHOLD = 15;
const DEFAULT_RECENT_SAMPLE_LIMIT = 50;
const DEFAULT_COMMAND_PORT = 12765;
const DEFAULT_COMMAND_TIMEOUT_MS = 3_000;

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
  const commandHost = normalizeText(moduleConfig.commandHost);
  const commandPort = normalizePositiveInteger(moduleConfig.commandPort, DEFAULT_COMMAND_PORT);
  const commandTimeoutMs = normalizePositiveInteger(moduleConfig.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS);
  const pythonExecutable = normalizeText(moduleConfig.pythonExecutable) || "python";
  const scriptPath = resolveTicketToolPath(moduleConfig.scriptPath);
  const scriptWorkingDirectory = normalizeText(moduleConfig.workingDirectory)
    || path.dirname(scriptPath);

  const sources = new Map();
  const recentSamples = [];
  const sockets = new Set();

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
    }
    return sources.get(sourceKey);
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

    emitUpdated();
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
    return await runTicketTool({
      pid: input.pid ?? getCurrentPid(),
      args: buildAbsoluteTicketArgs(input),
    });
  }

  async function adjustTickets(input = {}) {
    return await runTicketTool({
      pid: input.pid ?? getCurrentPid(),
      args: buildAdjustTicketArgs(input),
    });
  }

  function getCurrentPid() {
    return getCurrentSourceSummary()?.pid ?? null;
  }

  async function runTicketTool({ pid, args }) {
    const resolvedPid = normalizeNullableInteger(pid);
    if (!resolvedPid) {
      throw new Error("No target pid is available for the current sender.");
    }
    const response = await runTicketToolCommand({
      pythonExecutable,
      scriptPath,
      workingDirectory: scriptWorkingDirectory,
      args: [String(resolvedPid), ...args],
      timeoutMs: commandTimeoutMs,
    });
    return {
      ...response,
      pid: response?.pid ?? resolvedPid,
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
    sockets.add(socket);
    let buffer = "";
    const remoteInfo = {
      address: normalizeText(socket.remoteAddress),
      port: normalizeNullableInteger(socket.remotePort),
    };

    socket.setEncoding("utf8");
    if (typeof socket.setNoDelay === "function") socket.setNoDelay(true);

    socket.on("data", (chunk) => {
      buffer += String(chunk ?? "");
      while (true) {
        const lineBreak = buffer.indexOf("\n");
        if (lineBreak < 0) break;
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
      ingestSample,
      normalizeMessage,
      getCommandTarget,
      writeTickets,
      adjustTickets,
    },
    async start() {
      await startServer();
    },
    async stop() {
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

function resolveTicketToolPath(value) {
  const text = normalizeText(value);
  if (text) return path.resolve(text);
  return path.resolve(process.cwd(), "tools", "squad_ticket_tool.py");
}

function buildAbsoluteTicketArgs(input = {}) {
  const args = [];
  if (input.t1 !== undefined && input.t1 !== null && input.t1 !== "") {
    args.push("--t1", String(requireInteger(input.t1, "t1")));
  }
  if (input.t2 !== undefined && input.t2 !== null && input.t2 !== "") {
    args.push("--t2", String(requireInteger(input.t2, "t2")));
  }
  return args;
}

function buildAdjustTicketArgs(input = {}) {
  const args = [];
  if (input.addT1 !== undefined && input.addT1 !== null && input.addT1 !== "") {
    args.push("--add-t1", String(requireInteger(input.addT1, "addT1")));
  }
  if (input.addT2 !== undefined && input.addT2 !== null && input.addT2 !== "") {
    args.push("--add-t2", String(requireInteger(input.addT2, "addT2")));
  }
  if (input.noClamp) args.push("--no-clamp");
  if (input.clampMax !== undefined && input.clampMax !== null && input.clampMax !== "") {
    args.push("--clamp-max", String(requireInteger(input.clampMax, "clampMax")));
  }
  return args;
}

async function runTicketToolCommand({ pythonExecutable, scriptPath, workingDirectory, args, timeoutMs }) {
  return await new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable, [scriptPath, ...args], {
      cwd: workingDirectory,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error(`Ticket tool timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk ?? "");
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
      if (!line) {
        reject(new Error(stderr.trim() || `Ticket tool exited with code ${code} and no JSON output.`));
        return;
      }
      try {
        const parsed = JSON.parse(line);
        if (code !== 0 && parsed?.ok !== true) {
          reject(new Error(parsed?.error || stderr.trim() || `Ticket tool exited with code ${code}.`));
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Ticket tool returned invalid JSON: ${String(error?.message ?? error)}`));
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
