import fs from "node:fs/promises";
import path from "node:path";

const MODULE_ID = "module.reserveSlots";
const DEFAULT_LOCAL_RESERVE_FILE = "data/reserve-slots.json";
const DEFAULT_STORE_VERSION = 2;
const DEFAULT_RESERVE_GROUP = "BZSSVIP";
const DEFAULT_RESERVE_PERMISSION = "reserve";
const DEFAULT_CDK_CODE_LENGTH = 14;
const DEFAULT_CDK_PREFIX = "CDK";
const DEFAULT_ACTIVATION_RECORD_LIMIT = 500;
const RESERVE_MARKER_RE = /\/\/\s*预留位/;
const STEAM64_RE = /^7656119\d{10}$/;
const RESERVE_EXPIRE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const CDK_INPUT_RE = /^CDK([A-Za-z0-9_-]+)$/;

const ACTIVATION_RESULTS = {
  SUCCESS: "success",
  CODE_NOT_FOUND: "code_not_found",
  BATCH_DEACTIVATED: "batch_deactivated",
  CODE_USED: "code_used",
  DUPLICATE_PLAYER_RESTRICTED: "duplicate_player_restricted",
  TYPE_MISMATCH: "type_mismatch",
  FUTURE_REQUIREMENT_NOT_MET: "future_requirement_not_met",
  INVALID_MESSAGE: "invalid_message",
  INVALID_PLAYER: "invalid_player",
  INTERNAL_ERROR: "internal_error",
};

const CDK_REQUIREMENT_SUFFIXES = {
  DIRECT: "A",
  GATED: "B",
};

export function createReserveSlotsModule({ core, modules, config, logger }) {
  const moduleLogger =
    logger ??
    core.createLogger?.({
      moduleId: MODULE_ID,
      source: MODULE_ID,
      channel: "module",
    }) ??
    core.logger;

  const runtime = {
    config: readModuleConfig(),
    store: createEmptyStore(""),
    resolvedLocalReserveFilePath: "",
    loadedAt: null,
    unsubscribeChatMessage: null,
  };

  runtime.resolvedLocalReserveFilePath = resolveConfigPath(
    runtime.config.localReserveFilePath,
    DEFAULT_LOCAL_RESERVE_FILE,
  );

  const api = {
    async getState() {
      return buildState();
    },

    async getCdkState() {
      return buildCdkState();
    },

    async listBatchActivations(batchId, filters = {}) {
      return buildBatchActivationState(batchId, filters);
    },

    async createCdkBatch(input = {}, context = {}) {
      return createReserveCdkBatch(input, context);
    },

    async deactivateCdkBatch(batchId, context = {}) {
      return deactivateReserveCdkBatch(batchId, context);
    },

    async updateConfig(nextConfig = {}) {
      return updateReserveSystemConfig(nextConfig);
    },

    async importFromAdminFile() {
      return importReserveSlotsFromAdminFile();
    },

    async exportCsv() {
      return exportReserveSlotsCsv();
    },

    async importFromCsv(csvText = "") {
      return importReserveSlotsFromCsv(csvText);
    },

    async upsertMember(input = {}) {
      return upsertReserveSlotMember(input);
    },

    async deleteMember(input = {}) {
      return deleteReserveSlotMember(input);
    },

    async deleteExpiredMembers() {
      return deleteExpiredReserveSlotMembers();
    },

    async reload() {
      await loadStoreFromDisk({ repair: true });
      return buildState();
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "预留位系统",
      kind: "module",
      version: "1.1.0",
      description: "管理 Squad 管理员配置中的预留位，并扩展 CDK 批次发放与聊天激活记录。",
    },
    apiName: "reserveSlots",
    api,

    async init() {
      await loadStoreFromDisk({ repair: true });
    },

    async start() {
      subscribeChatMessages();
      moduleLogger?.info?.(`[ReserveSlots] started. enabled=${Boolean(runtime.config.enabled)} local=${runtime.resolvedLocalReserveFilePath}`);
    },

    async stop() {
      if (typeof runtime.unsubscribeChatMessage === "function") {
        try {
          runtime.unsubscribeChatMessage();
        } catch {}
        runtime.unsubscribeChatMessage = null;
      }
      moduleLogger?.info?.("[ReserveSlots] stopped.");
    },
  };

  function readModuleConfig() {
    const current = config?.get?.("reserveSystem", {}) ?? {};
    return {
      enabled: Boolean(current.enabled ?? true),
      adminFilePath: String(current.adminFilePath ?? "").trim(),
      localReserveFilePath: String(current.localReserveFilePath ?? DEFAULT_LOCAL_RESERVE_FILE).trim() || DEFAULT_LOCAL_RESERVE_FILE,
    };
  }

  function refreshConfigFromRuntime() {
    runtime.config = readModuleConfig();
    runtime.resolvedLocalReserveFilePath = resolveConfigPath(
      runtime.config.localReserveFilePath,
      DEFAULT_LOCAL_RESERVE_FILE,
    );
  }

  function subscribeChatMessages() {
    if (typeof runtime.unsubscribeChatMessage === "function") return;
    if (typeof modules?.chatManager?.on !== "function") return;
    runtime.unsubscribeChatMessage = modules.chatManager.on("message", (event) => {
      void handleChatMessage(event);
    });
  }

  async function loadStoreFromDisk({ repair = false } = {}) {
    refreshConfigFromRuntime();
    await ensureReserveSlotStoreFile(runtime.resolvedLocalReserveFilePath, runtime.config.adminFilePath, { repair });

    const rawText = await fs.readFile(runtime.resolvedLocalReserveFilePath, "utf8");
    runtime.store = normalizeStore(JSON.parse(rawText), {
      adminFilePath: runtime.config.adminFilePath,
    });
    runtime.loadedAt = new Date().toISOString();
    return runtime.store;
  }

  async function updateReserveSystemConfig(nextConfig = {}) {
    const previousConfig = cloneValue(config?.get?.("reserveSystem", {}) ?? {});
    const normalized = {
      enabled: Boolean(nextConfig.enabled ?? false),
      adminFilePath: String(nextConfig.adminFilePath ?? "").trim(),
      localReserveFilePath: String(nextConfig.localReserveFilePath ?? DEFAULT_LOCAL_RESERVE_FILE).trim() || DEFAULT_LOCAL_RESERVE_FILE,
    };

    config?.set?.("reserveSystem", normalized);

    try {
      refreshConfigFromRuntime();
      await ensureReserveSlotStoreFile(runtime.resolvedLocalReserveFilePath, runtime.config.adminFilePath, { repair: true });
      await config?.save?.();
    } catch (error) {
      if (config?.set) {
        config.set("reserveSystem", previousConfig);
      }
      refreshConfigFromRuntime();
      throw error;
    }

    await loadStoreFromDisk({ repair: true });
    moduleLogger?.info?.(`[ReserveSlots] config updated: enabled=${runtime.config.enabled} admin=${runtime.config.adminFilePath || "(empty)"} local=${runtime.config.localReserveFilePath}`);
    return buildState();
  }

  async function importReserveSlotsFromAdminFile() {
    refreshConfigFromRuntime();
    await ensureReserveSlotStoreFile(runtime.resolvedLocalReserveFilePath, runtime.config.adminFilePath, { repair: true });

    const currentLocalStore = await loadStoreFromDisk({ repair: true });
    const adminFilePath = runtime.config.adminFilePath;

    if (!adminFilePath) {
      moduleLogger?.info?.("[ReserveSlots] admin file is not configured. Skip sync.");
      return buildState({
        message: "管理员配置文件未配置，已跳过同步。",
        localStore: currentLocalStore,
      });
    }

    const resolvedAdminFilePath = resolveConfigPath(adminFilePath, "");
    try {
      const content = await fs.readFile(resolvedAdminFilePath, "utf8");
      const importedAt = new Date().toISOString();
      const parsed = parseReserveSlotsFromAdminFileContent(content, {
        adminFilePath,
        importedAt,
        logger: moduleLogger,
        runtimeState: core?.runtimeState,
      });

      parsed.source.adminFilePath = adminFilePath;
      parsed.source.lastImportedAt = importedAt;
      parsed.members = await enrichMembersWithLinkedNames(parsed.members, {
        playerDatabase: modules?.playerDatabase,
        runtimeState: core?.runtimeState,
      });

      const nextStore = mergeStoreWithCdkData(runtime.store, parsed);
      await persistStore(runtime.resolvedLocalReserveFilePath, nextStore);
      runtime.store = nextStore;
      runtime.loadedAt = importedAt;

      moduleLogger?.info?.(`[ReserveSlots] synced reserve slots from admin file: groups=${parsed.groups.length} members=${parsed.members.length}`);
      return buildState({
        message: "已从管理员文件同步预留位数据",
      });
    } catch (error) {
      if (error?.code === "ENOENT") {
        moduleLogger?.warn?.(`[ReserveSlots] admin file does not exist: ${resolvedAdminFilePath}`);
        return buildState({
          message: "管理员配置文件不存在，已返回当前本地数据。",
          adminFileMissing: true,
        });
      }

      moduleLogger?.warn?.(`[ReserveSlots] failed to read admin file: ${error?.message ?? String(error)}`);
      return buildState({
        message: "读取管理员配置文件失败，已返回当前本地数据。",
        adminFileReadFailed: true,
      });
    }
  }

  async function exportReserveSlotsCsv() {
    const state = await buildState();
    const rows = Array.isArray(state.members) ? state.members : [];
    return serializeReserveSlotsCsv(rows);
  }

  async function importReserveSlotsFromCsv(csvText = "") {
    const currentLocalStore = await loadStoreFromDisk({ repair: true });
    const parsed = parseReserveSlotsFromCsvContent(csvText, {
      adminFilePath: runtime.config.adminFilePath,
      logger: moduleLogger,
    });
    if (!parsed.members.length && !parsed.groups.length) {
      return buildState({
        message: "CSV 中没有可导入的预留位数据。",
        localStore: currentLocalStore,
      });
    }

    const importedAt = new Date().toISOString();
    parsed.source.adminFilePath = runtime.config.adminFilePath;
    parsed.source.lastImportedAt = importedAt;
    parsed.members = await enrichMembersWithLinkedNames(parsed.members, {
      playerDatabase: modules?.playerDatabase,
      runtimeState: core?.runtimeState,
    });

    const nextStore = mergeStoreWithCdkData(runtime.store, parsed);
    await persistStore(runtime.resolvedLocalReserveFilePath, nextStore);
    runtime.store = nextStore;
    runtime.loadedAt = importedAt;
    return buildState({
      message: "CSV 导入完成。",
    });
  }

  async function upsertReserveSlotMember(input = {}) {
    refreshConfigFromRuntime();
    await loadStoreFromDisk({ repair: true });
    const normalizedSteamId = normalizeReserveSteamId(input.steamId ?? input.steamID ?? input.steam64 ?? "");
    const existingMember = (runtime.store.members ?? []).find((item) => item.steamId === normalizedSteamId) ?? null;
    const member = normalizeReserveMemberInput(
      {
        ...input,
        steamId: normalizedSteamId,
      },
      { existingMember },
    );
    const adminFilePath = runtime.config.adminFilePath;
    if (!adminFilePath) {
      throw createReserveSlotError(400, "AdminFileNotConfigured", "管理员配置文件未配置。");
    }

    const resolvedAdminFilePath = resolveConfigPath(adminFilePath, "");
    let content = "";
    try {
      content = await fs.readFile(resolvedAdminFilePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw createReserveSlotError(404, "AdminFileNotFound", "管理员配置文件不存在。");
      }
      throw error;
    }

    const nextContent = upsertReserveSlotInAdminFileContent(content, member);
    await writeTextFileAtomic(resolvedAdminFilePath, nextContent);

    const importedAt = new Date().toISOString();
    const parsed = parseReserveSlotsFromAdminFileContent(nextContent, {
      adminFilePath,
      importedAt,
      logger: moduleLogger,
      runtimeState: core?.runtimeState,
    });
    parsed.source.adminFilePath = adminFilePath;
    parsed.source.lastImportedAt = importedAt;
    parsed.members = await enrichMembersWithLinkedNames(parsed.members, {
      playerDatabase: modules?.playerDatabase,
      runtimeState: core?.runtimeState,
    });

    const nextStore = mergeStoreWithCdkData(runtime.store, parsed);
    await persistStore(runtime.resolvedLocalReserveFilePath, nextStore);
    runtime.store = nextStore;
    runtime.loadedAt = importedAt;

    moduleLogger?.info?.(`[ReserveSlots] wrote reserve slot: steamId=${member.steamId} group=${member.group} expireAt=${member.expireAt}`);
    return buildState({
      message: "预留位时间已更新。",
      savedMember: member,
    });
  }

  async function deleteReserveSlotMember(input = {}) {
    refreshConfigFromRuntime();
    const steamId = normalizeReserveSteamId(input.steamId ?? input.steamID ?? input.steam64 ?? "");
    const adminFilePath = runtime.config.adminFilePath;
    if (!adminFilePath) {
      throw createReserveSlotError(400, "AdminFileNotConfigured", "管理员配置文件未配置。");
    }

    const resolvedAdminFilePath = resolveConfigPath(adminFilePath, "");
    let content = "";
    try {
      content = await fs.readFile(resolvedAdminFilePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw createReserveSlotError(404, "AdminFileNotFound", "管理员配置文件不存在。");
      }
      throw error;
    }

    const result = removeReserveSlotMembersFromAdminFileContent(content, {
      steamIds: [steamId],
    });
    if (result.removedCount <= 0) {
      throw createReserveSlotError(404, "ReserveSlotNotFound", "未找到该玩家的预留位。");
    }

    await writeTextFileAtomic(resolvedAdminFilePath, result.content);
    return syncRuntimeStoreFromAdminContent(result.content, {
      adminFilePath,
      message: `已删除 ${result.removedCount} 条预留位。`,
      removedCount: result.removedCount,
      removedSteamIds: [steamId],
    });
  }

  async function deleteExpiredReserveSlotMembers() {
    refreshConfigFromRuntime();
    const adminFilePath = runtime.config.adminFilePath;
    if (!adminFilePath) {
      throw createReserveSlotError(400, "AdminFileNotConfigured", "管理员配置文件未配置。");
    }

    const resolvedAdminFilePath = resolveConfigPath(adminFilePath, "");
    let content = "";
    try {
      content = await fs.readFile(resolvedAdminFilePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw createReserveSlotError(404, "AdminFileNotFound", "管理员配置文件不存在。");
      }
      throw error;
    }

    const result = removeReserveSlotMembersFromAdminFileContent(content, {
      removeExpiredOnly: true,
    });
    if (result.removedCount <= 0) {
      return buildState({
        message: "没有可删除的过期预留位。",
        removedCount: 0,
      });
    }

    await writeTextFileAtomic(resolvedAdminFilePath, result.content);
    return syncRuntimeStoreFromAdminContent(result.content, {
      adminFilePath,
      message: `已删除 ${result.removedCount} 条过期预留位。`,
      removedCount: result.removedCount,
      removedSteamIds: result.removedSteamIds,
    });
  }

  async function createReserveCdkBatch(input = {}, context = {}) {
    await loadStoreFromDisk({ repair: true });

    const payload = normalizeCreateCdkBatchInput(input);
    const createdAt = new Date().toISOString();
    const batchId = `cdk_batch_${Date.now()}_${randomToken(6)}`;
    const codes = [];
    const codeRecords = [];

    for (let index = 0; index < payload.quantity; index += 1) {
      const requirementSuffix = resolveCdkRequirementSuffix(payload);
      const codeBody = `${randomToken(DEFAULT_CDK_CODE_LENGTH)}${requirementSuffix}`;
      const fullCode = `${DEFAULT_CDK_PREFIX}${payload.codeType}${codeBody}`;
      codes.push(fullCode);
      codeRecords.push({
        code: fullCode,
        codeType: payload.codeType,
        codeBody,
        batchId,
        status: "unused",
        activatedBySteamId: null,
        activatedByPlayerName: null,
        activatedAt: null,
        grantedExpireAt: null,
      });
    }

    const batch = {
      id: batchId,
      codeType: payload.codeType,
      quantity: payload.quantity,
      durationDays: payload.durationDays,
      allowMultiActivation: payload.allowMultiActivation,
      deactivated: false,
      deactivatedAt: null,
      deactivatedBy: null,
      minCurrentSessionSeconds: 0,
      minServerSeconds: 0,
      createdAt,
      createdBy: normalizeActorName(context.actor),
    };

    runtime.store = {
      ...runtime.store,
      cdkBatches: [batch, ...(runtime.store.cdkBatches ?? [])],
      cdkCodes: [...codeRecords, ...(runtime.store.cdkCodes ?? [])],
    };
    await persistStore(runtime.resolvedLocalReserveFilePath, runtime.store);
    runtime.loadedAt = new Date().toISOString();

    return {
      ...(await buildCdkState()),
      createdBatchId: batchId,
      createdCodes: codes,
      message: `已生成 ${payload.quantity} 条 CDK。`,
    };
  }

  async function deactivateReserveCdkBatch(batchId, context = {}) {
    await loadStoreFromDisk({ repair: true });
    const normalizedBatchId = String(batchId ?? "").trim();
    const batchIndex = (runtime.store.cdkBatches ?? []).findIndex((item) => item.id === normalizedBatchId);
    if (batchIndex < 0) {
      throw createReserveSlotError(404, "CdkBatchNotFound", "未找到该 CDK 批次。");
    }

    const nextBatches = cloneValue(runtime.store.cdkBatches ?? []);
    nextBatches[batchIndex] = {
      ...nextBatches[batchIndex],
      deactivated: true,
      deactivatedAt: new Date().toISOString(),
      deactivatedBy: normalizeActorName(context.actor),
    };

    runtime.store = {
      ...runtime.store,
      cdkBatches: nextBatches,
    };
    await persistStore(runtime.resolvedLocalReserveFilePath, runtime.store);
    runtime.loadedAt = new Date().toISOString();

    return {
      ...(await buildCdkState()),
      message: "该批次预留位已失效，未使用的 CDK 将无法继续激活。",
    };
  }

  async function syncRuntimeStoreFromAdminContent(content, extra = {}) {
    const importedAt = new Date().toISOString();
    const parsed = parseReserveSlotsFromAdminFileContent(content, {
      adminFilePath: extra.adminFilePath ?? runtime.config.adminFilePath,
      importedAt,
      logger: moduleLogger,
      runtimeState: core?.runtimeState,
    });
    parsed.source.adminFilePath = extra.adminFilePath ?? runtime.config.adminFilePath;
    parsed.source.lastImportedAt = importedAt;
    parsed.members = await enrichMembersWithLinkedNames(parsed.members, {
      playerDatabase: modules?.playerDatabase,
      runtimeState: core?.runtimeState,
    });

    const nextStore = mergeStoreWithCdkData(runtime.store, parsed);
    await persistStore(runtime.resolvedLocalReserveFilePath, nextStore);
    runtime.store = nextStore;
    runtime.loadedAt = importedAt;
    return buildState(extra);
  }

  async function buildState(extra = {}) {
    refreshConfigFromRuntime();
    const [adminFileExists, localReserveFileExists] = await Promise.all([
      pathExists(runtime.config.adminFilePath ? resolveConfigPath(runtime.config.adminFilePath, "") : ""),
      pathExists(runtime.resolvedLocalReserveFilePath),
    ]);

    const store = runtime.store ?? createEmptyStore(runtime.config.adminFilePath);
    const members = await enrichMembersWithLinkedNames(store.members ?? [], {
      playerDatabase: modules?.playerDatabase,
      runtimeState: core?.runtimeState,
    });

    return {
      ok: true,
      enabled: runtime.config.enabled,
      adminFilePath: runtime.config.adminFilePath,
      localReserveFilePath: runtime.config.localReserveFilePath,
      adminFileExists,
      localReserveFileExists,
      lastImportedAt: store.source?.lastImportedAt ?? null,
      source: cloneValue(store.source ?? { adminFilePath: runtime.config.adminFilePath, lastImportedAt: null }),
      groups: cloneValue(store.groups ?? []),
      members: cloneValue(members),
      summary: buildSummary({ ...store, members }),
      cdkSummary: buildCdkSummary(store),
      loadedAt: runtime.loadedAt,
      ...extra,
    };
  }

  async function buildCdkState(extra = {}) {
    const store = runtime.store ?? createEmptyStore(runtime.config.adminFilePath);
    const batches = buildCdkBatchView(store);
    const activations = cloneValue(store.cdkActivations ?? []);
    return {
      ok: true,
      batches,
      activations,
      summary: buildCdkSummary(store),
      loadedAt: runtime.loadedAt,
      ...extra,
    };
  }

  async function buildBatchActivationState(batchId, filters = {}) {
    const normalizedBatchId = String(batchId ?? "").trim();
    const store = runtime.store ?? createEmptyStore(runtime.config.adminFilePath);
    const batch = (store.cdkBatches ?? []).find((item) => item.id === normalizedBatchId);
    if (!batch) {
      throw createReserveSlotError(404, "CdkBatchNotFound", "未找到该 CDK 批次。");
    }

    const steamIdFilter = String(filters.steamId ?? filters.steamID ?? "").trim().toLowerCase();
    const resultFilter = String(filters.result ?? "").trim().toLowerCase();
    const records = (store.cdkActivations ?? []).filter((record) => {
      if (record.batchId !== normalizedBatchId) return false;
      if (steamIdFilter && !String(record.steamId ?? "").toLowerCase().includes(steamIdFilter)) return false;
      if (resultFilter && String(record.result ?? "").toLowerCase() !== resultFilter) return false;
      return true;
    });

    return {
      ok: true,
      batch: cloneValue(batch),
      records: cloneValue(records),
    };
  }

  async function handleChatMessage(event = {}) {
    try {
      const channel = normalizeChatChannel(event?.chatChannel ?? event?.channel);
      if (channel !== "all") return;
      const rawMessage = String(event?.message ?? "").trim();
      if (!rawMessage || !CDK_INPUT_RE.test(rawMessage)) return;

      const playerName = String(event?.playerName ?? event?.name ?? "").trim();
      const steamId = String(event?.steamId ?? event?.steamID ?? "").trim();
      if (!playerName || !STEAM64_RE.test(steamId)) {
        await logActivation({
          playerName,
          steamId,
          message: rawMessage,
          batchId: null,
          code: rawMessage,
          codeType: null,
          result: ACTIVATION_RESULTS.INVALID_PLAYER,
          failureReason: "玩家身份无效，无法激活 CDK。",
          grantedExpireAt: null,
          matchedFutureRequirement: false,
        });
        return;
      }

      const activation = await activateCdkFromChat({
        playerName,
        steamId,
        message: rawMessage,
      });
      await sendActivationNotice(activation);
    } catch (error) {
      moduleLogger?.warn?.(`[ReserveSlots] failed to process chat CDK activation: ${error?.message ?? error}`);
    }
  }

  async function activateCdkFromChat({ playerName, steamId, message }) {
    const body = String(message ?? "").trim().slice(DEFAULT_CDK_PREFIX.length);
    const knownTypes = [...new Set((runtime.store.cdkBatches ?? []).map((item) => String(item.codeType ?? "").trim()).filter(Boolean))];
    const matchedType = knownTypes.find((codeType) => body.startsWith(codeType)) ?? null;

    if (!matchedType) {
      return logActivation({
        playerName,
        steamId,
        message,
        batchId: null,
        code: message,
        codeType: null,
        result: ACTIVATION_RESULTS.TYPE_MISMATCH,
        failureReason: "CDK 类型不匹配。",
        grantedExpireAt: null,
        matchedFutureRequirement: false,
      });
    }

    const code = `${DEFAULT_CDK_PREFIX}${body}`;
    const codeRecord = (runtime.store.cdkCodes ?? []).find((item) => item.code === code);
    if (!codeRecord) {
      return logActivation({
        playerName,
        steamId,
        message,
        batchId: null,
        code,
        codeType: matchedType,
        result: ACTIVATION_RESULTS.CODE_NOT_FOUND,
        failureReason: "CDK 不存在。",
        grantedExpireAt: null,
        matchedFutureRequirement: false,
      });
    }

    const batch = (runtime.store.cdkBatches ?? []).find((item) => item.id === codeRecord.batchId);
    if (!batch) {
      return logActivation({
        playerName,
        steamId,
        message,
        batchId: codeRecord.batchId,
        code,
        codeType: matchedType,
        result: ACTIVATION_RESULTS.CODE_NOT_FOUND,
        failureReason: "CDK 批次不存在。",
        grantedExpireAt: null,
        matchedFutureRequirement: false,
      });
    }

    if (batch.deactivated) {
      return logActivation({
        playerName,
        steamId,
        message,
        batchId: batch.id,
        code,
        codeType: matchedType,
        result: ACTIVATION_RESULTS.BATCH_DEACTIVATED,
        failureReason: "该批次已停用，无法继续激活。",
        grantedExpireAt: null,
        matchedFutureRequirement: false,
      });
    }

    if (codeRecord.status === "used") {
      return logActivation({
        playerName,
        steamId,
        message,
        batchId: batch.id,
        code,
        codeType: matchedType,
        result: ACTIVATION_RESULTS.CODE_USED,
        failureReason: "该 CDK 已被使用。",
        grantedExpireAt: codeRecord.grantedExpireAt ?? null,
        matchedFutureRequirement: false,
      });
    }

    const alreadyActivatedSameBatch = (runtime.store.cdkActivations ?? []).some((item) => (
      item.batchId === batch.id
      && item.steamId === steamId
      && item.result === ACTIVATION_RESULTS.SUCCESS
    ));
    if (!batch.allowMultiActivation && alreadyActivatedSameBatch) {
      return logActivation({
        playerName,
        steamId,
        message,
        batchId: batch.id,
        code,
        codeType: matchedType,
        result: ACTIVATION_RESULTS.DUPLICATE_PLAYER_RESTRICTED,
        failureReason: "该批次不允许同一玩家重复激活。",
        grantedExpireAt: null,
        matchedFutureRequirement: false,
      });
    }

    const requirement = await checkFutureRequirements(batch, { playerName, steamId });
    if (!requirement.matched) {
      return logActivation({
        playerName,
        steamId,
        message,
        batchId: batch.id,
        code,
        codeType: matchedType,
        result: ACTIVATION_RESULTS.FUTURE_REQUIREMENT_NOT_MET,
        failureReason: requirement.reason || "未满足激活条件。",
        grantedExpireAt: null,
        matchedFutureRequirement: false,
      });
    }

    const expireAt = await grantReserveSlotFromBatch(batch, { playerName, steamId, code });
    const activatedAt = new Date().toISOString();
    const nextCodes = cloneValue(runtime.store.cdkCodes ?? []);
    const codeIndex = nextCodes.findIndex((item) => item.code === code);
    nextCodes[codeIndex] = {
      ...nextCodes[codeIndex],
      status: "used",
      activatedBySteamId: steamId,
      activatedByPlayerName: playerName,
      activatedAt,
      grantedExpireAt: expireAt,
    };

    runtime.store = {
      ...runtime.store,
      cdkCodes: nextCodes,
    };

    const activation = await logActivation({
      playerName,
      steamId,
      message,
      batchId: batch.id,
      code,
      codeType: matchedType,
      result: ACTIVATION_RESULTS.SUCCESS,
      failureReason: "",
      grantedExpireAt: expireAt,
      matchedFutureRequirement: true,
    });
    await persistStore(runtime.resolvedLocalReserveFilePath, runtime.store);
    runtime.loadedAt = new Date().toISOString();
    return activation;
  }

  async function grantReserveSlotFromBatch(batch, { playerName, steamId, code }) {
    const currentMember = (runtime.store.members ?? []).find((item) => item.steamId === steamId) ?? null;
    const baseDate = pickGrantBaseDate(currentMember?.expireAt);
    const expireAt = formatLocalDateTime(addDays(baseDate, Number(batch.durationDays ?? 0)));
    await upsertReserveSlotMember({
      steamId,
      group: DEFAULT_RESERVE_GROUP,
      expireAt,
      name: playerName,
      reason: `CDK:${batch.codeType}:${code}`,
    });
    return expireAt;
  }

  async function checkFutureRequirements(batch, player) {
    const minCurrentSessionSeconds = Math.max(0, Number(batch?.minCurrentSessionSeconds ?? 0) || 0);
    const minServerSeconds = Math.max(0, Number(batch?.minServerSeconds ?? 0) || 0);
    if (minCurrentSessionSeconds <= 0 && minServerSeconds <= 0) {
      return { matched: true, reason: "" };
    }

    const serverSeconds = await resolvePlayerServerSeconds(player);
    if (minServerSeconds > 0 && serverSeconds < minServerSeconds) {
      return {
        matched: false,
        reason: `当前累计服内时长不足 ${minServerSeconds} 秒。`,
      };
    }

    return { matched: true, reason: "" };
  }

  async function resolvePlayerServerSeconds(player) {
    if (typeof modules?.playerDatabase?.listPlayersBySteamIDs !== "function") return 0;
    const rows = await modules.playerDatabase.listPlayersBySteamIDs([player.steamId]);
    const row = Array.isArray(rows) ? rows[0] : null;
    return Math.max(0, Number(row?.server_seconds ?? row?.serverSeconds ?? 0) || 0);
  }

  async function sendActivationNotice(activation) {
    let notice = buildActivationNotice(activation);
    if (!notice) return;
    const remainingDays = formatRemainingReserveDays(activation.grantedExpireAt);
    if (activation.result === ACTIVATION_RESULTS.SUCCESS) {
      notice = `${notice}\uFF0C\u5269\u4F59 ${remainingDays ?? "\u672A\u77E5"} \u5929`;
    }
    const targetName = String(activation.playerName ?? "").trim();
    const targetSteamId = String(activation.steamId ?? "").trim();
    if (targetName && typeof modules?.adminWarn?.warnPlayer === "function") {
      try {
        await modules.adminWarn.warnPlayer({
          targetName,
          targetSteamId,
          message: notice,
          reason: "reserve_slots_cdk_activation",
          sourceModule: MODULE_ID,
          system: true,
        });
      } catch (error) {
        moduleLogger?.warn?.(`[ReserveSlots] failed to send CDK activation notice: ${error?.message ?? error}`);
      }
    }

    const broadcastNotice = activation.result === ACTIVATION_RESULTS.SUCCESS
      ? `[\u9884\u7559\u4F4D CDK] \u73A9\u5BB6 ${targetName || "\u672A\u77E5\u73A9\u5BB6"} \u5DF2\u6FC0\u6D3B\u9884\u7559\u4F4D\uFF0C\u5269\u4F59 ${remainingDays ?? "\u672A\u77E5"} \u5929`
      : "";
    if (!broadcastNotice || typeof modules?.adminWarn?.broadcastMessage !== "function") return;
    try {
      await modules.adminWarn.broadcastMessage({
        message: broadcastNotice,
        reason: "reserve_slots_cdk_activation_broadcast",
        sourceModule: MODULE_ID,
        system: true,
      });
    } catch (error) {
      moduleLogger?.warn?.(`[ReserveSlots] failed to broadcast CDK activation notice: ${error?.message ?? error}`);
    }
  }

  async function logActivation(record) {
    const activationRecord = {
      id: `cdk_activation_${Date.now()}_${randomToken(6)}`,
      createdAt: new Date().toISOString(),
      playerName: String(record.playerName ?? "").trim(),
      steamId: String(record.steamId ?? "").trim(),
      message: String(record.message ?? "").trim(),
      code: String(record.code ?? "").trim(),
      codeType: record.codeType ? String(record.codeType).trim() : null,
      batchId: record.batchId ? String(record.batchId).trim() : null,
      result: String(record.result ?? ACTIVATION_RESULTS.INTERNAL_ERROR),
      failureReason: String(record.failureReason ?? "").trim(),
      grantedExpireAt: record.grantedExpireAt ? String(record.grantedExpireAt).trim() : null,
      matchedFutureRequirement: Boolean(record.matchedFutureRequirement),
    };

    const nextActivations = [activationRecord, ...(runtime.store.cdkActivations ?? [])].slice(0, DEFAULT_ACTIVATION_RECORD_LIMIT);
    runtime.store = {
      ...runtime.store,
      cdkActivations: nextActivations,
    };
    await persistStore(runtime.resolvedLocalReserveFilePath, runtime.store);
    runtime.loadedAt = new Date().toISOString();
    return activationRecord;
  }
}

export async function ensureReserveSlotStoreFile(filePath, adminFilePath, { repair = true } = {}) {
  const normalizedFilePath = String(filePath ?? "").trim();
  if (!normalizedFilePath) {
    throw new Error("reserve slot store file path is required.");
  }

  await fs.mkdir(path.dirname(normalizedFilePath), { recursive: true });

  try {
    const text = await fs.readFile(normalizedFilePath, "utf8");
    const parsed = JSON.parse(text);
    normalizeStore(parsed, { adminFilePath });
    return;
  } catch (error) {
    if (error?.code !== "ENOENT" && repair) {
      const brokenPath = `${normalizedFilePath}.broken-${Date.now()}.json`;
      try {
        await fs.rename(normalizedFilePath, brokenPath);
      } catch {
        try {
          await fs.copyFile(normalizedFilePath, brokenPath);
        } catch {}
      }
    } else if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  await persistStore(normalizedFilePath, createEmptyStore(""));
}

export function parseReserveSlotsFromAdminFileContent(content, options = {}) {
  const text = String(content ?? "");
  const lines = text.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => RESERVE_MARKER_RE.test(line));

  if (markerIndex < 0) {
    options.logger?.info?.("[ReserveSlots] reserve marker not found. Return empty store.");
    return createEmptyStore("");
  }

  const groups = [];
  const members = [];
  const adminFilePath = String(options.adminFilePath ?? "").trim();
  const importedAt = String(options.importedAt ?? new Date().toISOString());

  for (const rawLine of lines.slice(markerIndex + 1)) {
    const line = String(rawLine ?? "").trim();
    if (!line) continue;

    if (line.startsWith("Group=")) {
      const group = parseReserveGroupLine(line);
      if (!group) {
        options.logger?.warn?.(`[ReserveSlots] failed to parse group line: ${line}`);
        continue;
      }
      groups.push(group);
      continue;
    }

    if (line.startsWith("Admin=")) {
      const member = parseReserveMemberLine(line);
      if (!member) {
        options.logger?.warn?.(`[ReserveSlots] failed to parse admin line: ${line}`);
        continue;
      }
      members.push(member);
      continue;
    }

    options.logger?.debug?.(`[ReserveSlots] ignored line: ${line}`);
  }

  return normalizeStore({
    version: DEFAULT_STORE_VERSION,
    source: {
      adminFilePath,
      lastImportedAt: importedAt,
    },
    groups,
    members,
  }, {
    adminFilePath,
    runtimeState: options.runtimeState ?? null,
  });
}

export function upsertReserveSlotInAdminFileContent(content, input = {}) {
  const member = normalizeReserveMemberInput(input);
  const text = String(content ?? "");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "" && hadTrailingNewline) {
    lines.pop();
  }

  const markerIndex = lines.findIndex((line) => RESERVE_MARKER_RE.test(line));
  const memberLine = formatReserveMemberLine(member);

  if (markerIndex < 0) {
    if (lines.length && String(lines[lines.length - 1] ?? "").trim() !== "") {
      lines.push("");
    }
    lines.push("// 预留位");
    lines.push(formatReserveGroupLine(member.group));
    lines.push(memberLine);
    return `${lines.join(newline)}${newline}`;
  }

  const reserveRange = findReserveBlockRange(lines, markerIndex);
  const groupIndex = findReserveGroupLineIndex(lines, reserveRange, member.group);
  if (groupIndex < 0) {
    lines.splice(markerIndex + 1, 0, formatReserveGroupLine(member.group));
    reserveRange.end += 1;
  }

  const memberIndexes = findReserveMemberLineIndexes(lines, reserveRange, member.steamId);
  if (memberIndexes.length > 0) {
    const [firstIndex, ...duplicateIndexes] = memberIndexes;
    lines[firstIndex] = memberLine;
    for (let index = duplicateIndexes.length - 1; index >= 0; index -= 1) {
      lines.splice(duplicateIndexes[index], 1);
    }
  } else {
    const insertIndex = findReserveMemberInsertIndex(lines, reserveRange);
    lines.splice(insertIndex, 0, memberLine);
  }

  return `${lines.join(newline)}${hadTrailingNewline ? newline : ""}`;
}

export function removeReserveSlotMembersFromAdminFileContent(content, options = {}) {
  const text = String(content ?? "");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "" && hadTrailingNewline) {
    lines.pop();
  }

  const markerIndex = lines.findIndex((line) => RESERVE_MARKER_RE.test(line));
  if (markerIndex < 0) {
    return {
      content: `${lines.join(newline)}${hadTrailingNewline ? newline : ""}`,
      removedCount: 0,
      removedSteamIds: [],
    };
  }

  const steamIdSet = new Set(
    (Array.isArray(options.steamIds) ? options.steamIds : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
  const reserveRange = findReserveBlockRange(lines, markerIndex);
  const kept = [];
  const removedSteamIds = [];
  let removedCount = 0;

  for (let index = reserveRange.start; index < reserveRange.end; index += 1) {
    const line = String(lines[index] ?? "");
    const parsed = parseReserveMemberLine(line.trim());
    if (!parsed) {
      kept.push(line);
      continue;
    }

    const shouldRemove = options.removeExpiredOnly
      ? Boolean(parsed.isExpired)
      : steamIdSet.has(parsed.steamId);
    if (shouldRemove) {
      removedCount += 1;
      removedSteamIds.push(parsed.steamId);
      continue;
    }
    kept.push(line);
  }

  const nextLines = [
    ...lines.slice(0, reserveRange.start),
    ...kept,
    ...lines.slice(reserveRange.end),
  ];

  return {
    content: `${nextLines.join(newline)}${hadTrailingNewline ? newline : ""}`,
    removedCount,
    removedSteamIds: [...new Set(removedSteamIds)],
  };
}

function parseReserveGroupLine(line) {
  const content = String(line ?? "").trim();
  const payload = content.slice("Group=".length);
  const separatorIndex = payload.indexOf(":");
  if (separatorIndex <= 0) return null;

  const name = payload.slice(0, separatorIndex).trim();
  const permission = payload.slice(separatorIndex + 1).trim();
  if (!name || !permission) return null;

  return {
    name,
    permission,
    rawLine: content,
  };
}

function formatReserveGroupLine(groupName) {
  return `Group=${groupName}:${DEFAULT_RESERVE_PERMISSION}`;
}

function formatReserveMemberLine(member) {
  const commentParts = [member.expireAt];
  if (member.name) {
    commentParts.push(`名称:${member.name}`);
  }
  if (member.reason) {
    commentParts.push(member.reason);
  }
  return `Admin=${member.steamId}:${member.group} //${commentParts.join(" ")}`;
}

function findReserveBlockRange(lines, markerIndex) {
  let end = lines.length;
  for (let index = markerIndex + 1; index < lines.length; index += 1) {
    const line = String(lines[index] ?? "").trim();
    if (!line) continue;
    if (RESERVE_MARKER_RE.test(line)) {
      end = index;
      break;
    }
  }
  return { start: markerIndex + 1, end };
}

function findReserveGroupLineIndex(lines, range, groupName) {
  const expected = String(groupName ?? "").trim().toLowerCase();
  for (let index = range.start; index < range.end; index += 1) {
    const group = parseReserveGroupLine(String(lines[index] ?? "").trim());
    if (group && group.name.toLowerCase() === expected && group.permission === DEFAULT_RESERVE_PERMISSION) {
      return index;
    }
  }
  return -1;
}

function findReserveMemberLineIndex(lines, range, steamId) {
  const expected = String(steamId ?? "").trim();
  for (let index = range.start; index < range.end; index += 1) {
    const member = parseReserveMemberLine(String(lines[index] ?? "").trim());
    if (member && member.steamId === expected) {
      return index;
    }
  }
  return -1;
}

function findReserveMemberLineIndexes(lines, range, steamId) {
  const expected = String(steamId ?? "").trim();
  const indexes = [];
  for (let index = range.start; index < range.end; index += 1) {
    const member = parseReserveMemberLine(String(lines[index] ?? "").trim());
    if (member && member.steamId === expected) {
      indexes.push(index);
    }
  }
  return indexes;
}

function findReserveMemberInsertIndex(lines, range) {
  let lastGroupIndex = -1;
  let lastAdminIndex = -1;
  for (let index = range.start; index < range.end; index += 1) {
    const line = String(lines[index] ?? "").trim();
    if (line.startsWith("Group=")) lastGroupIndex = index;
    if (line.startsWith("Admin=")) lastAdminIndex = index;
  }
  if (lastAdminIndex >= 0) return lastAdminIndex + 1;
  if (lastGroupIndex >= 0) return lastGroupIndex + 1;
  return range.start;
}

function parseReserveMemberLine(line) {
  const content = String(line ?? "").trim();
  if (!content.startsWith("Admin=")) return null;
  const payload = content.slice("Admin=".length);
  const [head, commentTail = ""] = payload.split("//");
  const separatorIndex = head.indexOf(":");
  if (separatorIndex <= 0) return null;

  const steamId = head.slice(0, separatorIndex).trim();
  const group = head.slice(separatorIndex + 1).trim();
  if (!steamId || !group) return null;

  const { expireAt, name, reasons, remark } = parseReserveComment(commentTail);
  const expireDate = parseReserveDate(expireAt);

  return {
    steamId,
    group,
    name,
    expireAt: expireAt || null,
    reasons,
    remark,
    rawLine: content,
    isExpired: Boolean(expireDate && expireDate.getTime() < Date.now()),
  };
}

function parseReserveComment(commentText) {
  const text = String(commentText ?? "").trim();
  if (!text) {
    return {
      expireAt: null,
      name: "",
      reasons: [],
      remark: "",
    };
  }

  const localDateMatch = text.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})(?:\s+(.*))?$/);
  if (localDateMatch) {
    const payload = String(localDateMatch[2] ?? "").trim();
    const namedPayload = payload ? parseReserveNamedComment(payload) : null;
    return {
      expireAt: localDateMatch[1],
      name: namedPayload?.name ?? "",
      reasons: namedPayload?.reasons ?? splitReserveReasons(payload),
      remark: payload,
    };
  }

  const isoDateMatch = text.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)(?:\s+(.*))?$/);
  if (isoDateMatch) {
    const payload = String(isoDateMatch[2] ?? "").trim();
    const namedPayload = payload ? parseReserveNamedComment(payload) : null;
    return {
      expireAt: isoDateMatch[1],
      name: namedPayload?.name ?? "",
      reasons: namedPayload?.reasons ?? splitReserveReasons(payload),
      remark: payload,
    };
  }

  const named = parseReserveNamedComment(text);
  if (named) return named;

  return {
    expireAt: null,
    name: "",
    reasons: splitReserveReasons(text),
    remark: text,
  };
}

function parseReserveDate(text) {
  const value = String(text ?? "").trim();
  if (!value) return null;

  const parsed = new Date(value.includes(" ") ? value.replace(" ", "T") : value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function normalizeReserveMemberInput(input = {}, context = {}) {
  const steamId = normalizeReserveSteamId(input.steamId ?? input.steamID ?? input.steam64 ?? "");
  const group = String(input.group ?? DEFAULT_RESERVE_GROUP).trim() || DEFAULT_RESERVE_GROUP;
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(group)) {
    throw createReserveSlotError(400, "InvalidReserveGroup", "预留位组名只允许字母、数字、下划线、点和短横线。");
  }

  const expireAt = resolveReserveExpireAtInput(input, context);
  const name = String(input.name ?? "").trim();
  const reason = String(input.reason ?? "").trim();

  return {
    steamId,
    group,
    expireAt,
    name,
    reason,
  };
}

function resolveReserveExpireAtInput(input = {}, context = {}) {
  const durationDays = Number(input.durationDays ?? 0);
  if (Number.isFinite(durationDays) && durationDays > 0) {
    const baseDate = pickGrantBaseDate(context.existingMember?.expireAt ?? null);
    return formatLocalDateTime(addDays(baseDate, durationDays));
  }
  return normalizeReserveExpireAt(input.expireAt);
}

function normalizeCreateCdkBatchInput(input = {}) {
  const codeType = String(input.codeType ?? input.type ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(codeType)) {
    throw createReserveSlotError(400, "InvalidCdkType", "CDK 类型只能包含字母、数字、下划线和短横线。");
  }

  const quantity = Math.max(1, Math.min(500, Number(input.quantity ?? 0) || 0));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw createReserveSlotError(400, "InvalidCdkQuantity", "CDK 数量必须大于 0。");
  }

  const durationDays = Math.max(1, Math.min(3650, Number(input.durationDays ?? 0) || 0));
  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    throw createReserveSlotError(400, "InvalidCdkDurationDays", "激活天数必须大于 0。");
  }

  return {
    codeType,
    quantity,
    durationDays,
    allowMultiActivation: Boolean(input.allowMultiActivation),
  };
}

function resolveCdkRequirementSuffix(payload = {}) {
  const minCurrentSessionSeconds = Math.max(0, Number(payload.minCurrentSessionSeconds ?? 0) || 0);
  const minServerSeconds = Math.max(0, Number(payload.minServerSeconds ?? 0) || 0);
  if (minCurrentSessionSeconds <= 0 && minServerSeconds <= 0) {
    return CDK_REQUIREMENT_SUFFIXES.DIRECT;
  }
  return CDK_REQUIREMENT_SUFFIXES.GATED;
}

function normalizeReserveExpireAt(value) {
  const text = String(value ?? "").trim().replace("T", " ");
  if (!text) {
    throw createReserveSlotError(400, "ExpireAtRequired", "新增或续期预留位必须填写到期时间。");
  }
  if (!RESERVE_EXPIRE_RE.test(text)) {
    throw createReserveSlotError(400, "InvalidExpireAt", "到期时间格式必须是 YYYY-MM-DD HH:mm:ss。");
  }

  const parsed = parseReserveDate(text);
  if (!parsed || formatLocalDateTime(parsed) !== text) {
    throw createReserveSlotError(400, "InvalidExpireAt", "到期时间无效。");
  }
  return text;
}

function normalizeReserveSteamId(value) {
  const steamId = String(value ?? "").trim();
  if (!STEAM64_RE.test(steamId)) {
    throw createReserveSlotError(400, "InvalidSteamId", "Steam64 必须是有效的 17 位 SteamID。");
  }
  return steamId;
}

function formatLocalDateTime(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function normalizeStore(raw, { adminFilePath = "" } = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw.source
    : null;
  const groups = Array.isArray(raw?.groups) ? raw.groups.map(normalizeGroup).filter(Boolean) : [];
  const members = dedupeReserveMembers(
    Array.isArray(raw?.members) ? raw.members.map(normalizeMember).filter(Boolean) : [],
  );
  const lastImportedAt = String(source?.lastImportedAt ?? raw?.lastImportedAt ?? "").trim() || null;
  const cdkBatches = Array.isArray(raw?.cdkBatches) ? raw.cdkBatches.map(normalizeCdkBatch).filter(Boolean) : [];
  const cdkCodes = Array.isArray(raw?.cdkCodes) ? raw.cdkCodes.map(normalizeCdkCode).filter(Boolean) : [];
  const cdkActivations = Array.isArray(raw?.cdkActivations) ? raw.cdkActivations.map(normalizeCdkActivation).filter(Boolean) : [];

  return {
    version: Number(raw?.version ?? DEFAULT_STORE_VERSION) || DEFAULT_STORE_VERSION,
    source: {
      adminFilePath: String(source?.adminFilePath ?? adminFilePath ?? "").trim(),
      lastImportedAt,
    },
    groups,
    members,
    cdkBatches,
    cdkCodes,
    cdkActivations,
  };
}

function dedupeReserveMembers(members) {
  const result = [];
  const seen = new Set();
  for (const member of Array.isArray(members) ? members : []) {
    const steamId = String(member?.steamId ?? "").trim();
    if (!steamId || seen.has(steamId)) continue;
    seen.add(steamId);
    result.push(member);
  }
  return result;
}

function normalizeGroup(group) {
  if (!group || typeof group !== "object" || Array.isArray(group)) return null;
  const name = String(group.name ?? "").trim();
  const permission = String(group.permission ?? "").trim();
  const rawLine = String(group.rawLine ?? "").trim();
  if (!name || !permission || !rawLine) return null;

  return {
    name,
    permission,
    rawLine,
  };
}

function normalizeMember(member) {
  if (!member || typeof member !== "object" || Array.isArray(member)) return null;
  const steamId = String(member.steamId ?? "").trim();
  const group = String(member.group ?? "").trim();
  const rawLine = String(member.rawLine ?? "").trim();
  if (!steamId || !group || !rawLine) return null;

  const expireAt = member.expireAt == null || String(member.expireAt).trim() === ""
    ? null
    : String(member.expireAt).trim();
  const parsedExpireAt = parseReserveDate(expireAt);
  const reasons = normalizeReasons(member.reasons ?? member.reason ?? member.remark ?? []);
  const name = String(member.name ?? "").trim();

  return {
    steamId,
    group,
    name,
    expireAt,
    reasons,
    remark: String(member.remark ?? reasons.join("，")).trim(),
    rawLine,
    isExpired: Boolean(parsedExpireAt && parsedExpireAt.getTime() < Date.now()),
  };
}

function normalizeCdkBatch(batch) {
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) return null;
  const id = String(batch.id ?? "").trim();
  const codeType = String(batch.codeType ?? batch.type ?? "").trim();
  if (!id || !codeType) return null;
  return {
    id,
    codeType,
    quantity: Math.max(0, Number(batch.quantity ?? 0) || 0),
    durationDays: Math.max(0, Number(batch.durationDays ?? 0) || 0),
    allowMultiActivation: Boolean(batch.allowMultiActivation),
    deactivated: Boolean(batch.deactivated),
    deactivatedAt: optionalText(batch.deactivatedAt),
    deactivatedBy: optionalText(batch.deactivatedBy),
    minCurrentSessionSeconds: Math.max(0, Number(batch.minCurrentSessionSeconds ?? 0) || 0),
    minServerSeconds: Math.max(0, Number(batch.minServerSeconds ?? 0) || 0),
    createdAt: optionalText(batch.createdAt),
    createdBy: optionalText(batch.createdBy),
  };
}

function normalizeCdkCode(code) {
  if (!code || typeof code !== "object" || Array.isArray(code)) return null;
  const fullCode = String(code.code ?? "").trim();
  const batchId = String(code.batchId ?? "").trim();
  const codeType = String(code.codeType ?? "").trim();
  if (!fullCode || !batchId || !codeType) return null;
  return {
    code: fullCode,
    codeType,
    codeBody: String(code.codeBody ?? "").trim(),
    batchId,
    status: String(code.status ?? "unused").trim() || "unused",
    activatedBySteamId: optionalText(code.activatedBySteamId),
    activatedByPlayerName: optionalText(code.activatedByPlayerName),
    activatedAt: optionalText(code.activatedAt),
    grantedExpireAt: optionalText(code.grantedExpireAt),
  };
}

function normalizeCdkActivation(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const id = String(record.id ?? "").trim();
  const result = String(record.result ?? "").trim();
  if (!id || !result) return null;
  return {
    id,
    createdAt: optionalText(record.createdAt),
    playerName: String(record.playerName ?? "").trim(),
    steamId: String(record.steamId ?? "").trim(),
    message: String(record.message ?? "").trim(),
    code: String(record.code ?? "").trim(),
    codeType: optionalText(record.codeType),
    batchId: optionalText(record.batchId),
    result,
    failureReason: String(record.failureReason ?? "").trim(),
    grantedExpireAt: optionalText(record.grantedExpireAt),
    matchedFutureRequirement: Boolean(record.matchedFutureRequirement),
  };
}

function createEmptyStore(adminFilePath = "") {
  return {
    version: DEFAULT_STORE_VERSION,
    source: {
      adminFilePath: String(adminFilePath ?? "").trim(),
      lastImportedAt: null,
    },
    groups: [],
    members: [],
    cdkBatches: [],
    cdkCodes: [],
    cdkActivations: [],
  };
}

function mergeStoreWithCdkData(previousStore, nextBaseStore) {
  return normalizeStore({
    ...nextBaseStore,
    cdkBatches: cloneValue(previousStore?.cdkBatches ?? []),
    cdkCodes: cloneValue(previousStore?.cdkCodes ?? []),
    cdkActivations: cloneValue(previousStore?.cdkActivations ?? []),
  }, {
    adminFilePath: nextBaseStore?.source?.adminFilePath ?? "",
  });
}

function buildSummary(store) {
  const members = Array.isArray(store?.members) ? store.members : [];
  const groups = Array.isArray(store?.groups) ? store.groups : [];
  const expiredCount = members.filter((member) => Boolean(member?.isExpired)).length;
  const noExpireCount = members.filter((member) => member?.expireAt == null).length;

  return {
    groupCount: groups.length,
    memberCount: members.length,
    expiredCount,
    noExpireCount,
    activeCount: Math.max(0, members.length - expiredCount),
  };
}

function buildCdkSummary(store) {
  const batches = Array.isArray(store?.cdkBatches) ? store.cdkBatches : [];
  const codes = Array.isArray(store?.cdkCodes) ? store.cdkCodes : [];
  const activations = Array.isArray(store?.cdkActivations) ? store.cdkActivations : [];
  const visibleBatches = batches.filter((item) => !item.deactivated);
  const usedCodeCount = codes.filter((item) => item.status === "used").length;
  const activeBatchCount = visibleBatches.length;
  const deactivatedBatchCount = batches.filter((item) => item.deactivated).length;

  return {
    batchCount: visibleBatches.length,
    activeBatchCount,
    deactivatedBatchCount,
    codeCount: codes.length,
    usedCodeCount,
    remainingCodeCount: Math.max(0, codes.length - usedCodeCount),
    activationCount: activations.length,
    successCount: activations.filter((item) => item.result === ACTIVATION_RESULTS.SUCCESS).length,
    failureCount: activations.filter((item) => item.result !== ACTIVATION_RESULTS.SUCCESS).length,
  };
}

function buildCdkBatchView(store) {
  const batches = cloneValue((store?.cdkBatches ?? []).filter((batch) => !batch?.deactivated));
  const codes = store?.cdkCodes ?? [];
  return batches.map((batch) => {
    const relatedCodes = codes.filter((item) => item.batchId === batch.id);
    const usedCount = relatedCodes.filter((item) => item.status === "used").length;
    return {
      ...batch,
      codes: relatedCodes.map((item) => String(item?.code ?? "").trim()).filter(Boolean),
      usedCount,
      remainingCount: Math.max(0, relatedCodes.length - usedCount),
      activationCount: (store?.cdkActivations ?? []).filter((item) => item.batchId === batch.id).length,
      status: batch.deactivated ? "deactivated" : "active",
    };
  });
}

async function enrichMembersWithLinkedNames(members = [], { playerDatabase = null, runtimeState = null } = {}) {
  const list = Array.isArray(members) ? members : [];
  const steamIDs = [...new Set(list.map((member) => String(member?.steamId ?? "").trim()).filter(Boolean))];
  const bySteamID = new Map();

  if (steamIDs.length && playerDatabase?.listPlayersBySteamIDs) {
    try {
      const rows = await playerDatabase.listPlayersBySteamIDs(steamIDs);
      for (const row of Array.isArray(rows) ? rows : []) {
        const steamID = String(row?.steam_id ?? row?.steamID ?? row?.steam64 ?? "").trim();
        const name = String(row?.current_name ?? row?.name ?? "").trim();
        if (steamID && name) bySteamID.set(steamID, name);
      }
    } catch {}
  }

  const runtimeBySteamID = runtimeState?.getPlayers?.()?.bySteamID ?? {};
  return list.map((member) => {
    const currentName = String(member?.name ?? "").trim();
    if (currentName) return member;

    const steamId = String(member?.steamId ?? "").trim();
    const dbName = bySteamID.get(steamId) || "";
    const runtimeName = String(runtimeBySteamID?.[steamId]?.name ?? "").trim();
    const name = dbName || runtimeName;
    if (!name) return member;

    return {
      ...member,
      name,
    };
  });
}

function splitReserveReasons(text) {
  const value = String(text ?? "").trim();
  if (!value) return [];

  return value
    .split(/[|;,，、/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeReasons(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return splitReserveReasons(value);
  }
  return [];
}

function serializeReserveSlotsCsv(members = []) {
  const rows = Array.isArray(members) ? members : [];
  const header = ["steamId", "name", "group", "expireAt", "reasons", "remark", "isExpired"];
  const lines = [header.join(",")];

  for (const member of rows) {
    lines.push([
      csvEscape(member?.steamId ?? ""),
      csvEscape(member?.name ?? ""),
      csvEscape(member?.group ?? ""),
      csvEscape(member?.expireAt ?? ""),
      csvEscape(Array.isArray(member?.reasons) ? member.reasons.join(" | ") : ""),
      csvEscape(member?.remark ?? ""),
      csvEscape(Boolean(member?.isExpired) ? "true" : "false"),
    ].join(","));
  }

  return `${lines.join("\n")}\n`;
}

function parseReserveSlotsFromCsvContent(csvText, options = {}) {
  const text = String(csvText ?? "").replace(/^\uFEFF/, "").trim();
  if (!text) {
    return createEmptyStore(String(options.adminFilePath ?? ""));
  }

  const rows = parseCsvRows(text);
  if (!rows.length) {
    return createEmptyStore(String(options.adminFilePath ?? ""));
  }

  const header = rows[0].map((item) => String(item ?? "").trim());
  const indexOf = (name) => header.findIndex((item) => item === name);
  const steamIdIndex = indexOf("steamId");
  const nameIndex = indexOf("name");
  const groupIndex = indexOf("group");
  const expireAtIndex = indexOf("expireAt");
  const reasonsIndex = indexOf("reasons");
  const remarkIndex = indexOf("remark");

  if (steamIdIndex < 0 || groupIndex < 0) {
    options.logger?.warn?.("[ReserveSlots] CSV is missing steamId/group columns.");
    return createEmptyStore(String(options.adminFilePath ?? ""));
  }

  const members = [];
  for (const row of rows.slice(1)) {
    const steamId = String(row[steamIdIndex] ?? "").trim();
    const group = String(row[groupIndex] ?? "").trim();
    if (!steamId || !group) continue;

    const name = nameIndex >= 0 ? String(row[nameIndex] ?? "").trim() : "";
    const expireAt = expireAtIndex >= 0 ? String(row[expireAtIndex] ?? "").trim() : "";
    const reasonsRaw = reasonsIndex >= 0 ? String(row[reasonsIndex] ?? "").trim() : "";
    const remark = remarkIndex >= 0 ? String(row[remarkIndex] ?? "").trim() : "";
    const reasons = normalizeReasons(reasonsRaw);
    const parsedExpireAt = parseReserveDate(expireAt);

    members.push({
      steamId,
      name,
      group,
      expireAt: expireAt || null,
      reasons,
      remark: remark || reasons.join("，"),
      rawLine: `CSV:${steamId}:${group}`,
      isExpired: Boolean(parsedExpireAt && parsedExpireAt.getTime() < Date.now()),
    });
  }

  return normalizeStore({
    version: DEFAULT_STORE_VERSION,
    source: {
      adminFilePath: String(options.adminFilePath ?? "").trim(),
      lastImportedAt: options.importedAt ?? null,
    },
    groups: [],
    members,
  }, {
    adminFilePath: String(options.adminFilePath ?? "").trim(),
  });
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };

  const pushRow = () => {
    if (row.length || cell.length) {
      pushCell();
      rows.push(row);
      row = [];
    }
  };

  const input = String(text ?? "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = false;
        continue;
      }
      cell += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      pushCell();
      continue;
    }

    if (char === "\r") {
      continue;
    }

    if (char === "\n") {
      pushRow();
      continue;
    }

    cell += char;
  }

  if (cell.length || row.length) {
    pushRow();
  }

  return rows.filter((entry) => Array.isArray(entry) && entry.some((item) => String(item ?? "").trim() !== ""));
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[,"\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function parseReserveNamedComment(text) {
  const parts = splitReserveReasons(text);
  const namePart = parts.find((item) => /^(name|显示|名称)\s*[:=]/i.test(item));
  const reasonParts = parts.filter((item) => !/^(name|显示|名称)\s*[:=]/i.test(item));
  if (!namePart && !reasonParts.length) return null;

  const name = namePart ? String(namePart.split(/[:=]/, 2)[1] ?? "").trim() : "";
  return {
    expireAt: null,
    name,
    reasons: reasonParts.length ? reasonParts : (name ? [] : parts),
    remark: text,
  };
}

async function persistStore(filePath, store) {
  const normalizedPath = String(filePath ?? "").trim();
  if (!normalizedPath) {
    throw new Error("reserve slot store file path is required.");
  }

  await fs.mkdir(path.dirname(normalizedPath), { recursive: true });
  const tempPath = `${normalizedPath}.${process.pid}.${Date.now()}.tmp`;
  const normalizedStore = normalizeStore(store, {
    adminFilePath: store?.source?.adminFilePath ?? "",
  });
  const payload = `${JSON.stringify(normalizedStore, null, 2)}\n`;

  await fs.writeFile(tempPath, payload, "utf8");
  await fs.rename(tempPath, normalizedPath);
}

async function writeTextFileAtomic(filePath, content) {
  const normalizedPath = String(filePath ?? "").trim();
  if (!normalizedPath) {
    throw createReserveSlotError(400, "AdminFileNotConfigured", "管理员配置文件未配置。");
  }

  await fs.mkdir(path.dirname(normalizedPath), { recursive: true });
  const tempPath = `${normalizedPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, String(content ?? ""), "utf8");
  await fs.rename(tempPath, normalizedPath);
}

function createReserveSlotError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function pathExists(filePath) {
  const normalizedPath = String(filePath ?? "").trim();
  if (!normalizedPath) return false;

  try {
    await fs.access(normalizedPath);
    return true;
  } catch {
    return false;
  }
}

function resolveConfigPath(value, fallback) {
  const text = String(value ?? "").trim();
  const resolved = text || fallback;
  if (!resolved) return "";
  return path.isAbsolute(resolved) ? resolved : path.resolve(process.cwd(), resolved);
}

function cloneValue(value) {
  if (value == null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function randomToken(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let output = "";
  while (output.length < length) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function pickGrantBaseDate(currentExpireAt) {
  const currentExpire = parseReserveDate(currentExpireAt);
  const now = new Date();
  if (!currentExpire) return now;
  return currentExpire.getTime() > now.getTime() ? currentExpire : now;
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeActorName(actor) {
  if (!actor || typeof actor !== "object") return "system";
  return String(actor.username ?? actor.name ?? actor.id ?? "system").trim() || "system";
}

function normalizeChatChannel(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "chatall" || text === "all") return "all";
  return text;
}

function formatRemainingReserveDays(expireAt) {
  const parsed = parseReserveDate(expireAt);
  if (!parsed) return null;
  const diffMs = parsed.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / 86400000));
}

function buildActivationNotice(record) {
  switch (record.result) {
    case ACTIVATION_RESULTS.SUCCESS:
      return `[预留位 CDK] 激活成功，到期时间 ${record.grantedExpireAt || "未知"}`;
    case ACTIVATION_RESULTS.TYPE_MISMATCH:
      return "[预留位 CDK] CDK 类型不匹配。";
    case ACTIVATION_RESULTS.CODE_NOT_FOUND:
      return "[预留位 CDK] CDK 不存在。";
    case ACTIVATION_RESULTS.BATCH_DEACTIVATED:
      return "[预留位 CDK] 该批次已停用，无法继续激活。";
    case ACTIVATION_RESULTS.CODE_USED:
      return "[预留位 CDK] 该 CDK 已被使用。";
    case ACTIVATION_RESULTS.DUPLICATE_PLAYER_RESTRICTED:
      return "[预留位 CDK] 该批次不允许你重复激活。";
    case ACTIVATION_RESULTS.FUTURE_REQUIREMENT_NOT_MET:
      return `[预留位 CDK] ${record.failureReason || "未满足激活条件。"}`;
    case ACTIVATION_RESULTS.INVALID_PLAYER:
      return "[预留位 CDK] 无法识别你的身份信息。";
    default:
      return `[预留位 CDK] ${record.failureReason || "激活失败。"} `;
  }
}
