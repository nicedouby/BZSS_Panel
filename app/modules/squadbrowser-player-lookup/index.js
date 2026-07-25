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

export function createSquadBrowserPlayerLookupModule({ logger }) {
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
        if (cached && cached.expiresAt > Date.now()) return cached.value;

        const [profile, sessionData] = await Promise.all([
          callServerAction(PROFILE_ACTION, steam64),
          callServerAction(SESSIONS_ACTION, steam64),
        ]);
        const result = {
          ok: true,
          source: "SquadBrowser",
          sourceUrl: `${SOURCE_URL}/${steam64}`,
          fetchedAt: new Date().toISOString(),
          player: normalizeProfile(profile, steam64),
          sessions: normalizeSessions(sessionData?.sessions),
          sessionLimit: 50,
        };
        cache.set(steam64, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
        if (cache.size > 100) {
          const oldest = cache.keys().next().value;
          if (oldest) cache.delete(oldest);
        }
        logger?.info?.(`[SquadBrowser] lookup steam64=${steam64} sessions=${result.sessions.length}`);
        return result;
      },
      clearCache() {
        cache.clear();
        return { ok: true };
      },
    },
  };
}
