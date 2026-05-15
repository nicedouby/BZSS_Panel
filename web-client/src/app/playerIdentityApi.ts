import { apiGet } from "./apiClient";

export type PlayerIdentityIpSource = "current" | "last" | "none";

export interface PlayerIdentityIpResult {
  ip: string;
  source: PlayerIdentityIpSource;
}

interface PlayerIdentityLookupInput {
  steamId?: string | null;
  eosId?: string | null;
  name?: string | null;
}

const ipResultCache = new Map<string, PlayerIdentityIpResult>();
const inFlightLookups = new Map<string, Promise<PlayerIdentityIpResult>>();

export async function resolvePlayerIdentityIp(input: PlayerIdentityLookupInput): Promise<PlayerIdentityIpResult> {
  const cacheKey = buildCacheKey(input);
  if (cacheKey && ipResultCache.has(cacheKey)) {
    return ipResultCache.get(cacheKey) as PlayerIdentityIpResult;
  }

  if (cacheKey && inFlightLookups.has(cacheKey)) {
    return inFlightLookups.get(cacheKey) as Promise<PlayerIdentityIpResult>;
  }

  const promise = (async () => {
    const searchKeys = [
      sanitize(input.steamId),
      sanitize(input.eosId),
      sanitize(input.name),
    ].filter(Boolean) as string[];

    for (const searchKey of searchKeys) {
      try {
        const match = await findPlayerDatabaseEntry(searchKey);
        if (!match) continue;

        const ip = extractIpFromDatabaseItem(match);
        if (ip) {
          return { ip, source: "last" as const };
        }

        const id = normalizeId(match.id);
        if (!id) continue;

        const detail = await loadPlayerDatabaseDetail(id);
        const detailIp = extractIpFromPlayerDetail(detail);
        if (detailIp) {
          return { ip: detailIp, source: "last" as const };
        }
      } catch {
        continue;
      }
    }

    return { ip: "", source: "none" as const };
  })();

  if (cacheKey) {
    inFlightLookups.set(cacheKey, promise);
  }

  try {
    const result = await promise;
    if (cacheKey) {
      ipResultCache.set(cacheKey, result);
    }
    return result;
  } finally {
    if (cacheKey) {
      inFlightLookups.delete(cacheKey);
    }
  }
}

function buildCacheKey(input: PlayerIdentityLookupInput) {
  const parts = [sanitize(input.steamId), sanitize(input.eosId), sanitize(input.name)].filter(Boolean);
  return parts.length ? parts.join("|") : "";
}

function sanitize(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeId(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : "";
}

async function findPlayerDatabaseEntry(searchKey: string) {
  const params = new URLSearchParams({
    q: searchKey,
    limit: "1",
    sort: "last_login_desc",
  });

  const response = await apiGet<any>(`/api/query/player-database?${params.toString()}`, {}, { timeoutMs: 5_000 });
  return firstDatabasePlayer(response);
}

async function loadPlayerDatabaseDetail(id: string) {
  return apiGet<any>(`/api/player-database/detail?id=${encodeURIComponent(id)}`, {}, { timeoutMs: 5_000 });
}

function firstDatabasePlayer(response: any) {
  return response?.items?.[0] ?? response?.players?.[0] ?? response?.rows?.[0] ?? null;
}

function extractIpFromDatabaseItem(item: any) {
  return sanitize(item?.current_ip || item?.ip);
}

function extractIpFromPlayerDetail(detail: any) {
  return sanitize(
    detail?.player?.current_ip
      || detail?.ips?.[0]?.ip,
  );
}
