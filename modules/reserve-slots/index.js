// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const MODULE_ID = "module.reserveSlots";
const DEFAULT_LOCAL_RESERVE_FILE = "data/reserve-slots.json";
const DEFAULT_STORE_VERSION = 1;
const RESERVE_MARKER_RE = /\/\/\s*预留位/;

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
  };

  runtime.resolvedLocalReserveFilePath = resolveConfigPath(
    runtime.config.localReserveFilePath,
    DEFAULT_LOCAL_RESERVE_FILE,
  );

  const api = {
    async getState() {
      return buildState();
    },

    async updateConfig(nextConfig = {}) {
      return await updateReserveSystemConfig(nextConfig);
    },

    async importFromAdminFile() {
      return await importReserveSlotsFromAdminFile();
    },

    async exportCsv() {
      return await exportReserveSlotsCsv();
    },

    async importFromCsv(csvText = "") {
      return await importReserveSlotsFromCsv(csvText);
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
      version: "1.0.0",
      description: "读取 Squad 管理员配置文件中的预留位区块，并同步到本地 JSON 存储供页面展示。",
    },
    apiName: "reserveSlots",
    api,

    async init() {
      await loadStoreFromDisk({ repair: true });
    },

    async start() {
      moduleLogger?.info?.(`[ReserveSlots] started. enabled=${Boolean(runtime.config.enabled)} local=${runtime.resolvedLocalReserveFilePath}`);
    },

    async stop() {
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
      moduleLogger?.info?.("[ReserveSlots] 管理员配置文件未配置，跳过同步。");
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

      await persistStore(runtime.resolvedLocalReserveFilePath, parsed);
      runtime.store = parsed;
      runtime.loadedAt = importedAt;

      moduleLogger?.info?.(`[ReserveSlots] 已从管理员文件同步预留位: groups=${parsed.groups.length} members=${parsed.members.length}`);
      return buildState({
        message: "已从管理员文件同步预留位数据",
      });
    } catch (error) {
      if (error?.code === "ENOENT") {
        moduleLogger?.warn?.(`[ReserveSlots] 管理员配置文件不存在: ${resolvedAdminFilePath}`);
        return buildState({
          message: "管理员配置文件不存在，已返回当前本地数据。",
          adminFileMissing: true,
        });
      }

      moduleLogger?.warn?.(`[ReserveSlots] 读取管理员配置文件失败: ${error?.message ?? String(error)}`);
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

    await persistStore(runtime.resolvedLocalReserveFilePath, parsed);
    runtime.store = parsed;
    runtime.loadedAt = importedAt;
    return buildState({
      message: "CSV 导入完成。",
    });
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
      loadedAt: runtime.loadedAt,
      ...extra,
    };
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
    options.logger?.info?.("[ReserveSlots] 未找到 // 预留位 标记，返回空列表。");
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
        options.logger?.warn?.(`[ReserveSlots] 无法解析 Group 行，已跳过: ${line}`);
        continue;
      }
      groups.push(group);
      continue;
    }

    if (line.startsWith("Admin=")) {
      const member = parseReserveMemberLine(line);
      if (!member) {
        options.logger?.warn?.(`[ReserveSlots] 无法解析 Admin 行，已跳过: ${line}`);
        continue;
      }
      members.push(member);
      continue;
    }

    options.logger?.debug?.(`[ReserveSlots] 跳过未识别行: ${line}`);
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

function parseReserveMemberLine(line) {
  const content = String(line ?? "").trim();
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
    return {
      expireAt: localDateMatch[1],
      name: "",
      reasons: splitReserveReasons(payload),
      remark: payload,
    };
  }

  const isoDateMatch = text.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)(?:\s+(.*))?$/);
  if (isoDateMatch) {
    const payload = String(isoDateMatch[2] ?? "").trim();
    return {
      expireAt: isoDateMatch[1],
      name: "",
      reasons: splitReserveReasons(payload),
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

function normalizeStore(raw, { adminFilePath = "" } = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw.source
    : null;
  const groups = Array.isArray(raw?.groups) ? raw.groups.map(normalizeGroup).filter(Boolean) : [];
  const members = Array.isArray(raw?.members) ? raw.members.map(normalizeMember).filter(Boolean) : [];
  const lastImportedAt = String(source?.lastImportedAt ?? raw?.lastImportedAt ?? "").trim() || null;

  return {
    version: Number(raw?.version ?? DEFAULT_STORE_VERSION) || DEFAULT_STORE_VERSION,
    source: {
      adminFilePath: String(source?.adminFilePath ?? adminFilePath ?? "").trim(),
      lastImportedAt,
    },
    groups,
    members,
  };
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
    remark: String(member.remark ?? reasons.join("；")).trim(),
    rawLine,
    isExpired: Boolean(parsedExpireAt && parsedExpireAt.getTime() < Date.now()),
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
  };
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
    .split(/[|;,，、\/]+/)
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
    options.logger?.warn?.("[ReserveSlots] CSV 缺少 steamId/group 列，返回空列表。");
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
      remark: remark || reasons.join("；"),
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
  const namePart = parts.find((item) => /^(name|昵称|名称)\s*[:=]/i.test(item));
  const reasonParts = parts.filter((item) => !/^(name|昵称|名称)\s*[:=]/i.test(item));
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
