// -*- coding: utf-8 -*-

import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";

function now() {
  return Date.now();
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (!version) return false;

  if (version === 4) {
    const octets = ip.split(".").map((part) => Number(part));
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [first, second] = octets;
    if (first === 10) return true;
    if (first === 127) return true;
    if (first === 169 && second === 254) return true;
    if (first === 192 && second === 168) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    return false;
  }
  return false;
}

function getLocalPhysicalIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    const nameLower = name.toLowerCase();
    if (
      nameLower.includes("loopback") ||
      nameLower.includes("tunnel") ||
      nameLower.includes("tun") ||
      nameLower.includes("tap") ||
      nameLower.includes("clash") ||
      nameLower.includes("vpn") ||
      nameLower.includes("virtual") ||
      nameLower.includes("vbox") ||
      nameLower.includes("vmware") ||
      nameLower.includes("hyper-v") ||
      nameLower.includes("vethernet") ||
      nameLower.includes("pseudo") ||
      nameLower.includes("zerotier") ||
      nameLower.includes("wireguard")
    ) {
      continue;
    }
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

function pingIp(targetIp, localIp, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const args = ["-n", "1", "-w", String(timeoutMs)];
    if (localIp) {
      args.push("-S", localIp);
    }
    args.push(targetIp);

    const child = spawn("ping", args);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      const rttMatch = stdout.match(/time[=<](\d+)ms/i) || stdout.match(/时间[=<](\d+)ms/i);
      if (rttMatch) {
        resolve({ success: true, rtt: parseInt(rttMatch[1], 10) });
      } else {
        const isUnreachable = stdout.includes("Unreachable") || stdout.includes("无法访问") || stdout.includes("超时") || stdout.includes("timed out");
        resolve({
          success: false,
          rtt: null,
          error: isUnreachable ? "Destination unreachable / timed out" : (stderr || stdout.trim() || `Exit code ${code}`),
        });
      }
    });

    child.on("error", (err) => {
      resolve({ success: false, rtt: null, error: err.message });
    });
  });
}

export function createNetworkStatsModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.networkStats",
    source: "module.networkStats",
    channel: "module",
  }) ?? core.logger;

  let enabled = true;
  let localPingIp = "";
  let pingIntervalSeconds = 15;
  let pingTimeoutMs = 1500;
  let historySize = 10;
  let allowPrivateIps = true;
  let timer = null;

  // steamID -> Array of { success: boolean, rtt: number | null, time: number }
  const playerHistory = new Map();

  function readConfig() {
    enabled = Boolean(config.get("modules.networkStats.enabled", true));
    localPingIp = String(config.get("modules.networkStats.localPingIp", "")).trim();
    pingIntervalSeconds = Math.max(5, Number(config.get("modules.networkStats.pingIntervalSeconds", 15)));
    pingTimeoutMs = Math.max(200, Number(config.get("modules.networkStats.pingTimeoutMs", 1500)));
    historySize = Math.max(3, Number(config.get("modules.networkStats.historySize", 10)));
    allowPrivateIps = Boolean(config.get("modules.networkStats.allowPrivateIps", true));
  }

  function determineBindIp() {
    if (localPingIp) return localPingIp;
    const physicalIps = getLocalPhysicalIps();
    if (physicalIps.length > 0) {
      return physicalIps[0];
    }
    return "";
  }

  async function performPings() {
    if (!enabled) return;

    try {
      const onlinePlayers = modules.playerState?.getOnlinePlayers() || [];
      const activePlayers = onlinePlayers.filter((p) => p.steamID);
      if (activePlayers.length === 0) return;

      const steamIDs = activePlayers.map((p) => p.steamID);
      const dbPlayers = modules.playerDatabase?.listPlayersBySteamIDs
        ? await modules.playerDatabase.listPlayersBySteamIDs(steamIDs)
        : [];

      const ipBySteamID = {};
      for (const p of dbPlayers) {
        let ip = p.current_ip;
        if ((!ip || net.isIP(ip) !== 4) && p.id && modules.playerDatabase?.listPlayerIps) {
          try {
            const pastIps = await modules.playerDatabase.listPlayerIps(p.id, { limit: 1 });
            if (pastIps && pastIps.length > 0 && pastIps[0].ip) {
              ip = pastIps[0].ip;
            }
          } catch (err) {
            moduleLogger.warn(`Failed to fetch past IPs for player ${p.steam_id}: ${err.message}`);
          }
        }
        if (p.steam_id && ip && net.isIP(ip) === 4 && (allowPrivateIps || !isPrivateIp(ip))) {
          ipBySteamID[p.steam_id] = ip;
        }
      }

      const targets = [];
      for (const player of activePlayers) {
        const ip = ipBySteamID[player.steamID];
        if (ip) {
          targets.push({ steamID: player.steamID, ip });
        }
      }

      if (targets.length === 0) return;

      const bindIp = determineBindIp();
      moduleLogger.debug(`Starting ping round for ${targets.length} players. Bind IP: ${bindIp || "Default"}`);

      // Process pings in concurrent batches of size 3
      const queue = [...targets];
      const workers = Array.from({ length: 3 }, async () => {
        while (queue.length > 0) {
          const target = queue.shift();
          if (!target) break;

          const isLoopback = target.ip === "127.0.0.1" || target.ip.startsWith("127.");
          const activeBindIp = isLoopback ? "" : bindIp;
          let res = await pingIp(target.ip, activeBindIp, pingTimeoutMs);
          
          if (!res.success && activeBindIp && res.error && (res.error.includes("bind") || res.error.includes("绑定"))) {
            moduleLogger.warn(`Ping bind failed with ${activeBindIp}, attempting fallback without bind for ${target.ip}`);
            res = await pingIp(target.ip, "", pingTimeoutMs);
          }

          recordPing(target.steamID, res);
        }
      });

      await Promise.all(workers);
      const updatedAt = new Date().toISOString();
      core.eventBus?.emitModuleEvent?.("module.networkStats", "statsUpdated", {
        eventId: `module.networkStats:statsUpdated:${Date.now()}`,
        eventName: "module.networkStats.statsUpdated",
        layer: "module",
        source: "module.networkStats",
        time: updatedAt,
        updatedAt,
        steamIDs: targets.map((target) => target.steamID),
        playerCount: targets.length,
      });
      moduleLogger.debug(`Finished ping round for ${targets.length} players.`);
    } catch (err) {
      moduleLogger.error(`Error in ping round: ${err.message}`, {
        operation: "performPings",
      });
    }
  }

  function recordPing(steamID, res) {
    if (!playerHistory.has(steamID)) {
      playerHistory.set(steamID, []);
    }
    const history = playerHistory.get(steamID);
    history.push({
      time: now(),
      success: res.success,
      rtt: res.rtt,
    });
    if (history.length > historySize) {
      history.shift();
    }
  }

  function getPlayerStats(steamID) {
    if (!enabled) return null;
    const history = playerHistory.get(steamID);
    if (!history || history.length === 0) return null;

    const successful = history.filter((h) => h.success);
    const total = history.length;
    const failed = total - successful.length;
    const packetLoss = Math.round((failed / total) * 100);

    let averagePing = null;
    if (successful.length > 0) {
      const sum = successful.reduce((acc, curr) => acc + curr.rtt, 0);
      averagePing = Math.round(sum / successful.length);
    }

    return {
      ping: averagePing,
      packetLoss,
    };
  }

  function startTimer() {
    stopTimer();
    if (!enabled) return;
    performPings();
    timer = setInterval(performPings, pingIntervalSeconds * 1000);
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    manifest: {
      id: "module.networkStats",
      name: "Network Stats Module",
      kind: "module",
      version: "0.1.0",
      description: "定期测量在线玩家的延迟与丢包率，支持绕过代理与TUN接口。",
    },
    apiName: "networkStats",
    api: {
      getPlayerStats,
    },
    async init() {
      readConfig();
    },
    async start() {
      startTimer();
      moduleLogger.info("Network stats module started.", {
        operation: "start",
        data: { enabled, localPingIp, pingIntervalSeconds, pingTimeoutMs, historySize },
      });
    },
    async stop() {
      stopTimer();
      playerHistory.clear();
      moduleLogger.info("Network stats module stopped.", {
        operation: "stop",
      });
    },
  };
}
