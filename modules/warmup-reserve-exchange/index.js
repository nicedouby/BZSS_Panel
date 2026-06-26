// -*- coding: utf-8 -*-

import { createDatabase } from "../../core/database.js";

const MODULE_ID = "module.warmupReserveExchange";
const DEFAULT_TICK_INTERVAL_MS = 60_000;
const DEFAULT_REQUIRED_SECONDS = 3600;
const DEFAULT_NOTIFY_INTERVAL_SECONDS = 180;
const DEFAULT_REWARD_DAYS = 1;

export function createWarmupReserveExchangeModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = config?.get?.("warmupReserveExchange", {}) ?? {};
  let db = null;
  let timer = null;
  let running = false;
  let tickInFlight = false;
  let lastTickAtMs = null;

  const api = {
    async getState() {
      return buildState();
    },
    async getPlayers() {
      return listProgressRows();
    },
    async getRewards(limit = 200) {
      return listRewardRows(limit);
    },
    async resetProgress() {
      await ensureDb();
      await db.run("DELETE FROM warmup_reserve_progress");
      return buildState({ message: "已清空所有未兑换的暖服进度。" });
    },
    async resetAllStatistics() {
      await ensureDb();
      await db.exec("BEGIN");
      try {
        await db.run("DELETE FROM warmup_reserve_progress");
        await db.run("DELETE FROM warmup_reserve_rewards");
        await db.run("DELETE FROM warmup_mode_windows");
        await db.exec("COMMIT");
      } catch (error) {
        try { await db.exec("ROLLBACK"); } catch {}
        throw error;
      }
      return buildState({ message: "已清空全部暖服统计。" });
    },
    async resetLegacyWarmupPoints() {
      if (!modules?.playerDatabase?.listPlayers || !modules?.playerDatabase?.setAssetAmount) {
        return { ok: false, error: "PlayerDatabaseUnavailable", message: "playerDatabase is unavailable." };
      }
      const rows = await modules.playerDatabase.listPlayers({ limit: 5000 });
      const items = Array.isArray(rows?.items) ? rows.items : [];
      let updated = 0;
      for (const player of items) {
        const current = Number(player?.warmupPoints ?? player?.assets?.warmupPoints ?? 0);
        if (!Number.isFinite(current) || current <= 0) continue;
        await modules.playerDatabase.setAssetAmount(player.id, "warmupPoints", 0);
        updated += 1;
      }
      return { ok: true, updated };
    },
    async tick(nowMs = Date.now()) {
      return performTick(nowMs, { force: true });
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "暖服自动兑换预留位模块",
      kind: "module",
      version: "0.1.0",
      description: "统计暖服时长并为符合条件的在线玩家自动兑换预留位天数。",
    },
    apiName: "warmupReserveExchange",
    api,

    async init() {
      db = await createDatabase(config.get("database", config.get("modules.playerDatabase.database", {})));
      await ensureSchema();
    },

    async start() {
      running = true;
      core.webRegistry?.registerPage?.({
        id: "web.warmupReserveExchange",
        title: "暖服自动兑换预留位",
        group: "Base",
        route: "/warmup-reserve-exchange",
        pageModule: "/pages/warmup-reserve-exchange.js",
        source: MODULE_ID,
        required: false,
        enabled: true,
        order: 36,
        icon: "⏱️",
      });
      await performTick(Date.now(), { force: true });
      timer = setInterval(() => {
        void performTick(Date.now());
      }, getTickIntervalMs());
      moduleLogger?.info?.("[WarmupReserveExchange] started.");
    },

    async stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      lastTickAtMs = null;
      moduleLogger?.info?.("[WarmupReserveExchange] stopped.");
    },
  };

  async function ensureDb() {
    if (db) return db;
    db = await createDatabase(config.get("database", config.get("modules.playerDatabase.database", {})));
    await ensureSchema();
    return db;
  }

  async function ensureSchema() {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS warmup_reserve_progress (
        steam_id TEXT PRIMARY KEY,
        player_name TEXT NOT NULL DEFAULT '',
        total_seconds INTEGER NOT NULL DEFAULT 0,
        lifetime_seconds INTEGER NOT NULL DEFAULT 0,
        last_seen_at INTEGER NOT NULL DEFAULT 0,
        last_tick_at INTEGER NOT NULL DEFAULT 0,
        last_notify_bucket INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS warmup_reserve_rewards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        steam_id TEXT NOT NULL,
        player_name TEXT NOT NULL DEFAULT '',
        reward_days INTEGER NOT NULL DEFAULT 1,
        cost_seconds INTEGER NOT NULL DEFAULT 3600,
        reserve_before TEXT,
        reserve_after TEXT,
        created_at INTEGER NOT NULL,
        round_id TEXT
      );
      CREATE TABLE IF NOT EXISTS warmup_mode_windows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        reason TEXT NOT NULL DEFAULT '',
        end_reason TEXT NOT NULL DEFAULT ''
      );
    `);
  }

  function getTickIntervalMs() {
    const seconds = Number(moduleConfig.tickIntervalSeconds ?? DEFAULT_TICK_INTERVAL_MS / 1000);
    return Math.max(5_000, Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds * 1000) : DEFAULT_TICK_INTERVAL_MS);
  }

  function getRequiredSeconds() {
    return Math.max(60, Number(moduleConfig.requiredSeconds ?? DEFAULT_REQUIRED_SECONDS) || DEFAULT_REQUIRED_SECONDS);
  }

  function getNotifyIntervalSeconds() {
    return Math.max(60, Number(moduleConfig.notifyIntervalSeconds ?? DEFAULT_NOTIFY_INTERVAL_SECONDS) || DEFAULT_NOTIFY_INTERVAL_SECONDS);
  }

  function getRewardDays() {
    return Math.max(1, Number(moduleConfig.rewardReserveDays ?? DEFAULT_REWARD_DAYS) || DEFAULT_REWARD_DAYS);
  }

  function resolveWarmupGate() {
    return modules?.warmupModeGate?.evaluate?.() ?? {
      active: false,
      reason: "gate_unavailable",
      playerCount: Number(core.webStatus?.getSnapshot?.()?.playerCount ?? 0) || 0,
    };
  }

  async function performTick(nowMs = Date.now(), { force = false } = {}) {
    if ((!running && !force) || tickInFlight) return buildState();
    tickInFlight = true;
    try {
      await ensureDb();
      const gate = resolveWarmupGate();
      const snapshot = core.webStatus?.getSnapshot?.() ?? core.webStatus?.state ?? {};
      const serverId = String(snapshot.serverId ?? core.webStatus?.serverId ?? "").trim();
      const players = (modules.playerState?.getOnlinePlayers?.(serverId) ?? [])
        .filter((player) => resolvePlayerSteamId(player));
      const now = Number(nowMs) || Date.now();

      if (!gate.active) {
        lastTickAtMs = null;
        await recordWarmupWindow(false, gate.reason, now);
        return buildState({ gate, playerCount: players.length, deltaSeconds: 0 });
      }

      await recordWarmupWindow(true, gate.reason, now);
      const deltaSeconds = Math.max(0, Math.floor((now - (lastTickAtMs ?? now)) / 1000));
      lastTickAtMs = now;

      for (const player of players) {
        const steamID = resolvePlayerSteamId(player);
        if (!steamID) continue;
        const playerName = String(player?.name ?? player?.current_name ?? "").trim();
        const current = await ensureProgressRow(steamID, playerName, now);
        if (deltaSeconds > 0) {
          current.total_seconds += deltaSeconds;
          current.lifetime_seconds += deltaSeconds;
          current.last_tick_at = now;
        }
        current.last_seen_at = now;

        let rewardCount = 0;
        while (current.total_seconds >= getRequiredSeconds()) {
          current.total_seconds -= getRequiredSeconds();
          rewardCount += 1;
          await grantReserveDay(player, current, now);
        }

        const notifyBucket = Math.floor(current.total_seconds / getNotifyIntervalSeconds()) * getNotifyIntervalSeconds();
        if (notifyBucket >= getNotifyIntervalSeconds() && notifyBucket !== current.last_notify_bucket) {
          current.last_notify_bucket = notifyBucket;
          await sendNotify(player, current, notifyBucket);
        }

        current.updated_at = now;
        await upsertProgress(current);
        if (rewardCount > 0) {
          moduleLogger?.info?.(`[WarmupReserveExchange] rewarded ${rewardCount} day(s) for ${steamID}`);
        }
      }

      return buildState({ gate, playerCount: players.length, deltaSeconds });
    } catch (error) {
      moduleLogger?.warn?.(`[WarmupReserveExchange] tick failed: ${error?.message ?? String(error)}`);
      return buildState({ error: String(error?.message ?? error) });
    } finally {
      tickInFlight = false;
    }
  }

  async function ensureProgressRow(steamID, playerName, now) {
    const row = await db.get("SELECT * FROM warmup_reserve_progress WHERE steam_id = ?", steamID);
    if (row) {
      if (playerName && row.player_name !== playerName) {
        row.player_name = playerName;
      }
      return row;
    }
    return {
      steam_id: steamID,
      player_name: playerName || "",
      total_seconds: 0,
      lifetime_seconds: 0,
      last_seen_at: now,
      last_tick_at: now,
      last_notify_bucket: 0,
      updated_at: now,
    };
  }

  async function upsertProgress(row) {
    await db.run(
      `INSERT INTO warmup_reserve_progress
       (steam_id, player_name, total_seconds, lifetime_seconds, last_seen_at, last_tick_at, last_notify_bucket, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(steam_id) DO UPDATE SET
         player_name = excluded.player_name,
         total_seconds = excluded.total_seconds,
         lifetime_seconds = excluded.lifetime_seconds,
         last_seen_at = excluded.last_seen_at,
         last_tick_at = excluded.last_tick_at,
         last_notify_bucket = excluded.last_notify_bucket,
         updated_at = excluded.updated_at`,
      row.steam_id,
      row.player_name,
      Math.max(0, Math.floor(Number(row.total_seconds) || 0)),
      Math.max(0, Math.floor(Number(row.lifetime_seconds) || 0)),
      Math.max(0, Math.floor(Number(row.last_seen_at) || 0)),
      Math.max(0, Math.floor(Number(row.last_tick_at) || 0)),
      Math.max(0, Math.floor(Number(row.last_notify_bucket) || 0)),
      Math.max(0, Math.floor(Number(row.updated_at) || 0)),
    );
  }

  async function grantReserveDay(player, progressRow, now) {
    const steamID = resolvePlayerSteamId(player) || String(progressRow?.steam_id ?? "").trim();
    const playerName = String(player?.name ?? player?.current_name ?? progressRow.player_name ?? "").trim();
    if (!steamID) {
      moduleLogger?.warn?.("[WarmupReserveExchange] skip reserve reward because steam id is missing.");
      return;
    }

    const existing = (await modules.playerDatabase?.getCachedPlayer?.({ steamID })) ?? null;
    const before = existing?.expireAt ?? existing?.expire_at ?? null;
    const currentExpire = parseExpire(before);
    const base = currentExpire && currentExpire > now ? currentExpire : now;
    const after = new Date(base + getRewardDays() * 24 * 60 * 60 * 1000).toISOString();

    await db.run(
      `INSERT INTO warmup_reserve_rewards
        (steam_id, player_name, reward_days, cost_seconds, reserve_before, reserve_after, created_at, round_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      steamID,
      playerName,
      getRewardDays(),
      getRequiredSeconds(),
      before ? String(before) : null,
      after,
      now,
      core.webStatus?.getSnapshot?.()?.roundId ?? null,
    );

    if (modules?.reserveSlots?.upsertMember) {
      await modules.reserveSlots.upsertMember({
        steamId: steamID,
        name: playerName,
        group: "BZSSVIP",
        expireAt: after.slice(0, 19).replace("T", " "),
        reason: "warmup_reserve_exchange",
      });
    }

    await sendNotify(player, progressRow, getRequiredSeconds(), true);
  }

  async function sendNotify(player, progressRow, bucketSeconds, isReward = false) {
    const adminWarn = modules?.adminWarn;
    const warn = adminWarn?.warnPlayer ?? adminWarn?.sendAdminWarn;
    if (typeof warn !== "function") return;
    const steamID = resolvePlayerSteamId(player) || String(progressRow?.steam_id ?? "").trim();
    const playerName = String(player?.name ?? player?.current_name ?? progressRow.player_name ?? "").trim();
    const minutes = Math.floor(bucketSeconds / 60);
    const remainingMinutes = Math.max(0, Math.ceil((getRequiredSeconds() - bucketSeconds) / 60));
    const message = isReward
      ? `感谢暖服！你已累计暖服 ${minutes} 分钟，系统已为你自动激活 ${getRewardDays()} 天预留位。`
      : `你已累计暖服 ${minutes} 分钟，还需要 ${remainingMinutes} 分钟即可自动激活 ${getRewardDays()} 天预留位。`;
    await warn.call(adminWarn, {
      targetName: playerName || steamID,
      targetSteamId: steamID || null,
      message,
      sourceModule: MODULE_ID,
      reason: isReward ? "warmup_reserve_reward" : "warmup_reserve_notify",
      system: true,
    });
  }

  async function recordWarmupWindow(active, reason, now) {
    const current = await db.get("SELECT id, started_at, ended_at FROM warmup_mode_windows ORDER BY id DESC LIMIT 1");
    if (active) {
      if (!current || current.ended_at != null) {
        await db.run(
          "INSERT INTO warmup_mode_windows (started_at, ended_at, reason, end_reason) VALUES (?, NULL, ?, '')",
          now,
          String(reason ?? ""),
        );
      }
      return;
    }
    if (current && current.ended_at == null) {
      await db.run(
        "UPDATE warmup_mode_windows SET ended_at = ?, end_reason = ? WHERE id = ?",
        now,
        String(reason ?? ""),
        current.id,
      );
    }
  }

  async function listProgressRows() {
    await ensureDb();
    const rows = await db.all("SELECT * FROM warmup_reserve_progress ORDER BY updated_at DESC, lifetime_seconds DESC");
    return rows.map((row) => ({
      steamId: row.steam_id,
      playerName: row.player_name,
      totalSeconds: Number(row.total_seconds ?? 0),
      lifetimeSeconds: Number(row.lifetime_seconds ?? 0),
      lastSeenAt: row.last_seen_at,
      lastTickAt: row.last_tick_at,
      lastNotifyBucket: Number(row.last_notify_bucket ?? 0),
      updatedAt: row.updated_at,
    }));
  }

  async function listRewardRows(limit = 200) {
    await ensureDb();
    const rows = await db.all(
      "SELECT * FROM warmup_reserve_rewards ORDER BY created_at DESC, id DESC LIMIT ?",
      Math.max(1, Math.min(1000, Number(limit) || 200)),
    );
    return rows.map((row) => ({
      id: row.id,
      steamId: row.steam_id,
      playerName: row.player_name,
      rewardDays: Number(row.reward_days ?? 1),
      costSeconds: Number(row.cost_seconds ?? 3600),
      reserveBefore: row.reserve_before ?? null,
      reserveAfter: row.reserve_after ?? null,
      createdAt: row.created_at,
      roundId: row.round_id ?? null,
    }));
  }

  async function buildState(extra = {}) {
    await ensureDb();
    const progress = await listProgressRows();
    const rewards = await listRewardRows(100);
    const windows = await db.all("SELECT * FROM warmup_mode_windows ORDER BY started_at DESC, id DESC LIMIT 20");
    return {
      ok: true,
      gate: resolveWarmupGate(),
      progress,
      rewards,
      windows: windows.map((row) => ({
        id: row.id,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        reason: row.reason,
        endReason: row.end_reason,
      })),
      settings: {
        enabled: Boolean(config?.get?.("warmup.enabled", false)),
        requiredSeconds: getRequiredSeconds(),
        rewardReserveDays: getRewardDays(),
        notifyIntervalSeconds: getNotifyIntervalSeconds(),
        tickIntervalSeconds: Math.round(getTickIntervalMs() / 1000),
      },
      lastTickAtMs,
      running,
      ...extra,
    };
  }
}

function resolvePlayerSteamId(player = {}) {
  return String(
    player?.steamID
    ?? player?.steamId
    ?? player?.steam64
    ?? player?.steam64ID
    ?? player?.steam_id
    ?? "",
  ).trim();
}

function parseExpire(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const date = new Date(text.replace(" ", "T"));
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}
