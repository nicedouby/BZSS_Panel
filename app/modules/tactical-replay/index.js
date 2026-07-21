// -*- coding: utf-8 -*-

import { fork } from "node:child_process";
import http from "node:http";
import path from "node:path";

const DEFAULT_PLAYER_INTERVAL_MS = 333;
const DEFAULT_ASSET_INTERVAL_MS = 5_000;
const DEFAULT_SERVICE_PORT = 12766;

export function createTacticalReplayModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.tacticalReplay",
    source: "module.tacticalReplay",
    channel: "module",
  }) ?? core.logger;

  const serviceHost = String(readConfig(config, "modules.tacticalReplay.serviceHost", "127.0.0.1"));
  const servicePort = clampInteger(
    readConfig(config, "modules.tacticalReplay.servicePort", DEFAULT_SERVICE_PORT),
    1024,
    65535,
    DEFAULT_SERVICE_PORT,
  );
  const playerIntervalMs = clampInteger(
    readConfig(config, "modules.tacticalReplay.playerIntervalMs", DEFAULT_PLAYER_INTERVAL_MS),
    50,
    60_000,
    DEFAULT_PLAYER_INTERVAL_MS,
  );
  const assetIntervalMs = clampInteger(
    readConfig(config, "modules.tacticalReplay.assetIntervalMs", DEFAULT_ASSET_INTERVAL_MS),
    250,
    300_000,
    DEFAULT_ASSET_INTERVAL_MS,
  );
  const serviceConfig = {
    host: serviceHost,
    port: servicePort,
    dataDirectory: path.resolve(process.cwd(), String(readConfig(
      config,
      "modules.tacticalReplay.dataDirectory",
      "./data/tactical-replays",
    ))),
    playerIntervalMs,
    assetIntervalMs,
    chunkDurationMs: clampInteger(readConfig(config, "modules.tacticalReplay.chunkDurationMs", 10_000), 2_000, 60_000, 10_000),
    flushIntervalMs: clampInteger(readConfig(config, "modules.tacticalReplay.flushIntervalMs", 500), 100, 10_000, 500),
    maxBufferedBytes: clampInteger(readConfig(config, "modules.tacticalReplay.maxBufferedBytes", 512 * 1024), 16 * 1024, 32 * 1024 * 1024, 512 * 1024),
    retentionDays: clampInteger(readConfig(config, "modules.tacticalReplay.retentionDays", 14), 1, 3650, 14),
  };
  const restartOnExit = readConfig(config, "modules.tacticalReplay.restartOnExit", true) !== false;

  const state = {
    started: false,
    serviceReady: false,
    servicePid: null,
    restartCount: 0,
    lastError: "",
    lastSnapshotAt: "",
    sentPlayerSamples: 0,
    sentAssetSamples: 0,
    droppedPlayerSamples: 0,
    droppedAssetSamples: 0,
  };

  let child = null;
  let stopping = false;
  let latestSnapshot = null;
  let unsubscribeSnapshot = null;
  let playerTimer = null;
  let assetTimer = null;
  let restartTimer = null;
  let bootstrappedServicePid = null;
  let fallbackRoundEpoch = 1;
  let fallbackRoundBase = "";
  let fallbackWasClosed = false;
  const sendQueues = {
    players: { busy: false, pending: null },
    assets: { busy: false, pending: null },
  };

  function onSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    latestSnapshot = snapshot;
    state.lastSnapshotAt = firstText(snapshot?.meta?.generatedAt, new Date().toISOString());
    bootstrapServiceSamples();
  }

  function bootstrapServiceSamples() {
    const pid = Number(state.servicePid ?? 0) || null;
    if (!latestSnapshot || !state.serviceReady || !pid || bootstrappedServicePid === pid) return;
    bootstrappedServicePid = pid;
    sampleAssets();
    samplePlayers();
  }

  async function startService() {
    if (child || stopping) return;
    state.serviceReady = false;
    const servicePath = path.resolve(process.cwd(), "app/modules/tactical-replay/service.js");
    child = fork(servicePath, [], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        BZSS_TACTICAL_REPLAY_CONFIG: JSON.stringify(serviceConfig),
      },
    });
    state.servicePid = child.pid ?? null;

    child.stdout?.on("data", (data) => {
      const text = data.toString("utf8").trimEnd();
      if (text) moduleLogger.info?.(`[REPLAY] ${text}`);
    });
    child.stderr?.on("data", (data) => {
      const text = data.toString("utf8").trimEnd();
      if (text) moduleLogger.warn?.(`[REPLAY] ${text}`);
    });
    child.on("message", (message) => {
      if (message?.type === "ready") {
        state.serviceReady = true;
        state.servicePid = Number(message.pid ?? child?.pid ?? 0) || null;
        moduleLogger.info?.(`Tactical replay service ready. pid=${state.servicePid} port=${servicePort}`);
        bootstrapServiceSamples();
        return;
      }
      if (message?.type === "diagnostic") {
        const method = message.level === "error" ? "error" : message.level === "warn" ? "warn" : "info";
        moduleLogger[method]?.(`[REPLAY] ${message.message}`);
      }
    });
    child.on("error", (error) => {
      state.lastError = error?.message ?? String(error);
      moduleLogger.error?.(`Tactical replay service spawn failed: ${state.lastError}`);
    });
    child.on("exit", (code, signal) => {
      const unexpected = !stopping;
      state.serviceReady = false;
      state.servicePid = null;
      bootstrappedServicePid = null;
      child = null;
      sendQueues.players.busy = false;
      sendQueues.players.pending = null;
      sendQueues.assets.busy = false;
      sendQueues.assets.pending = null;
      moduleLogger.warn?.(`Tactical replay service exited. code=${code} signal=${signal}`);
      if (unexpected && restartOnExit) {
        state.restartCount += 1;
        restartTimer = setTimeout(() => {
          restartTimer = null;
          void startService();
        }, 2_000);
        restartTimer.unref?.();
      }
    });
  }

  function samplePlayers() {
    const snapshot = latestSnapshot;
    if (!snapshot || stopping || !state.serviceReady) return;
    queueSample("players", {
      round: resolveRoundDescriptor(snapshot),
      snapshot: {
        meta: snapshot.meta ?? {},
        server: snapshot.server ?? {},
        match: snapshot.match ?? {},
        teams: Array.isArray(snapshot.teams) ? snapshot.teams : [],
        players: Array.isArray(snapshot.players) ? snapshot.players : [],
        diagnostics: snapshot.diagnostics ?? {},
      },
    });
  }

  function sampleAssets() {
    const snapshot = latestSnapshot;
    if (!snapshot || stopping || !state.serviceReady) return;
    queueSample("assets", {
      round: resolveRoundDescriptor(snapshot),
      snapshot: {
        meta: snapshot.meta ?? {},
        server: snapshot.server ?? {},
        match: snapshot.match ?? {},
        teams: Array.isArray(snapshot.teams) ? snapshot.teams : [],
        assets: {
          captureZones: Array.isArray(snapshot?.assets?.captureZones) ? snapshot.assets.captureZones : [],
          fobs: Array.isArray(snapshot?.assets?.fobs) ? snapshot.assets.fobs : [],
          mainZones: Array.isArray(snapshot?.assets?.mainZones) ? snapshot.assets.mainZones : [],
        },
      },
    });
  }

  function queueSample(kind, payload) {
    const queue = sendQueues[kind];
    if (!queue) return;
    if (queue.busy) {
      queue.pending = payload;
      state[kind === "players" ? "droppedPlayerSamples" : "droppedAssetSamples"] += 1;
      return;
    }
    sendSampleNow(kind, payload);
  }

  function sendSampleNow(kind, payload) {
    const target = child;
    const queue = sendQueues[kind];
    if (!target?.connected || !queue) return;
    queue.busy = true;
    target.send({ type: kind === "players" ? "sample-players" : "sample-assets", payload }, (error) => {
      queue.busy = false;
      if (error) {
        state.lastError = error.message;
        moduleLogger.warn?.(`Tactical replay IPC ${kind} sample failed: ${error.message}`);
      } else {
        state[kind === "players" ? "sentPlayerSamples" : "sentAssetSamples"] += 1;
      }
      const pending = queue.pending;
      queue.pending = null;
      if (pending && !stopping) sendSampleNow(kind, pending);
    });
  }

  function resolveRoundDescriptor(snapshot) {
    const roundState = modules.matchState?.getRoundState?.() ?? {};
    const currentRound = roundState?.current ?? {};
    const serverId = firstText(snapshot?.server?.serverId, snapshot?.meta?.serverId, roundState?.serverId, "default");
    const map = firstText(snapshot?.server?.map, snapshot?.match?.map, snapshot?.match?.mapName, currentRound?.mapName);
    const layer = firstText(snapshot?.server?.layer, snapshot?.match?.layer, snapshot?.match?.layerName, currentRound?.layerName);
    const mode = firstText(snapshot?.server?.mode, snapshot?.match?.mode, snapshot?.match?.gameMode);
    const phase = firstText(snapshot?.match?.phase, snapshot?.match?.state, snapshot?.server?.phase).toLowerCase();
    const closed = /waitingpostmatch|postmatch|intermission|roundended|matchended|complete|finished/.test(phase);
    const stableToken = firstText(
      currentRound?.dedupeKey,
      currentRound?.sourceEventId,
      currentRound?.roundId,
      currentRound?.matchId,
      currentRound?.id,
      currentRound?.worldPath && currentRound?.serverPlayAt
        ? `${currentRound.worldPath}|${currentRound.serverPlayAt}|${currentRound.logLineTime ?? ""}`
        : "",
    );

    let token = stableToken;
    if (!token) {
      const base = `${serverId}|${layer || map}`;
      if (!closed && (base !== fallbackRoundBase || fallbackWasClosed)) fallbackRoundEpoch += 1;
      fallbackRoundBase = base;
      fallbackWasClosed = closed;
      token = `${base}|epoch:${fallbackRoundEpoch}`;
    }

    return {
      serverId,
      map,
      layer,
      mode,
      token,
      key: `${serverId}|${token}`,
      startedAt: firstText(currentRound?.receivedAt, currentRound?.serverPlayAt, snapshot?.match?.startedAt, snapshot?.match?.startTime),
      closed,
    };
  }

  async function proxyRequest({ url, req, res }) {
    if (!state.serviceReady) {
      writeProxyError(res, 503, "ReplayServiceUnavailable", "Tactical replay service is starting or unavailable.");
      return true;
    }
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        res.off("close", abortUpstream);
        resolve();
      };
      const upstream = http.request({
        host: serviceHost,
        port: servicePort,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        headers: { accept: req.headers.accept ?? "application/json" },
        timeout: 15_000,
      }, (upstreamResponse) => {
        const headers = { ...upstreamResponse.headers, "x-tactical-replay-proxy": "child-process" };
        res.writeHead(upstreamResponse.statusCode ?? 502, headers);
        upstreamResponse.pipe(res);
        upstreamResponse.once("end", finish);
        upstreamResponse.once("error", finish);
      });
      const abortUpstream = () => {
        if (!res.writableEnded) upstream.destroy();
        finish();
      };
      res.once("close", abortUpstream);
      upstream.on("timeout", () => upstream.destroy(new Error("Replay service request timed out.")));
      upstream.on("error", (error) => {
        state.lastError = error.message;
        writeProxyError(res, 502, "ReplayServiceProxyError", error.message);
        finish();
      });
      upstream.end();
    });
    return true;
  }

  async function requestJson(pathname) {
    if (!state.serviceReady) throw new Error("Tactical replay service is unavailable.");
    return new Promise((resolve, reject) => {
      const request = http.get({ host: serviceHost, port: servicePort, path: pathname, timeout: 15_000 }, (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { text += chunk; });
        response.on("end", () => {
          try {
            const parsed = JSON.parse(text || "null");
            if ((response.statusCode ?? 500) >= 400) {
              const error = new Error(parsed?.message ?? `Replay service request failed (${response.statusCode}).`);
              error.statusCode = response.statusCode;
              error.code = parsed?.error;
              reject(error);
              return;
            }
            resolve(parsed);
          } catch (error) { reject(error); }
        });
      });
      request.on("timeout", () => request.destroy(new Error("Replay service request timed out.")));
      request.on("error", reject);
    });
  }

  const api = {
    async listSessions({ limit = 100, includeLegacy = false } = {}) {
      const response = await requestJson(`/api/tactical-state/replays?limit=${encodeURIComponent(limit)}&includeLegacy=${includeLegacy ? 1 : 0}`);
      return response?.sessions ?? [];
    },
    async getSession(sessionId) {
      const response = await requestJson(`/api/tactical-state/replays/${encodeURIComponent(sessionId)}`);
      return response?.session ?? null;
    },
    async readFrames(sessionId, options = {}) {
      const fromMs = Math.max(0, Number(options.fromMs) || 0);
      const toMs = Number(options.toMs);
      const durationMs = Number.isFinite(toMs) ? Math.max(500, Math.min(15_000, toMs - fromMs)) : 6_000;
      const response = await requestJson(
        `/api/tactical-state/replays/${encodeURIComponent(sessionId)}/window?from=${fromMs}&duration=${durationMs}`
        + `&limit=${Math.max(1, Math.min(10_000, Number(options.limit) || 3_000))}`
        + `&context=${options.includeContext === false ? 0 : 1}`,
      );
      return response;
    },
    getStatus() {
      return {
        enabled: state.started && !stopping,
        serviceReady: state.serviceReady,
        servicePid: state.servicePid,
        serviceHost,
        servicePort,
        playerIntervalMs,
        assetIntervalMs,
        diagnostics: { ...state },
      };
    },
    proxyRequest,
  };

  return {
    manifest: {
      id: "module.tacticalReplay",
      name: "Tactical Replay Service",
      kind: "module",
      version: "0.2.0",
      description: "Proxy and sampler for the isolated tactical replay data service.",
    },
    apiName: "tacticalReplay",
    api,
    async start() {
      if (state.started) return;
      state.started = true;
      stopping = false;
      await startService();
      const tacticalState = modules.tacticalState;
      if (!tacticalState?.subscribe) {
        state.lastError = "tacticalState module is unavailable.";
        moduleLogger.warn?.(state.lastError);
        return;
      }
      unsubscribeSnapshot = tacticalState.subscribe(onSnapshot);
      try {
        const initialSnapshot = await tacticalState.getSnapshot?.();
        if (initialSnapshot) onSnapshot(initialSnapshot);
      } catch (error) {
        state.lastError = error?.message ?? String(error);
      }
      playerTimer = setInterval(samplePlayers, playerIntervalMs);
      assetTimer = setInterval(sampleAssets, assetIntervalMs);
      playerTimer.unref?.();
      assetTimer.unref?.();
    },
    async stop() {
      if (!state.started) return;
      state.started = false;
      stopping = true;
      unsubscribeSnapshot?.();
      unsubscribeSnapshot = null;
      if (playerTimer) clearInterval(playerTimer);
      if (assetTimer) clearInterval(assetTimer);
      if (restartTimer) clearTimeout(restartTimer);
      playerTimer = null;
      assetTimer = null;
      restartTimer = null;
      const target = child;
      if (target) {
        try { target.send({ type: "shutdown", reason: "module-stop" }); } catch {}
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            try { target.kill("SIGKILL"); } catch {}
            resolve();
          }, 3_000);
          target.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      child = null;
      state.serviceReady = false;
      state.servicePid = null;
      bootstrappedServicePid = null;
    },
  };
}

function writeProxyError(res, statusCode, code, message) {
  if (res.headersSent || res.writableEnded) return;
  const text = JSON.stringify({ error: code, message });
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function readConfig(config, key, fallback) {
  try {
    const value = config?.get?.(key, fallback);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}
