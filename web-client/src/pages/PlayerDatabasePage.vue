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
            placeholder="Search by name / Steam64 / EOS ID / IP"
          >
          <select v-model="filters.sort" class="console-select">
            <option value="updated_desc">Sort: recently updated</option>
            <option value="name_asc">Sort: A-Z</option>
            <option value="last_login_desc">Sort: last login</option>
          </select>
          <button type="button" @click="openStatsModal">Open stats modal</button>
        </div>
      </div>
    </section>

    <div class="db-panel">
      <aside class="db-list-col">
        <div v-if="listLoading && !rows.length" class="placeholder">Loading player list...</div>
        <div v-else-if="listError" class="placeholder">{{ listError }}</div>
        <div v-else-if="!rows.length" class="placeholder">No matching players</div>
        <button
          v-for="player in rows"
          :key="player.id"
          type="button"
          class="db-row"
          :class="{ active: selectedId === player.id }"
          @click="openPlayer(player.id)"
        >
          <div class="db-row-name">{{ player.current_name || player.name || "(unnamed)" }}</div>
          <div class="db-row-meta">
            {{ player.permission_group || "default" }} · R={{ player.ladder_rating ?? 0 }} · K={{ player.total_kills_light ?? 0 }} · TK={{ teamKills(player) }}
          </div>
          <div class="db-row-meta">
            Last login {{ formatTime(player.last_login_at) }} · Updated {{ formatTime(player.updated_at) }}
          </div>
          <div v-if="showIpInList && (player.current_ip || player.ip)" class="db-row-ip">
            <button type="button" class="db-copy-link" @click.stop="copyRowIp(player)">Copy IP</button>
            <span class="db-row-ip-value">{{ player.current_ip || player.ip }}</span>
            <small>{{ listIpSummary(player) || "" }}</small>
          </div>
        </button>
      </aside>

      <section class="db-detail-col">
        <div class="db-detail-scroll">
        <div v-if="selectedId === null" class="placeholder">Select a player on the left to view the profile</div>
        <div v-else-if="detailLoading && !detail" class="placeholder">Loading player detail...</div>
        <div v-else-if="detailError" class="placeholder db-error-block">
          <div>{{ detailError }}</div>
          <button type="button" class="console-clear-btn" @click="retryDetail">Retry</button>
        </div>
        <template v-else-if="detail">
          <div class="db-detail-head">
            <div>
              <h2>{{ detail.player?.current_name || detail.player?.name || "Player" }}</h2>
              <p>Steam64 {{ detail.player?.steam_id || "--" }} · EOS {{ detail.player?.eos_id || "--" }}</p>
            </div>
            <button type="button" class="console-clear-btn" @click="closePlayerDetail">Close detail</button>
          </div>

          <div class="db-card">
            <h3>Overview</h3>
            <div class="db-grid">
              <div v-if="showIpInDetail" class="db-ip-field">
                <span>Current IP</span>
                <div class="db-ip-line">
                  <strong>{{ currentIp }}</strong>
                  <button type="button" class="db-copy-link" :disabled="currentIp === '--'" @click="copyIp(currentIp)">Copy</button>
                </div>
                <small>{{ currentIpSummary }}</small>
              </div>
              <div><span>Permission group</span><strong>{{ detail.player?.permission_group || "default" }}</strong></div>
              <div><span>Created at</span><strong>{{ formatTime(detail.player?.created_at) }}</strong></div>
              <div><span>Updated at</span><strong>{{ formatTime(detail.player?.updated_at) }}</strong></div>
              <div><span>Game time</span><strong>{{ formatSeconds(detail.summary?.gameSeconds ?? detail.player?.game_seconds ?? 0) }}</strong></div>
              <div><span>Server time</span><strong>{{ formatSeconds(detail.summary?.serverSeconds ?? detail.player?.server_seconds ?? 0) }}</strong></div>
              <div><span>Total kills</span><strong>{{ formatNumber(detail.summary?.totalKills ?? 0) }}</strong></div>
              <div><span>Total downs</span><strong>{{ formatNumber(detail.summary?.totalDowns ?? 0) }}</strong></div>
              <div><span>Total deaths</span><strong>{{ formatNumber(detail.summary?.totalDeaths ?? 0) }}</strong></div>
              <div><span>Total team kills</span><strong>{{ formatNumber(detail.summary?.totalTeamKills ?? 0) }}</strong></div>
              <div><span>Ladder rating</span><strong>{{ formatNumber(detail.player?.ladder_rating ?? 0) }}</strong></div>
              <div><span>Win rate</span><strong>{{ winRate(detail.player?.total_match_wins, detail.player?.total_matches) }}</strong></div>
            </div>
          </div>

          <div class="db-card">
            <h3>Warmup Stats</h3>
            <div class="db-grid">
              <div><span>Kills</span><strong>{{ warmupTotal(detail.warmupStats, "kills") }}</strong></div>
              <div><span>Downs</span><strong>{{ warmupTotal(detail.warmupStats, "downs") }}</strong></div>
              <div><span>Received downs</span><strong>{{ detail.warmupStats?.total_downed_received ?? 0 }}</strong></div>
              <div><span>Team kills</span><strong>{{ warmupTotal(detail.warmupStats, "teamKills") }}</strong></div>
              <div><span>Deaths</span><strong>{{ detail.warmupStats?.total_deaths ?? 0 }}</strong></div>
              <div><span>Suicides</span><strong>{{ detail.warmupStats?.total_suicides ?? 0 }}</strong></div>
            </div>
          </div>

          <div class="db-detail-grid">
            <div class="db-card">
              <h3>Aliases (recent 12)</h3>
              <ul class="db-list-mini">
                <li v-for="alias in (detail.aliases || []).slice(0, 12)" :key="`${alias.alias_name}-${alias.seen_at}`">
                  <span>{{ alias.alias_name }}</span>
                  <small>{{ formatTime(alias.seen_at) }}</small>
                </li>
                <li v-if="!(detail.aliases || []).length">None</li>
              </ul>
            </div>

            <div class="db-card">
              <h3>IP History (recent 12)</h3>
              <ul class="db-history-list">
                <li v-for="item in (detail.ips || []).slice(0, 12)" :key="`${item.ip}-${item.seen_at}`">
                  <div class="db-history-head">
                    <div>
                      <strong>{{ item.ip }}</strong>
                      <small>{{ formatTime(item.seen_at) }}</small>
                    </div>
                    <button type="button" class="db-copy-link" @click="copyIp(item.ip)">Copy</button>
                  </div>
                  <small>{{ ipDetailSummary(item.ip) || "Unknown" }}</small>
                  <small>{{ ipSourceLabel(item.ip) }}</small>
                </li>
                <li v-if="!(detail.ips || []).length">None</li>
              </ul>
            </div>

            <div class="db-card">
              <h3>Logins (recent 12)</h3>
              <ul class="db-login-list">
                <li v-for="item in (detail.logins || []).slice(0, 12)" :key="`${item.ip}-${item.joined_at}`">
                  <div class="db-login-head">
                    <div>
                      <strong>{{ item.ip || "--" }}</strong>
                      <small>{{ formatTime(item.joined_at) }}</small>
                    </div>
                    <button v-if="item.ip" type="button" class="db-copy-link" @click="copyIp(item.ip)">Copy IP</button>
                  </div>
                  <small v-if="item.controller_path">Controller {{ item.controller_path }}</small>
                  <small v-if="item.steam_id">SteamID {{ item.steam_id }}</small>
                  <small v-if="item.eos_id">EOSID {{ item.eos_id }}</small>
                  <small>{{ ipDetailSummary(item.ip) || "Unknown" }}</small>
                  <small>{{ ipSourceLabel(item.ip) }}</small>
                </li>
                <li v-if="!(detail.logins || []).length">None</li>
              </ul>
            </div>

            <div class="db-card">
              <h3>Squad created</h3>
              <div v-if="detail.squadCreated" class="db-grid compact">
                <div><span>Squad ID</span><strong>{{ detail.squadCreated.squad_id ?? "--" }}</strong></div>
                <div><span>Squad name</span><strong>{{ detail.squadCreated.squad_name || "--" }}</strong></div>
                <div><span>Team name</span><strong>{{ detail.squadCreated.team_name || "--" }}</strong></div>
                <div><span>Created at</span><strong>{{ formatTime(detail.squadCreated.created_at) }}</strong></div>
              </div>
              <div v-else class="placeholder">None</div>
            </div>
          </div>
        </template>
        </div>
      </section>
    </div>

    <div v-if="showStatsModal" class="db-stats-modal" aria-hidden="false">
      <button class="db-stats-modal-backdrop" type="button" aria-label="Close stats modal" @click="closeStatsModal" />
      <section class="db-stats-modal-card" role="dialog" aria-modal="true" aria-label="Database stats modal">
        <header class="db-stats-modal-head">
          <div>
            <h2>Database stats</h2>
            <p>{{ statsSubtitle }}</p>
          </div>
          <div class="db-stats-actions">
            <select v-model="statsDays" class="console-select">
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </select>
            <select v-model="statsTop" class="console-select">
              <option value="5">Top 5</option>
              <option value="10">Top 10</option>
              <option value="20">Top 20</option>
              <option value="50">Top 50</option>
            </select>
            <button type="button" class="console-clear-btn" :disabled="statsLoading" @click="refreshStats">
              {{ statsLoading ? "Refreshing..." : "Refresh stats" }}
            </button>
            <button type="button" class="console-clear-btn" @click="closeStatsModal">Close</button>
          </div>
        </header>

        <div class="db-stats-modal-body">
          <div v-if="statsLoading" class="placeholder">Loading stats...</div>
          <div v-else-if="statsError" class="placeholder">{{ statsError }}</div>
          <section v-else class="db-analytics">
          <div class="db-analytics-grid">
            <div class="db-card db-analytics-card">
              <h3>Overview</h3>
              <div class="db-grid compact">
                <div v-for="item in overviewCards" :key="item.label">
                  <span>{{ item.label }}</span>
                  <strong>{{ item.value }}</strong>
                </div>
              </div>
            </div>

            <div class="db-card db-analytics-card">
              <h3>Breakdowns</h3>
              <div class="db-analytics-body">
                <section class="db-analytics-block">
                  <h4>Permission groups</h4>
                  <div v-if="stats?.breakdowns?.permissionGroups?.length" class="db-chip-wrap">
                    <span v-for="item in stats.breakdowns.permissionGroups" :key="item.permissionGroup" class="db-chip">
                      <span>{{ item.permissionGroup }}</span>
                      <small>{{ formatNumber(item.players) }}</small>
                    </span>
                  </div>
                  <div v-else class="placeholder">No data</div>
                </section>

                <section class="db-analytics-block">
                  <h4>Role tags</h4>
                  <div v-if="stats?.breakdowns?.roleTags?.length" class="db-chip-wrap">
                    <span v-for="item in stats.breakdowns.roleTags" :key="item.tagValue" class="db-chip">
                      <span>{{ item.tagValue }}</span>
                      <small>{{ formatNumber(item.players) }}</small>
                    </span>
                  </div>
                  <div v-else class="placeholder">No data</div>
                </section>

                <section class="db-analytics-block">
                  <h4>Component tags</h4>
                  <div v-if="stats?.breakdowns?.componentTags?.length" class="db-chip-wrap">
                    <span v-for="item in stats.breakdowns.componentTags" :key="item.tagValue" class="db-chip">
                      <span>{{ item.tagValue }}</span>
                      <small>{{ formatNumber(item.players) }}</small>
                    </span>
                  </div>
                  <div v-else class="placeholder">No data</div>
                </section>

                <section class="db-analytics-block">
                  <h4>Violation types</h4>
                  <div v-if="stats?.breakdowns?.violationTypes?.length" class="db-chip-wrap">
                    <span v-for="item in stats.breakdowns.violationTypes" :key="item.violationKey" class="db-chip">
                      <span>{{ item.violationLabel || item.violationKey }}</span>
                      <small>{{ formatNumber(item.totalCount) }}</small>
                    </span>
                  </div>
                  <div v-else class="placeholder">No data</div>
                </section>
              </div>
            </div>

            <div class="db-card db-analytics-card">
              <h3>Leaderboards</h3>
              <div class="db-analytics-body">
                <section class="db-analytics-block">
                  <h4>Kills</h4>
                  <ol v-if="stats?.leaderboards?.byKills?.length" class="db-rank-list">
                    <li v-for="item in stats.leaderboards.byKills" :key="item.id">
                      <button type="button" class="name db-rank-player" @click="jumpToPlayerFromStats(item.id)">
                        {{ item.currentName || item.steamID || item.eosID || "Unknown player" }}
                      </button>
                      <span class="value">K {{ formatNumber(item.totalKills) }} / D {{ formatNumber(item.totalDeaths) }}</span>
                    </li>
                  </ol>
                  <div v-else class="placeholder">No data</div>
                </section>

                <section class="db-analytics-block">
                  <h4>Playtime</h4>
                  <ol v-if="stats?.leaderboards?.byPlaytime?.length" class="db-rank-list">
                    <li v-for="item in stats.leaderboards.byPlaytime" :key="item.id">
                      <button type="button" class="name db-rank-player" @click="jumpToPlayerFromStats(item.id)">
                        {{ item.currentName || item.steamID || item.eosID || "Unknown player" }}
                      </button>
                      <span class="value">{{ formatHoursFromSeconds(item.gameSeconds) }}</span>
                    </li>
                  </ol>
                  <div v-else class="placeholder">No data</div>
                </section>

                <section class="db-analytics-block">
                  <h4>Violations</h4>
                  <ol v-if="stats?.leaderboards?.byViolations?.length" class="db-rank-list">
                    <li v-for="item in stats.leaderboards.byViolations" :key="item.playerId">
                      <button type="button" class="name db-rank-player" @click="jumpToPlayerFromStats(item.playerId)">
                        {{ item.currentName || item.steamID || item.eosID || "Unknown player" }}
                      </button>
                      <span class="value">Violations {{ formatNumber(item.totalViolations) }}</span>
                    </li>
                  </ol>
                  <div v-else class="placeholder">No data</div>
                </section>
              </div>
            </div>

            <div class="db-card db-analytics-card">
              <h3>Trends</h3>
              <div class="db-analytics-body">
                <section class="db-analytics-block">
                  <h4>Logins by day</h4>
                  <ul v-if="stats?.trends?.loginsByDay?.length" class="db-trend-list">
                    <li v-for="item in stats.trends.loginsByDay" :key="item.day">
                      <span class="name">{{ item.day }}</span>
                      <span class="value">Logins {{ formatNumber(item.loginCount) }} · Unique {{ formatNumber(item.uniquePlayers) }}</span>
                    </li>
                  </ul>
                  <div v-else class="placeholder">No data</div>
                </section>

                <section class="db-analytics-block">
                  <h4>Matches by day</h4>
                  <ul v-if="stats?.trends?.matchesByDay?.length" class="db-trend-list">
                    <li v-for="item in stats.trends.matchesByDay" :key="item.day">
                      <span class="name">{{ item.day }}</span>
                      <span class="value">Matches {{ formatNumber(item.matchCount) }} · Completed {{ formatNumber(item.completedCount) }}</span>
                    </li>
                  </ul>
                  <div v-else class="placeholder">No data</div>
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
  const generatedAt = stats.value?.generatedAt ? formatTime(stats.value.generatedAt) : "not loaded yet";
  return `Window ${statsDays.value} days · Top ${statsTop.value} · Updated ${generatedAt}`;
});

const syncText = ref("Waiting");
const syncTone = ref<"idle" | "ok" | "warn" | "error">("idle");
const selectedId = ref<number | null>(null);

const { query } = usePlayerDatabaseQuery(filters);

const rows = computed(() => query.data.value?.items ?? query.data.value?.players ?? []);
const listLoading = computed(() => query.isLoading.value && !rows.value.length);
const listError = computed(() => (query.error.value && !rows.value.length ? renderApiError(query.error.value, "Failed to load the player database.") : ""));

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
  if (error instanceof ApiError && error.type === "timeout") return "Player detail timed out";
  return renderApiError(error, "Failed to load player detail.");
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
    { label: "Players", value: overview ? formatNumber(overview.totalPlayers ?? 0) : "--" },
    { label: "Active", value: overview ? formatNumber(overview.activePlayersInWindow ?? 0) : "--" },
    { label: "Kills / Deaths", value: overview ? `${formatNumber(overview.totalKills ?? 0)} / ${formatNumber(overview.totalDeaths ?? 0)}` : "--" },
    { label: "Matches", value: overview ? formatNumber(overview.totalMatches ?? 0) : "--" },
    { label: "Game Time", value: overview ? formatHoursFromSeconds(overview.totalGameSeconds ?? 0) : "--" },
    { label: "Rating Avg / Min / Max", value: overview ? ratingSummary(overview.averageLadderRating, overview.minLadderRating, overview.maxLadderRating) : "--" },
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
    setSyncStatus(`Stats refreshed (${statsDays.value}d / Top ${statsTop.value})`, "ok");
  } catch (error) {
    statsError.value = renderApiError(error, "Failed to load database statistics.");
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
  return new Date(time).toLocaleString("en-US");
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
  return new Intl.NumberFormat("en-US").format(Number(value ?? 0));
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
  if (!item && !isPrivateIp(ip)) return showIpGeo.value ? "Unknown" : "";
  return formatIpSummary(item ?? (isPrivateIp(ip) ? { ip: String(ip ?? ""), isPrivate: true, source: "private", provider: "none", country: "", region: "", city: "", isp: "", org: "", asn: "", timezone: "", latitude: null, longitude: null, isProxy: null, isHosting: null, updatedAt: 0, error: "" } : null), showIpGeo.value);
}

function ipDetailSummary(ip: unknown) {
  const item = lookupItem(ip, detailIpLookupQuery.items.value ?? {});
  if (!item && !isPrivateIp(ip)) return showIpGeo.value ? "Unknown" : "";
  return formatIpSummary(item ?? (isPrivateIp(ip) ? { ip: String(ip ?? ""), isPrivate: true, source: "private", provider: "none", country: "", region: "", city: "", isp: "", org: "", asn: "", timezone: "", latitude: null, longitude: null, isProxy: null, isHosting: null, updatedAt: 0, error: "" } : null), showIpGeo.value);
}

function ipSourceLabel(ip: unknown) {
  const item = lookupItem(ip, detailIpLookupQuery.items.value ?? {}) ?? lookupItem(ip, listIpLookupQuery.items.value ?? {});
  if (!item) {
    return isPrivateIp(ip) ? "Source private / none" : "Source unknown";
  }
  return `Source ${item.source} / ${item.provider}`;
}

async function copyIp(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text === "--") return;
  await copyTextWithToast(text, ui, {
    label: "IP copied",
    successMessage: text,
  });
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
