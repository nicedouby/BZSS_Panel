import fs from "node:fs/promises";
import path from "node:path";

const MODULE_ID = "module.blackEdgePrivilege";
const ASSET_KEY = "blackEdgeSwitchCount";
const DEFAULT_STORE_FILE = "data/black-edge-privilege.json";
const DEFAULT_STORE_VERSION = 1;
const DEFAULT_CDK_CODE_LENGTH = 14;
const DEFAULT_CDK_PREFIX = "CDK";
const DEFAULT_ACTIVATION_RECORD_LIMIT = 500;
const CDK_INPUT_RE = /^CDK([A-Za-z0-9_-]+)$/;
const STEAM64_RE = /^7656119\d{10}$/;

const ACTIVATION_RESULTS = {
  SUCCESS: "success",
  CODE_NOT_FOUND: "code_not_found",
  BATCH_DEACTIVATED: "batch_deactivated",
  CODE_USED: "code_used",
  DUPLICATE_PLAYER_RESTRICTED: "duplicate_player_restricted",
  TYPE_MISMATCH: "type_mismatch",
  INVALID_PLAYER: "invalid_player",
  INTERNAL_ERROR: "internal_error",
};

export function createBlackEdgePrivilegeModule({ core, modules, config, logger }) {
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
    config: readModuleConfig(config),
    store: createEmptyStore(),
    resolvedStoreFilePath: "",
    loadedAt: null,
    unsubscribeChatMessage: null,
  };

  runtime.resolvedStoreFilePath = resolveConfigPath(runtime.config.storeFilePath, DEFAULT_STORE_FILE);

  const api = {
    async getCdkState() {
      return buildCdkState();
    },

    async listBatchActivations(batchId, filters = {}) {
      return buildBatchActivationState(batchId, filters);
    },

    async createCdkBatch(input = {}, context = {}) {
      return createCdkBatch(input, context);
    },

    async deactivateCdkBatch(batchId, context = {}) {
      return deactivateCdkBatch(batchId, context);
    },

    async reload() {
      await loadStoreFromDisk({ repair: true });
      return buildCdkState();
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "黑奴跳边额度",
      kind: "module",
      version: "1.0.0",
      description: "管理黑奴跳边次数的 CDK 批次、聊天激活记录和资产发放。",
    },
    apiName: "blackEdgePrivilege",
    api,

    async init() {
      await loadStoreFromDisk({ repair: true });
    },

    async start() {
      subscribeChatMessages();
      moduleLogger?.info?.(`[BlackEdgePrivilege] started. enabled=${Boolean(runtime.config.enabled)} file=${runtime.resolvedStoreFilePath}`);
    },

    async stop() {
      if (typeof runtime.unsubscribeChatMessage === "function") {
        try {
          runtime.unsubscribeChatMessage();
        } catch {}
        runtime.unsubscribeChatMessage = null;
      }
      moduleLogger?.info?.("[BlackEdgePrivilege] stopped.");
    },
  };

  function subscribeChatMessages() {
    if (typeof runtime.unsubscribeChatMessage === "function") return;
    if (typeof modules?.chatManager?.on !== "function") return;
    runtime.unsubscribeChatMessage = modules.chatManager.on("message", (event) => {
      void handleChatMessage(event);
    });
  }

  async function loadStoreFromDisk({ repair = false } = {}) {
    runtime.config = readModuleConfig(config);
    runtime.resolvedStoreFilePath = resolveConfigPath(runtime.config.storeFilePath, DEFAULT_STORE_FILE);
    await ensureStoreFile(runtime.resolvedStoreFilePath, { repair });
    const rawText = await fs.readFile(runtime.resolvedStoreFilePath, "utf8");
    runtime.store = normalizeStore(JSON.parse(rawText));
    runtime.loadedAt = new Date().toISOString();
    return runtime.store;
  }

  async function createCdkBatch(input = {}, context = {}) {
    await loadStoreFromDisk({ repair: true });
    const payload = normalizeCreateBatchInput(input);
    const createdAt = new Date().toISOString();
    const batchId = `black_edge_batch_${Date.now()}_${randomToken(6)}`;
    const codes = [];
    const codeRecords = [];

    for (let index = 0; index < payload.quantity; index += 1) {
      const codeBody = randomToken(DEFAULT_CDK_CODE_LENGTH);
      const code = `${DEFAULT_CDK_PREFIX}${payload.codeType}${codeBody}`;
      codes.push(code);
      codeRecords.push({
        code,
        codeType: payload.codeType,
        codeBody,
        batchId,
        status: "unused",
        activatedBySteamId: null,
        activatedByPlayerName: null,
        activatedAt: null,
      });
    }

    const batch = {
      id: batchId,
      codeType: payload.codeType,
      quantity: payload.quantity,
      grantCount: payload.grantCount,
      allowMultiActivation: payload.allowMultiActivation,
      deactivated: false,
      deactivatedAt: null,
      deactivatedBy: null,
      createdAt,
      createdBy: normalizeActorName(context.actor),
    };

    runtime.store = normalizeStore({
      ...runtime.store,
      cdkBatches: [batch, ...(runtime.store.cdkBatches ?? [])],
      cdkCodes: [...codeRecords, ...(runtime.store.cdkCodes ?? [])],
    });
    await persistStore(runtime.resolvedStoreFilePath, runtime.store);
    runtime.loadedAt = new Date().toISOString();

    return {
      ...(await buildCdkState()),
      createdBatchId: batchId,
      createdCodes: codes,
      message: `已生成 ${payload.quantity} 个黑奴跳边 CDK。`,
    };
  }

  async function deactivateCdkBatch(batchId, context = {}) {
    await loadStoreFromDisk({ repair: true });
    const normalizedBatchId = String(batchId ?? "").trim();
    const batchIndex = (runtime.store.cdkBatches ?? []).findIndex((item) => item.id === normalizedBatchId);
    if (batchIndex < 0) {
      throw createModuleError(404, "CdkBatchNotFound", "未找到对应的黑奴跳边 CDK 批次。");
    }

    const nextBatches = cloneValue(runtime.store.cdkBatches ?? []);
    nextBatches[batchIndex] = {
      ...nextBatches[batchIndex],
      deactivated: true,
      deactivatedAt: new Date().toISOString(),
      deactivatedBy: normalizeActorName(context.actor),
    };

    runtime.store = normalizeStore({
      ...runtime.store,
      cdkBatches: nextBatches,
    });
    await persistStore(runtime.resolvedStoreFilePath, runtime.store);
    runtime.loadedAt = new Date().toISOString();

    return {
      ...(await buildCdkState()),
      message: "该批次已停用，未使用的黑奴跳边 CDK 将无法继续激活。",
    };
  }

  async function buildCdkState(extra = {}) {
    const store = runtime.store ?? createEmptyStore();
    return {
      ok: true,
      batches: buildBatchView(store),
      activations: cloneValue(store.cdkActivations ?? []),
      summary: buildSummary(store),
      loadedAt: runtime.loadedAt,
      ...extra,
    };
  }

  async function buildBatchActivationState(batchId, filters = {}) {
    const normalizedBatchId = String(batchId ?? "").trim();
    const store = runtime.store ?? createEmptyStore();
    const batch = buildBatchView(store).find((item) => item.id === normalizedBatchId);
    if (!batch) {
      throw createModuleError(404, "CdkBatchNotFound", "未找到对应的黑奴跳边 CDK 批次。");
    }

    const steamIdFilter = String(filters.steamId ?? "").trim().toLowerCase();
    const resultFilter = String(filters.result ?? "").trim().toLowerCase();
    const records = (store.cdkActivations ?? []).filter((record) => {
      if (record.batchId !== normalizedBatchId) return false;
      if (steamIdFilter && !String(record.steamId ?? "").toLowerCase().includes(steamIdFilter)) return false;
      if (resultFilter && String(record.result ?? "").toLowerCase() !== resultFilter) return false;
      return true;
    });

    return {
      ok: true,
      batch,
      records: cloneValue(records),
    };
  }

  async function handleChatMessage(event = {}) {
    try {
      if (!runtime.config.enabled) return;
      const channel = normalizeChatChannel(event?.chatChannel ?? event?.channel);
      if (channel !== "all") return;

      const rawMessage = String(event?.message ?? "").trim();
      if (!rawMessage || !CDK_INPUT_RE.test(rawMessage)) return;

      const playerName = String(event?.playerName ?? event?.name ?? "").trim();
      const steamId = String(event?.steamId ?? event?.steamID ?? "").trim();
      if (!playerName || !STEAM64_RE.test(steamId)) {
        const activation = await logActivation({
          playerName,
          steamId,
          code: rawMessage,
          codeType: null,
          batchId: null,
          result: ACTIVATION_RESULTS.INVALID_PLAYER,
          failureReason: "玩家身份无效，无法激活黑奴跳边 CDK。",
          grantedCount: 0,
        });
        await sendActivationNotice(activation);
        return;
      }

      const activation = await activateCdkFromChat({
        playerName,
        steamId,
        message: rawMessage,
      });
      await sendActivationNotice(activation);
    } catch (error) {
      moduleLogger?.warn?.(`[BlackEdgePrivilege] failed to process chat activation: ${error?.message ?? error}`);
    }
  }

  async function activateCdkFromChat({ playerName, steamId, message }) {
    await loadStoreFromDisk({ repair: true });

    const body = String(message ?? "").trim().slice(DEFAULT_CDK_PREFIX.length);
    const knownTypes = [...new Set((runtime.store.cdkBatches ?? []).map((item) => String(item.codeType ?? "").trim()).filter(Boolean))];
    const matchedType = knownTypes.find((codeType) => body.startsWith(codeType)) ?? null;

    if (!matchedType) {
      return logActivation({
        playerName,
        steamId,
        code: message,
        codeType: null,
        batchId: null,
        result: ACTIVATION_RESULTS.TYPE_MISMATCH,
        failureReason: "CDK 类型不匹配。",
        grantedCount: 0,
      });
    }

    const code = `${DEFAULT_CDK_PREFIX}${body}`;
    const codeRecord = (runtime.store.cdkCodes ?? []).find((item) => item.code === code);
    if (!codeRecord) {
      return logActivation({
        playerName,
        steamId,
        code,
        codeType: matchedType,
        batchId: null,
        result: ACTIVATION_RESULTS.CODE_NOT_FOUND,
        failureReason: "CDK 不存在。",
        grantedCount: 0,
      });
    }

    const batch = (runtime.store.cdkBatches ?? []).find((item) => item.id === codeRecord.batchId);
    if (!batch) {
      return logActivation({
        playerName,
        steamId,
        code,
        codeType: matchedType,
        batchId: codeRecord.batchId,
        result: ACTIVATION_RESULTS.CODE_NOT_FOUND,
        failureReason: "CDK 批次不存在。",
        grantedCount: 0,
      });
    }

    if (batch.deactivated) {
      return logActivation({
        playerName,
        steamId,
        code,
        codeType: matchedType,
        batchId: batch.id,
        result: ACTIVATION_RESULTS.BATCH_DEACTIVATED,
        failureReason: "该批次已停用，无法继续激活。",
        grantedCount: 0,
      });
    }

    if (codeRecord.status === "used") {
      return logActivation({
        playerName,
        steamId,
        code,
        codeType: matchedType,
        batchId: batch.id,
        result: ACTIVATION_RESULTS.CODE_USED,
        failureReason: "该 CDK 已被使用。",
        grantedCount: 0,
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
        code,
        codeType: matchedType,
        batchId: batch.id,
        result: ACTIVATION_RESULTS.DUPLICATE_PLAYER_RESTRICTED,
        failureReason: "该批次不允许同一玩家重复激活。",
        grantedCount: 0,
      });
    }

    const updatedPlayer = await modules?.playerDatabase?.addAssetByIdentity?.({
      name: playerName,
      steamID: steamId,
    }, ASSET_KEY, Number(batch.grantCount ?? 0) || 0);

    if (!updatedPlayer) {
      return logActivation({
        playerName,
        steamId,
        code,
        codeType: matchedType,
        batchId: batch.id,
        result: ACTIVATION_RESULTS.INTERNAL_ERROR,
        failureReason: "玩家资产写入失败。",
        grantedCount: 0,
      });
    }

    const activatedAt = new Date().toISOString();
    const nextCodes = cloneValue(runtime.store.cdkCodes ?? []);
    const codeIndex = nextCodes.findIndex((item) => item.code === code);
    nextCodes[codeIndex] = {
      ...nextCodes[codeIndex],
      status: "used",
      activatedBySteamId: steamId,
      activatedByPlayerName: playerName,
      activatedAt,
    };

    runtime.store = normalizeStore({
      ...runtime.store,
      cdkCodes: nextCodes,
    });

    const activation = await logActivation({
      playerName,
      steamId,
      code,
      codeType: matchedType,
      batchId: batch.id,
      result: ACTIVATION_RESULTS.SUCCESS,
      failureReason: "",
      grantedCount: Number(batch.grantCount ?? 0) || 0,
      remainingCount: Math.max(0, Number(
        updatedPlayer?.blackEdgeSwitchCount
        ?? updatedPlayer?.assets?.[ASSET_KEY]
        ?? 0,
      ) || 0),
    });
    await persistStore(runtime.resolvedStoreFilePath, runtime.store);
    runtime.loadedAt = new Date().toISOString();
    return activation;
  }

  async function sendActivationNotice(activation) {
    const targetName = String(activation.playerName ?? "").trim();
    const targetSteamId = String(activation.steamId ?? "").trim();
    const notice = buildActivationNotice(activation);
    if (notice && targetName && typeof modules?.adminWarn?.warnPlayer === "function") {
      try {
        await modules.adminWarn.warnPlayer({
          targetName,
          targetSteamId,
          message: notice,
          reason: "black_edge_cdk_activation",
          sourceModule: MODULE_ID,
          system: true,
        });
      } catch (error) {
        moduleLogger?.warn?.(`[BlackEdgePrivilege] failed to warn player: ${error?.message ?? error}`);
      }
    }

    if (activation.result !== ACTIVATION_RESULTS.SUCCESS) return;
    if (typeof modules?.adminWarn?.broadcastMessage !== "function") return;
    try {
      await modules.adminWarn.broadcastMessage({
        message: `[黑奴跳边 CDK] 玩家 ${targetName || "未知玩家"} 已激活 ${activation.grantedCount} 次黑奴跳边，当前剩余 ${activation.remainingCount ?? activation.grantedCount} 次`,
        reason: "black_edge_cdk_activation_broadcast",
        sourceModule: MODULE_ID,
        system: true,
      });
    } catch (error) {
      moduleLogger?.warn?.(`[BlackEdgePrivilege] failed to broadcast activation: ${error?.message ?? error}`);
    }
  }

  async function logActivation(record) {
    const activationRecord = {
      id: `black_edge_activation_${Date.now()}_${randomToken(6)}`,
      createdAt: new Date().toISOString(),
      playerName: String(record.playerName ?? "").trim(),
      steamId: String(record.steamId ?? "").trim(),
      code: String(record.code ?? "").trim(),
      codeType: optionalText(record.codeType),
      batchId: optionalText(record.batchId),
      result: String(record.result ?? ACTIVATION_RESULTS.INTERNAL_ERROR).trim(),
      failureReason: String(record.failureReason ?? "").trim(),
      grantedCount: Math.max(0, Number(record.grantedCount ?? 0) || 0),
      remainingCount: record.remainingCount == null ? null : Math.max(0, Number(record.remainingCount ?? 0) || 0),
    };

    runtime.store = normalizeStore({
      ...runtime.store,
      cdkActivations: [activationRecord, ...(runtime.store.cdkActivations ?? [])].slice(0, DEFAULT_ACTIVATION_RECORD_LIMIT),
    });
    await persistStore(runtime.resolvedStoreFilePath, runtime.store);
    runtime.loadedAt = new Date().toISOString();
    return activationRecord;
  }
}

function readModuleConfig(config) {
  const current = config?.get?.("blackEdgePrivilege", {}) ?? {};
  return {
    enabled: Boolean(current.enabled ?? true),
    storeFilePath: String(current.storeFilePath ?? DEFAULT_STORE_FILE).trim() || DEFAULT_STORE_FILE,
  };
}

export async function ensureStoreFile(filePath, { repair = true } = {}) {
  const normalizedPath = String(filePath ?? "").trim();
  if (!normalizedPath) {
    throw new Error("black edge privilege store file path is required.");
  }

  await fs.mkdir(path.dirname(normalizedPath), { recursive: true });

  try {
    const text = await fs.readFile(normalizedPath, "utf8");
    normalizeStore(JSON.parse(text));
    return;
  } catch (error) {
    if (error?.code !== "ENOENT" && repair) {
      const brokenPath = `${normalizedPath}.broken-${Date.now()}.json`;
      try {
        await fs.rename(normalizedPath, brokenPath);
      } catch {
        try {
          await fs.copyFile(normalizedPath, brokenPath);
        } catch {}
      }
    } else if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  await persistStore(normalizedPath, createEmptyStore());
}

function normalizeStore(raw) {
  return {
    version: Number(raw?.version ?? DEFAULT_STORE_VERSION) || DEFAULT_STORE_VERSION,
    cdkBatches: Array.isArray(raw?.cdkBatches) ? raw.cdkBatches.map(normalizeBatch).filter(Boolean) : [],
    cdkCodes: Array.isArray(raw?.cdkCodes) ? raw.cdkCodes.map(normalizeCode).filter(Boolean) : [],
    cdkActivations: Array.isArray(raw?.cdkActivations) ? raw.cdkActivations.map(normalizeActivation).filter(Boolean) : [],
  };
}

function normalizeBatch(batch) {
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) return null;
  const id = String(batch.id ?? "").trim();
  const codeType = String(batch.codeType ?? "").trim();
  if (!id || !codeType) return null;
  return {
    id,
    codeType,
    quantity: Math.max(0, Number(batch.quantity ?? 0) || 0),
    grantCount: Math.max(1, Number(batch.grantCount ?? 1) || 1),
    allowMultiActivation: Boolean(batch.allowMultiActivation),
    deactivated: Boolean(batch.deactivated),
    deactivatedAt: optionalText(batch.deactivatedAt),
    deactivatedBy: optionalText(batch.deactivatedBy),
    createdAt: optionalText(batch.createdAt),
    createdBy: optionalText(batch.createdBy),
  };
}

function normalizeCode(code) {
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
  };
}

function normalizeActivation(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const id = String(record.id ?? "").trim();
  const result = String(record.result ?? "").trim();
  if (!id || !result) return null;
  return {
    id,
    createdAt: optionalText(record.createdAt),
    playerName: String(record.playerName ?? "").trim(),
    steamId: String(record.steamId ?? "").trim(),
    code: String(record.code ?? "").trim(),
    codeType: optionalText(record.codeType),
    batchId: optionalText(record.batchId),
    result,
    failureReason: String(record.failureReason ?? "").trim(),
    grantedCount: Math.max(0, Number(record.grantedCount ?? 0) || 0),
    remainingCount: record.remainingCount == null ? null : Math.max(0, Number(record.remainingCount ?? 0) || 0),
  };
}

function createEmptyStore() {
  return {
    version: DEFAULT_STORE_VERSION,
    cdkBatches: [],
    cdkCodes: [],
    cdkActivations: [],
  };
}

function buildBatchView(store) {
  const batches = cloneValue((store?.cdkBatches ?? []).filter((batch) => !batch?.deactivated));
  const codes = store?.cdkCodes ?? [];
  const activations = store?.cdkActivations ?? [];
  return batches.map((batch) => {
    const relatedCodes = codes.filter((item) => item.batchId === batch.id);
    const usedCount = relatedCodes.filter((item) => item.status === "used").length;
    return {
      ...batch,
      codes: relatedCodes.map((item) => String(item?.code ?? "").trim()).filter(Boolean),
      usedCount,
      remainingCount: Math.max(0, relatedCodes.length - usedCount),
      activationCount: activations.filter((item) => item.batchId === batch.id).length,
      status: batch.deactivated ? "deactivated" : "active",
    };
  });
}

function buildSummary(store) {
  const batches = Array.isArray(store?.cdkBatches) ? store.cdkBatches : [];
  const visibleBatches = batches.filter((item) => !item.deactivated);
  const codes = Array.isArray(store?.cdkCodes) ? store.cdkCodes : [];
  const activations = Array.isArray(store?.cdkActivations) ? store.cdkActivations : [];
  const usedCodeCount = codes.filter((item) => item.status === "used").length;
  return {
    batchCount: visibleBatches.length,
    activeBatchCount: visibleBatches.length,
    deactivatedBatchCount: batches.filter((item) => item.deactivated).length,
    codeCount: codes.length,
    usedCodeCount,
    remainingCodeCount: Math.max(0, codes.length - usedCodeCount),
    activationCount: activations.length,
    successCount: activations.filter((item) => item.result === ACTIVATION_RESULTS.SUCCESS).length,
    failureCount: activations.filter((item) => item.result !== ACTIVATION_RESULTS.SUCCESS).length,
    totalGrantedCount: activations
      .filter((item) => item.result === ACTIVATION_RESULTS.SUCCESS)
      .reduce((sum, item) => sum + Math.max(0, Number(item.grantedCount ?? 0) || 0), 0),
  };
}

function normalizeCreateBatchInput(input = {}) {
  const codeType = String(input.codeType ?? "").trim().toUpperCase();
  const quantity = Math.min(Math.max(Number(input.quantity ?? 0) || 0, 1), 500);
  const grantCount = Math.min(Math.max(Number(input.grantCount ?? 0) || 0, 1), 999);
  if (!codeType) {
    throw createModuleError(400, "InvalidCodeType", "codeType 不能为空。");
  }
  if (!/^[A-Z0-9_-]{1,12}$/.test(codeType)) {
    throw createModuleError(400, "InvalidCodeType", "codeType 仅支持 1-12 位大写字母、数字、下划线或中划线。");
  }
  return {
    codeType,
    quantity,
    grantCount,
    allowMultiActivation: Boolean(input.allowMultiActivation),
  };
}

function buildActivationNotice(record) {
  switch (record.result) {
    case ACTIVATION_RESULTS.SUCCESS:
      return `[黑奴跳边 CDK] 激活成功，已获得 ${record.grantedCount} 次黑奴跳边，当前剩余 ${record.remainingCount ?? record.grantedCount} 次`;
    case ACTIVATION_RESULTS.TYPE_MISMATCH:
      return "[黑奴跳边 CDK] CDK 类型不匹配。";
    case ACTIVATION_RESULTS.CODE_NOT_FOUND:
      return "[黑奴跳边 CDK] CDK 不存在。";
    case ACTIVATION_RESULTS.BATCH_DEACTIVATED:
      return "[黑奴跳边 CDK] 该批次已停用，无法继续激活。";
    case ACTIVATION_RESULTS.CODE_USED:
      return "[黑奴跳边 CDK] 该 CDK 已被使用。";
    case ACTIVATION_RESULTS.DUPLICATE_PLAYER_RESTRICTED:
      return "[黑奴跳边 CDK] 该批次不允许你重复激活。";
    case ACTIVATION_RESULTS.INVALID_PLAYER:
      return "[黑奴跳边 CDK] 无法识别你的玩家身份。";
    default:
      return `[黑奴跳边 CDK] ${record.failureReason || "激活失败。"}`;
  }
}

async function persistStore(filePath, store) {
  const normalizedPath = String(filePath ?? "").trim();
  if (!normalizedPath) {
    throw new Error("black edge privilege store file path is required.");
  }
  await fs.mkdir(path.dirname(normalizedPath), { recursive: true });
  const tempPath = `${normalizedPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(normalizeStore(store), null, 2)}\n`, "utf8");
  await fs.rename(tempPath, normalizedPath);
}

function createModuleError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function resolveConfigPath(value, fallback) {
  const text = String(value ?? "").trim();
  const resolved = text || fallback;
  if (!resolved) return "";
  return path.isAbsolute(resolved) ? resolved : path.resolve(process.cwd(), resolved);
}

function normalizeChatChannel(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "chatall" || text === "all") return "all";
  return text;
}

function normalizeActorName(actor) {
  if (!actor || typeof actor !== "object") return "system";
  return String(actor.username ?? actor.name ?? actor.id ?? "system").trim() || "system";
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function randomToken(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let output = "";
  while (output.length < length) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

function cloneValue(value) {
  if (value == null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}
