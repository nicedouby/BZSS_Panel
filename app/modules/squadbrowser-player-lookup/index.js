// -*- coding: utf-8 -*-

const SOURCE_URL = "https://squadbrowser.app/players";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const CACHE_TTL_MS = 60_000;

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
