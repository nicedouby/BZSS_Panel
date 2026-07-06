import fs from "node:fs/promises";
import path from "node:path";

const MODULE_ID = "module.warmupReserveGrant";
const DEFAULT_STORE_FILE = "data/warmup-reserve-grant/store.json";
const DEFAULT_GRANTS_FILE = "data/warmup-reserve-grant/grants.jsonl";
const STORE_VERSION = 1;
const TICK_MS = 30_000;
const GRANT_RETRY_COOLDOWN_MS = 60_000;
const STEAM64_RE = /^7656119\d{10}$/;

export const DEFAULT_SETTINGS = {
  enabled: true,
  grantEveryMinutes: 120,
  grantDays: 1,
  reminderEveryMinutes: 5,
  maxEligiblePlayers: 50,
  requireWarmupMode: true,
  requireSquad: true,
  requireUnlockedSquad: true,
  group: "BZSSVIP",
  countMode: "accumulate_eligible_squad_member_time",
  timeWindows: [
    { enabled: true, start: "00:00", end: "23:59" },
  ],
  clearOfflineAfterHours: 24,
  maxRecentRecords: 500,
};

export function createWarmupReserveGrantModule({ core, modules, config, logger }) {
  const moduleLogger =
    logger ??
    core?.createLogger?.({
      moduleId: MODULE_ID,
      source: MODULE_ID,
      channel: "module",
    }) ??
    core?.logger ??
    console;

  const runtime = {
    settings: normalizeSettings(config?.get?.("modules.warmupReserveGrant", {}) ?? {}),
    store: createEmptyStore(),
    resolvedStoreFilePath: "",
    resolvedGrantsFilePath: "",
    timer: null,
    running: false,
    inTick: false,
    saveQueue: Promise.resolve(),
    lastTickAt: null,
    lastConditions: null,
    lastError: null,
    todayGrantCount: 0,
    squadStateSnapshot: null,
  };

  runtime.resolvedStoreFilePath = resolveConfigPath(runtime.settings.storeFilePath, DEFAULT_STORE_FILE);
  runtime.resolvedGrantsFilePath = resolveConfigPath(runtime.settings.grantsFilePath, DEFAULT_GRANTS_FILE);

  const api = {
    getState() {
      return buildState();
    },

    async updateSettings(patch = {}) {
      const nextSettings = normalizeSettings({
        ...runtime.settings,
        ...patch,
      });
      config?.set?.("modules.warmupReserveGrant", stripRuntimeOnlySettings(nextSettings));
      if (typeof config?.save === "function") await config.save();
      runtime.settings = nextSettings;
      runtime.resolvedStoreFilePath = resolveConfigPath(runtime.settings.storeFilePath, DEFAULT_STORE_FILE);
      runtime.resolvedGrantsFilePath = resolveConfigPath(runtime.settings.grantsFilePath, DEFAULT_GRANTS_FILE);
      runtime.store.settingsSnapshot = stripRuntimeOnlySettings(runtime.settings);
      await persistStore();
      restartTimer();
      return buildState({ message: "Warmup reserve grant settings saved." });
    },

    async clearRecords() {
      runtime.store.recentRecords = [];
      runtime.todayGrantCount = 0;
      await ensureDirectory(path.dirname(runtime.resolvedGrantsFilePath));
      await fs.writeFile(runtime.resolvedGrantsFilePath, "", "utf8");
      await persistStore();
      return buildState({ message: "Warmup reserve grant history cleared." });
    },

    async clearProgress() {
      runtime.store.progress = {};
      await persistStore();
      return buildState({ message: "Warmup accumulation progress cleared." });
    },

    async grantNow(input = {}, context = {}) {
      const steamId = normalizeSteamId(input.steamId ?? input.steamID ?? input.steam64);
      const existing = runtime.store.progress[steamId] ?? {};
      const name = String(input.name ?? existing.name ?? "").trim();
      const playerId = input.playerId ?? existing.playerId ?? null;
      const record = buildProgressRecord(runtime, { steamId, name, playerId }, Date.now());
      const durationDays = input.durationDays ? Number(input.durationDays) : null;
      const result = await grantReserveSlot(record, {
        manual: true,
        actor: context.actor ?? null,
        conditions: getCurrentConditions(),
        durationDays,
      });
      await persistStore();
      return {
        ok: true,
        success: true,
        message: "Manual grant completed: " + result.grantedDays + " day(s).",
        grant: result,
        state: buildState(),
      };
    },

    async tickNow() {
      await tick();
      return buildState();
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "暖服赠送预留位",
      kind: "module",
      version: "1.0.0",
      description: "按玩家在线暖服累计时长自动续费预留位。",
    },
    apiName: "warmupReserveGrant",
    api,

    async init() {
      await loadStoreFromDisk({ repair: true });
    },

    async start() {
      runtime.running = true;
      restartTimer();
      moduleLogger?.info?.(`[WarmupReserveGrant] started. enabled=${Boolean(runtime.settings.enabled)} file=${runtime.resolvedStoreFilePath}`);
    },

    async stop() {
      runtime.running = false;
      if (runtime.timer) {
        clearInterval(runtime.timer);
        runtime.timer = null;
      }
      await persistStore();
      moduleLogger?.info?.("[WarmupReserveGrant] stopped.");
    },
  };

  function restartTimer() {
    if (runtime.timer) {
      clearInterval(runtime.timer);
      runtime.timer = null;
    }
    if (!runtime.running || !runtime.settings.enabled) return;
    runtime.timer = setInterval(() => {
      void tick().catch((error) => {
        runtime.lastError = error?.message ?? String(error);
        moduleLogger?.warn?.(`[WarmupReserveGrant] tick failed: ${runtime.lastError}`);
      });
    }, TICK_MS);
    runtime.timer.unref?.();
    void tick().catch((error) => {
      runtime.lastError = error?.message ?? String(error);
    });
  }

  async function loadStoreFromDisk({ repair = false } = {}) {
    runtime.settings = normalizeSettings(config?.get?.("modules.warmupReserveGrant", runtime.settings) ?? runtime.settings);
    runtime.resolvedStoreFilePath = resolveConfigPath(runtime.settings.storeFilePath, DEFAULT_STORE_FILE);
    runtime.resolvedGrantsFilePath = resolveConfigPath(runtime.settings.grantsFilePath, DEFAULT_GRANTS_FILE);
    await ensureStoreFile(runtime.resolvedStoreFilePath, { repair });
    const rawText = await fs.readFile(runtime.resolvedStoreFilePath, "utf8");
    runtime.store = normalizeStore(JSON.parse(rawText));
    runtime.store.settingsSnapshot = stripRuntimeOnlySettings(runtime.settings);
    runtime.todayGrantCount = countTodayGrants(runtime.store.recentRecords);
    await ensureDirectory(path.dirname(runtime.resolvedGrantsFilePath));
    return runtime.store;
  }

  async function tick() {
    if (runtime.inTick) return;
    runtime.inTick = true;
    const now = Date.now();
    try {
      const webStatus = core?.webStatus?.getSnapshot?.() ?? {};
      const squadSnapshot = getSquadManagementSnapshot();
      const fallbackPlayersState = core?.runtimeState?.getPlayers?.() ?? {};
      const fallbackPlayers = Array.isArray(fallbackPlayersState.active) ? fallbackPlayersState.active : [];
      const playerCount = Number.isFinite(Number(webStatus.playerCount))
        ? Number(webStatus.playerCount)
        : (Array.isArray(squadSnapshot?.players) ? squadSnapshot.players.length : fallbackPlayers.length);
      const conditions = buildConditions({ webStatus, playerCount, settings: runtime.settings, now });
      runtime.lastConditions = conditions;
      runtime.lastTickAt = new Date(now).toISOString();
      runtime.squadStateSnapshot = squadSnapshot;

      const seenSteamIds = new Set();
      const deltaSeconds = Math.max(0, Math.round((now - resolveLastTickMs()) / 1000));
      const cappedDeltaSeconds = Math.min(deltaSeconds || 30, 120);
      const eligibleIndex = buildEligibilityIndex({
        squadState: squadSnapshot,
        fallbackPlayers,
      });

      for (const entry of eligibleIndex.entries) {
        const { player, squad, eligibility } = entry;
        if (!player?.steamId) continue;
        seenSteamIds.add(player.steamId);
        const record = buildProgressRecord(runtime, player, now);
        record.name = player.name || record.name;
        record.playerId = player.playerId ?? record.playerId ?? null;
        record.teamId = player.teamId ?? player.teamID ?? record.teamId ?? null;
        record.squadId = player.squadId ?? player.squadID ?? record.squadId ?? null;
        record.squadName = squad?.squadName ?? record.squadName ?? "";
        record.squadLocked = Boolean(squad?.locked);
        record.lastSeenAt = new Date(now).toISOString();
        record.pauseReason = eligibility.pauseReason;

        if (eligibility.eligible) {
          record.status = "active";
          record.eligibleSeconds = Math.max(0, Number(record.eligibleSeconds ?? 0)) + cappedDeltaSeconds;
          record.lastTickAt = new Date(now).toISOString();
          record.lastEligibleAt = new Date(now).toISOString();
          record.lastPauseAt = null;
          await maybeSendReminder(record, eligibility, now);
          await maybeGrant(record, conditions, eligibility, now);
        } else {
          record.status = "paused";
          record.lastTickAt = new Date(now).toISOString();
          record.lastPauseAt = new Date(now).toISOString();
          maybeRecordPause(record, eligibility.pauseReason, now, squad);
          await maybeSendInvalidReminder(record, eligibility, now);
        }
      }

      markOfflinePlayers(seenSteamIds, now);
      pruneOldOfflineProgress(now);
      runtime.store.lastTickMs = now;
      await persistStore();
      runtime.lastError = null;
    } finally {
      runtime.inTick = false;
    }
  }

  function resolveLastTickMs() {
    const value = Number(runtime.store.lastTickMs ?? 0);
    return Number.isFinite(value) && value > 0 ? value : Date.now() - TICK_MS;
  }

  function getSquadManagementSnapshot() {
    const api = modules?.squadManagement;
    if (typeof api?.getCurrent === "function") {
      try {
        return api.getCurrent();
      } catch (error) {
        moduleLogger?.warn?.("[WarmupReserveGrant] failed to read squadManagement.getCurrent(): " + (error?.message ?? error));
      }
    }
    if (typeof api?.getState === "function") {
      try {
        return api.getState();
      } catch (error) {
        moduleLogger?.warn?.("[WarmupReserveGrant] failed to read squadManagement.getState(): " + (error?.message ?? error));
      }
    }
    return null;
  }

  function buildEligibilityIndex({ squadState, fallbackPlayers = [] } = {}) {
    const squadMap = new Map();
    const squads = Array.isArray(squadState?.squads) ? squadState.squads : [];
    for (const squad of squads) {
      const teamId = Number(squad?.teamId ?? squad?.teamID);
      const squadId = Number(squad?.squadId ?? squad?.squadID);
      if (!Number.isFinite(teamId) || !Number.isFinite(squadId)) continue;
      squadMap.set(`${teamId}:${squadId}`, squad);
    }

    const sourcePlayers = Array.isArray(squadState?.players) && squadState.players.length > 0
      ? squadState.players
      : fallbackPlayers;
    const entries = [];
    for (const sourcePlayer of sourcePlayers) {
      const player = normalizePlayer(sourcePlayer);
      if (!player?.steamId) continue;
      const teamId = Number(sourcePlayer?.teamId ?? sourcePlayer?.teamID ?? player.teamId ?? NaN);
      const squadId = Number(sourcePlayer?.squadId ?? sourcePlayer?.squadID ?? player.squadId ?? NaN);
      const squad = Number.isFinite(teamId) && Number.isFinite(squadId)
        ? squadMap.get(`${teamId}:${squadId}`) ?? null
        : null;
      const eligibility = classifyWarmupEligibility({
        player: {
          ...player,
          teamId: Number.isFinite(teamId) ? teamId : null,
          squadId: Number.isFinite(squadId) ? squadId : null,
        },
        squad,
        settings: runtime.settings,
        globalConditions: runtime.lastConditions,
      });
      entries.push({
        player: {
          ...player,
          teamId: Number.isFinite(teamId) ? teamId : null,
          squadId: Number.isFinite(squadId) ? squadId : null,
        },
        squad,
        eligibility,
      });
    }

    return { entries, squadMap, sourcePlayers };
  }

  function classifyWarmupEligibility({ player, squad, settings, globalConditions }) {
    if (!globalConditions?.eligible) {
      return {
        eligible: false,
        pauseReason: globalConditions?.pauseReason ?? "paused",
        squad: squad ?? null,
      };
    }

    const teamId = Number(player?.teamId ?? player?.teamID);
    const squadId = Number(player?.squadId ?? player?.squadID);
    const hasSquad = Number.isFinite(teamId) && Number.isFinite(squadId) && squadId > 0;
    if (settings?.requireSquad !== false && !hasSquad) {
      return {
        eligible: false,
        pauseReason: "not_in_squad",
        squad: null,
      };
    }

    if (settings?.requireUnlockedSquad !== false && squad?.locked) {
      return {
        eligible: false,
        pauseReason: "squad_locked",
        squad,
      };
    }

    return {
      eligible: true,
      pauseReason: null,
      squad: squad ?? null,
    };
  }

  function buildEligibleReminderMessage(record, eligibility, doneMinutes, remainingMinutes) {
    const squadLabel = formatSquadLabel(eligibility?.squad ?? null);
    return 'Warmup squad accumulation: ' + doneMinutes + ' minutes completed, ' + remainingMinutes + ' minutes remaining before 1 day reserve is granted.' + squadLabel;
  }

  function buildInvalidReminderMessage(record, eligibility) {
    const squadLabel = formatSquadLabel(eligibility?.squad ?? null);
    if (eligibility?.pauseReason === 'squad_locked') {
      return 'Warmup mode: your squad is locked, so accumulation is paused. Move to an unlocked squad to continue.' + squadLabel;
    }
    if (eligibility?.pauseReason === 'not_in_squad') {
      return 'Warmup mode: you are not in a squad yet, so accumulation is paused. Join an unlocked squad to continue.' + squadLabel;
    }
    return 'Warmup mode: you are temporarily paused from accumulation.' + squadLabel;
  }

  function formatSquadLabel(squad) {
    if (!squad) return "";
    const squadName = String(squad.squadName ?? "").trim();
    const teamId = squad.teamId ?? squad.teamID ?? "";
    const squadId = squad.squadId ?? squad.squadID ?? "";
    const parts = [];
    if (teamId !== "") parts.push("T" + teamId);
    if (squadId !== "") parts.push("S" + squadId);
    const header = parts.length ? "[" + parts.join("/") + "]" : "";
    return header || squadName ? " (" + [header, squadName].filter(Boolean).join(" ") + ")" : "";
  }

  function getPlayerTeamId(record) {
    const value = Number(record?.teamId ?? record?.teamID ?? NaN);
    return Number.isFinite(value) ? value : null;
  }

  function getPlayerSquadId(record) {
    const value = Number(record?.squadId ?? record?.squadID ?? NaN);
    return Number.isFinite(value) ? value : null;
  }

  async function maybeSendReminder(record, eligibility, now) {
    const reminderSeconds = Math.max(60, Number(runtime.settings.reminderEveryMinutes) * 60);
    const lastReminderMs = Date.parse(record.lastReminderAt ?? '');
    if (Number.isFinite(lastReminderMs) && now - lastReminderMs < reminderSeconds * 1000) return;
    const thresholdSeconds = Math.max(60, Number(runtime.settings.grantEveryMinutes) * 60);
    const doneMinutes = Math.floor(Number(record.eligibleSeconds ?? 0) / 60);
    const remainingMinutes = Math.max(0, Math.ceil((thresholdSeconds - Number(record.eligibleSeconds ?? 0)) / 60));
    const message = buildEligibleReminderMessage(record, eligibility, doneMinutes, remainingMinutes);
    const result = await warnPlayer(record, message, 'warmup_reserve_grant_reminder');
    record.lastReminderAt = new Date(now).toISOString();
    appendRecentRecord({
      type: 'reminder',
      steamId: record.steamId,
      name: record.name,
      playerId: record.playerId,
      teamId: record.teamId ?? eligibility?.player?.teamId ?? null,
      squadId: record.squadId ?? eligibility?.player?.squadId ?? null,
      squadName: record.squadName ?? eligibility?.squad?.squadName ?? '',
      squadLocked: Boolean(record.squadLocked ?? eligibility?.squad?.locked ?? false),
      eligibleSeconds: Math.floor(record.eligibleSeconds ?? 0),
      result: result?.ok === false ? 'failed' : 'success',
      createdAt: new Date(now).toISOString(),
    });
  }

  async function maybeSendInvalidReminder(record, eligibility, now) {
    if (!eligibility?.pauseReason || !['not_in_squad', 'squad_locked'].includes(eligibility.pauseReason)) return;
    const reminderSeconds = Math.max(60, Number(runtime.settings.reminderEveryMinutes) * 60);
    const lastReminderMs = Date.parse(record.lastInvalidReminderAt ?? '');
    if (Number.isFinite(lastReminderMs) && now - lastReminderMs < reminderSeconds * 1000) return;
    const message = buildInvalidReminderMessage(record, eligibility);
    const result = await warnPlayer(record, message, 'warmup_reserve_grant_invalid');
    record.lastInvalidReminderAt = new Date(now).toISOString();
    appendRecentRecord({
      type: 'invalid_reminder',
      steamId: record.steamId,
      name: record.name,
      playerId: record.playerId,
      teamId: record.teamId ?? eligibility?.player?.teamId ?? null,
      squadId: record.squadId ?? eligibility?.player?.squadId ?? null,
      squadName: record.squadName ?? eligibility?.squad?.squadName ?? '',
      squadLocked: Boolean(record.squadLocked ?? eligibility?.squad?.locked ?? false),
      pauseReason: eligibility.pauseReason,
      eligibleSeconds: Math.floor(record.eligibleSeconds ?? 0),
      result: result?.ok === false ? 'failed' : 'success',
      createdAt: new Date(now).toISOString(),
    });
  }

  async function maybeGrant(record, conditions, eligibility, now) {
    const thresholdSeconds = Math.max(60, Number(runtime.settings.grantEveryMinutes) * 60);
    if (Number(record.eligibleSeconds ?? 0) < thresholdSeconds) return;
    const lastFailureMs = Date.parse(record.lastGrantFailedAt ?? '');
    if (Number.isFinite(lastFailureMs) && now - lastFailureMs < GRANT_RETRY_COOLDOWN_MS) return;

    try {
      const grant = await grantReserveSlot(record, {
        manual: false,
        conditions,
        eligibility,
      });
      record.eligibleSeconds = Math.max(0, Number(record.eligibleSeconds ?? 0) - thresholdSeconds);
      record.grantCount = Math.max(0, Number(record.grantCount ?? 0)) + 1;
      record.totalGrantedDays = Math.max(0, Number(record.totalGrantedDays ?? 0)) + Number(runtime.settings.grantDays);
      record.lastGrantedAt = grant.createdAt;
      record.lastGrantFailedAt = null;
      record.status = Number(record.eligibleSeconds) >= thresholdSeconds ? 'active' : 'granted';
      runtime.todayGrantCount += 1;
      await warnPlayer(
        record,
        'Warmup reserve granted: you have accumulated ' + runtime.settings.grantEveryMinutes + ' minutes and received ' + runtime.settings.grantDays + ' day(s).',
        'warmup_reserve_grant_success',
      );
    } catch (error) {
      record.lastGrantFailedAt = new Date(now).toISOString();
      runtime.lastError = error?.message ?? String(error);
      await appendAuditRecord({
        type: 'grant_failed',
        steamId: record.steamId,
        name: record.name,
        playerId: record.playerId,
        eligibleSeconds: Math.floor(record.eligibleSeconds ?? 0),
        error: runtime.lastError,
        conditions: summarizeConditions(conditions),
        createdAt: new Date(now).toISOString(),
      });
    }
  }

  async function grantReserveSlot(record, { manual = false, actor = null, conditions = null, durationDays = null, eligibility = null } = {}) {
    if (typeof modules?.reserveSlots?.upsertMember !== 'function') {
      const error = new Error('reserveSlots.upsertMember is unavailable.');
      error.code = 'ReserveSlotsUnavailable';
      throw error;
    }
    const grantedDays = Math.max(1, Number(durationDays ?? runtime.settings.grantDays) || 1);
    const resolvedName = await resolveGrantPlayerName(record);
    if (resolvedName) record.name = resolvedName;
    const result = await modules.reserveSlots.upsertMember({
      steamId: record.steamId,
      name: record.name,
      group: runtime.settings.group,
      durationDays: grantedDays,
    });
    const savedMember = result?.savedMember ?? result?.members?.find?.((item) => item?.steamId === record.steamId) ?? null;
    const createdAt = new Date().toISOString();
    const grantRecord = {
      type: 'grant',
      steamId: record.steamId,
      name: record.name,
      playerId: record.playerId ?? null,
      teamId: record.teamId ?? eligibility?.player?.teamId ?? null,
      squadId: record.squadId ?? eligibility?.player?.squadId ?? null,
      squadName: record.squadName ?? eligibility?.squad?.squadName ?? '',
      squadLocked: Boolean(record.squadLocked ?? eligibility?.squad?.locked ?? false),
      grantedDays,
      eligibleSeconds: Math.max(0, Number(runtime.settings.grantEveryMinutes) * 60),
      expireAt: savedMember?.expireAt ?? null,
      manual,
      grantReason: manual
        ? 'warmup manual grant: ' + grantedDays + ' days'
        : 'warmup auto grant: eligible squad member accumulated ' + runtime.settings.grantEveryMinutes + ' minutes',
      actor: normalizeActorName(actor),
      conditions: summarizeConditions(conditions ?? getCurrentConditions()),
      createdAt,
    };
    await appendAuditRecord(grantRecord);
    return grantRecord;
  }

  async function resolveGrantPlayerName(record) {
    const steamId = String(record?.steamId ?? '').trim();
    if (!steamId) return String(record?.name ?? '').trim();

    if (typeof modules?.playerDatabase?.listPlayersBySteamIDs === 'function') {
      try {
        const rows = await modules.playerDatabase.listPlayersBySteamIDs([steamId]);
        const row = Array.isArray(rows) ? rows.find((item) => {
          const rowSteamId = String(item?.steam_id ?? item?.steamID ?? item?.steam64 ?? '').trim();
          return rowSteamId === steamId;
        }) : null;
        const dbName = String(row?.current_name ?? row?.currentName ?? row?.name ?? '').trim();
        if (dbName) return dbName;
      } catch (error) {
        moduleLogger?.warn?.('[WarmupReserveGrant] failed to resolve player name from database: ' + (error?.message ?? error));
      }
    }

    const runtimePlayer = core?.runtimeState?.getPlayers?.()?.bySteamID?.[steamId] ?? null;
    const runtimeName = String(runtimePlayer?.name ?? '').trim();
    return runtimeName || String(record?.name ?? '').trim();
  }

  async function warnPlayer(record, message, reason) {
    const sender = modules?.adminWarn?.warnPlayer ?? modules?.adminWarn?.sendAdminWarn;
    if (typeof sender !== 'function') return { ok: false, skipped: true };
    return sender.call(modules.adminWarn, {
      targetName: record.name,
      targetPlayerId: record.playerId,
      targetSteamId: record.steamId,
      message,
      reason,
      sourceModule: MODULE_ID,
      system: true,
    });
  }

  function ensureProgressRecord(player, now) {
    const steamId = normalizeSteamId(player.steamId);
    if (!runtime.store.progress[steamId]) {
      runtime.store.progress[steamId] = {
        steamId,
        name: player.name ?? '',
        playerId: player.playerId ?? null,
        teamId: player.teamId ?? player.teamID ?? null,
        squadId: player.squadId ?? player.squadID ?? null,
        squadName: '',
        squadLocked: false,
        eligibleSeconds: 0,
        lastSeenAt: new Date(now).toISOString(),
        lastTickAt: null,
        lastReminderAt: null,
        lastInvalidReminderAt: null,
        grantCount: 0,
        totalGrantedDays: 0,
        lastGrantedAt: null,
        lastEligibleAt: null,
        lastPauseAt: null,
        lastGrantFailedAt: null,
        status: 'active',
        pauseReason: null,
      };
    }
    return runtime.store.progress[steamId];
  }

  function maybeRecordPause(record, pauseReason, now, squad = null) {
    if (record.pauseReason === pauseReason) return;
    record.pauseReason = pauseReason;
    appendRecentRecord({
      type: 'pause',
      steamId: record.steamId,
      name: record.name,
      playerId: record.playerId,
      teamId: record.teamId ?? getPlayerTeamId(record) ?? null,
      squadId: record.squadId ?? getPlayerSquadId(record) ?? null,
      squadName: record.squadName ?? squad?.squadName ?? '',
      squadLocked: Boolean(record.squadLocked ?? squad?.locked ?? false),
      pauseReason,
      eligibleSeconds: Math.floor(record.eligibleSeconds ?? 0),
      createdAt: new Date(now).toISOString(),
    });
  }

  function markOfflinePlayers(seenSteamIds, now) {
    for (const record of Object.values(runtime.store.progress)) {
      if (seenSteamIds.has(record.steamId)) continue;
      if (record.status !== 'offline') {
        record.status = 'offline';
        appendRecentRecord({
          type: 'offline',
          steamId: record.steamId,
          name: record.name,
          playerId: record.playerId,
          teamId: record.teamId ?? null,
          squadId: record.squadId ?? null,
          squadName: record.squadName ?? '',
          squadLocked: Boolean(record.squadLocked ?? false),
          eligibleSeconds: Math.floor(record.eligibleSeconds ?? 0),
          createdAt: new Date(now).toISOString(),
        });
      }
    }
  }

  function pruneOldOfflineProgress(now) {
    const ttlMs = Math.max(1, Number(runtime.settings.clearOfflineAfterHours) || 24) * 60 * 60 * 1000;
    for (const [steamId, record] of Object.entries(runtime.store.progress)) {
      if (record.status !== 'offline') continue;
      const lastSeenMs = Date.parse(record.lastSeenAt ?? '');
      if (Number.isFinite(lastSeenMs) && now - lastSeenMs > ttlMs) {
        delete runtime.store.progress[steamId];
      }
    }
  }

  function getCurrentConditions() {
    const webStatus = core?.webStatus?.getSnapshot?.() ?? {};
    const squadSnapshot = runtime.squadStateSnapshot ?? getSquadManagementSnapshot();
    const playerCount = Number.isFinite(Number(webStatus.playerCount))
      ? Number(webStatus.playerCount)
      : Array.isArray(squadSnapshot?.players)
        ? squadSnapshot.players.length
        : (core?.runtimeState?.getPlayers?.()?.active ?? []).length;
    return buildConditions({ webStatus, playerCount, settings: runtime.settings, now: Date.now() });
  }

  function buildState(extra = {}) {
    const progress = Object.values(runtime.store.progress)
      .sort((a, b) => Number(b.eligibleSeconds ?? 0) - Number(a.eligibleSeconds ?? 0));
    const conditions = runtime.lastConditions ?? getCurrentConditions();
    return {
      ok: true,
      config: stripRuntimeOnlySettings(runtime.settings),
      paths: {
        storeFilePath: runtime.resolvedStoreFilePath,
        grantsFilePath: runtime.resolvedGrantsFilePath,
      },
      status: {
        running: runtime.running,
        enabled: Boolean(runtime.settings.enabled),
        inTick: runtime.inTick,
        lastTickAt: runtime.lastTickAt,
        lastError: runtime.lastError,
        conditions,
        accumulatingCount: progress.filter((record) => record.status === 'active').length,
        todayGrantCount: runtime.todayGrantCount,
      },
      progress,
      records: runtime.store.recentRecords,
      summary: {
        progressCount: progress.length,
        activeCount: progress.filter((record) => record.status === 'active').length,
        pausedCount: progress.filter((record) => record.status === 'paused').length,
        offlineCount: progress.filter((record) => record.status === 'offline').length,
        grantCount: progress.reduce((sum, record) => sum + Number(record.grantCount ?? 0), 0),
        totalGrantedDays: progress.reduce((sum, record) => sum + Number(record.totalGrantedDays ?? 0), 0),
      },
      ...extra,
    };
  }

  async function appendAuditRecord(record) {

    appendRecentRecord(record);
    await ensureDirectory(path.dirname(runtime.resolvedGrantsFilePath));
    await fs.appendFile(runtime.resolvedGrantsFilePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  function appendRecentRecord(record) {
    runtime.store.recentRecords.unshift(record);
    const limit = Math.max(1, Number(runtime.settings.maxRecentRecords) || 500);
    runtime.store.recentRecords = runtime.store.recentRecords.slice(0, limit);
  }

  async function persistStore() {
    runtime.store.version = STORE_VERSION;
    runtime.store.settingsSnapshot = stripRuntimeOnlySettings(runtime.settings);
    runtime.store.updatedAt = new Date().toISOString();
    runtime.saveQueue = runtime.saveQueue.then(async () => {
      await ensureDirectory(path.dirname(runtime.resolvedStoreFilePath));
      const tmpPath = `${runtime.resolvedStoreFilePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmpPath, `${JSON.stringify(runtime.store, null, 2)}\n`, "utf8");
      await fs.rename(tmpPath, runtime.resolvedStoreFilePath);
    });
    return runtime.saveQueue;
  }
}

function buildProgressRecord(runtime, player, now) {
  const steamId = normalizeSteamId(player.steamId);
  if (!runtime.store.progress[steamId]) {
    runtime.store.progress[steamId] = {
      steamId,
      name: player.name ?? "",
      playerId: player.playerId ?? null,
      teamId: player.teamId ?? player.teamID ?? null,
      squadId: player.squadId ?? player.squadID ?? null,
      squadName: "",
      squadLocked: false,
      eligibleSeconds: 0,
      lastSeenAt: new Date(now).toISOString(),
      lastTickAt: null,
      lastReminderAt: null,
      lastInvalidReminderAt: null,
      grantCount: 0,
      totalGrantedDays: 0,
      lastGrantedAt: null,
      lastEligibleAt: null,
      lastPauseAt: null,
      lastGrantFailedAt: null,
      status: "active",
      pauseReason: null,
    };
  }
  return runtime.store.progress[steamId];
}

function buildConditions({ webStatus, playerCount, settings, now }) {
  const isWarmup = Boolean(webStatus?.isWarmup);
  const matchedTimeWindow = isWithinAnyTimeWindow(settings.timeWindows, new Date(now));
  const belowPlayerLimit = Number(playerCount) < Number(settings.maxEligiblePlayers);
  const warmupOk = !settings.requireWarmupMode || isWarmup;
  let pauseReason = null;
  if (!settings.enabled) pauseReason = "disabled";
  else if (!warmupOk) pauseReason = "not_warmup";
  else if (!belowPlayerLimit) pauseReason = "player_limit";
  else if (!matchedTimeWindow) pauseReason = "time_window";
  return {
    eligible: !pauseReason,
    isWarmup,
    playerCount,
    maxEligiblePlayers: Number(settings.maxEligiblePlayers),
    belowPlayerLimit,
    matchedTimeWindow,
    pauseReason,
    checkedAt: new Date(now).toISOString(),
  };
}

export function isWithinAnyTimeWindow(windows, date = new Date()) {
  const enabledWindows = (Array.isArray(windows) ? windows : [])
    .map((item) => normalizeTimeWindow(item))
    .filter((item) => item.enabled);
  if (!enabledWindows.length) return true;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return enabledWindows.some((window) => isMinuteWithinWindow(minutes, window));
}

export function isMinuteWithinWindow(nowMinutes, window) {
  const start = parseTimeToMinutes(window.start);
  const end = parseTimeToMinutes(window.end);
  if (start <= end) return nowMinutes >= start && nowMinutes <= end;
  return nowMinutes >= start || nowMinutes <= end;
}

function normalizeSettings(input = {}) {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...input,
  };
  return {
    enabled: Boolean(settings.enabled),
    grantEveryMinutes: clampNumber(settings.grantEveryMinutes, DEFAULT_SETTINGS.grantEveryMinutes, 1, 24 * 60),
    grantDays: clampNumber(settings.grantDays, 1, 1, 3650),
    reminderEveryMinutes: clampNumber(settings.reminderEveryMinutes, DEFAULT_SETTINGS.reminderEveryMinutes, 1, 24 * 60),
    maxEligiblePlayers: clampNumber(settings.maxEligiblePlayers, 50, 1, 200),
    requireWarmupMode: Boolean(settings.requireWarmupMode),
    requireSquad: Boolean(settings.requireSquad ?? DEFAULT_SETTINGS.requireSquad),
    requireUnlockedSquad: Boolean(settings.requireUnlockedSquad ?? DEFAULT_SETTINGS.requireUnlockedSquad),
    group: String(settings.group ?? 'BZSSVIP').trim() || 'BZSSVIP',
    countMode: String(settings.countMode ?? DEFAULT_SETTINGS.countMode).trim() || DEFAULT_SETTINGS.countMode,
    timeWindows: normalizeTimeWindows(settings.timeWindows),
    clearOfflineAfterHours: clampNumber(settings.clearOfflineAfterHours, 24, 1, 24 * 30),
    maxRecentRecords: clampNumber(settings.maxRecentRecords, 500, 10, 5000),
    storeFilePath: String(settings.storeFilePath ?? DEFAULT_STORE_FILE).trim() || DEFAULT_STORE_FILE,
    grantsFilePath: String(settings.grantsFilePath ?? DEFAULT_GRANTS_FILE).trim() || DEFAULT_GRANTS_FILE,
  };
}

function normalizeStore(input = {}) {
  const store = {
    ...createEmptyStore(),
    ...(input && typeof input === "object" ? input : {}),
  };
  const progress = {};
  for (const item of Object.values(store.progress ?? {})) {
    if (!item?.steamId || !STEAM64_RE.test(String(item.steamId))) continue;
    progress[item.steamId] = {
      steamId: item.steamId,
      name: String(item.name ?? ""),
      playerId: item.playerId ?? null,
      teamId: item.teamId ?? null,
      squadId: item.squadId ?? null,
      squadName: String(item.squadName ?? ""),
      squadLocked: Boolean(item.squadLocked ?? false),
      eligibleSeconds: Math.max(0, Number(item.eligibleSeconds ?? 0) || 0),
      lastSeenAt: item.lastSeenAt ?? null,
      lastTickAt: item.lastTickAt ?? null,
      lastReminderAt: item.lastReminderAt ?? null,
      lastInvalidReminderAt: item.lastInvalidReminderAt ?? null,
      grantCount: Math.max(0, Number(item.grantCount ?? 0) || 0),
      totalGrantedDays: Math.max(0, Number(item.totalGrantedDays ?? 0) || 0),
      lastGrantedAt: item.lastGrantedAt ?? null,
      lastEligibleAt: item.lastEligibleAt ?? null,
      lastPauseAt: item.lastPauseAt ?? null,
      lastGrantFailedAt: item.lastGrantFailedAt ?? null,
      status: normalizeStatus(item.status),
      pauseReason: item.pauseReason ?? null,
    };
  }
  store.progress = progress;
  store.recentRecords = Array.isArray(store.recentRecords) ? store.recentRecords.slice(0, 5000) : [];
  return store;
}

function createEmptyStore() {
  return {
    version: STORE_VERSION,
    settingsSnapshot: stripRuntimeOnlySettings(DEFAULT_SETTINGS),
    progress: {},
    recentRecords: [],
    lastTickMs: 0,
    updatedAt: null,
  };
}

function normalizePlayer(player) {
  const steamId = String(player?.steamId ?? player?.steamID ?? player?.steam64 ?? "").trim();
  if (!STEAM64_RE.test(steamId)) return null;
  return {
    steamId,
    name: String(player?.name ?? player?.playerName ?? "").trim(),
    playerId: player?.playerId ?? player?.playerID ?? player?.id ?? null,
  };
}

function normalizeSteamId(value) {
  const text = String(value ?? "").trim();
  if (!STEAM64_RE.test(text)) {
    const error = new Error("Steam64 must be a valid 17-digit SteamID64.");
    error.statusCode = 400;
    error.code = "InvalidSteam64";
    throw error;
  }
  return text;
}

function normalizeStatus(value) {
  const text = String(value ?? "").trim();
  if (["active", "paused", "granted", "offline"].includes(text)) return text;
  return "offline";
}

function normalizeTimeWindows(input) {
  const list = Array.isArray(input) ? input : DEFAULT_SETTINGS.timeWindows;
  const normalized = list.map((item) => normalizeTimeWindow(item)).filter(Boolean);
  return normalized.length ? normalized : DEFAULT_SETTINGS.timeWindows;
}

function normalizeTimeWindow(item = {}) {
  return {
    enabled: item?.enabled !== false,
    start: normalizeTimeText(item?.start, "00:00"),
    end: normalizeTimeText(item?.end, "23:59"),
  };
}

function normalizeTimeText(value, fallback) {
  let text = String(value ?? "").trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(text)) {
    text = text.slice(0, 5);
  }
  return /^\d{2}:\d{2}$/.test(text) && parseTimeToMinutes(text) != null ? text : fallback;
}

function parseTimeToMinutes(text) {
  const match = String(text ?? "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function stripRuntimeOnlySettings(settings) {
  const {
    enabled,
    grantEveryMinutes,
    grantDays,
    reminderEveryMinutes,
    maxEligiblePlayers,
    requireWarmupMode,
    requireSquad,
    requireUnlockedSquad,
    group,
    countMode,
    timeWindows,
    clearOfflineAfterHours,
    maxRecentRecords,
  } = settings;
  return {
    enabled,
    grantEveryMinutes,
    grantDays,
    reminderEveryMinutes,
    maxEligiblePlayers,
    requireWarmupMode,
    requireSquad,
    requireUnlockedSquad,
    group,
    countMode,
    timeWindows,
    clearOfflineAfterHours,
    maxRecentRecords,
  };
}

function summarizeConditions(conditions) {
  return {
    isWarmup: Boolean(conditions?.isWarmup),
    playerCount: Number(conditions?.playerCount ?? 0),
    matchedTimeWindow: Boolean(conditions?.matchedTimeWindow),
  };
}

function normalizeActorName(actor) {
  if (!actor || typeof actor !== "object") return "system";
  return String(actor.username ?? actor.name ?? actor.id ?? "system").trim() || "system";
}

function countTodayGrants(records = []) {
  const today = new Date().toISOString().slice(0, 10);
  return records.filter((record) => record?.type === "grant" && String(record.createdAt ?? "").slice(0, 10) === today).length;
}

async function ensureStoreFile(filePath, { repair = false } = {}) {
  await ensureDirectory(path.dirname(filePath));
  try {
    await fs.access(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await fs.writeFile(filePath, `${JSON.stringify(createEmptyStore(), null, 2)}\n`, "utf8");
    return;
  }
  if (!repair) return;
  try {
    JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    await fs.writeFile(filePath, `${JSON.stringify(createEmptyStore(), null, 2)}\n`, "utf8");
  }
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function resolveConfigPath(value, fallback) {
  const raw = String(value ?? fallback ?? "").trim() || fallback;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}
