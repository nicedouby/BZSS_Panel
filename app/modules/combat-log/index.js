// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_DIR = "./data/combat-logs";
const SUBSCRIPTION_ID = "module.combatLog";
const COMBAT_CLEAN_EVENTS = new Set(["damageResolved", "woundResolved", "killResolved", "reviveResolved"]);
const SQUID_BOT_CONTROLLER_ID = "SquidBotAIController_C";

export function createCombatLogModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: SUBSCRIPTION_ID,
    source: SUBSCRIPTION_ID,
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config?.get?.("modules.combatLog", {}) ?? {};
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const baseDir = path.resolve(process.cwd(), String(moduleConfig.directory ?? DEFAULT_BASE_DIR).trim() || DEFAULT_BASE_DIR);
  const unsubscribers = [];
  const seenEventKeys = new Map();
  let writeChain = Promise.resolve();
  let writeCount = 0;
  let lastWriteAt = "";
  let lastWriteFilePath = "";
  let lastError = "";
  let lastLine = "";

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.(SUBSCRIPTION_ID) !== false
      && core.pluginSubscriptions?.isSubscribed?.(SUBSCRIPTION_ID) !== false;
  }

  function normalizeRecord(event) {
    const record = event?.record && typeof event.record === "object"
      ? event.record
      : event?.rejection && typeof event.rejection === "object"
        ? event.rejection
        : event && typeof event === "object"
          ? event
          : null;
    if (!record) return null;

    const time = String(record.time ?? event?.time ?? new Date().toISOString());
    const type = formatType(record);
    const mark = formatMark(record);
    const attacker = formatAttackerName(record);
    const victim = formatPlayerName(record.victim ?? record.victimName ?? record.victimDisplayName ?? record.victim?.displayName ?? record.victim?.name);
    const attackerTeamId = formatTeamId(
      record.attackerTeamID
      ?? record.attackerTeamId
      ?? record.attacker?.teamID
      ?? record.attacker?.teamId,
    );
    const victimTeamId = formatTeamId(
      record.victimTeamID
      ?? record.victimTeamId
      ?? record.victim?.teamID
      ?? record.victim?.teamId,
    );
    const damage = formatDamage(record.damage);
    const weapon = formatWeapon(record.weapon ?? record.weaponName ?? record.causedBy ?? record.rawCausedBy ?? record.weapon?.displayName);

    return {
      sourceEventKey: buildEventKey(record, event),
      time,
      type,
      mark,
      attacker,
      victim,
      attackerTeamId,
      victimTeamId,
      damage,
      weapon,
    };
  }

  function formatType(record = {}) {
    const baseType = String(record.type ?? record.eventType ?? "").trim().toLowerCase();
    if (record.isTeamKill || record.tk || baseType === "tk") return "tk";
    if (baseType === "damaged") return "damage";
    if (baseType === "wounded") return "wound";
    if (baseType === "death") return "kill";
    if (baseType === "died") return "kill";
    if (baseType === "revived") return "revive";
    return baseType || "unknown";
  }

  function formatMark(record = {}) {
    const labels = [];
    for (const label of Array.isArray(record.eventFlagLabels) ? record.eventFlagLabels : []) {
      const text = sanitizeLineValue(label);
      if (text) labels.push(text);
    }

    if (!labels.length && record.isFriendlyFire) {
      labels.push(sanitizeLineValue(record.friendlyFireLabel || "友伤"));
    }

    if (!labels.length && record.isTeamKillDown) {
      labels.push("TK击倒");
    }

    if (!labels.length && record.isTeamKill) {
      labels.push("友伤");
    }

    const unique = [...new Set(labels.filter(Boolean))];
    return unique.length ? unique.join("|") : "-";
  }

  function formatPlayerName(value) {
    if (value && typeof value === "object") {
      return sanitizeLineValue(value.displayName || value.name || value.playerName || value.title || "");
    }
    return sanitizeLineValue(value);
  }

  function formatAttackerName(record = {}) {
    if (record?.attacker?.isBot || record?.isBotAttack) {
      return "bot";
    }

    const attackerName = sanitizeLineValue(record.attackerName ?? record.attackerDisplayName ?? record.attacker?.displayName ?? record.attacker?.name ?? "");
    const attackerControllerID = sanitizeLineValue(record.attackerControllerID ?? record.attackerControllerId ?? record.attacker?.controllerID ?? "");
    const weapon = sanitizeLineValue(
      record.weapon?.displayName
      ?? record.weapon?.raw
      ?? record.weaponName
      ?? record.causedBy
      ?? record.rawCausedBy
      ?? record.weapon
      ?? "",
    );

    if (isSquidBotControllerID(attackerControllerID) || isSquidBotControllerID(attackerName)) {
      return "bot";
    }

    if (isBotWeaponName(weapon)) {
      return "bot";
    }

    return attackerName || formatPlayerName(record.attacker);
  }

  function formatDamage(value) {
    if (value == null || String(value).trim() === "") return "-";
    const number = Number(value);
    if (!Number.isFinite(number)) return sanitizeLineValue(value);
    return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(6)));
  }

  function formatTeamId(value) {
    const text = sanitizeLineValue(value);
    return text || "-";
  }

  function formatWeapon(value) {
    if (value && typeof value === "object") {
      return sanitizeLineValue(value.displayName || value.cleaned || value.raw || value.name || "");
    }
    return sanitizeLineValue(value);
  }

  function buildEventKey(record, event) {
    // CombatState emits the raw record first, then CombatClean emits the
    // enriched record. The clean record carries the original identifier under
    // raw.sourceEventId, so both layers must resolve to the same key.
    const explicitKey = [
      record?.sourceEventId,
      record?.raw?.sourceEventId,
      record?.eventId,
      event?.sourceEventId,
      event?.eventId,
      event?.record?.sourceEventId,
      event?.record?.raw?.sourceEventId,
    ].find((value) => String(value ?? "").trim());
    if (explicitKey) return String(explicitKey).trim();

    // Older parser events may have no id. rawLog is still stable across the
    // raw and cleaned representations and is safer than a random key.
    const serverId = record?.serverId ?? event?.serverId ?? "";
    const time = record?.time ?? event?.time ?? "";
    const rawLog = record?.rawLog ?? record?.raw?.rawLog ?? event?.rawLog ?? "";
    if (String(rawLog).trim()) {
      return `raw:${serverId}:${time}:${rawLog}`.trim();
    }

    const type = record?.type ?? record?.eventType ?? "";
    const victim = record?.victimName ?? record?.victim?.name ?? record?.victim?.displayName ?? "";
    const damage = record?.damage ?? "";
    const weapon = record?.weaponName ?? record?.weapon?.displayName ?? record?.weapon ?? record?.causedBy ?? "";
    return `fallback:${serverId}:${time}:${type}:${victim}:${damage}:${weapon}`.trim();
  }

  function sanitizeLineValue(value) {
    return String(value ?? "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isSquidBotControllerID(value) {
    const text = sanitizeLineValue(value);
    return text === SQUID_BOT_CONTROLLER_ID || text.startsWith(`${SQUID_BOT_CONTROLLER_ID}_`);
  }

  function isBotWeaponName(value) {
    const text = sanitizeLineValue(value).toLowerCase();
    if (!text) return false;
    const compact = text.replace(/[\s._-]+/g, "");
    return text === "projectile"
      || text === "projectile_xmm"
      || text === "projectile xmm"
      || compact === "projectile"
      || compact === "projectilexmm";
  }

  function formatDateParts(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    const year = safeDate.getFullYear();
    const month = String(safeDate.getMonth() + 1).padStart(2, "0");
    const day = String(safeDate.getDate()).padStart(2, "0");
    const hour = String(safeDate.getHours()).padStart(2, "0");
    const minute = String(safeDate.getMinutes()).padStart(2, "0");
    const second = String(safeDate.getSeconds()).padStart(2, "0");
    return {
      date: safeDate,
      year,
      month,
      day,
      monthKey: `${year}-${month}`,
      dateKey: `${year}-${month}-${day}`,
      timeKey: `${hour}:${minute}:${second}`,
    };
  }

  function resolveTargetPath(value) {
    const parts = formatDateParts(value);
    const folderPath = path.join(baseDir, parts.monthKey);
    const fileName = `${parts.dateKey}.log`;
    const filePath = path.join(folderPath, fileName);
    return {
      ...parts,
      folderPath,
      fileName,
      filePath,
      relativePath: path.relative(process.cwd(), filePath),
    };
  }

  function formatLogLine(entry) {
    const fields = [
      entry.timeKey,
      entry.type,
      entry.mark,
      entry.attacker,
      entry.victim,
      entry.damage,
      entry.weapon,
    ];
    if (entry.attackerTeamId !== "-" || entry.victimTeamId !== "-") {
      fields.push(entry.attackerTeamId, entry.victimTeamId);
    }
    return fields.join("\t");
  }

  function pruneSeenKeys(now = Date.now()) {
    const ttlMs = 24 * 60 * 60 * 1000;
    for (const [key, seenAt] of seenEventKeys.entries()) {
      if (now - seenAt > ttlMs) {
        seenEventKeys.delete(key);
      }
    }
    if (seenEventKeys.size <= 20000) return;

    const sorted = [...seenEventKeys.entries()].sort((left, right) => left[1] - right[1]);
    for (let i = 0; i < sorted.length - 20000; i += 1) {
      seenEventKeys.delete(sorted[i][0]);
    }
  }

  async function appendEntry(entry) {
    const target = resolveTargetPath(entry.time);
    const line = formatLogLine({
      ...entry,
      ...target,
    });

    if (seenEventKeys.has(entry.sourceEventKey)) {
      return null;
    }

    const eventKey = entry.sourceEventKey;
    const scheduledAt = Date.now();
    seenEventKeys.set(eventKey, scheduledAt);
    writeChain = writeChain
      .then(async () => {
        await fs.mkdir(target.folderPath, { recursive: true });
        if (lastWriteFilePath !== target.filePath) {
          lastWriteFilePath = target.filePath;
          moduleLogger.info("Combat log file rotated.", {
            operation: "rotate",
            data: {
              filePath: target.filePath,
              relativePath: target.relativePath,
              month: target.monthKey,
              date: target.dateKey,
            },
          });
        }
        await fs.appendFile(target.filePath, `${line}\n`, "utf8");
        pruneSeenKeys();
        writeCount += 1;
        lastWriteAt = new Date().toISOString();
        lastLine = line;
      })
      .catch((error) => {
        lastError = String(error?.message ?? error ?? "Combat log write failed.");
        moduleLogger.warn(`Combat log write failed: ${lastError}`);
      });

    return writeChain;
  }

  function handleCombatEvent(event) {
    if (!enabled || !isSubscribed()) return null;
    const entry = normalizeRecord(event);
    if (!entry) return null;
    return appendEntry(entry);
  }

  async function listMonths() {
    return listCombatMonths(baseDir);
  }

  async function listFiles(month) {
    return listCombatFiles(baseDir, month);
  }

  async function readLog(filter = {}) {
    return readCombatLog(baseDir, filter);
  }

  async function searchLog(filter = {}) {
    return searchCombatLogs(baseDir, filter);
  }

  function getStatus() {
    const currentTarget = resolveTargetPath(new Date());
    return {
      ok: true,
      enabled,
      baseDir,
      currentMonth: currentTarget.monthKey,
      currentDate: currentTarget.dateKey,
      currentFilePath: lastWriteFilePath || currentTarget.filePath,
      currentRelativePath: lastWriteFilePath ? path.relative(process.cwd(), lastWriteFilePath) : currentTarget.relativePath,
      currentTargetFilePath: currentTarget.filePath,
      currentTargetRelativePath: currentTarget.relativePath,
      lastWrittenFilePath: lastWriteFilePath,
      lastWrittenAt: lastWriteAt,
      writeCount,
      lastError,
      lastLine,
    };
  }

  const api = {
    getStatus,
    listMonths,
    listFiles,
    readLog,
    searchLog,
    getCurrentFilePath() {
      return getStatus().currentFilePath;
    },
  };

  return {
    manifest: {
      id: SUBSCRIPTION_ID,
      name: "战斗日志",
      kind: "module",
      version: "1.0.0",
      description: "将战斗管理输出按月分文件夹、按天分文件落盘，并提供浏览接口。",
    },
    apiName: "combatLog",
    api,

    async start() {
      core.webRegistry?.registerPage?.({
        id: "web.combatLog",
        title: "战斗日志",
        group: "管理",
        route: "/combat-log",
        pageModule: "/pages/combat-log.js",
        source: SUBSCRIPTION_ID,
        required: false,
        enabled: true,
        order: 114,
        icon: "🗂️",
        requiredPermission: "combat_manager.view",
      });

      unsubscribers.push(core.eventBus?.onModuleEvent?.("module.combatState", "updated", handleCombatEvent));
      for (const eventName of COMBAT_CLEAN_EVENTS) {
        unsubscribers.push(core.eventBus?.onModuleEvent?.("module.combatClean", eventName, handleCombatEvent));
      }
      unsubscribers.push(core.eventBus?.onModuleEvent?.("module.killManage", "teamKillResolved", handleCombatEvent));

      moduleLogger.info("Combat log module started.", {
        operation: "start",
        data: {
          baseDir,
          currentFilePath: getStatus().currentFilePath,
        },
      });
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe?.();
        } catch {}
      }
      await writeChain;
      moduleLogger.info("Combat log module stopped.", {
        operation: "stop",
        data: {
          writeCount,
          lastWrittenAt: lastWriteAt,
        },
      });
    },
  };
}

async function listCombatMonths(baseDir) {
  const entries = await safeReadDir(baseDir);
  const months = [];

  for (const entry of entries) {
    if (!entry?.isDirectory?.()) continue;
    const month = String(entry.name ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const files = await listCombatFiles(baseDir, month);
    months.push({
      month,
      fileCount: files.length,
      latestDate: files[0]?.date ?? "",
      latestFilePath: files[0]?.filePath ?? "",
      latestMtime: files[0]?.mtime ?? "",
    });
  }

  months.sort((left, right) => String(right.month).localeCompare(String(left.month)));
  return months;
}

async function listCombatFiles(baseDir, month) {
  const monthKey = String(month ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return [];

  const folderPath = path.join(baseDir, monthKey);
  const entries = await safeReadDir(folderPath);
  const files = [];

  for (const entry of entries) {
    if (!entry?.isFile?.()) continue;
    const fileName = String(entry.name ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(fileName)) continue;
    const date = fileName.slice(0, 10);
    const filePath = path.join(folderPath, fileName);
    const stat = await safeStat(filePath);
    files.push({
      date,
      fileName,
      filePath,
      relativePath: path.relative(process.cwd(), filePath),
      size: stat?.size ?? 0,
      mtime: stat ? new Date(stat.mtimeMs).toISOString() : "",
    });
  }

  files.sort((left, right) => String(right.date).localeCompare(String(left.date)));
  return files;
}

async function readCombatLog(baseDir, filter = {}) {
  const month = String(filter.month ?? "").trim();
  const date = String(filter.date ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw createHttpError(400, "InvalidMonth", "month must use YYYY-MM.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createHttpError(400, "InvalidDate", "date must use YYYY-MM-DD.");
  }

  const filePath = path.join(baseDir, month, `${date}.log`);
  const text = await safeReadFile(filePath);
  const allLines = text ? text.split(/\r?\n/).filter((line) => String(line ?? "").trim()) : [];
  const search = String(filter.q ?? filter.search ?? "").trim().toLowerCase();
  const limit = clampNumber(filter.limit, 300, 1, 2000);
  const offset = clampNumber(filter.offset, 0, 0, 1_000_000);

  const filtered = search
    ? allLines.filter((line) => line.toLowerCase().includes(search))
    : allLines;
  const reversed = [...filtered].reverse();
  const slice = reversed.slice(offset, offset + limit);

  return {
    ok: true,
    month,
    date,
    filePath,
    relativePath: path.relative(process.cwd(), filePath),
    total: filtered.length,
    offset,
    limit,
    hasMoreOlder: offset + limit < filtered.length,
    hasMoreNewer: offset > 0,
    lines: slice.map((line, index) => parseCombatLogLine(line, filtered.length - offset - index)),
  };
}

async function searchCombatLogs(baseDir, filter = {}) {
  const startAt = parseSearchDate(filter.from ?? filter.start);
  const endAt = parseSearchDate(filter.to ?? filter.end);
  if (startAt && endAt && startAt > endAt) {
    throw createHttpError(400, "InvalidTimeRange", "from must be earlier than or equal to to.");
  }

  const attacker = normalizeSearchText(filter.attacker);
  const eventType = normalizeEventType(filter.eventType ?? filter.type);
  const victim = normalizeSearchText(filter.victim ?? filter.victimOrTeam);
  const weapon = normalizeSearchText(filter.weapon);
  const damage = normalizeDamageFilter(filter.damage);
  const limit = clampNumber(filter.limit, 100, 1, 500);
  const offset = clampNumber(filter.offset, 0, 0, 1_000_000);
  const months = await listCombatMonths(baseDir);
  const matches = [];
  let filesScanned = 0;

  for (const month of months) {
    const files = await listCombatFiles(baseDir, month.month);
    for (const file of files) {
      if (!fileMayOverlapRange(file.date, startAt, endAt)) continue;
      filesScanned += 1;
      const text = await safeReadFile(file.filePath);
      const lines = text ? text.split(/\r?\n/).filter((line) => String(line ?? "").trim()) : [];

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = parseCombatLogLine(lines[index], index + 1);
        const timestamp = parseLogTimestamp(file.date, line.time);
        if (startAt && (!timestamp || timestamp < startAt)) continue;
        if (endAt && (!timestamp || timestamp > endAt)) continue;
        if (!matchesSearchFilter(line, { attacker, eventType, victim, weapon, damage })) continue;
        matches.push({
          ...line,
          date: file.date,
          timestamp: timestamp ? timestamp.toISOString() : "",
          relativePath: file.relativePath,
        });
      }
    }
  }

  matches.sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return String(right.date ?? "").localeCompare(String(left.date ?? ""));
  });

  const lines = matches.slice(offset, offset + limit);
  return {
    ok: true,
    total: matches.length,
    offset,
    limit,
    hasMoreOlder: offset + limit < matches.length,
    hasMoreNewer: offset > 0,
    filesScanned,
    filters: {
      from: startAt?.toISOString() ?? "",
      to: endAt?.toISOString() ?? "",
      attacker,
      eventType,
      victim,
      weapon,
      damage: damage.raw,
    },
    lines,
  };
}

function matchesSearchFilter(line, filters) {
  if (filters.attacker && !normalizeSearchText(line.attacker).includes(filters.attacker)) return false;
  if (filters.eventType && normalizeEventType(line.type) !== filters.eventType) return false;
  if (filters.victim) {
    const victimName = normalizeSearchText(line.victim);
    const victimTeamId = normalizeSearchText(line.victimTeamId);
    if (!victimName.includes(filters.victim) && victimTeamId !== filters.victim) return false;
  }
  if (filters.weapon && !normalizeSearchText(line.weapon).includes(filters.weapon)) return false;
  if (filters.damage.enabled) {
    const lineDamage = Number(line.damage);
    if (filters.damage.numeric && Number.isFinite(lineDamage)) {
      if (lineDamage !== filters.damage.value) return false;
    } else if (normalizeSearchText(line.damage) !== filters.damage.raw) {
      return false;
    }
  }
  return true;
}

function normalizeSearchText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeEventType(value) {
  const type = normalizeSearchText(value);
  if (type === "damaged") return "damage";
  if (type === "wounded") return "wound";
  if (type === "death" || type === "died") return "kill";
  if (type === "revived") return "revive";
  return type;
}

function normalizeDamageFilter(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return { enabled: false, numeric: false, value: null, raw: "" };
  const valueNumber = Number(raw);
  return {
    enabled: true,
    numeric: Number.isFinite(valueNumber),
    value: Number.isFinite(valueNumber) ? valueNumber : null,
    raw,
  };
}

function parseSearchDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, "InvalidSearchDate", `Invalid date: ${text}`);
  }
  return date;
}

function parseLogTimestamp(dateText, timeText) {
  const date = String(dateText ?? "").trim();
  const time = String(timeText ?? "").trim();
  const parsed = new Date(`${date}T${time}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function fileMayOverlapRange(dateText, startAt, endAt) {
  const dayStart = new Date(`${dateText}T00:00:00`);
  const dayEnd = new Date(`${dateText}T23:59:59.999`);
  if (Number.isNaN(dayStart.getTime()) || Number.isNaN(dayEnd.getTime())) return false;
  if (startAt && dayEnd < startAt) return false;
  if (endAt && dayStart > endAt) return false;
  return true;
}

function parseCombatLogLine(line, lineNumber = 0) {
  const parts = String(line ?? "").split("\t");
  const [
    time = "",
    type = "",
    mark = "",
    attacker = "",
    victim = "",
    damage = "",
    weapon = "",
    attackerTeamId = "-",
    victimTeamId = "-",
    ...rest
  ] = parts;
  return {
    lineNumber,
    time,
    type,
    mark,
    attacker,
    victim,
    damage,
    weapon,
    attackerTeamId: attackerTeamId || "-",
    victimTeamId: victimTeamId || "-",
    raw: String(line ?? ""),
    extra: rest.length ? rest.join("\t") : "",
  };
}

async function safeReadDir(dirPath) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function safeReadFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function clampNumber(value, defaultValue, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(max, Math.max(min, parsed));
}

function createHttpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export default createCombatLogModule;
