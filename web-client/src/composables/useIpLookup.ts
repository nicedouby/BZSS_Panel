import { computed, unref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet } from "../app/apiClient";
import { collectIps } from "../utils/ip";

export interface IpLookupResult {
  ip: string;
  source: "cache" | "cache_stale" | "provider" | "private" | "invalid" | "unknown";
  provider: "local-mmdb" | "ip-api" | "ipinfo" | "manual" | "none";
  country: string;
  region: string;
  city: string;
  isp: string;
  org: string;
  asn: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  isPrivate: boolean;
  isProxy: boolean | null;
  isHosting: boolean | null;
  updatedAt: number;
  error: string;
  stale?: boolean;
}

export function useIpLookup(source: any, options: { enabled?: any; chunkSize?: number } = {}) {
  const normalizedIps = computed(() => collectIps(unref(source) ?? []));
  const enabled = computed(() => Boolean(unref(options.enabled) ?? true) && normalizedIps.value.length > 0);
  const chunkSize = Math.max(1, Number(options.chunkSize ?? 50));

  const query = useQuery({
    queryKey: computed(() => ["ip-lookup-many", normalizedIps.value.join("|")]),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 24 * 60 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const items: Record<string, IpLookupResult> = {};
      const ips = normalizedIps.value;
      for (let index = 0; index < ips.length; index += chunkSize) {
        const chunk = ips.slice(index, index + chunkSize);
        if (!chunk.length) continue;
        try {
          const response = await apiGet<{ items?: Record<string, IpLookupResult> }>(`/api/ip/lookup-many?ips=${encodeURIComponent(chunk.join(","))}`);
          Object.assign(items, response.items ?? {});
        } catch {}
      }
      return { items };
    },
  });

  return {
    normalizedIps,
    query,
    items: computed(() => query.data.value?.items ?? {}),
  };
}
