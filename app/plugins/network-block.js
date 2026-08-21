// -*- coding: utf-8 -*-
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PLUGIN_ID = "networkBlock";
const PAGE_ROUTE = "/plugins/network-block";
const DEFAULT_DATA_DIR = "./data/plugins/network-block";
const DEFAULT_DATA_FILE = "blocks.json";
const DEFAULT_UDP_PORTS = "7787,7788,27165";
const STATUS_ACTIVE = "active";
const STATUS_DISABLED = "disabled";
const STATUS_EXPIRED = "expired";
const MAX_EVENTS = 50;

const text = (value, fallback = "") => String(value ?? "").trim().replace(/\s+/g, " ") || fallback;
const nowIso = () => new Date().toISOString();
const isExpired = (entry, at = Date.now()) => Boolean(entry?.expiresAt) && Date.parse(entry.expiresAt) <= at;
const formatDuration = (ms) => {
  const value = Math.max(0, Number(ms) || 0);
  if (value < 60_000) return `${Math.max(0, Math.ceil(value / 1000))}秒`;
  if (value < 3_600_000) return `${Math.ceil(value / 60_000)}分钟`;
  if (value < 86_400_000) return `${Math.ceil(value / 3_600_000)}小时`;
  return `${Math.ceil(value / 86_400_000)}天`;
};

function normalizeIp(value) {
  const ip = text(value);
  if (!ip) return "";
  // IPv4 and normal IPv6 literals only. CIDR/ranges are deliberately rejected.
  if (/^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip)) return ip;
  if (/^[0-9a-fA-F:]+$/.test(ip) && ip.includes(":")) return ip;
  return "";
}

function toIso(value) {
  const date = new Date(value ?? "");
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function resolveExpiry(input) {
  const direct = toIso(input?.expiresAt);
  if (direct) return direct;
  const amount = Number(input?.durationValue ?? input?.duration ?? 0);
  const unit = text(input?.durationUnit, "days").toLowerCase();
  const multiplier = { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 }[unit] ?? 0;
  return amount > 0 && multiplier ? new Date(Date.now() + amount * multiplier).toISOString() : "";
}

function effectiveStatus(entry) {
  if (entry.status === STATUS_DISABLED) return STATUS_DISABLED;
  return isExpired(entry) ? STATUS_EXPIRED : STATUS_ACTIVE;
}

function snapshot(entry) {
  const status = effectiveStatus(entry);
  const remaining = entry.expiresAt ? Math.max(0, Date.parse(entry.expiresAt) - Date.now()) : 0;
  return { ...entry, status, isActive: status === STATUS_ACTIVE, isDisabled: status === STATUS_DISABLED,
    isExpired: status === STATUS_EXPIRED, expiresInMs: remaining, expiresInLabel: formatDuration(remaining) };
}

export function createPlugin({ core, config, logger } = {}) {
  const log = logger ?? core?.logger ?? console;
  const runtime = { entries: [], filePath: "", events: [], timer: null, queue: Promise.resolve() };
  const state = { enabled: true, subscribed: true, dataDir: DEFAULT_DATA_DIR, udpPorts: DEFAULT_UDP_PORTS,
    enforcementAvailable: process.platform === "win32", lastSyncAt: "", lastError: "", applySuccess: 0, applyFailed: 0 };

  const enqueue = (task) => {
    const next = runtime.queue.then(task, task);
    runtime.queue = next.catch(() => {});
    return next;
  };
  const pushEvent = (kind, detail = {}) => {
    runtime.events.unshift({ id: crypto.randomUUID(), at: nowIso(), kind, ...detail });
    runtime.events.length = Math.min(runtime.events.length, MAX_EVENTS);
  };
  const getConfig = () => {
    const raw = config?.get?.(`plugins.${PLUGIN_ID}`, {}) ?? {};
    state.enabled = raw.enabled !== false;
    state.dataDir = text(raw.dataDir, DEFAULT_DATA_DIR);
    state.udpPorts = text(raw.udpPorts, DEFAULT_UDP_PORTS);
  };
  const ruleName = (entry, protocol) => `BZSS Network Block ${entry.id} ${protocol}`;

  async function runNetsh(args) {
    if (process.platform !== "win32") {
      const error = new Error("网络阻塞仅能在 Windows 服务器上执行（需要 Windows 防火墙）。");
      error.code = "NetworkBlockWindowsOnly";
      throw error;
    }
    await execFileAsync("netsh.exe", args, { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 });
  }

  async function deleteRules(entry) {
    for (const protocol of ["UDP", "TCP"]) {
      await runNetsh(["advfirewall", "firewall", "delete", "rule", `name=${ruleName(entry, protocol)}`])
        .catch(() => {});
    }
  }

  async function applyRules(entry) {
    await deleteRules(entry);
    // UDP ports cover the Squad game/query traffic. TCP rule covers uncommon TCP listeners without
    // blocking unrelated Windows services.
    await runNetsh(["advfirewall", "firewall", "add", "rule", `name=${ruleName(entry, "UDP")}`,
      "dir=in", "action=block", `remoteip=${entry.ip}`, "protocol=UDP", `localport=${state.udpPorts}`, "profile=any"]);
    await runNetsh(["advfirewall", "firewall", "add", "rule", `name=${ruleName(entry, "TCP")}`,
      "dir=in", "action=block", `remoteip=${entry.ip}`, "protocol=TCP", `localport=${state.udpPorts}`, "profile=any"]);
  }

  async function save(reason) {
    const payload = JSON.stringify({ version: 1, updatedAt: nowIso(), reason, entries: runtime.entries }, null, 2);
    const temp = `${runtime.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(runtime.filePath), { recursive: true });
    await fs.writeFile(temp, payload, "utf8");
    await fs.rename(temp, runtime.filePath);
  }

  async function load(force = false) {
    getConfig();
    runtime.filePath = path.join(path.resolve(process.cwd(), state.dataDir), DEFAULT_DATA_FILE);
    try {
      const parsed = JSON.parse(await fs.readFile(runtime.filePath, "utf8"));
      runtime.entries = (Array.isArray(parsed?.entries) ? parsed.entries : []).map((raw) => {
        const ip = normalizeIp(raw?.ip);
        const expiresAt = toIso(raw?.expiresAt);
        return ip && expiresAt ? {
          id: text(raw?.id) || crypto.randomUUID(), ip, reason: text(raw?.reason), expiresAt,
          status: [STATUS_ACTIVE, STATUS_DISABLED, STATUS_EXPIRED].includes(raw?.status) ? raw.status : STATUS_ACTIVE,
          createdAt: toIso(raw?.createdAt) || nowIso(), createdBy: text(raw?.createdBy),
          updatedAt: toIso(raw?.updatedAt) || nowIso(), appliedAt: toIso(raw?.appliedAt), lastError: text(raw?.lastError),
        } : null;
      }).filter(Boolean);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      runtime.entries = [];
    }
    if (force) await reconcile();
    return getState();
  }

  async function reconcile() {
    let changed = false;
    for (const entry of runtime.entries) {
      const status = effectiveStatus(entry);
      if (entry.status !== status) { entry.status = status; entry.updatedAt = nowIso(); changed = true; }
      try {
        if (status === STATUS_ACTIVE) {
          await applyRules(entry);
          entry.appliedAt = nowIso(); entry.lastError = ""; state.applySuccess += 1;
        } else {
          await deleteRules(entry);
        }
      } catch (error) {
        entry.lastError = error instanceof Error ? error.message : String(error);
        state.lastError = entry.lastError; state.applyFailed += 1;
        pushEvent("firewall_failed", { entryId: entry.id, ip: entry.ip, error: entry.lastError });
        log?.warn?.(`[NetworkBlock] firewall rule failed for ${entry.ip}: ${entry.lastError}`);
      }
    }
    if (changed) await save("reconcile");
    state.lastSyncAt = nowIso();
    return getState();
  }

  function getState() {
    const entries = runtime.entries.map(snapshot).sort((a, b) => a.status.localeCompare(b.status) || Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
    return { ...state, totalEntries: entries.length, activeEntries: entries.filter((e) => e.status === STATUS_ACTIVE).length,
      disabledEntries: entries.filter((e) => e.status === STATUS_DISABLED).length, expiredEntries: entries.filter((e) => e.status === STATUS_EXPIRED).length,
      entries, recentEvents: runtime.events.map((event) => ({ ...event })) };
  }

  async function createEntry(input = {}) {
    const ip = normalizeIp(input.ip);
    const expiresAt = resolveExpiry(input);
    if (!ip) throw Object.assign(new Error("请输入有效的 IPv4 或 IPv6 地址；不支持 CIDR 与 IP 段。"), { statusCode: 400, code: "InvalidNetworkBlockIp" });
    if (!expiresAt || Date.parse(expiresAt) <= Date.now()) throw Object.assign(new Error("必须设置未来的到期时间。"), { statusCode: 400, code: "InvalidNetworkBlockExpiry" });
    if (runtime.entries.some((entry) => entry.ip === ip && effectiveStatus(entry) === STATUS_ACTIVE)) {
      throw Object.assign(new Error("该 IP 已处于有效网络阻塞中。"), { statusCode: 409, code: "NetworkBlockAlreadyActive" });
    }
    const entry = { id: crypto.randomUUID(), ip, reason: text(input.reason), expiresAt, status: text(input.status, STATUS_ACTIVE),
      createdAt: nowIso(), createdBy: text(input.createdBy ?? input.actor?.username, "system"), updatedAt: nowIso(), appliedAt: "", lastError: "" };
    if (entry.status === STATUS_ACTIVE) {
      await applyRules(entry);
      entry.appliedAt = nowIso(); state.applySuccess += 1;
    }
    runtime.entries.push(entry);
    await save("create");
    pushEvent("entry_created", { entryId: entry.id, ip, reason: entry.reason, expiresAt });
    return snapshot(entry);
  }

  async function updateEntry(id, input = {}) {
    const entry = runtime.entries.find((item) => item.id === text(id));
    if (!entry) throw Object.assign(new Error("网络阻塞条目不存在。"), { statusCode: 404, code: "NetworkBlockNotFound" });
    const previous = { ...entry };
    const ip = input.ip === undefined ? entry.ip : normalizeIp(input.ip);
    const expiresAt = input.expiresAt === undefined && input.durationValue === undefined ? entry.expiresAt : resolveExpiry(input);
    if (!ip || !expiresAt || Date.parse(expiresAt) <= Date.now()) throw Object.assign(new Error("IP 或到期时间无效。"), { statusCode: 400, code: "InvalidNetworkBlock" });
    await deleteRules(previous);
    Object.assign(entry, { ip, expiresAt, reason: input.reason === undefined ? entry.reason : text(input.reason),
      status: [STATUS_ACTIVE, STATUS_DISABLED].includes(input.status) ? input.status : entry.status, updatedAt: nowIso(), lastError: "" });
    if (effectiveStatus(entry) === STATUS_ACTIVE) { await applyRules(entry); entry.appliedAt = nowIso(); state.applySuccess += 1; }
    await save("update");
    pushEvent("entry_updated", { entryId: entry.id, ip: entry.ip, status: effectiveStatus(entry) });
    return snapshot(entry);
  }

  async function deleteEntry(id) {
    const index = runtime.entries.findIndex((item) => item.id === text(id));
    if (index < 0) throw Object.assign(new Error("网络阻塞条目不存在。"), { statusCode: 404, code: "NetworkBlockNotFound" });
    const [entry] = runtime.entries.splice(index, 1);
    await deleteRules(entry);
    await save("delete");
    pushEvent("entry_deleted", { entryId: entry.id, ip: entry.ip });
    return snapshot(entry);
  }

  const api = { getState, load: () => load(false), reload: () => load(true), reconcile,
    createEntry, updateEntry, deleteEntry,
    listEntries(filter = {}) { const search = text(filter.search).toLowerCase(); return getState().entries.filter((entry) =>
      (!filter.status || filter.status === "all" || entry.status === filter.status) && (!search || [entry.ip, entry.reason, entry.createdBy].join(" ").toLowerCase().includes(search))); } };

  return { manifest: { id: `plugin.${PLUGIN_ID}`, name: "Network Block", kind: "plugin", version: "1.0.0",
      description: "按 IP 创建具有到期时间的 Windows 防火墙游戏端口阻塞规则。",
      configSchema: [{ key: `plugins.${PLUGIN_ID}.enabled`, type: "boolean", default: true, description: "是否启用网络阻塞" },
        { key: `plugins.${PLUGIN_ID}.udpPorts`, type: "string", default: DEFAULT_UDP_PORTS, description: "Squad 对外 UDP/TCP 端口列表" }] },
    apiName: PLUGIN_ID, api,
    async init() { await load(false); },
    async start() { if (!state.enabled) return; await reconcile(); runtime.timer = setInterval(() => void enqueue(reconcile), 60_000); },
    async stop() { if (runtime.timer) clearInterval(runtime.timer); runtime.timer = null; } };
}
