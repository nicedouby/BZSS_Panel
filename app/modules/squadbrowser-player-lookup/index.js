// -*- coding: utf-8 -*-

const SOURCE_URL = "https://squadbrowser.app/players";
const PROFILE_ACTION = "40bf33ab7238c92dd51fce05c8de745f64c5600d25";
const SESSIONS_ACTION = "40b74301b9fe2a47ce1df21e51688fc5496f856f96";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const CACHE_TTL_MS = 60_000;

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
    const error = new Error(String(payload?.error ?? "SquadBrowser 查询失败。"));
    error.code = "SquadBrowserUpstreamError";
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
      const error = new Error(`SquadBrowser HTTP ${response.status}`);
      error.code = "SquadBrowserHttpError";
      error.statusCode = response.status === 404 ? 404 : 502;
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
  const [profile, sessionData] = await Promise.all([
    callServerAction(PROFILE_ACTION, steam64),
    callServerAction(SESSIONS_ACTION, steam64),
  ]);
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
  const detail = await playerDatabase.getPlayerDetail?.(dbPlayer.id);
  const profile = detail?.steamProfile ?? {};
  return {
    playerId: dbPlayer.id,
    avatar: profile.avatar_medium ?? profile.avatar_full ?? dbPlayer.steam_avatar ?? null,
    savedSessions: Number(saved?.inserted ?? 0) + Number(saved?.updated ?? 0),
  };
}

export function createSquadBrowserPlayerLookupModule({ logger, modules }) {
  const cache = new Map();

  return {
    manifest: {
      id: "module.squadBrowserPlayerLookup",
      name: "SquadBrowser Player Lookup",
      kind: "module",
      version: "0.1.0",
      description: "查询 SquadBrowser 的玩家档案与最近服务器游玩记录。",
    },
    apiName: "squadBrowserPlayerLookup",
    api: {
      async lookup(value) {
        const steam64 = normalizeSteam64(value);
        const cached = cache.get(steam64);
        const result = cached && cached.expiresAt > Date.now()
          ? cached.value
          : await fetchLookupResult(steam64);

        const database = await persistLookupResult(modules?.playerDatabase, result);
        const enriched = {
          ...result,
          database,
          player: {
            ...result.player,
            steamAvatar: database?.avatar ?? null,
          },
        };
        cache.set(steam64, { expiresAt: Date.now() + CACHE_TTL_MS, value: enriched });
        if (cache.size > 100) {
          const oldest = cache.keys().next().value;
          if (oldest) cache.delete(oldest);
        }
        logger?.info?.(`[SquadBrowser] lookup steam64=${steam64} sessions=${enriched.sessions.length} saved=${database?.savedSessions ?? 0}`);
        return enriched;
      },
      clearCache() {
        cache.clear();
        return { ok: true };
      },
    },
  };
}
