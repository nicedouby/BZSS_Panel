// -*- coding: utf-8 -*-
//
// Compatibility wrapper for the existing playtime module.
// Individual manual refresh jobs used to finish before the asynchronous Steam
// avatar request had written its result into the player database. The browser
// immediately reloaded the player row and therefore kept the old/missing avatar.

import { createPlaytimeModule as createBasePlaytimeModule } from "../playtime/index.js";

const TERMINAL_JOB_STATUS = new Set(["completed", "failed"]);
const DEFAULT_AVATAR_WAIT_MS = 8_000;
const DEFAULT_AVATAR_POLL_MS = 200;
const DEFAULT_JOB_WAIT_MS = 30_000;

export function createPlaytimeModule(context) {
  return createPlaytimeAvatarRefreshModule(context, createBasePlaytimeModule);
}

export function createPlaytimeAvatarRefreshModule(context, createBaseModule = createBasePlaytimeModule) {
  const baseModule = createBaseModule(context);
  const baseApi = baseModule?.api ?? {};
  const trackedJobs = new Map();
  const settings = readSettings(context?.config);

  function trackManualRefresh(job, payload = {}) {
    const jobId = text(job?.id);
    const steamID = normalizeSteamID(payload?.steamID ?? payload?.steamId ?? payload?.steam64);
    if (!jobId || !steamID || trackedJobs.has(jobId)) return job;

    const record = {
      jobId,
      steamID,
      result: null,
      promise: null,
    };
    record.promise = finalizeTrackedJob({
      record,
      baseApi,
      playerDatabase: context?.modules?.playerDatabase,
      settings,
    }).then((result) => {
      record.result = result;
      return result;
    }).catch((error) => {
      const fallback = baseApi.getJob?.(jobId) ?? job;
      record.result = {
        ...fallback,
        status: "failed",
        error: { message: error?.message ?? String(error) },
      };
      return record.result;
    });
    trackedJobs.set(jobId, record);
    return job;
  }

  const api = {
    ...baseApi,

    createLookupJob(payload = {}) {
      const job = baseApi.createLookupJob?.(payload);
      return trackManualRefresh(job, payload);
    },

    async refreshPlayer(payload = {}) {
      const job = await baseApi.refreshPlayer?.(payload);
      return trackManualRefresh(job, payload);
    },

    getJob(jobId) {
      const id = text(jobId);
      const baseJob = baseApi.getJob?.(id) ?? null;
      const tracked = trackedJobs.get(id);
      if (!tracked) return baseJob;
      if (tracked.result) return tracked.result;
      if (isTerminalJob(baseJob)) return markAvatarSyncPending(baseJob);
      return baseJob;
    },

    async waitForJob(jobId, waitMs) {
      const id = text(jobId);
      const baseJob = await baseApi.waitForJob?.(id, waitMs) ?? null;
      const tracked = trackedJobs.get(id);
      if (!tracked) return baseJob;
      if (tracked.result) return tracked.result;
      if (!isTerminalJob(baseJob)) return baseJob;

      const result = await waitAtMost(tracked.promise, clampWaitMs(waitMs, settings.avatarPollResponseWaitMs));
      if (result) return result;
      return markAvatarSyncPending(baseJob);
    },
  };

  return {
    ...baseModule,
    manifest: {
      ...(baseModule?.manifest ?? {}),
      version: `${baseModule?.manifest?.version ?? "0.2.0"}-avatar-refresh`,
      description: `${baseModule?.manifest?.description ?? "Steam playtime module."} Manual player refresh waits for Steam avatar persistence.`,
    },
    api,
  };
}

async function finalizeTrackedJob({ record, baseApi, playerDatabase, settings }) {
  const initialPlayer = await readCachedPlayer(playerDatabase, record.steamID);
  const initialAvatar = resolveAvatar(initialPlayer);
  const terminalJob = await waitForTerminalJob(baseApi, record.jobId, settings.jobWaitMs);
  if (!terminalJob || terminalJob.status === "failed") return terminalJob;

  const avatarState = await waitForAvatarPersistence({
    playerDatabase,
    steamID: record.steamID,
    initialAvatar,
    waitMs: settings.avatarWaitMs,
    pollMs: settings.avatarPollMs,
  });

  return {
    ...terminalJob,
    result: {
      ...(terminalJob?.result && typeof terminalJob.result === "object" ? terminalJob.result : {}),
      avatar: avatarState.avatar,
      avatarUpdated: avatarState.updated,
      avatarPersisted: avatarState.persisted,
      player: avatarState.player,
    },
  };
}

async function waitForTerminalJob(baseApi, jobId, waitMs) {
  const deadline = Date.now() + Math.max(0, Number(waitMs) || DEFAULT_JOB_WAIT_MS);
  let job = baseApi.getJob?.(jobId) ?? null;

  while (!isTerminalJob(job) && Date.now() < deadline) {
    const remaining = Math.max(0, deadline - Date.now());
    job = await baseApi.waitForJob?.(jobId, Math.min(3_000, remaining)) ?? baseApi.getJob?.(jobId) ?? job;
  }

  return job;
}

async function waitForAvatarPersistence({ playerDatabase, steamID, initialAvatar, waitMs, pollMs }) {
  const deadline = Date.now() + Math.max(0, Number(waitMs) || DEFAULT_AVATAR_WAIT_MS);
  let player = await readCachedPlayer(playerDatabase, steamID);
  let avatar = resolveAvatar(player);

  while (Date.now() < deadline) {
    if (avatar && (!initialAvatar || avatar !== initialAvatar)) {
      return { player, avatar, updated: avatar !== initialAvatar, persisted: true };
    }
    await delay(Math.max(50, Number(pollMs) || DEFAULT_AVATAR_POLL_MS));
    player = await readCachedPlayer(playerDatabase, steamID);
    avatar = resolveAvatar(player);
  }

  // Steam may legitimately return the same immutable avatar URL. Waiting the
  // full persistence window ensures the original fire-and-forget write had a
  // chance to finish before the frontend reloads the player record.
  return {
    player,
    avatar: avatar || initialAvatar || null,
    updated: Boolean(avatar && avatar !== initialAvatar),
    persisted: Boolean(avatar),
  };
}

async function readCachedPlayer(playerDatabase, steamID) {
  try {
    return await playerDatabase?.getCachedPlayer?.({ steamID }) ?? null;
  } catch {
    return null;
  }
}

function resolveAvatar(player) {
  return text(player?.steam_avatar ?? player?.steamAvatar ?? player?.avatar_medium ?? player?.avatarMedium) || null;
}

function markAvatarSyncPending(job) {
  if (!job || typeof job !== "object") return job;
  return {
    ...job,
    status: "running",
    progress: {
      ...(job.progress && typeof job.progress === "object" ? job.progress : {}),
      phase: "avatar",
      message: "正在同步 Steam 头像",
    },
  };
}

function isTerminalJob(job) {
  return TERMINAL_JOB_STATUS.has(text(job?.status).toLowerCase());
}

async function waitAtMost(promise, waitMs) {
  if (!promise) return null;
  const timeoutMs = Math.max(0, Number(waitMs) || 0);
  if (timeoutMs <= 0) return null;
  return Promise.race([
    promise,
    delay(timeoutMs).then(() => null),
  ]);
}

function readSettings(config) {
  const value = config?.get?.("modules.playtime", {}) ?? {};
  return {
    avatarWaitMs: positiveInteger(value.manualAvatarWaitMs, DEFAULT_AVATAR_WAIT_MS),
    avatarPollMs: positiveInteger(value.manualAvatarPollMs, DEFAULT_AVATAR_POLL_MS),
    avatarPollResponseWaitMs: positiveInteger(value.manualAvatarPollResponseWaitMs, 3_000),
    jobWaitMs: positiveInteger(value.manualRefreshJobWaitMs, DEFAULT_JOB_WAIT_MS),
  };
}

function normalizeSteamID(value) {
  const raw = text(value);
  return raw.match(/^\d{5,20}$/)?.[0] ?? raw.match(/\d{5,20}/)?.[0] ?? "";
}

function clampWaitMs(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.min(Math.floor(numeric), 30_000));
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function text(value) {
  return String(value ?? "").trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
