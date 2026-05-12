<template>
  <section class="page db-page">
    <section class="db-overview">
      <div class="db-overview-card">
        <div v-for="item in overviewCards" :key="item.label" class="db-stat-item">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </div>
      </div>
    </section>

    <section class="db-toolbar-shell">
      <div class="db-toolbar-card">
        <div class="console-toolbar db-toolbar-row">
          <input
            v-model="filters.q"
            class="console-input db-search"
            :placeholder="t('database.searchPlaceholder')"
          >
          <select v-model="filters.sort" class="console-select">
            <option value="updated_desc">{{ t("database.sortRecentlyUpdated") }}</option>
            <option value="name_asc">{{ t("database.sortNameAsc") }}</option>
            <option value="last_login_desc">{{ t("database.sortLastLogin") }}</option>
          </select>
          <button type="button" @click="openStatsModal">{{ t("database.openStatsModal") }}</button>
        </div>
      </div>
    </section>

    <div class="db-panel">
      <aside class="db-list-col">
        <div v-if="listLoading && !rows.length" class="placeholder">{{ t("database.loadingPlayerList") }}</div>
        <div v-else-if="listError" class="placeholder">{{ listError }}</div>
        <div v-else-if="!rows.length" class="placeholder">{{ t("database.noMatchingPlayers") }}</div>
        <button
          v-for="player in rows"
          :key="player.id"
          type="button"
          class="db-row"
          :class="{ active: selectedId === player.id }"
          @click="openPlayer(player.id)"
        >
          <div class="db-row-name">{{ player.current_name || player.name || t("common.unknown") }}</div>
          <div class="db-row-meta">
            {{ player.permission_group || "default" }} · {{ t("database.ladderRating") }}={{ player.ladder_rating ?? 0 }} · {{ t("database.kills") }}={{ player.total_kills_light ?? 0 }} · {{ t("database.teamKills") }}={{ teamKills(player) }}
          </div>
          <div class="db-row-meta">
            {{ t("database.lastLogin") }} {{ formatTime(player.last_login_at) }} · {{ t("database.updatedAt") }} {{ formatTime(player.updated_at) }}
          </div>
          <div v-if="showIpInList && (player.current_ip || player.ip)" class="db-row-ip">
            <button type="button" class="db-copy-link" @click.stop="copyRowIp(player)">{{ t("database.copyIp") }}</button>
            <span class="db-row-ip-value">{{ player.current_ip || player.ip }}</span>
            <small>{{ listIpSummary(player) || "" }}</small>
          </div>
        </button>
      </aside>

      <section class="db-detail-col">
        <div class="db-detail-scroll">
        <div v-if="selectedId === null" class="placeholder">{{ t("database.selectPlayer") }}</div>
        <div v-else-if="detailLoading && !detail" class="placeholder">{{ t("database.loadingDetail") }}</div>
        <div v-else-if="detailError" class="placeholder db-error-block">
          <div>{{ detailError }}</div>
          <button type="button" class="console-clear-btn" @click="retryDetail">{{ t("database.retry") }}</button>
        </div>
        <template v-else-if="detail">
          <div class="db-detail-head">
            <div>
              <h2>{{ detail.player?.current_name || detail.player?.name || t("player.player") }}</h2>
              <p>Steam64 {{ detail.player?.steam_id || "--" }} · EOS {{ detail.player?.eos_id || "--" }}</p>
            </div>
            <button type="button" class="console-clear-btn" @click="closePlayerDetail">{{ t("database.closeDetail") }}</button>
          </div>

          <div class="db-card">
            <h3>{{ t("database.overview") }}</h3>
            <div class="db-grid">
              <div v-if="showIpInDetail" class="db-ip-field">
                <span>{{ t("player.currentIp") }}</span>
                <div class="db-ip-line">
                  <strong>{{ currentIp }}</strong>
                  <button type="button" class="db-copy-link" :disabled="currentIp === '--'" @click="copyIp(currentIp)">{{ t("common.copy") }}</button>
                </div>
                <small>{{ currentIpSummary }}</small>
              </div>
              <div><span>{{ fieldLabel("permission_group", t("database.permissionGroup")) }}</span><strong>{{ detail.player?.permission_group || "default" }}</strong></div>
              <div><span>{{ fieldLabel("created_at", t("database.createdAt")) }}</span><strong>{{ formatTime(detail.player?.created_at) }}</strong></div>
              <div><span>{{ fieldLabel("updated_at", t("database.updatedAt")) }}</span><strong>{{ formatTime(detail.player?.updated_at) }}</strong></div>
              <div><span>{{ t("database.gameTime") }}</span><strong>{{ formatSeconds(detail.summary?.gameSeconds ?? detail.player?.game_seconds ?? 0) }}</strong></div>
              <div><span>{{ t("database.serverTime") }}</span><strong>{{ formatSeconds(detail.summary?.serverSeconds ?? detail.player?.server_seconds ?? 0) }}</strong></div>
              <div><span>{{ t("database.totalKills") }}</span><strong>{{ formatNumber(detail.summary?.totalKills ?? 0) }}</strong></div>
              <div><span>{{ t("database.totalDowns") }}</span><strong>{{ formatNumber(detail.summary?.totalDowns ?? 0) }}</strong></div>
              <div><span>{{ t("database.totalDeaths") }}</span><strong>{{ formatNumber(detail.summary?.totalDeaths ?? 0) }}</strong></div>
              <div><span>{{ t("database.totalTeamKills") }}</span><strong>{{ formatNumber(detail.summary?.totalTeamKills ?? 0) }}</strong></div>
              <div><span>{{ t("database.ladderRating") }}</span><strong>{{ formatNumber(detail.player?.ladder_rating ?? 0) }}</strong></div>
              <div><span>{{ t("database.winRate") }}</span><strong>{{ winRate(detail.player?.total_match_wins, detail.player?.total_matches) }}</strong></div>
            </div>
          </div>

          <div class="db-card">
            <h3>{{ t("database.warmupStats") }}</h3>
            <div class="db-grid">
              <div><span>{{ t("database.kills") }}</span><strong>{{ warmupTotal(detail.warmupStats, "kills") }}</strong></div>
              <div><span>{{ t("database.downs") }}</span><strong>{{ warmupTotal(detail.warmupStats, "downs") }}</strong></div>
              <div><span>{{ t("database.receivedDowns") }}</span><strong>{{ detail.warmupStats?.total_downed_received ?? 0 }}</strong></div>
              <div><span>{{ t("database.teamKills") }}</span><strong>{{ warmupTotal(detail.warmupStats, "teamKills") }}</strong></div>
              <div><span>{{ t("database.deaths") }}</span><strong>{{ detail.warmupStats?.total_deaths ?? 0 }}</strong></div>
              <div><span>{{ t("database.suicides") }}</span><strong>{{ detail.warmupStats?.total_suicides ?? 0 }}</strong></div>
            </div>
          </div>

          <div class="db-detail-grid">
            <div class="db-card">
              <h3>{{ t("database.aliases") }} ({{ t("database.recent12") }})</h3>
              <ul class="db-list-mini">
                <li v-for="alias in (detail.aliases || []).slice(0, 12)" :key="`${alias.alias_name}-${alias.seen_at}`">
                  <span>{{ alias.alias_name }}</span>
                  <small>{{ formatTime(alias.seen_at) }}</small>
                </li>
                <li v-if="!(detail.aliases || []).length">{{ t("common.none") }}</li>
              </ul>
            </div>

            <div class="db-card">
              <h3>{{ t("database.ipHistory") }} ({{ t("database.recent12") }})</h3>
              <ul class="db-history-list">
                <li v-for="item in (detail.ips || []).slice(0, 12)" :key="`${item.ip}-${item.seen_at}`">
                  <div class="db-history-head">
                    <div>
                      <strong>{{ item.ip }}</strong>
                      <small>{{ formatTime(item.seen_at) }}</small>
                    </div>
                    <button type="button" class="db-copy-link" @click="copyIp(item.ip)">{{ t("common.copy") }}</button>
                  </div>
                  <small>{{ ipDetailSummary(item.ip) || t("common.unknown") }}</small>
                  <small>{{ ipSourceLabel(item.ip) }}</small>
                </li>
                <li v-if="!(detail.ips || []).length">{{ t("common.none") }}</li>
              </ul>
            </div>

            <div class="db-card">
              <h3>{{ t("database.logins") }} ({{ t("database.recent12") }})</h3>
              <ul class="db-login-list">
                <li v-for="item in (detail.logins || []).slice(0, 12)" :key="`${item.ip}-${item.joined_at}`">
                  <div class="db-login-head">
                    <div>
                      <strong>{{ item.ip || "--" }}</strong>
                      <small>{{ formatTime(item.joined_at) }}</small>
                    </div>
                    <button v-if="item.ip" type="button" class="db-copy-link" @click="copyIp(item.ip)">{{ t("database.copyIp") }}</button>
                  </div>
                  <small v-if="item.controller_path">{{ t("player.controller") }} {{ item.controller_path }}</small>
                  <small v-if="item.steam_id">{{ t("player.steamId") }} {{ item.steam_id }}</small>
                  <small v-if="item.eos_id">{{ t("player.eosId") }} {{ item.eos_id }}</small>
                  <small>{{ ipDetailSummary(item.ip) || t("common.unknown") }}</small>
                  <small>{{ ipSourceLabel(item.ip) }}</small>
                </li>
                <li v-if="!(detail.logins || []).length">{{ t("common.none") }}</li>
              </ul>
            </div>

            <div class="db-card">
              <h3>{{ t("database.squadCreated") }}</h3>
              <div v-if="detail.squadCreated" class="db-grid compact">
                <div><span>{{ fieldLabel("squad_id") }}</span><strong>{{ detail.squadCreated.squad_id ?? "--" }}</strong></div>
                <div><span>{{ fieldLabel("squad_name") }}</span><strong>{{ detail.squadCreated.squad_name || "--" }}</strong></div>
                <div><span>{{ fieldLabel("team_name") }}</span><strong>{{ detail.squadCreated.team_name || "--" }}</strong></div>
                <div><span>{{ fieldLabel("created_at", t("database.createdAt")) }}</span><strong>{{ formatTime(detail.squadCreated.created_at) }}</strong></div>
              </div>
              <div v-else class="placeholder">{{ t("common.none") }}</div>
            </div>
          </div>
        </template>
        </div>
      </section>
    </div>

    <div v-if="showStatsModal" class="db-stats-modal" aria-hidden="false">
      <button class="db-stats-modal-backdrop" type="button" :aria-label="t('database.closeDetail')" @click="closeStatsModal" />
      <section class="db-stats-modal-card" role="dialog" aria-modal="true" :aria-label="t('database.databaseStats')">
        <header class="db-stats-modal-head">
          <div>
            <h2>{{ t("database.databaseStats") }}</h2>
            <p>{{ statsSubtitle }}</p>
          </div>
          <div class="db-stats-actions">
            <select v-model="statsDays" class="console-select">
              <option value="7">7 {{ t("database.days") }}</option>
              <option value="14">14 {{ t("database.days") }}</option>
              <option value="30">30 {{ t("database.days") }}</option>
              <option value="60">60 {{ t("database.days") }}</option>
              <option value="90">90 {{ t("database.days") }}</option>
            </select>
            <select v-model="statsTop" class="console-select">
              <option value="5">{{ t("database.top") }} 5</option>
              <option value="10">{{ t("database.top") }} 10</option>
              <option value="20">{{ t("database.top") }} 20</option>
              <option value="50">{{ t("database.top") }} 50</option>
            </select>
            <button type="button" class="console-clear-btn" :disabled="statsLoading" @click="refreshStats">
              {{ statsLoading ? t("common.refreshing") : t("database.refreshStats") }}
            </button>
            <button type="button" class="console-clear-btn" @click="closeStatsModal">{{ t("common.close") }}</button>
          </div>
        </header>

        <div class="db-stats-modal-body">
          <div v-if="statsLoading" class="placeholder">{{ t("database.loadingStats") }}</div>
          <div v-else-if="statsError" class="placeholder">{{ statsError }}</div>
          <section v-else class="db-analytics">
          <div class="db-analytics-grid">
            <div class="db-card db-analytics-card">
              <h3>{{ t("database.overview") }}</h3>
              <div class="db-grid compact">
                <div v-for="item in overviewCards" :key="item.label">
                  <span>{{ item.label }}</span>
                  <strong>{{ item.value }}</strong>
                </div>
              </div>
            </div>

            <div class="db-card db-analytics-card">
              <h3>{{ t("database.breakdowns") }}</h3>
              <div class="db-analytics-body">
                <section class="db-analytics-block">
                  <h4>{{ t("database.permissionGroups") }}</h4>
                  <div v-if="stats?.breakdowns?.permissionGroups?.length" class="db-chip-wrap">
                    <span v-for="item in stats.breakdowns.permissionGroups" :key="item.permissionGroup" class="db-chip">
                      <span>{{ item.permissionGroup }}</span>
                      <small>{{ formatNumber(item.players) }}</small>
                    </span>
                  </div>
                  <div v-else class="placeholder">{{ t("common.noData") }}</div>
                </section>

                <section class="db-analytics-block">
                  <h4>{{ t("database.roleTags") }}</h4>
                  <div v-if="stats?.breakdowns?.roleTags?.length" class="db-chip-wrap">
                    <span v-for="item in stats.breakdowns.roleTags" :key="item.tagValue" class="db-chip">
                      <span>{{ item.tagValue }}</span>
                      <small>{{ formatNumber(item.players) }}</small>
                    </span>
                  </div>
                  <div v-else class="placeholder">{{ t("common.noData") }}</div>
                </section>

                <section class="db-analytics-block">
                  <h4>{{ t("database.componentTags") }}</h4>
                  <div v-if="stats?.breakdowns?.componentTags?.length" class="db-chip-wrap">
                    <span v-for="item in stats.breakdowns.componentTags" :key="item.tagValue" class="db-chip">
                      <span>{{ item.tagValue }}</span>
                      <small>{{ formatNumber(item.players) }}</small>
                    </span>
                  </div>
                  <div v-else class="placeholder">{{ t("common.noData") }}</div>
                </section>

                <section class="db-analytics-block">
                  <h4>{{ t("database.violationTypes") }}</h4>
                  <div v-if="stats?.breakdowns?.violationTypes?.length" class="db-chip-wrap">
                    <span v-for="item in stats.breakdowns.violationTypes" :key="item.violationKey" class="db-chip">
                      <span>{{ item.violationLabel || item.violationKey }}</span>
                      <small>{{ formatNumber(item.totalCount) }}</small>
                    </span>
                  </div>
                  <div v-else class="placeholder">{{ t("common.noData") }}</div>
                </section>
              </div>
            </div>

            <div class="db-card db-analytics-card">
              <h3>{{ t("database.leaderboards") }}</h3>
              <div class="db-analytics-body">
                <section class="db-analytics-block">
                  <h4>{{ t("database.kills") }}</h4>
                  <ol v-if="stats?.leaderboards?.byKills?.length" class="db-rank-list">
                    <li v-for="item in stats.leaderboards.byKills" :key="item.id">
                      <button type="button" class="name db-rank-player" @click="jumpToPlayerFromStats(item.id)">
                        {{ item.currentName || item.steamID || item.eosID || t("common.unknown") }}
                      </button>
                      <span class="value">{{ t("database.kills") }} {{ formatNumber(item.totalKills) }} / {{ t("database.deaths") }} {{ formatNumber(item.totalDeaths) }}</span>
                    </li>
                  </ol>
                  <div v-else class="placeholder">{{ t("common.noData") }}</div>
                </section>

                <section class="db-analytics-block">
                  <h4>{{ t("database.playtime") }}</h4>
                  <ol v-if="stats?.leaderboards?.byPlaytime?.length" class="db-rank-list">
                    <li v-for="item in stats.leaderboards.byPlaytime" :key="item.id">
                      <button type="button" class="name db-rank-player" @click="jumpToPlayerFromStats(item.id)">
                        {{ item.currentName || item.steamID || item.eosID || t("common.unknown") }}
                      </button>
                      <span class="value">{{ formatHoursFromSeconds(item.gameSeconds) }}</span>
                    </li>
                  </ol>
                  <div v-else class="placeholder">{{ t("common.noData") }}</div>
                </section>

                <section class="db-analytics-block">
                  <h4>{{ t("database.violations") }}</h4>
                  <ol v-if="stats?.leaderboards?.byViolations?.length" class="db-rank-list">
                    <li v-for="item in stats.leaderboards.byViolations" :key="item.playerId">
                      <button type="button" class="name db-rank-player" @click="jumpToPlayerFromStats(item.playerId)">
                        {{ item.currentName || item.steamID || item.eosID || t("common.unknown") }}
                      </button>
                      <span class="value">{{ t("database.violations") }} {{ formatNumber(item.totalViolations) }}</span>
                    </li>
                  </ol>
                  <div v-else class="placeholder">{{ t("common.noData") }}</div>
                </section>
              </div>
            </div>

            <div class="db-card db-analytics-card">
              <h3>{{ t("database.trends") }}</h3>
              <div class="db-analytics-body">
                <section class="db-analytics-block">
                  <h4>{{ t("database.loginsByDay") }}</h4>
                  <ul v-if="stats?.trends?.loginsByDay?.length" class="db-trend-list">
                    <li v-for="item in stats.trends.loginsByDay" :key="item.day">
                      <span class="name">{{ item.day }}</span>
                      <span class="value">{{ t("database.logins") }} {{ formatNumber(item.loginCount) }} · {{ t("database.active") }} {{ formatNumber(item.uniquePlayers) }}</span>
                    </li>
                  </ul>
                  <div v-else class="placeholder">{{ t("common.noData") }}</div>
                </section>

                <section class="db-analytics-block">
                  <h4>{{ t("database.matchesByDay") }}</h4>
                  <ul v-if="stats?.trends?.matchesByDay?.length" class="db-trend-list">
                    <li v-for="item in stats.trends.matchesByDay" :key="item.day">
                      <span class="name">{{ item.day }}</span>
                      <span class="value">{{ t("database.matches") }} {{ formatNumber(item.matchCount) }} · {{ t("common.updated") }} {{ formatNumber(item.completedCount) }}</span>
                    </li>
                  </ul>
                  <div v-else class="placeholder">{{ t("common.noData") }}</div>
                </section>
              </div>
            </div>
          </div>
          </section>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRoute } from "vue-router";
import { ApiError, apiGet } from "../app/apiClient";
import { queryClient } from "../app/queryClient";
import { renderApiError } from "../app/errors";
import { useServerStore } from "../stores/server.store";
import { useUiStore } from "../stores/ui.store";
import { usePlayerDatabaseQuery } from "../composables/usePlayerDatabaseQuery";
import { useIpLookup } from "../composables/useIpLookup";
import { copyTextWithToast } from "../utils/clipboard";
import { collectIps, formatIpSummary, isPrivateIp, normalizeIp } from "../utils/ip";
import { currentLocale, t } from "../i18n";

const filters = reactive({
  q: "",
  sort: "updated_desc",
  limit: 200,
  offset: 0,
});

const statsDays = ref("14");
const statsTop = ref("10");
const showStatsModal = ref(false);
const statsLoading = ref(false);
const statsError = ref("");
const stats = ref<any | null>(null);
const route = useRoute();
const server = useServerStore();
const ui = useUiStore();

const statsSubtitle = computed(() => {
  const generatedAt = stats.value?.generatedAt ? formatTime(stats.value.generatedAt) : t("common.notLoaded");
  return t("database.statsSubtitle", "", {
    days: statsDays.value,
    top: statsTop.value,
    time: generatedAt,
  });
});

const syncText = ref(t("common.loading"));
const syncTone = ref<"idle" | "ok" | "warn" | "error">("idle");
const selectedId = ref<number | null>(null);

const { query } = usePlayerDatabaseQuery(filters);

const rows = computed(() => query.data.value?.items ?? query.data.value?.players ?? []);
const listLoading = computed(() => query.isLoading.value && !rows.value.length);
const listError = computed(() => (query.error.value && !rows.value.length ? renderApiError(query.error.value, t("common.error")) : ""));

const identityDisplay = computed(() => {
  const config = server.snapshot.webStatus?.playerIdentityDisplay ?? server.snapshot.playerIdentityDisplay ?? {};
  return {
    showIpInList: config.showIpInList !== false,
    showIpInDetail: config.showIpInDetail !== false,
    showIpGeo: config.showIpGeo !== false,
  };
});

const showIpInList = computed(() => identityDisplay.value.showIpInList);
const showIpInDetail = computed(() => identityDisplay.value.showIpInDetail);
const showIpGeo = computed(() => identityDisplay.value.showIpGeo);

const detailQuery = useQuery({
  queryKey: computed(() => ["player-database-detail", selectedId.value]),
  enabled: computed(() => selectedId.value !== null),
  queryFn: async () => apiGet<any>(`/api/player-database/detail?id=${encodeURIComponent(String(selectedId.value))}`, {}, { timeoutMs: 5_000 }),
  retry: false,
  refetchOnWindowFocus: false,
  staleTime: 10_000,
  gcTime: 60_000,
});

const detail = computed(() => (selectedId.value === null ? null : detailQuery.data.value ?? null));
const detailLoading = computed(() => selectedId.value !== null && detailQuery.isLoading.value && !detail.value);
const detailError = computed(() => {
  if (selectedId.value === null) return "";
  const error = detailQuery.error.value;
  if (!error) return "";
  if (error instanceof ApiError && error.type === "abort") return "";
  if (error instanceof ApiError && error.type === "timeout") return t("common.error");
  return renderApiError(error, t("common.error"));
});

const currentIp = computed(() => detail.value?.player?.current_ip || detail.value?.ips?.[0]?.ip || detail.value?.logins?.[0]?.ip || "--");
const listLookupIps = computed(() => (showIpGeo.value ? collectIps(rows.value.map((player) => player.current_ip || player.ip)) : []));
const detailLookupIps = computed(() => {
  if (!showIpGeo.value || !detail.value) return [];
  return collectIps([
    detail.value?.player?.current_ip,
    ...(detail.value?.ips ?? []).map((item: any) => item.ip),
    ...(detail.value?.logins ?? []).map((item: any) => item.ip),
  ]);
});
const listIpLookupQuery = useIpLookup(listLookupIps, { enabled: showIpGeo });
const detailIpLookupQuery = useIpLookup(detailLookupIps, { enabled: showIpGeo });
const overviewCards = computed(() => {
  const overview = stats.value?.overview ?? null;
  return [
    { label: t("database.title"), value: overview ? formatNumber(overview.totalPlayers ?? 0) : "--" },
    { label: t("database.active"), value: overview ? formatNumber(overview.activePlayersInWindow ?? 0) : "--" },
    { label: `${t("database.kills")} / ${t("database.deaths")}`, value: overview ? `${formatNumber(overview.totalKills ?? 0)} / ${formatNumber(overview.totalDeaths ?? 0)}` : "--" },
    { label: t("database.matches"), value: overview ? formatNumber(overview.totalMatches ?? 0) : "--" },
    { label: t("database.gameTime"), value: overview ? formatHoursFromSeconds(overview.totalGameSeconds ?? 0) : "--" },
    { label: t("database.ratingAvgMinMax"), value: overview ? ratingSummary(overview.averageLadderRating, overview.minLadderRating, overview.maxLadderRating) : "--" },
  ];
});

const currentIpSummary = computed(() => ipDetailSummary(currentIp.value));

watch(
  () => route.query.q,
  (value) => {
    const next = String(value ?? "").trim();
    if (next !== filters.q) {
      filters.q = next;
    }
  },
  { immediate: true },
);

watch(
  () => [filters.q, filters.sort],
  () => {
    void queryClient.cancelQueries({ queryKey: ["player-database-detail"] });
    selectedId.value = null;
  },
);

onBeforeUnmount(() => {
  void queryClient.cancelQueries({ queryKey: ["player-database-detail"] });
});

async function cancelDetailQueries() {
  await queryClient.cancelQueries({ queryKey: ["player-database-detail"] });
}

async function openPlayer(id: number) {
  await cancelDetailQueries();
  selectedId.value = Number(id);
}

async function closePlayerDetail() {
  await cancelDetailQueries();
  selectedId.value = null;
}

async function retryDetail() {
  if (selectedId.value === null) return;
  await detailQuery.refetch();
}

async function openStatsModal() {
  showStatsModal.value = true;
  await loadStats();
}

function closeStatsModal() {
  showStatsModal.value = false;
}

async function loadStats() {
  statsLoading.value = true;
  statsError.value = "";
  try {
    const params = new URLSearchParams({
      days: String(statsDays.value),
      top: String(statsTop.value),
    });
    stats.value = await apiGet<any>(`/api/db/stats?${params.toString()}`);
    setSyncStatus(t("database.refreshStats"), "ok");
  } catch (error) {
    statsError.value = renderApiError(error, t("common.error"));
    setSyncStatus(statsError.value, "error");
  } finally {
    statsLoading.value = false;
  }
}

async function refreshStats() {
  await loadStats();
}

async function jumpToPlayerFromStats(playerId: number) {
  showStatsModal.value = false;
  await openPlayer(playerId);
}

function setSyncStatus(text: string, tone: "idle" | "ok" | "warn" | "error" = "idle") {
  syncText.value = text;
  syncTone.value = tone;
}

function formatTime(value: unknown) {
  const time = Number(value ?? 0);
  if (!time) return "--";
  return new Date(time).toLocaleString(currentLocale.value);
}

function formatSeconds(value: unknown) {
  const totalSeconds = Math.max(0, Math.floor(Number(value ?? 0)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${totalSeconds}s (${hours}h ${minutes}m)`;
}

function formatHoursFromSeconds(value: unknown) {
  return `${(Math.max(0, Number(value ?? 0)) / 3600).toFixed(1)} h`;
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat(currentLocale.value).format(Number(value ?? 0));
}

function ratingSummary(avg: unknown, min: unknown, max: unknown) {
  const average = Number(avg ?? 0).toFixed(1);
  return `${average} / ${formatNumber(min)}-${formatNumber(max)}`;
}

function winRate(wins: unknown, total: unknown) {
  const winCount = Number(wins ?? 0);
  const totalCount = Number(total ?? 0);
  if (totalCount <= 0) return "--";
  return `${((winCount / totalCount) * 100).toFixed(1)}%`;
}

function teamKills(player: any) {
  return Number(player?.total_tk_down ?? 0) + Number(player?.total_tk_kill ?? 0);
}

function lookupItem(ip: unknown, map: Record<string, any>) {
  const key = normalizeIp(ip);
  if (!key) return null;
  return map[key] ?? null;
}

function listIpSummary(player: any) {
  const ip = player?.current_ip || player?.ip;
  const item = lookupItem(ip, listIpLookupQuery.items.value ?? {});
  if (!item && !isPrivateIp(ip)) return showIpGeo.value ? t("common.unknown") : "";
  return formatIpSummary(item ?? (isPrivateIp(ip) ? { ip: String(ip ?? ""), isPrivate: true, source: "private", provider: "none", country: "", region: "", city: "", isp: "", org: "", asn: "", timezone: "", latitude: null, longitude: null, isProxy: null, isHosting: null, updatedAt: 0, error: "" } : null), showIpGeo.value);
}

function ipDetailSummary(ip: unknown) {
  const item = lookupItem(ip, detailIpLookupQuery.items.value ?? {});
  if (!item && !isPrivateIp(ip)) return showIpGeo.value ? t("common.unknown") : "";
  return formatIpSummary(item ?? (isPrivateIp(ip) ? { ip: String(ip ?? ""), isPrivate: true, source: "private", provider: "none", country: "", region: "", city: "", isp: "", org: "", asn: "", timezone: "", latitude: null, longitude: null, isProxy: null, isHosting: null, updatedAt: 0, error: "" } : null), showIpGeo.value);
}

function ipSourceLabel(ip: unknown) {
  const item = lookupItem(ip, detailIpLookupQuery.items.value ?? {}) ?? lookupItem(ip, listIpLookupQuery.items.value ?? {});
  if (!item) {
    return isPrivateIp(ip) ? `${t("common.source")} private / none` : t("database.sourceUnknown");
  }
  return `${t("common.source")} ${item.source} / ${item.provider}`;
}

async function copyIp(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text === "--") return;
  await copyTextWithToast(text, ui, {
    label: `${t("player.ip")} ${t("common.copied")}`,
    successMessage: text,
  });
}

function fieldLabel(key: string, fallback?: string) {
  return t(`field.${key}`, fallback ?? key);
}

async function copyRowIp(player: any) {
  await copyIp(player?.current_ip || player?.ip);
}

function warmupTotal(statsBlock: any, type: "kills" | "downs" | "teamKills") {
  if (type === "kills") {
    return Number(statsBlock?.total_kills_light ?? 0) + Number(statsBlock?.total_kills_other ?? 0);
  }
  if (type === "downs") {
    return Number(statsBlock?.total_downed_light ?? 0) + Number(statsBlock?.total_downed_other ?? 0);
  }
  return Number(statsBlock?.total_tk_down ?? 0) + Number(statsBlock?.total_tk_kill ?? 0);
}
</script>

<style scoped>
.db-page {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 10px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.db-overview-card,
.db-toolbar-card,
.db-card,
.db-stats-modal-card {
  border: 1px solid rgba(42, 49, 68, 0.84);
  border-radius: 14px;
  background: rgba(11, 15, 22, 0.88);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18);
}

.db-overview-card {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  padding: 8px;
}

.db-stat-item {
  border: 1px solid rgba(42, 49, 68, 0.82);
  border-radius: 12px;
  padding: 7px 8px;
  display: grid;
  gap: 3px;
}

.db-stat-item span,
.db-grid span,
.db-list-mini small,
.db-row-meta,
.db-stats-modal-head p,
.placeholder {
  color: #8a93a8;
  font-size: 11px;
}

.db-stat-item strong,
.db-grid strong {
  font-size: 14px;
  color: #edf2f4;
}

.db-toolbar-card {
  padding: 8px;
}

.db-toolbar-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.db-panel {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 10px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  border: 1px solid rgba(42, 49, 68, 0.84);
  border-radius: 14px;
}

.db-list-col {
  border-right: 1px solid rgba(42, 49, 68, 0.84);
  background: rgba(10, 14, 20, 0.92);
  padding: 6px;
  display: grid;
  gap: 6px;
  align-content: start;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}

.db-detail-col {
  padding: 10px;
  display: grid;
  gap: 10px;
  align-content: start;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.db-detail-scroll {
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  display: grid;
  gap: 10px;
  align-content: start;
  padding-right: 4px;
}

.db-row {
  text-align: left;
  border: 1px solid rgba(42, 49, 68, 0.84);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  padding: 7px 9px;
  display: grid;
  gap: 3px;
  color: #edf2f4;
  min-height: unset;
}

.db-row.active {
  border-color: rgba(101, 140, 255, 0.72);
  background: rgba(88, 126, 255, 0.14);
}

.db-row-name {
  font-weight: 700;
  font-size: 13px;
  line-height: 1.25;
}

.db-row-ip {
  display: grid;
  gap: 5px;
  padding-top: 2px;
  margin-top: 2px;
  font-size: 11px;
}

.db-row-ip-value {
  font-size: 11px;
  color: #edf2f4;
  word-break: break-word;
}

.db-copy-link {
  width: fit-content;
  border: 0;
  background: transparent;
  color: #8bb6ff;
  padding: 2px 5px;
  font-size: 11px;
  cursor: pointer;
}

.db-copy-link:disabled {
  color: #6f7a8f;
  cursor: not-allowed;
}

.db-ip-field {
  display: grid;
  gap: 3px;
}

.db-ip-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.db-ip-line strong {
  min-width: 0;
  word-break: break-word;
}

.db-ip-field small,
.db-history-list small,
.db-login-list small {
  color: #8a93a8;
  font-size: 10.5px;
  line-height: 1.25;
}

.db-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
}

.db-detail-head h2,
.db-card h3,
.db-stats-modal-head h2 {
  margin: 0;
}

.db-detail-head h2 {
  font-size: 18px;
}

.db-detail-head p {
  margin: 3px 0 0;
  color: #8a93a8;
  font-size: 11px;
}

.db-card {
  padding: 10px 12px;
  border-radius: 10px;
}

.db-card h3 {
  font-size: 13px;
  margin-bottom: 8px;
}

.db-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.db-grid.compact {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.db-grid > div {
  border: 1px solid rgba(42, 49, 68, 0.78);
  border-radius: 8px;
  padding: 7px 8px;
  display: grid;
  gap: 3px;
}

.db-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.db-list-mini,
.db-history-list,
.db-login-list,
.db-rank-list,
.db-trend-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.db-list-mini li,
.db-history-list li,
.db-login-list li,
.db-rank-list li,
.db-trend-list li {
  border: 1px solid rgba(42, 49, 68, 0.82);
  border-radius: 8px;
  padding: 7px 8px;
  display: grid;
  gap: 4px;
  background: rgba(255, 255, 255, 0.03);
}

.db-history-head,
.db-login-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.db-history-head div,
.db-login-head div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.db-history-head strong,
.db-login-head strong {
  word-break: break-word;
  font-size: 12px;
}

.db-chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.db-chip {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid rgba(108, 122, 160, 0.22);
  background: rgba(255, 255, 255, 0.04);
}

.db-analytics {
  margin-top: 10px;
}

.db-analytics-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.db-analytics-card {
  width: auto;
}

.db-analytics-body {
  display: grid;
  gap: 8px;
}

.db-analytics-block {
  border: 1px solid rgba(42, 49, 68, 0.82);
  border-radius: 10px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.03);
}

.db-analytics-block h4 {
  margin: 0 0 6px;
  font-size: 11px;
  color: #8a93a8;
}

.db-rank-player {
  border: 0;
  padding: 0;
  background: transparent;
  color: #edf2f4;
  cursor: pointer;
}

.db-rank-player:hover {
  color: #8bb6ff;
  text-decoration: underline;
}

.db-stats-modal {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 14px;
}

.db-stats-modal-backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgba(7, 10, 16, 0.68);
  backdrop-filter: blur(2px);
}

.db-stats-modal-card {
  position: relative;
  width: min(1280px, calc(100vw - 28px));
  max-height: calc(100vh - 48px);
  overflow: hidden;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  padding: 12px;
}

.db-stats-modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.db-stats-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.db-stats-modal-body {
  min-height: 0;
  overflow-y: auto;
  padding-top: 12px;
}

.db-error-block {
  display: grid;
  gap: 10px;
}

@media (max-width: 1280px) {
  .db-overview-card {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .db-analytics-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 920px) {
  .db-panel {
    grid-template-columns: 1fr;
  }

  .db-list-col {
    border-right: 0;
    border-bottom: 1px solid rgba(42, 49, 68, 0.84);
  }

  .db-grid,
  .db-detail-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .db-overview-card,
  .db-grid.compact {
    grid-template-columns: 1fr;
  }

  .db-toolbar-row > * {
    width: 100%;
  }

  .db-stats-modal {
    padding: 10px;
  }

  .db-stats-modal-card {
    width: min(100vw - 20px, 100%);
  }
}
</style>
