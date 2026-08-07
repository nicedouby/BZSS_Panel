// -*- coding: utf-8 -*-

const DEFAULT_MAX_RECORDS = 300;

export function createKillManageModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.killManage",
    source: "module.killManage",
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = config?.get?.("modules.killManage", {}) ?? {};
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const maxRecords = Math.max(1, Number(moduleConfig.maxRecords ?? DEFAULT_MAX_RECORDS));
  const store = new KillManageMemoryStore(maxRecords);

  const api = {
    async killPlayer(input = {}) {
      return killPlayer(input);
    },

    async killRecord(input = {}) {
      return api.killPlayer(input);
    },

    getRecentKills(serverId = "", limit = 50) {
      return store.query({ serverId, limit });
    },

    clear() {
      return { ok: true, cleared: store.clear() };
    },
  };

  async function killPlayer(input = {}) {
    const serverId = String(input.serverId ?? "").trim();
    const targetName = String(input.targetName ?? "").trim();
    const targetSteamId = String(input.targetSteamId ?? "").trim();
    const targetEosId = String(input.targetEosId ?? "").trim();
    const reason = String(input.reason ?? "").trim();
    const operatorId = String(input.operatorId ?? "").trim();
    const operatorName = String(input.operatorName ?? "").trim();
    const source = String(input.source ?? "module.killManage").trim() || "module.killManage";
    const createdAt = Date.now();

    const resolvedTarget = resolveListPlayersTarget({
      serverId,
      targetPlayerId: input.targetPlayerId ?? input.playerId,
      targetName,
      targetSteamId,
      targetEosId,
    });
    const targetPlayerId = resolvedTarget?.playerID ?? "";
    const targetResolution = resolvedTarget?.resolution ?? "";
    const command = buildKillCommand(targetPlayerId);

    if (!enabled) {
      return storeAndReturn({
        success: false,
        command,
        serverId,
        targetPlayerId,
        targetResolution,
        targetName,
        targetSteamId,
        targetEosId,
        reason,
        operatorId,
        operatorName,
        source,
        error: "ModuleDisabled",
        createdAt,
        skipped: true,
        skipReason: "module_disabled",
      });
    }

    if (!targetPlayerId) {
      return storeAndReturn({
        success: false,
        command,
        serverId,
        targetPlayerId,
        targetResolution,
        targetName,
        targetSteamId,
        targetEosId,
        reason,
        operatorId,
        operatorName,
        source,
        error: "MissingListPlayersPlayerId",
        createdAt,
        skipped: true,
        skipReason: "missing_list_players_player_id",
      });
    }

    try {
      const result = await core.rconManager.dispatchCommand({
        command,
        requestedBy: "module.killManage",
        reason: reason || "manual_kill",
        actor: input.actor ?? null,
        system: Boolean(input.system ?? false),
        priority: "high",
      });

      return storeAndReturn({
        success: Boolean(result?.success),
        command,
        serverId,
        targetPlayerId,
        targetResolution,
        targetName,
        targetSteamId,
        targetEosId,
        reason,
        operatorId,
        operatorName,
        source,
        error: result?.success ? "" : String(result?.message ?? "RCON command failed."),
        createdAt,
      });
    } catch (error) {
      return storeAndReturn({
        success: false,
        command,
        serverId,
        targetPlayerId,
        targetResolution,
        targetName,
        targetSteamId,
        targetEosId,
        reason,
        operatorId,
        operatorName,
        source,
        error: error instanceof Error ? error.message : String(error),
        createdAt,
      });
    }
  }

  function resolveListPlayersTarget({
    serverId = "",
    targetPlayerId = null,
    targetName = "",
    targetSteamId = "",
    targetEosId = "",
  } = {}) {
    const explicitPlayerID = normalizePlayerID(targetPlayerId);
    if (explicitPlayerID) {
      return {
        playerID: explicitPlayerID,
        resolution: "explicit_list_players_id",
      };
    }

    const playerState = modules?.playerState;
    if (!playerState) return null;

    const identity = {
      name: targetName,
      steamID: targetSteamId,
      eosID: targetEosId,
    };

    if (serverId && typeof playerState.findPlayer === "function") {
      const player = playerState.findPlayer(serverId, identity);
      const playerID = normalizePlayerID(player?.playerID);
      if (playerID) {
        return {
          playerID,
          resolution: "player_state_list_players_snapshot",
        };
      }
    }

    if (typeof playerState.getState !== "function" || typeof playerState.findPlayer !== "function") {
      return null;
    }

    const state = playerState.getState();
    const byServer = state?.byServer && typeof state.byServer === "object"
      ? state.byServer
      : {};
    const candidates = [];

    for (const candidateServerId of Object.keys(byServer)) {
      const player = playerState.findPlayer(candidateServerId, identity);
      const playerID = normalizePlayerID(player?.playerID);
      if (!playerID) continue;
      candidates.push({
        playerID,
        resolution: "player_state_list_players_snapshot",
      });
    }

    if (candidates.length === 1) return candidates[0];
    return null;
  }

  function storeAndReturn(record) {
    const saved = store.push(record);
    return cloneJsonSafe(saved);
  }

  return {
    manifest: {
      id: "module.killManage",
      name: "RCON 强制击杀",
      kind: "module",
      version: "1.1.0",
      hidden: true,
      description: "管理端强制击杀入口。AdminKill 只使用 ListPlayers 返回的玩家 ID；Steam/EOS/名字仅用于定位当前玩家。",
    },
    apiName: "killManage",
    api,

    async start() {
      core.webRegistry?.registerPage?.({
        id: "web.killManage",
        title: "RCON 强制击杀",
        group: "管理",
        route: "/kill-manage",
        pageModule: "/pages/kill-manage.js",
        source: "module.killManage",
        description: "管理端强制击杀入口，仅执行 AdminKill。",
        required: false,
        enabled: true,
        order: 114,
        icon: "K",
      });
      moduleLogger?.info?.("KillManage admin-kill module started.", {
        operation: "start",
      });
    },

    async stop() {
      moduleLogger?.info?.("KillManage admin-kill module stopped.", {
        operation: "stop",
      });
    },
  };
}

class KillManageMemoryStore {
  constructor(maxRecords) {
    this.maxRecords = Math.max(1, Number(maxRecords ?? DEFAULT_MAX_RECORDS));
    this.records = [];
  }

  push(record) {
    this.records.push(cloneJsonSafe({
      ...record,
      createdAt: Number(record?.createdAt ?? Date.now()),
      success: Boolean(record?.success),
      skipped: Boolean(record?.skipped),
      skipReason: String(record?.skipReason ?? ""),
      error: String(record?.error ?? ""),
      command: String(record?.command ?? ""),
      serverId: String(record?.serverId ?? ""),
      targetPlayerId: String(record?.targetPlayerId ?? ""),
      targetResolution: String(record?.targetResolution ?? ""),
      targetName: String(record?.targetName ?? ""),
      targetSteamId: String(record?.targetSteamId ?? ""),
      targetEosId: String(record?.targetEosId ?? ""),
      reason: String(record?.reason ?? ""),
      operatorId: String(record?.operatorId ?? ""),
      operatorName: String(record?.operatorName ?? ""),
      source: String(record?.source ?? "module.killManage"),
    }));

    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }

    return this.records[this.records.length - 1];
  }

  query({ serverId = "", limit = 50 } = {}) {
    const wantedServer = String(serverId ?? "").trim();
    const maxLimit = Math.max(1, Math.min(Number(limit) || 50, this.maxRecords));
    return this.records
      .slice()
      .reverse()
      .filter((record) => !wantedServer || String(record.serverId ?? "").trim() === wantedServer)
      .slice(0, maxLimit)
      .map(cloneJsonSafe);
  }

  clear() {
    const cleared = this.records.length;
    this.records.splice(0);
    return cleared;
  }
}

function normalizePlayerID(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return "";
  return text;
}

function buildKillCommand(targetPlayerId) {
  const target = normalizePlayerID(targetPlayerId);
  return target ? `AdminKill ${target}` : "";
}

function cloneJsonSafe(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

export default createKillManageModule;
