// -*- coding: utf-8 -*-

const SOURCE_URL = "https://squadbrowser.app/players";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const CACHE_TTL_MS = 60_000;
const AUTO_REFRESH_TTL_MS = 36 * 60 * 60 * 1000;
const AUTO_REFRESH_INTERVAL_MS = 12_000;
const AUTO_REFRESH_BATCH_SIZE = 50;
const ONLINE_REFRESH_BATCH_SIZE = 8;
const FAILURE_BACKOFF_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const MAX_FAILURE_CACHE_SIZE = 5_000;
const BZSS_SERVER_LICENSE_ID = "LICENSED-1008168";
const LOYAL_PLAYER_TAG = "忠诚玩家";

let actionCache = {
  profile: "404fee0c709081e101437b42eca9a7480cf839f19e",
  sessions: "40e689b5cfcae1b65138618595288f2cedf3530132",
  fetchedAt: Date.now(),
};

async function discoverActionsFromUpstream() {
  try {
    const [htmlRes, rscRes] = await Promise.all([
      fetch(SOURCE_URL, { headers: { "User-Agent": "BZSS-Panel SquadBrowser lookup/1.0" } }),
      fetch(SOURCE_URL, { headers: { RSC: "1", "User-Agent": "BZSS-Panel SquadBrowser lookup/1.0" } }),
    ]);
    const html = await htmlRes.text();
    const rsc = await rscRes.text();
    const combined = html + "\n" + rsc;

    const chunkRegex = /\/_next\/static\/chunks\/[a-f0-9]+\.js/g;
    const scriptUrls = new Set(combined.match(chunkRegex) || []);

    const discovered = {};
    for (const urlPath of scriptUrls) {
      const jsRes = await fetch(`https://squadbrowser.app${urlPath}`, {
        headers: { "User-Agent": "BZSS-Panel SquadBrowser lookup/1.0" },
      });
      const text = await jsRes.text();
      if (!text.includes("createServerReference")) continue;

      const regex = /["']([a-f0-9]{30,60})["']\s*,\s*[^,]+\s*,\s*[^,]+\s*,\s*[^,]+\s*,\s*["'](getPlayerProfile|getPlayerSessions)["']/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const [, hash, name] = match;
        if (name === "getPlayerProfile") discovered.profile = hash;
        if (name === "getPlayerSessions") discovered.sessions = hash;
      }
    }

    if (discovered.profile && discovered.sessions) {
      actionCache = { ...discovered, fetchedAt: Date.now() };
      return discovered;
    }
  } catch {}
  return actionCache;
}

function normalizeSteam64(value) {
  const steam64 = String(value ?? "").trim();
  if (!/^\d{17}$/.test(steam64)) {
    const error = new Error("Steam64 必须是 17 位数字。");
    error.statusCode = 400;
    error.code = "InvalidSteam64";
    throw error;
  }
  return steam64;
}

function parseServerActionResponse(text) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .find((item) => item.startsWith("1:"));
  if (!line) throw new Error("SquadBrowser 返回格式无法识别。");

  let payload;
  try {
    payload = JSON.parse(line.slice(2));
  } catch {
    throw new Error("SquadBrowser 返回了无效数据。");
  }
  if (!payload?.ok) {
    const error = new Error(describeUnknownValue(payload?.error ?? "SquadBrowser 查询失败。"));
    error.code = "SquadBrowserUpstreamError";
    error.responseBody = String(text ?? "").slice(0, 2_048);
    throw error;
  }
  return payload.data ?? {};
}

async function callServerAction(action, steam64) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${SOURCE_URL}/${steam64}`, {
      method: "POST",
      headers: {
        Accept: "text/x-component",
        "Content-Type": "text/plain;charset=UTF-8",
        "Next-Action": action,
        Referer: `${SOURCE_URL}/${steam64}`,
        "User-Agent": "BZSS-Panel SquadBrowser lookup/1.0",
      },
      body: JSON.stringify([steam64]),
      signal: controller.signal,
    });
    if (!response.ok) {
      const responseBody = (await response.text().catch(() => "")).slice(0, 2_048);
      const error = new Error(`SquadBrowser HTTP ${response.status} ${response.statusText || ""}`.trim());
      error.code = "SquadBrowserHttpError";
      error.statusCode = response.status === 404 ? 404 : 502;
      error.httpStatus = response.status;
      error.statusText = response.statusText;
      error.url = response.url || `${SOURCE_URL}/${steam64}`;
      error.responseBody = responseBody;
      throw error;
    }

    const reader = response.body?.getReader();
    if (!reader) return parseServerActionResponse(await response.text());
    const chunks = [];
    let total = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        const error = new Error("SquadBrowser 返回数据过大。");
        error.code = "SquadBrowserResponseTooLarge";
        error.statusCode = 502;
        throw error;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return parseServerActionResponse(chunks.join(""));
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("SquadBrowser 查询超时。");
      timeoutError.code = "SquadBrowserTimeout";
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function getSquadBrowserFailureBackoffMs(failureCount) {
  const index = Math.min(Math.max(Number(failureCount) - 1, 0), FAILURE_BACKOFF_MS.length - 1);
  return FAILURE_BACKOFF_MS[index];
}

export function serializeSquadBrowserError(error) {
  if (error instanceof Error || (error && typeof error === "object")) {
    return {
      name: String(error?.name ?? "Error"),
      message: describeUnknownValue(error?.message ?? error),
      code: error?.code ?? null,
      statusCode: Number.isFinite(Number(error?.statusCode)) ? Number(error.statusCode) : null,
      httpStatus: Number.isFinite(Number(error?.httpStatus)) ? Number(error.httpStatus) : null,
      statusText: error?.statusText ? String(error.statusText) : null,
      url: error?.url ? String(error.url) : null,
      responseBody: error?.responseBody ? String(error.responseBody).slice(0, 2_048) : null,
      cause: error?.cause ? describeUnknownValue(error.cause) : null,
    };
  }
  return { name: typeof error, message: describeUnknownValue(error) };
}

function describeUnknownValue(value) {
  if (typeof value === "string") return value;
  if (value == null) return String(value ?? "");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeProfile(profile, steam64) {
  return {
    // 保留上游返回的全部字段，页面可展示完整资料，新增字段无需再次改后端。
    ...(profile && typeof profile === "object" ? profile : {}),
    steamId: profile?.steamId ?? steam64,
    eosId: profile?.eosId ?? null,
    displayName: profile?.displayName ?? null,
    firstSeen: profile?.firstSeen ?? null,
    lastSeen: profile?.lastSeen ?? null,
    squadHours: Number.isFinite(Number(profile?.squadHours)) ? Number(profile.squadHours) : null,
    steamHoursUpdatedAt: profile?.steamHoursUpdatedAt ?? null,
    steamProfilePrivate: Boolean(profile?.steamProfilePrivate),
    isOnline: Boolean(profile?.isOnline),
    currentServer: profile?.currentServer ?? null,
    topServer: profile?.topServer ?? null,
    stats: profile?.stats ?? {},
    favoriteServers: Array.isArray(profile?.favoriteServers) ? profile.favoriteServers : [],
  };
}

function normalizeSessions(sessions) {
  return (Array.isArray(sessions) ? sessions : []).map((session) => ({
    // 保留每条记录的全部上游字段，兼容站点后续增加地图、阵营等字段。
    ...(session && typeof session === "object" ? session : {}),
    id: session?.id ?? null,
    serverId: session?.serverId ?? null,
    serverName: session?.serverName ?? null,
    joinedAt: session?.joinedAt ?? null,
    leftAt: session?.leftAt ?? null,
    durationMinutes: session?.durationMinutes == null
      ? null
      : (Number.isFinite(Number(session.durationMinutes)) ? Number(session.durationMinutes) : null),
  }));
}

async function fetchLookupResult(steam64) {
  let profileAction = actionCache.profile;
  let sessionsAction = actionCache.sessions;

  try {
    const [profile, sessionData] = await Promise.all([
      callServerAction(profileAction, steam64),
      callServerAction(sessionsAction, steam64),
    ]);
    return buildLookupPayload(profile, sessionData, steam64);
  } catch (error) {
    if (error?.statusCode === 404 || error?.code === "SquadBrowserHttpError") {
      const freshActions = await discoverActionsFromUpstream();
      if (freshActions.profile !== profileAction || freshActions.sessions !== sessionsAction) {
        const [profile, sessionData] = await Promise.all([
          callServerAction(freshActions.profile, steam64),
          callServerAction(freshActions.sessions, steam64),
        ]);
        return buildLookupPayload(profile, sessionData, steam64);
      }
    }
    throw error;
  }
}

function buildLookupPayload(profile, sessionData, steam64) {
  return {
    ok: true,
    source: "SquadBrowser",
    sourceUrl: `${SOURCE_URL}/${steam64}`,
    fetchedAt: new Date().toISOString(),
    player: normalizeProfile(profile, steam64),
    sessions: normalizeSessions(sessionData?.sessions),
    sessionLimit: 50,
  };
}

export function evaluateLoyalPlayer(rankings = []) {
  const servers = (Array.isArray(rankings) ? rankings : []).slice(0, 15);
  const normalized = servers.map((server) => ({
    ...server,
    minutes: Math.max(0, Number(server?.playtimeMinutes) || 0),
  }));
  const totalMinutes = normalized.reduce((sum, server) => sum + server.minutes, 0);
  const bzss = normalized.find((server) => (
    String(server?.serverId ?? "").trim() === BZSS_SERVER_LICENSE_ID
    || (String(server?.serverName ?? "").includes("步战鼠鼠")
      || String(server?.serverName ?? "").toUpperCase().includes("BZSS"))
  ));
  const highestMinutes = normalized.reduce((highest, server) => Math.max(highest, server.minutes), 0);
  const share = totalMinutes > 0 && bzss ? bzss.minutes / totalMinutes : 0;
  return {
    qualified: Boolean(bzss && bzss.minutes === highestMinutes && share > 0.5),
    bzssMinutes: bzss?.minutes ?? 0,
    totalMinutes,
    share,
  };
}

async function persistLookupResult(playerDatabase, result) {
  if (!playerDatabase?.upsertFromPresence) return null;
  const player = result?.player ?? {};
  const dbPlayer = await playerDatabase.upsertFromPresence({
    name: player.displayName,
    steamID: player.steamId,
    eosID: player.eosId,
  });
  if (!dbPlayer?.id) return null;

  const saved = await playerDatabase.upsertSquadBrowserSessions?.(
    dbPlayer.id,
    result.sessions,
    Date.parse(result.fetchedAt) || Date.now(),
  );
  const fetchedAt = Date.parse(result.fetchedAt) || Date.now();
  await playerDatabase.upsertSquadBrowserProfile?.(
    dbPlayer.id,
    player.steamId,
    result.player,
    fetchedAt,
  );
  const ranking = await playerDatabase.replaceSquadBrowserServerRankings?.(
    dbPlayer.id,
    player.favoriteServers,
    fetchedAt,
  );
  const loyalty = evaluateLoyalPlayer(player.favoriteServers);
  await playerDatabase.setPlayerTagPresence?.(
    dbPlayer.id,
    "automatic",
    LOYAL_PLAYER_TAG,
    loyalty.qualified,
  );
  const detail = await playerDatabase.getPlayerDetail?.(dbPlayer.id);
  const profile = detail?.steamProfile ?? {};
  return {
    playerId: dbPlayer.id,
    avatar: profile.avatar_medium ?? profile.avatar_full ?? dbPlayer.steam_avatar ?? null,
    savedSessions: Number(saved?.inserted ?? 0),
    savedServerRankings: Number(ranking?.saved ?? 0),
    loyalPlayer: loyalty,
  };
}

export function createSquadBrowserPlayerLookupModule({
  core,
  logger,
  modules,
  lookupFetcher = fetchLookupResult,
}) {
  const cache = new Map();
  const lookupInFlight = new Map();
  const failures = new Map();
  let refreshTimer = null;
  let initialRefreshTimer = null;
  let refreshInFlight = false;
  let started = false;
  let refreshCount = 0;
  let lastRefreshAt = null;
  let lastRefreshError = null;

  function onlineSteamIds() {
    const serverId = core?.webStatus?.serverId;
    const players = modules?.playerState?.getOnlinePlayers?.(serverId) ?? [];
    return new Set(players
      .map((player) => String(player?.steamID ?? player?.steam64 ?? player?.steam_id ?? "").trim())
      .filter((steam64) => /^\d{17}$/.test(steam64)));
  }

  async function refreshOneCandidate(candidate, { force = false } = {}) {
    const steam64 = normalizeSteam64(candidate?.steam_id);
    const previousFailure = failures.get(steam64);
    if (!force && previousFailure && Date.now() < previousFailure.nextRetryAt) return null;
    try {
      await api.lookup(steam64, { bypassCache: true });
      failures.delete(steam64);
      refreshCount += 1;
      lastRefreshAt = Date.now();
      lastRefreshError = null;
      return true;
    } catch (error) {
      const serialized = serializeSquadBrowserError(error);
      lastRefreshError = JSON.stringify(serialized);
      const count = Number(previousFailure?.count ?? 0) + 1;
      failures.delete(steam64);
      failures.set(steam64, {
        count,
        lastFailureAt: Date.now(),
        nextRetryAt: Date.now() + getSquadBrowserFailureBackoffMs(count),
        lastError: serialized,
      });
      while (failures.size > MAX_FAILURE_CACHE_SIZE) failures.delete(failures.keys().next().value);
      await modules?.playerDatabase?.recordSquadBrowserLookupFailure?.(
        candidate?.id,
        steam64,
        lastRefreshError,
      );
      logger?.warn?.(`[SquadBrowser] automatic refresh failed steam64=${steam64}: ${lastRefreshError}`);
      return false;
    }
  }

  async function runAutoRefresh() {
    if (refreshInFlight || !modules?.playerDatabase?.listSquadBrowserRefreshCandidates) return;
    refreshInFlight = true;
    try {
      // 先把当前局内全部玩家写入候选库。此前新进入后始终在线的玩家若未被其他模块落库，
      // 就永远不会出现在数据库候选中，因此不会被 SquadBrowser 自动查询。
      const serverId = core?.webStatus?.serverId;
      const onlinePlayers = modules?.playerState?.getOnlinePlayers?.(serverId) ?? [];
      await Promise.all(onlinePlayers.map(async (player) => {
        const steamID = String(player?.steamID ?? player?.steam64 ?? player?.steam_id ?? "").trim();
        if (!/^\d{17}$/.test(steamID)) return;
        await modules?.playerDatabase?.upsertFromPresence?.({
          name: player?.name ?? player?.playerName ?? null,
          steamID,
          eosID: player?.eosID ?? player?.eos ?? player?.eos_id ?? null,
        });
      }));

      const staleBefore = Date.now() - AUTO_REFRESH_TTL_MS;
      const online = onlineSteamIds();
      // 在线队列独立查询：数据库中排在前面的离线历史记录不能再挤占当前对局玩家。
      const onlineCandidates = await modules.playerDatabase.listSquadBrowserRefreshCandidatesBySteamIDs?.(
        [...online],
        { staleBefore },
      ) ?? [];
      if (onlineCandidates.length) {
        await Promise.all(onlineCandidates
          .slice(0, ONLINE_REFRESH_BATCH_SIZE)
          .map((candidate) => refreshOneCandidate(candidate)));
        return;
      }

      // 没有待刷新的在线玩家后，才把带宽留给离线的历史补全。
      const candidates = await modules.playerDatabase.listSquadBrowserRefreshCandidates({
        limit: AUTO_REFRESH_BATCH_SIZE,
        staleBefore,
      });
      if (candidates.length) await refreshOneCandidate(candidates[0]);
    } finally {
      refreshInFlight = false;
    }
  }

  const api = {
    async lookup(value, { bypassCache = false } = {}) {
      const steam64 = normalizeSteam64(value);
      const cached = cache.get(steam64);
      if (!bypassCache && cached && cached.expiresAt > Date.now()) return cached.value;
      const existing = lookupInFlight.get(steam64);
      if (existing) return existing;

      const promise = (async () => {
        const result = await lookupFetcher(steam64);
        const database = await persistLookupResult(modules?.playerDatabase, result);
        const enriched = {
          ...result,
          database,
          player: {
            ...result.player,
            steamAvatar: database?.avatar ?? null,
          },
        };
        cache.delete(steam64);
        cache.set(steam64, { expiresAt: Date.now() + CACHE_TTL_MS, value: enriched });
        while (cache.size > 100) cache.delete(cache.keys().next().value);
        logger?.info?.(`[SquadBrowser] lookup steam64=${steam64} sessions=${enriched.sessions.length} saved=${database?.savedSessions ?? 0}`);
        return enriched;
      })();
      lookupInFlight.set(steam64, promise);
      try {
        return await promise;
      } finally {
        if (lookupInFlight.get(steam64) === promise) lookupInFlight.delete(steam64);
      }
    },
    async refreshOnline({ force = false } = {}) {
      const serverId = core?.webStatus?.serverId;
      const players = modules?.playerState?.getOnlinePlayers?.(serverId) ?? [];
      const steamIDs = [...new Set(players
        .map((player) => String(player?.steamID ?? player?.steam64 ?? player?.steam_id ?? "").trim())
        .filter((steamID) => /^\d{17}$/.test(steamID)))];
      const candidates = force
        ? steamIDs.map((steam_id) => ({ steam_id }))
        : await modules?.playerDatabase?.listSquadBrowserRefreshCandidatesBySteamIDs?.(
          steamIDs, { staleBefore: Date.now() - AUTO_REFRESH_TTL_MS },
        ) ?? [];
      const result = { total: candidates.length, updated: 0, failed: 0, skipped: steamIDs.length - candidates.length };
      for (let index = 0; index < candidates.length; index += ONLINE_REFRESH_BATCH_SIZE) {
        const batch = candidates.slice(index, index + ONLINE_REFRESH_BATCH_SIZE);
        const outcomes = await Promise.all(batch.map((candidate) => refreshOneCandidate(candidate, { force })));
        result.updated += outcomes.filter(Boolean).length;
        result.failed += outcomes.filter((ok) => ok === false).length;
        result.skipped += outcomes.filter((ok) => ok === null).length;
      }
      return result;
    },
    async runAutoRefresh() {
      return runAutoRefresh();
    },
    getAutoRefreshStatus() {
      return {
        ttlHours: AUTO_REFRESH_TTL_MS / 3_600_000,
        refreshCount,
        lastRefreshAt,
        lastRefreshError,
        refreshing: refreshInFlight,
        inFlightCount: lookupInFlight.size,
        failureCount: failures.size,
      };
    },
    clearCache() {
      cache.clear();
      return { ok: true };
    },
  };

  return {
    manifest: {
      id: "module.squadBrowserPlayerLookup",
      name: "SquadBrowser Player Lookup",
      kind: "module",
      version: "0.1.0",
      description: "查询 SquadBrowser 的玩家档案与最近服务器游玩记录。",
    },
    apiName: "squadBrowserPlayerLookup",
    api,
    async start() {
      if (started) return;
      started = true;
      // 先稍等模块全部启动，再开始低频后台刷新，避免影响实时事件。
      refreshTimer = setInterval(() => { void runAutoRefresh(); }, AUTO_REFRESH_INTERVAL_MS);
      initialRefreshTimer = setTimeout(() => { void runAutoRefresh(); }, 3_000);
      logger?.info?.("[SquadBrowser] automatic player refresh started (36h TTL).");
    },
    async stop() {
      started = false;
      if (refreshTimer) clearInterval(refreshTimer);
      if (initialRefreshTimer) clearTimeout(initialRefreshTimer);
      refreshTimer = null;
      initialRefreshTimer = null;
    },
  };
}
