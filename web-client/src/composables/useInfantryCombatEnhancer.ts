import { computed, reactive, ref, watch } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useRoute, useRouter } from "vue-router";
import { apiGet, apiPost } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import { useUiStore } from "../stores/ui.store";
import {
  INFANTRY_COMBAT_DEFAULT_CONFIG,
  INFANTRY_COMBAT_DEFAULT_FILTERS,
  type InfantryCombatConfig,
  type InfantryCombatEventRecord,
  type InfantryCombatFilters,
  type InfantryCombatOverview,
} from "../types/infantry-combat-enhancer";

export function useInfantryCombatEnhancer() {
  const route = useRoute();
  const router = useRouter();
  const ui = useUiStore();

  const filters = reactive<InfantryCombatFilters>(readFiltersFromQuery(route.query));
  const config = reactive<InfantryCombatConfig>({ ...INFANTRY_COMBAT_DEFAULT_CONFIG });
  const selectedEvent = ref<InfantryCombatEventRecord | null>(null);

  const configQuery = useQuery({
    queryKey: ["infantry-combat-enhancer-config"],
    queryFn: async () => apiGet<{ ok: boolean; config: Partial<InfantryCombatConfig> | null }>("/api/plugins/infantry-combat-enhancer/config"),
    refetchOnWindowFocus: false,
  });

  watch(
    () => configQuery.data.value?.config,
    (next) => {
      Object.assign(config, normalizeConfig(next));
    },
    { immediate: true },
  );

  const configMutation = useMutation({
    mutationFn: async (patch: Partial<InfantryCombatConfig>) => apiPost("/api/plugins/infantry-combat-enhancer/config", patch),
    onSuccess: (response: any) => {
      Object.assign(config, normalizeConfig(response?.config));
      ui.pushToast({
        title: "保存完成",
        message: "步兵战斗增强配置已更新。",
        tone: "ok",
      });
    },
    onError: (error) => {
      ui.pushToast({
        title: "保存失败",
        message: renderApiError(error, "更新步兵战斗增强配置失败"),
        tone: "error",
      });
    },
  });

  const eventsQuery = useQuery({
    queryKey: computed(() => [
      "infantry-combat-enhancer",
      filters.type,
      filters.warning,
      filters.relation,
      filters.weapon,
      filters.q,
      filters.limit,
      filters.offset,
      filters.autoRefresh,
    ]),
    queryFn: async () => apiGet<{
      events: Array<InfantryCombatEventRecord>;
      overview: InfantryCombatOverview | null;
    }>(buildEventsEndpoint(filters)),
    placeholderData: (previousData) => previousData,
    refetchInterval: () => (filters.autoRefresh ? 3000 : false),
    refetchIntervalInBackground: false,
  });

  const events = computed(() => eventsQuery.data.value?.events ?? []);
  const visibleEvents = events;
  const overview = computed(() => eventsQuery.data.value?.overview ?? null);
  const pageError = computed(() => (eventsQuery.error.value ? renderApiError(eventsQuery.error.value, "加载步兵战斗增强记录失败") : ""));
  const hasNextPage = computed(() => Boolean((overview.value?.count ?? 0) > (filters.offset + filters.limit)));
  const isEventsLoading = computed(() => eventsQuery.isLoading.value);
  const isEventsFetching = computed(() => eventsQuery.isFetching.value);
  const isConfigLoading = computed(() => configQuery.isLoading.value);
  const isConfigSaving = computed(() => configMutation.isPending.value);

  watch(
    () => events.value,
    (next) => {
      if (!next.length) {
        selectedEvent.value = null;
        return;
      }

      if (!next.some((event) => event.id === selectedEvent.value?.id)) {
        selectedEvent.value = null;
      }
    },
    { immediate: true },
  );

  watch(
    () => route.query,
    (query) => {
      const next = readFiltersFromQuery(query);
      if (sameFilters(filters, next)) return;
      Object.assign(filters, next);
    },
    { immediate: true },
  );

  watch(
    () => ({ ...filters }),
    () => {
      const query = buildQueryFromFilters(filters);
      if (sameQuery(route.query, query)) return;
      void router.replace({ query: { ...route.query, ...query, panel: "infantry-combat-enhancer" } });
    },
    { deep: true },
  );

  function setSelectedEvent(event: InfantryCombatEventRecord | null) {
    selectedEvent.value = event;
  }

  function reload() {
    void Promise.all([eventsQuery.refetch(), configQuery.refetch()]);
  }

  async function clearEvents() {
    const confirmed = await ui.openConfirm({
      title: "清空步兵战斗增强记录",
      message: "这只会清空当前内存缓存，不会影响数据库或原始日志。",
      confirmText: "清空",
      tone: "warn",
    });
    if (!confirmed) return;

    try {
      await apiPost("/api/plugins/infantry-combat-enhancer/clear", {});
      selectedEvent.value = null;
      ui.pushToast({
        title: "清空完成",
        message: "步兵战斗增强缓存已清空。",
        tone: "ok",
      });
      await eventsQuery.refetch();
    } catch (error) {
      ui.pushToast({
        title: "清空失败",
        message: renderApiError(error, "清空步兵战斗增强记录失败"),
        tone: "error",
      });
    }
  }

  function patchConfig(patch: Partial<InfantryCombatConfig>) {
    return configMutation.mutateAsync(patch);
  }

  return {
    filters,
    config,
    configQuery,
    configMutation,
    eventsQuery,
    events,
    visibleEvents,
    overview,
    pageError,
    selectedEvent,
    setSelectedEvent,
    reload,
    clearEvents,
    patchConfig,
    hasNextPage,
    isEventsLoading,
    isEventsFetching,
    isConfigLoading,
    isConfigSaving,
  };
}

function buildEventsEndpoint(filters: InfantryCombatFilters) {
  const params = new URLSearchParams({
    type: filters.type,
    warning: filters.warning,
    relation: filters.relation,
    weapon: filters.weapon,
    search: filters.q,
    limit: String(filters.limit),
    offset: String(filters.offset),
  });
  return `/api/plugins/infantry-combat-enhancer/events?${params.toString()}`;
}

function readFiltersFromQuery(query: Record<string, unknown>): InfantryCombatFilters {
  return {
    type: normalizeType(query.type),
    warning: normalizeWarning(query.warning),
    relation: normalizeRelation(query.relation),
    weapon: normalizeWeapon(query.weapon),
    q: normalizeString(query.q),
    limit: normalizeNumber(query.limit, INFANTRY_COMBAT_DEFAULT_FILTERS.limit),
    offset: normalizeNumber(query.offset, INFANTRY_COMBAT_DEFAULT_FILTERS.offset),
    autoRefresh: normalizeBoolean(query.autoRefresh, INFANTRY_COMBAT_DEFAULT_FILTERS.autoRefresh),
  };
}

function buildQueryFromFilters(filters: InfantryCombatFilters) {
  return {
    type: filters.type !== "all" ? filters.type : undefined,
    warning: filters.warning !== "all" ? filters.warning : undefined,
    relation: filters.relation !== "all" ? filters.relation : undefined,
    weapon: filters.weapon !== "all" ? filters.weapon : undefined,
    q: filters.q || undefined,
    limit: filters.limit !== INFANTRY_COMBAT_DEFAULT_FILTERS.limit ? String(filters.limit) : undefined,
    offset: filters.offset > 0 ? String(filters.offset) : undefined,
    autoRefresh: filters.autoRefresh === INFANTRY_COMBAT_DEFAULT_FILTERS.autoRefresh
      ? undefined
      : "0",
  };
}

function normalizeConfig(source: Partial<InfantryCombatConfig> | null | undefined): InfantryCombatConfig {
  return {
    enabled: source?.enabled ?? INFANTRY_COMBAT_DEFAULT_CONFIG.enabled,
    forceAttackerDamageDisplay: source?.forceAttackerDamageDisplay ?? INFANTRY_COMBAT_DEFAULT_CONFIG.forceAttackerDamageDisplay,
    minAttackerDamage: normalizeNumber(source?.minAttackerDamage, INFANTRY_COMBAT_DEFAULT_CONFIG.minAttackerDamage),
    damageDebounceMs: normalizeNumber(source?.damageDebounceMs, INFANTRY_COMBAT_DEFAULT_CONFIG.damageDebounceMs),
    showKillDisplay: source?.showKillDisplay ?? INFANTRY_COMBAT_DEFAULT_CONFIG.showKillDisplay,
    showOnlyLightWeaponDamage: source?.showOnlyLightWeaponDamage ?? INFANTRY_COMBAT_DEFAULT_CONFIG.showOnlyLightWeaponDamage,
    showVictimDamage: source?.showVictimDamage ?? INFANTRY_COMBAT_DEFAULT_CONFIG.showVictimDamage,
    showVictimWound: source?.showVictimWound ?? INFANTRY_COMBAT_DEFAULT_CONFIG.showVictimWound,
    showVictimKill: source?.showVictimKill ?? INFANTRY_COMBAT_DEFAULT_CONFIG.showVictimKill,
    showAttackerDamage: source?.showAttackerDamage ?? INFANTRY_COMBAT_DEFAULT_CONFIG.showAttackerDamage,
    storeRecentEventLimit: normalizeNumber(source?.storeRecentEventLimit, INFANTRY_COMBAT_DEFAULT_CONFIG.storeRecentEventLimit),
  };
}

function sameFilters(left: InfantryCombatFilters, right: InfantryCombatFilters) {
  return left.type === right.type
    && left.warning === right.warning
    && left.relation === right.relation
    && left.weapon === right.weapon
    && left.q === right.q
    && left.limit === right.limit
    && left.offset === right.offset
    && left.autoRefresh === right.autoRefresh;
}

function sameQuery(query: Record<string, unknown>, next: Record<string, unknown>) {
  const keys = ["type", "warning", "relation", "weapon", "q", "limit", "offset", "autoRefresh"];
  return keys.every((key) => normalizeString(query[key]) === normalizeString(next[key]));
}

function normalizeType(value: unknown) {
  const text = normalizeString(value);
  if (text === "damage" || text === "wound" || text === "kill" || text === "revive") return text;
  return "all";
}

function normalizeWarning(value: unknown) {
  const text = normalizeString(value);
  if (text === "victim_sent" || text === "attacker_sent" || text === "skipped" || text === "failed") return text;
  return "all";
}

function normalizeRelation(value: unknown) {
  const text = normalizeString(value);
  if (text === "enemy" || text === "friendly" || text === "self" || text === "same_player") return text;
  return "all";
}

function normalizeWeapon(value: unknown) {
  const text = normalizeString(value);
  if (text === "light" || text === "non_light" || text === "explosive" || text === "vehicle" || text === "emplacement" || text === "unknown") return text;
  return "all";
}

function normalizeString(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (value == null || value === "") return fallback;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}
