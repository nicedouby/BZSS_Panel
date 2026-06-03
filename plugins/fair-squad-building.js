// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.fairSquadBuilding";
const API_NAME = "fairSquadBuilding";
const PAGE_ROUTE = "/plugins/fair-squad-building";
const PAGE_ORDER = 135;
const DEFAULT_PERMISSION = {
  disband: "squad.disband",
  kick: "squad.kick",
  remove: "squad.remove",
  switch: "squad.switch",
};

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger
    ?? core?.createLogger?.({
      moduleId: PLUGIN_ID,
      source: PLUGIN_ID,
      channel: "module",
    })
    ?? core?.logger
    ?? console;

  const pluginConfig = readConfig(config);
  let pageRegistered = false;

  function getDefaultServerId() {
    return normalizeText(core?.webStatus?.serverId ?? core?.webStatus?.getSnapshot?.()?.serverId ?? "");
  }

  function getServerId(serverId) {
    return normalizeText(serverId || getDefaultServerId());
  }

  function getSquadManagement() {
    return modules?.squadManagement ?? null;
  }

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
      && core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }

  function isActive() {
    return Boolean(pluginConfig.enabled) && isSubscribed() && Boolean(getSquadManagement());
  }

  function buildPluginState() {
    return {
      id: PLUGIN_ID,
      apiName: API_NAME,
      route: PAGE_ROUTE,
      enabled: Boolean(pluginConfig.enabled),
      subscribed: isSubscribed(),
      active: isActive(),
      dependencyAvailable: Boolean(getSquadManagement()),
    };
  }

  async function getPageState(serverId, actor = null) {
    const squadManagement = getSquadManagement();
    const resolvedServerId = getServerId(serverId);
    const pluginState = buildPluginState();

    if (!squadManagement?.getState) {
      return {
        plugin: pluginState,
        serverId: resolvedServerId,
        viewer: buildViewer(core, actor, null),
        policy: buildPolicy(null),
        summary: buildSummary(null, [], []),
        currentMatchId: "",
        squads: [],
        violations: [],
        creators: [],
        recentActions: [],
      };
    }

    const state = squadManagement.getState(resolvedServerId);
    const recordsResponse = await listRecords({
      serverId: resolvedServerId,
      matchId: state?.currentMatchId ?? state?.matchId ?? "",
      kind: "squad_created",
      limit: 1000,
      offset: 0,
    });

    const policy = buildPolicy(state);
    const viewer = buildViewer(core, actor, state);
    const squads = Array.isArray(state?.squads) ? state.squads.map(cloneShallow) : [];
    const creators = enrichCreators(Array.isArray(state?.creators) ? state.creators : [], policy.kickThreshold);
    const creationRecordIndex = buildCreationRecordIndex(recordsResponse?.records ?? []);
    const violations = [
      ...deriveSquadViolations(squads, policy, creationRecordIndex),
      ...deriveCreatorViolations(creators, policy.kickThreshold),
    ];

    return {
      plugin: pluginState,
      serverId: resolvedServerId,
      viewer,
      policy,
      summary: buildSummary(state, violations, creators),
      currentMatchId: normalizeText(state?.currentMatchId ?? state?.matchId),
      squads,
      violations,
      creators,
      recentActions: Array.isArray(state?.recentActions) ? state.recentActions.map(cloneShallow) : [],
    };
  }

  async function listRecords(query = {}) {
    const squadManagement = getSquadManagement();
    if (!squadManagement?.getRecords) {
      return buildEmptyRecordsResponse(query);
    }

    return await squadManagement.getRecords({
      serverId: getServerId(query.serverId),
      matchId: normalizeText(query.matchId),
      kind: normalizeText(query.kind) || "all",
      limit: query.limit ?? 500,
      offset: query.offset ?? 0,
    });
  }

  async function executeAction(payload = {}, actor = null) {
    const squadManagement = getSquadManagement();
    if (!squadManagement?.executeAction) {
      return {
        ok: false,
        error: "SquadManagementUnavailable",
        message: "Squad management module is not loaded.",
        serverId: getServerId(payload.serverId),
      };
    }

    return await squadManagement.executeAction({
      ...payload,
      actor,
      serverId: getServerId(payload.serverId),
      source: normalizeText(payload.source) || "web.fairSquadBuilding",
      system: false,
    });
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "公平建队",
      kind: "plugin",
      version: "0.1.0",
      description: "独立的公平建队插件页，复用 SquadManagement 状态与动作网关。",
      category: "Plugin",
    },
    apiName: API_NAME,
    api: {
      getPageState,
      listRecords,
      executeAction,
    },
    async init() {},
    async start() {
      if (!pluginConfig.enabled || pageRegistered) return;
      core?.webRegistry?.registerPage?.({
        id: "web.fairSquadBuilding",
        title: "公平建队",
        route: PAGE_ROUTE,
        pageModule: "/pages/fair-squad-building.js",
        source: PLUGIN_ID,
        description: "公平建队规则窗口、违规候选、创建者排行与动作执行页面。",
        enabled: true,
        order: PAGE_ORDER,
        icon: "FSB",
      });
      pageRegistered = true;
      pluginLogger?.info?.("[FairSquadBuilding] plugin started");
    },
    async stop() {
      pluginLogger?.info?.("[FairSquadBuilding] plugin stopped");
    },
  };
}

function readConfig(config) {
  const pluginConfig = config?.get?.("plugins.fairSquadBuilding", {}) ?? {};
  return {
    enabled: pluginConfig.enabled !== false,
  };
}

function buildViewer(core, actor, state) {
  const authManager = core?.authManager;
  const user = actor ?? null;
  const isSuperAdmin = Boolean(user?.isSuperAdmin || authManager?.hasEverything?.(user));
  const disbandPermission = normalizeText(state?.disbandPermission) || DEFAULT_PERMISSION.disband;
  const kickPermission = normalizeText(state?.kickPermission) || DEFAULT_PERMISSION.kick;
  const removePermission = normalizeText(state?.removePermission) || DEFAULT_PERMISSION.remove;
  const switchPermission = normalizeText(state?.switchPermission) || DEFAULT_PERMISSION.switch;

  return {
    username: normalizeText(user?.username),
    role: normalizeText(user?.role),
    isSuperAdmin,
    canDisband: Boolean(isSuperAdmin || authManager?.hasPermission?.(user, disbandPermission)),
    canKick: Boolean(isSuperAdmin || authManager?.hasPermission?.(user, kickPermission)),
    canRemove: Boolean(isSuperAdmin || authManager?.hasPermission?.(user, removePermission)),
    canSwitch: Boolean(isSuperAdmin || authManager?.hasPermission?.(user, switchPermission)),
    permissions: Array.isArray(user?.permissions) ? [...user.permissions] : [],
  };
}

function buildPolicy(state) {
  return {
    enforcementEnabled: Boolean(state?.enforcementEnabled),
    window: normalizeText(state?.window) || "waiting",
    logClockSeconds: normalizeNullableNumber(state?.logClockSeconds),
    noBuildUntilSeconds: normalizePositiveInteger(state?.noBuildUntilSeconds, 0),
    infantryOnlyUntilSeconds: normalizePositiveInteger(state?.infantryOnlyUntilSeconds, 0),
    kickThreshold: normalizePositiveInteger(state?.kickThreshold, 0),
    allowedInfantryNames: Array.isArray(state?.allowedInfantryNames) ? state.allowedInfantryNames.map((value) => normalizeText(value)).filter(Boolean) : [],
  };
}

function buildSummary(state, violations, creators) {
  return {
    currentSquads: Number(state?.summary?.currentSquads ?? state?.squads?.length ?? 0),
    trackedCreations: Number(state?.summary?.trackedCreations ?? 0),
    violations: Array.isArray(violations) ? violations.length : 0,
    creatorsOverThreshold: Array.isArray(creators) ? creators.filter((creator) => creator.overThreshold).length : 0,
  };
}

function enrichCreators(creators, kickThreshold) {
  return creators.map((creator) => {
    const count = normalizePositiveInteger(creator?.count, 0);
    const threshold = normalizePositiveInteger(kickThreshold, 0);
    const overThreshold = threshold > 0 && count > threshold;
    return {
      ...cloneShallow(creator),
      threshold,
      overThreshold,
      excessCount: overThreshold ? count - threshold : 0,
    };
  });
}

function deriveSquadViolations(squads, policy, creationRecordIndex) {
  const violations = [];

  for (const squad of squads) {
    if (!squad?.active) continue;
    const creationRecord = findCreationRecordForSquad(squad, creationRecordIndex);
    const logSeconds = normalizeNullableNumber(creationRecord?.logSeconds);
    if (logSeconds == null) continue;

    const teamId = normalizeNullableNumber(squad?.teamId);
    const squadId = normalizeNullableNumber(squad?.squadId);
    const squadName = normalizeText(squad?.squadName);
    const creatorName = normalizeText(squad?.creatorName);
    const reasonSuffix = `T${teamId ?? "?"} S${squadId ?? "?"} ${squadName || "Unknown Squad"}`.trim();

    if (policy.noBuildUntilSeconds > 0 && logSeconds < policy.noBuildUntilSeconds) {
      violations.push({
        id: `no_build:${teamId}:${squadId}:${normalizeNullableNumber(squad?.generation) ?? 1}`,
        kind: "no_build",
        title: "No Build 时间窗违规",
        reason: `${reasonSuffix} 在 ${logSeconds}s 创建，早于 ${policy.noBuildUntilSeconds}s`,
        teamId,
        squadId,
        squadName,
        creatorName,
        creatorKey: normalizeText(squad?.creatorKey),
        steamId: normalizeText(squad?.creatorSteamId),
        eosId: normalizeText(squad?.creatorEosId),
        createdLogSeconds: logSeconds,
        threshold: policy.noBuildUntilSeconds,
        squad: cloneShallow(squad),
        creator: null,
      });
    }

    const squadNature = normalizeText(squad?.squadNature).toLowerCase();
    const isAllowedInfantry = squadNature === "infantry"
      || matchesAllowedInfantryName(squadName, policy.allowedInfantryNames);

    if (policy.infantryOnlyUntilSeconds > 0 && logSeconds < policy.infantryOnlyUntilSeconds && !isAllowedInfantry) {
      violations.push({
        id: `infantry_only:${teamId}:${squadId}:${normalizeNullableNumber(squad?.generation) ?? 1}`,
        kind: "infantry_only",
        title: "Infantry Only 时间窗违规",
        reason: `${reasonSuffix} 在 ${logSeconds}s 创建，且队名性质为 ${normalizeText(squad?.squadNatureLabel) || squadNature || "unknown"}`,
        teamId,
        squadId,
        squadName,
        creatorName,
        creatorKey: normalizeText(squad?.creatorKey),
        steamId: normalizeText(squad?.creatorSteamId),
        eosId: normalizeText(squad?.creatorEosId),
        createdLogSeconds: logSeconds,
        threshold: policy.infantryOnlyUntilSeconds,
        squad: cloneShallow(squad),
        creator: null,
      });
    }
  }

  return violations;
}

function deriveCreatorViolations(creators, kickThreshold) {
  if (!kickThreshold) return [];

  return creators
    .filter((creator) => creator.overThreshold)
    .map((creator) => ({
      id: `creator_threshold:${normalizeText(creator?.creatorKey)}`,
      kind: "creator_threshold",
      title: "创建次数超阈值",
      reason: `${normalizeText(creator?.creatorName) || "Unknown"} 已创建 ${normalizePositiveInteger(creator?.count, 0)} 个小队，阈值 ${kickThreshold}`,
      teamId: normalizeNullableNumber(creator?.latestTeamId),
      squadId: normalizeNullableNumber(creator?.latestSquadId),
      squadName: normalizeText(creator?.latestSquadName),
      creatorName: normalizeText(creator?.creatorName),
      creatorKey: normalizeText(creator?.creatorKey),
      steamId: normalizeText(creator?.steamId),
      eosId: normalizeText(creator?.eosId),
      createdLogSeconds: null,
      threshold: kickThreshold,
      squad: null,
      creator: cloneShallow(creator),
    }));
}

function buildCreationRecordIndex(records) {
  const byGeneration = new Map();
  const bySlot = new Map();

  for (const record of Array.isArray(records) ? records : []) {
    const slotKey = buildSlotKey(record?.teamId, record?.squadId);
    const generationKey = `${slotKey}:${normalizeNullableNumber(record?.generation) ?? 1}`;
    const currentByGeneration = byGeneration.get(generationKey);
    if (!currentByGeneration || recordTimeValue(record) >= recordTimeValue(currentByGeneration)) {
      byGeneration.set(generationKey, record);
    }
    const currentBySlot = bySlot.get(slotKey);
    if (!currentBySlot || recordTimeValue(record) >= recordTimeValue(currentBySlot)) {
      bySlot.set(slotKey, record);
    }
  }

  return {
    byGeneration,
    bySlot,
  };
}

function findCreationRecordForSquad(squad, creationRecordIndex) {
  const slotKey = buildSlotKey(squad?.teamId, squad?.squadId);
  const generationKey = `${slotKey}:${normalizeNullableNumber(squad?.generation) ?? 1}`;
  return creationRecordIndex.byGeneration.get(generationKey)
    ?? creationRecordIndex.bySlot.get(slotKey)
    ?? null;
}

function buildSlotKey(teamId, squadId) {
  return `${normalizeNullableNumber(teamId) ?? "?"}:${normalizeNullableNumber(squadId) ?? "?"}`;
}

function recordTimeValue(record) {
  const timeMs = Number(record?.timeMs ?? record?.createdAtMs ?? Date.parse(record?.time ?? ""));
  return Number.isFinite(timeMs) ? timeMs : 0;
}

function matchesAllowedInfantryName(squadName, allowedNames) {
  const normalizedSquadName = normalizeText(squadName).toLowerCase();
  if (!normalizedSquadName) return false;
  return allowedNames.some((name) => normalizedSquadName.includes(normalizeText(name).toLowerCase()));
}

function buildEmptyRecordsResponse(query = {}) {
  return {
    ok: true,
    kind: normalizeText(query.kind) || "all",
    limit: normalizePositiveInteger(query.limit, 500),
    offset: normalizePositiveInteger(query.offset, 0),
    total: 0,
    summary: {
      total: 0,
      created: 0,
      disbanded: 0,
      kicked: 0,
      removed: 0,
      switched: 0,
      actions: 0,
      success: 0,
      failed: 0,
      lastEventAt: "",
    },
    records: [],
  };
}

function cloneShallow(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneShallow);
  return { ...value };
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeNullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return Math.trunc(Number(fallback) || 0);
  return Math.trunc(number);
}
