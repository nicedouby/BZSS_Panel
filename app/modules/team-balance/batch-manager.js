// -*- coding: utf-8 -*-

export const MAX_BATCH_PLAYERS = 100;
export const MAX_BATCH_HISTORY = 50;
export const ACTIVE_BATCH_CONCURRENCY = 1;
export const RCON_ITEM_CONCURRENCY = 8;

const IDEMPOTENCY_TTL_MS = 30 * 60 * 1000;

export class TeamBalanceBatchManager {
  constructor({
    executeOnePlayer,
    resolveCurrentPlayer,
    recordAudit,
    canContinue,
    logger,
    now = () => Date.now(),
    itemConcurrency = RCON_ITEM_CONCURRENCY,
  } = {}) {
    this.executeOnePlayer = executeOnePlayer;
    this.resolveCurrentPlayer = resolveCurrentPlayer;
    this.recordAudit = recordAudit;
    this.canContinue = canContinue;
    this.logger = logger;
    this.now = now;
    this.itemConcurrency = clampInteger(itemConcurrency, 1, RCON_ITEM_CONCURRENCY);
    this.history = [];
    this.queue = [];
    this.byId = new Map();
    this.byClientRequestId = new Map();
    this.running = false;
    this.pumpScheduled = false;
  }

  create(request = {}) {
    const clientRequestId = normalizeText(request.clientRequestId);
    if (!clientRequestId) {
      return { ok: false, error: "MissingClientRequestId", message: "clientRequestId is required." };
    }

    const existing = this.getByClientRequestId(clientRequestId);
    if (existing) return { ok: true, duplicate: true, batch: existing };

    const players = normalizePlayers(request.players);
    if (players.length === 0) {
      return { ok: false, error: "EmptyBatch", message: "At least one player is required." };
    }
    if (players.length > MAX_BATCH_PLAYERS) {
      return {
        ok: false,
        error: "BatchTooLarge",
        message: `A batch may contain at most ${MAX_BATCH_PLAYERS} unique players.`,
      };
    }

    const now = this.now();
    const id = `tb-batch-${now}-${Math.random().toString(36).slice(2, 10)}`;
    const batch = {
      id,
      clientRequestId,
      type: normalizeText(request.type) || "manual",
      planId: normalizeText(request.planId) || "",
      roundKey: normalizeText(request.roundKey) || "",
      source: normalizeText(request.source) || "web.matchStatus.batch",
      reason: normalizeText(request.reason) || "manual_batch_team_balance",
      operator: request.operator ?? null,
      status: "queued",
      createdAt: new Date(now).toISOString(),
      startedAt: null,
      completedAt: null,
      total: players.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      concurrency: Math.min(this.itemConcurrency, players.length),
      currentPlayer: null,
      currentPlayers: [],
      cancelRequested: false,
      cancelReason: "",
      players,
      results: [],
    };

    this.history.unshift(batch);
    this.byId.set(id, batch);
    this.byClientRequestId.set(clientRequestId, { id, expiresAt: now + IDEMPOTENCY_TTL_MS });
    this.trimHistory();
    this.queue.push(batch);
    this.schedulePump();

    void Promise.resolve(this.recordAudit?.({
      action: "player.batch_switch_team",
      category: "player_management",
      actor: batch.operator,
      batchId: batch.id,
      status: batch.status,
      total: batch.total,
      concurrency: batch.concurrency,
      source: batch.source,
      reason: batch.reason,
    })).catch((error) => this.logger?.warn?.(`[TB] batch audit failed: ${error?.message ?? error}`));

    return { ok: true, duplicate: false, batch: snapshotBatch(batch) };
  }

  list() {
    return this.history.map(snapshotBatch);
  }

  get(id) {
    const batch = this.byId.get(normalizeText(id));
    return batch ? snapshotBatch(batch) : null;
  }

  findLatest({ type = "", roundKey = "" } = {}) {
    const normalizedType = normalizeText(type);
    const normalizedRoundKey = normalizeText(roundKey);
    const batch = this.history.find((item) => {
      if (normalizedType && item.type !== normalizedType) return false;
      if (normalizedRoundKey && item.roundKey !== normalizedRoundKey) return false;
      return true;
    });
    return batch ? snapshotBatch(batch) : null;
  }

  findActive({ type = "", roundKey = "" } = {}) {
    const normalizedType = normalizeText(type);
    const normalizedRoundKey = normalizeText(roundKey);
    const batch = this.history.find((item) => {
      if (item.status !== "queued" && item.status !== "running") return false;
      if (normalizedType && item.type !== normalizedType) return false;
      if (normalizedRoundKey && item.roundKey !== normalizedRoundKey) return false;
      return true;
    });
    return batch ? snapshotBatch(batch) : null;
  }

  cancelActiveByType(type, reason = "cancelled", roundKey = "") {
    const normalizedType = normalizeText(type);
    const normalizedRoundKey = normalizeText(roundKey);
    const cancelled = [];
    for (const batch of this.history) {
      if (batch.type !== normalizedType) continue;
      if (normalizedRoundKey && batch.roundKey !== normalizedRoundKey) continue;
      if (batch.status !== "queued" && batch.status !== "running") continue;
      const result = this.cancel(batch.id, reason);
      if (result.ok) cancelled.push(result.batch ?? this.get(batch.id));
    }
    return cancelled;
  }

  cancel(id, reason = "cancelled") {
    const batch = this.byId.get(normalizeText(id));
    if (!batch) return { ok: false, error: "BatchNotFound", message: "Batch not found." };

    if (batch.status === "queued") {
      batch.cancelRequested = true;
      batch.cancelReason = normalizeText(reason) || "cancelled";
      batch.status = "cancelled";
      batch.completedAt = new Date(this.now()).toISOString();
      markRemainingCancelled(batch, `before execution: ${batch.cancelReason}`);
      this.queue = this.queue.filter((item) => item.id !== batch.id);
      return { ok: true, status: "cancelled", batch: snapshotBatch(batch) };
    }

    if (batch.status === "running") {
      batch.cancelRequested = true;
      batch.cancelReason = normalizeText(reason) || "cancelled";
      return {
        ok: true,
        status: "cancelling",
        completed: batch.completed,
        remaining: Math.max(0, batch.total - batch.completed),
        batch: snapshotBatch(batch),
      };
    }

    return { ok: true, status: batch.status, batch: snapshotBatch(batch) };
  }

  schedulePump() {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    setImmediate(() => {
      this.pumpScheduled = false;
      void this.pump();
    });
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.shift();
        if (!batch || batch.status !== "queued") continue;
        await this.runBatch(batch);
      }
    } finally {
      this.running = false;
    }
  }

  async runBatch(batch) {
    if (batch.cancelRequested) {
      batch.cancelReason = batch.cancelReason || "cancelled";
      markRemainingCancelled(batch, batch.cancelReason);
      batch.status = "cancelled";
      batch.completedAt = new Date(this.now()).toISOString();
      return;
    }

    batch.status = "running";
    batch.startedAt = new Date(this.now()).toISOString();
    let nextIndex = 0;
    const workerCount = Math.min(this.itemConcurrency, batch.players.length);

    const worker = async () => {
      while (!batch.cancelRequested) {
        const playerIndex = nextIndex;
        nextIndex += 1;
        if (playerIndex >= batch.players.length) return;

        const gate = await this.checkContinue(batch);
        if (!gate.ok) {
          batch.cancelRequested = true;
          batch.cancelReason = gate.reason || "execution_gate_closed";
          return;
        }
        if (batch.cancelRequested) return;

        const player = batch.players[playerIndex];
        addCurrentPlayer(batch, player);
        const result = await this.executePlayer(batch, player);
        removeCurrentPlayer(batch, player);
        recordPlayerResult(batch, result, playerIndex);

        void Promise.resolve(this.recordAudit?.({
          action: "player.switch_team",
          category: "player_management",
          actor: batch.operator,
          batchId: batch.id,
          status: result.status,
          playerId: result.playerId,
          playerName: result.playerName,
          steamId: result.steamId,
          fromTeamId: result.fromTeamId,
          targetTeamId: result.targetTeamId,
          result: result.status,
        })).catch((error) => this.logger?.warn?.(`[TB] item audit failed: ${error?.message ?? error}`));

        await yieldToEventLoop();
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    batch.currentPlayers = [];
    batch.currentPlayer = null;

    if (batch.completed < batch.total) markRemainingCancelled(batch, batch.cancelReason || "cancelled");
    batch.results.sort((left, right) => left._playerIndex - right._playerIndex);
    batch.status = batch.cancelRequested
      ? "cancelled"
      : batch.failed > 0 || batch.skipped > 0
        ? "partial"
        : "completed";
    batch.completedAt = new Date(this.now()).toISOString();

    void Promise.resolve(this.recordAudit?.({
      action: "player.batch_switch_team",
      category: "player_management",
      actor: batch.operator,
      batchId: batch.id,
      status: batch.status,
      total: batch.total,
      succeeded: batch.succeeded,
      failed: batch.failed,
      skipped: batch.skipped,
      concurrency: batch.concurrency,
      source: batch.source,
      reason: batch.reason,
    })).catch((error) => this.logger?.warn?.(`[TB] batch completion audit failed: ${error?.message ?? error}`));
  }

  async checkContinue(batch) {
    if (typeof this.canContinue !== "function") return { ok: true };
    try {
      const result = await this.canContinue(batch);
      return result && result.ok === false
        ? { ok: false, reason: normalizeText(result.reason) || "execution_gate_closed" }
        : { ok: true };
    } catch (error) {
      this.logger?.warn?.(`[TB] batch execution gate failed: ${error?.message ?? error}`);
      return { ok: false, reason: "execution_gate_error" };
    }
  }

  async executePlayer(batch, player) {
    if (player.invalid || !player.steamId) return resultFor(player, "invalid_steam_id", "SteamID is invalid.");
    if (normalizeTeamId(player.fromTeamId) == null || normalizeTeamId(player.targetTeamId) == null) {
      return resultFor(player, "failed_state_unknown", "Source or target team is unknown.");
    }

    // Shuffle is intentionally a one-shot operation. The command itself is the
    // source of truth; do not perform a preflight player-state check because a
    // stale state can make a toggle command appear already applied and cause
    // the next player/round to be switched back later.
    if (batch.type !== "shuffle") {
      let current = null;
      try {
        current = await this.resolveCurrentPlayer?.(player);
      } catch (error) {
        this.logger?.warn?.(`[TB] player state lookup failed: ${error?.message ?? error}`);
      }

      if (!current) return resultFor(player, "skipped_offline", "Player is offline.");
      const currentTeamId = normalizeTeamId(current.teamId ?? current.teamID);
      if (currentTeamId == null) return resultFor(player, "failed_state_unknown", "Current team is unknown.");
      if (currentTeamId === normalizeTeamId(player.targetTeamId)) {
        return resultFor(player, "already_applied", "Player is already on the target team.");
      }
      if (currentTeamId !== normalizeTeamId(player.fromTeamId)) {
        return resultFor(player, "failed_state_unknown", "Player team changed before execution.");
      }
    }

    let response;
    try {
      response = await this.executeOnePlayer({
        ...player,
        source: batch.source,
        reason: batch.reason,
        priority: "interactive",
        maxQueueWaitMs: 10_000,
        batchId: batch.id,
        operator: batch.operator,
        system: false,
      });
    } catch (error) {
      return resultFor(player, "rcon_failed", String(error?.message ?? error));
    }

    if (response?.ok) return resultFor(player, "success", response.message || "Team switch requested.", response);
    const errorText = String(response?.error ?? response?.message ?? "RCON command failed.");
    if (response?.unknownResult || /timeout|timed out|ETIMEDOUT/i.test(errorText)) {
      return resultFor(player, "unknown_result", errorText, response);
    }
    return resultFor(player, "rcon_failed", errorText, response);
  }

  getByClientRequestId(clientRequestId) {
    const key = normalizeText(clientRequestId);
    const item = this.byClientRequestId.get(key);
    if (!item) return null;
    if (item.expiresAt <= this.now()) {
      this.byClientRequestId.delete(key);
      return null;
    }
    return this.byId.has(item.id) ? snapshotBatch(this.byId.get(item.id)) : null;
  }

  trimHistory() {
    while (this.history.length > MAX_BATCH_HISTORY) {
      const removed = this.history.pop();
      if (removed) this.byId.delete(removed.id);
    }
  }
}

function normalizePlayers(players) {
  if (!Array.isArray(players)) return [];
  const seen = new Set();
  const normalized = [];
  for (const raw of players) {
    const steamId = normalizeText(raw?.steamId ?? raw?.steamID);
    if (!steamId) {
      normalized.push({
        playerId: raw?.playerId ?? null,
        steamId: "",
        playerName: normalizeText(raw?.playerName ?? raw?.name),
        fromTeamId: normalizeTeamId(raw?.fromTeamId),
        targetTeamId: normalizeTeamId(raw?.targetTeamId),
        invalid: true,
      });
      continue;
    }
    const key = steamId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      playerId: raw?.playerId ?? null,
      steamId,
      playerName: normalizeText(raw?.playerName ?? raw?.name),
      fromTeamId: normalizeTeamId(raw?.fromTeamId),
      targetTeamId: normalizeTeamId(raw?.targetTeamId),
    });
  }
  return normalized;
}

function resultFor(player, status, message, response = null) {
  return {
    playerId: player.playerId ?? null,
    steamId: player.steamId || null,
    playerName: player.playerName || "",
    fromTeamId: player.fromTeamId ?? null,
    targetTeamId: player.targetTeamId ?? null,
    status,
    ok: status === "success",
    message,
    error: status === "success" ? "" : status,
    command: response?.command ?? "",
    rconResponse: response?.rconResponse ?? "",
    completedAt: new Date().toISOString(),
  };
}

function recordPlayerResult(batch, result, playerIndex) {
  batch.results.push({ ...result, _playerIndex: playerIndex });
  batch.completed += 1;
  if (result.status === "success") batch.succeeded += 1;
  else if (result.status === "skipped_offline" || result.status === "already_applied" || result.status === "cancelled") batch.skipped += 1;
  else batch.failed += 1;
}

function addCurrentPlayer(batch, player) {
  batch.currentPlayers.push({ steamId: player.steamId, playerName: player.playerName });
  batch.currentPlayer = batch.currentPlayers[0] ?? null;
}

function removeCurrentPlayer(batch, player) {
  batch.currentPlayers = batch.currentPlayers.filter((item) => item.steamId !== player.steamId);
  batch.currentPlayer = batch.currentPlayers[0] ?? null;
}

function markRemainingCancelled(batch, reason = "cancelled") {
  const completedIndexes = new Set(batch.results.map((result) => result._playerIndex));
  batch.players.forEach((player, playerIndex) => {
    if (completedIndexes.has(playerIndex)) return;
    recordPlayerResult(batch, resultFor(player, "cancelled", cancellationMessage(reason)), playerIndex);
  });
}

function cancellationMessage(reason) {
  const normalized = normalizeText(reason);
  if (!normalized || normalized === "cancelled") return "Batch cancelled.";
  if (normalized.startsWith("before execution:")) return `Batch cancelled ${normalized}.`;
  return `Batch cancelled: ${normalized}.`;
}

function snapshotBatch(batch) {
  const snapshot = JSON.parse(JSON.stringify(batch));
  snapshot.results = snapshot.results.map(({ _playerIndex, ...result }) => result);
  return snapshot;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeTeamId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clampInteger(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}
