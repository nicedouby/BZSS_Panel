<template>
  <section class="page db-page">
    <section class="db-overview">
      <div class="db-overview-card">
        <div
          v-for="item in overviewCards"
          :key="item.label"
          class="db-stat-item"
        >
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
            placeholder="搜索：名称 / Steam64 / EOS ID / IP"
          >
          <select v-model="filters.sort" class="console-select">
            <option value="updated_desc">排序：最近更新</option>
            <option value="name_asc">排序：A-Z</option>
            <option value="last_login_desc">排序：登录时间</option>
          </select>
          <select v-model="statsDays" class="console-select" title="统计窗口天数">
            <option value="7">统计窗口：7天</option>
            <option value="14">统计窗口：14天</option>
            <option value="30">统计窗口：30天</option>
            <option value="60">统计窗口：60天</option>
            <option value="90">统计窗口：90天</option>
          </select>
          <select v-model="statsTop" class="console-select" title="排行榜数量">
            <option value="5">排行榜数量：5</option>
            <option value="10">排行榜数量：10</option>
            <option value="20">排行榜数量：20</option>
            <option value="50">排行榜数量：50</option>
          </select>
          <button type="button" @click="openStatsModal">打开统计弹窗</button>
          <button type="button" @click="refreshStats">刷新统计</button>
          <button type="button" @click="refreshOnlinePlayers">
            {{ refreshingOnline ? "同步中..." : "同步在线玩家时长" }}
          </button>
          <button type="button" class="console-clear-btn" @click="resetKillStats">
            {{ resettingKillStats ? "重置中..." : "重置击杀记录" }}
          </button>
          <span id="db-sync-status" class="status-text" :data-tone="syncTone">{{ syncText }}</span>
        </div>
      </div>
    </section>

    <div class="db-panel">
      <aside class="db-list-col">
        <div v-if="listLoading && !rows.length" class="placeholder">正在加载玩家列表...</div>
        <div v-else-if="listError" class="placeholder">{{ listError }}</div>
        <div v-else-if="!rows.length" class="placeholder">没有匹配的玩家</div>
        <button
          v-for="player in rows"
          :key="player.id"
          type="button"
          class="db-row"
          :class="{ active: selectedId === player.id }"
          @click="openPlayer(player.id)"
        >
          <div class="db-row-name">{{ player.current_name || player.name || "(未命名)" }}</div>
          <div class="db-row-meta">
            {{ player.permission_group || "default" }} · R={{ player.ladder_rating ?? 0 }} · K={{ player.total_kills_light ?? 0 }} · TK={{ teamKills(player) }}
          </div>
          <div class="db-row-meta">
            最近登录 {{ formatTime(player.last_login_at) }} · 更新 {{ formatTime(player.updated_at) }}
          </div>
        </button>
      </aside>

      <section class="db-detail-col">
        <div v-if="detailLoading && selectedId" class="placeholder">正在加载玩家详情...</div>
        <div v-else-if="detailError" class="placeholder">{{ detailError }}</div>
        <template v-else-if="detail">
          <div class="db-detail-top">
            <div class="db-card">
              <h2>{{ detail.player?.current_name || detail.player?.name || "Player" }}</h2>
              <div class="db-grid">
                <div><span>Steam64</span><strong class="db-vivid-id">{{ detail.player?.steam_id || "--" }}</strong></div>
                <div><span>EOS ID</span><strong class="db-vivid-id">{{ detail.player?.eos_id || "--" }}</strong></div>
                <div><span>当前IP</span><strong class="db-vivid-ip">{{ currentIp }}</strong></div>
                <div><span>权限组</span><strong class="db-vivid-perm">{{ detail.player?.permission_group || "default" }}</strong></div>
                <div><span>档案创建时间</span><strong>{{ formatTime(detail.player?.created_at) }}</strong></div>
                <div><span>最近更新时间</span><strong>{{ formatTime(detail.player?.updated_at) }}</strong></div>
                <div><span>游戏时长</span><strong class="db-vivid-duration">{{ formatSeconds(detail.player?.game_seconds) }}</strong></div>
                <div><span>服务器时长</span><strong>{{ formatSeconds(detail.player?.server_seconds) }}</strong></div>
                <div><span>暖服时长</span><strong>{{ formatSeconds(detail.player?.warmup_seconds) }}</strong></div>
                <div><span>处于小队时长</span><strong>{{ formatSeconds(detail.player?.in_squad_seconds) }}</strong></div>
                <div><span>作为队长时长</span><strong>{{ formatSeconds(detail.player?.squad_leader_seconds) }}</strong></div>
                <div><span>担任指挥官时长</span><strong>{{ formatSeconds(detail.player?.commander_seconds) }}</strong></div>
                <div><span>天梯分</span><strong class="db-vivid-rating">{{ detail.player?.ladder_rating ?? 0 }}</strong></div>
                <div><span>胜率</span><strong>{{ winRate(detail.player?.total_match_wins, detail.player?.total_matches) }}</strong></div>
                <div><span>带队胜率</span><strong>{{ winRate(detail.player?.total_lead_wins, detail.player?.total_lead_matches) }}</strong></div>
                <div><span>指挥胜率</span><strong>{{ winRate(detail.player?.total_cmd_wins, detail.player?.total_cmd_matches) }}</strong></div>
              </div>
            </div>

            <div class="db-card">
              <h3>击杀统计</h3>
              <div class="db-grid">
                <div><span>轻武器击杀</span><strong class="db-vivid-kill">{{ detail.player?.total_kills_light ?? 0 }}</strong></div>
                <div><span>轻武器击倒</span><strong class="db-vivid-kill">{{ detail.player?.total_downed_light ?? 0 }}</strong></div>
                <div><span>致命击倒</span><strong class="db-vivid-kill">{{ detail.player?.total_downed_light_fatal ?? 0 }}</strong></div>
                <div><span>致命击倒率</span><strong>{{ fatalDownRate(detail.player) }}</strong></div>
                <div><span>其他击杀</span><strong>{{ detail.player?.total_kills_other ?? 0 }}</strong></div>
                <div><span>其他击倒</span><strong>{{ detail.player?.total_downed_other ?? 0 }}</strong></div>
                <div><span>TK(击倒)</span><strong class="db-vivid-danger">{{ detail.player?.total_tk_down ?? 0 }}</strong></div>
                <div><span>TK(击杀)</span><strong class="db-vivid-danger">{{ detail.player?.total_tk_kill ?? 0 }}</strong></div>
                <div><span>被击倒</span><strong>{{ detail.player?.total_downed_received ?? 0 }}</strong></div>
                <div><span>死亡</span><strong>{{ detail.player?.total_deaths ?? 0 }}</strong></div>
                <div><span>KD</span><strong>{{ kd(detail.player) }}</strong></div>
                <div><span>自杀</span><strong>{{ detail.player?.total_suicides ?? 0 }}</strong></div>
              </div>
            </div>
          </div>

          <div class="db-card">
            <h3>暖服统计</h3>
            <div class="db-grid">
              <div><span>暖服击杀</span><strong>{{ warmupTotal(detail.warmupStats, "kills") }}</strong></div>
              <div><span>暖服击倒</span><strong>{{ warmupTotal(detail.warmupStats, "downs") }}</strong></div>
              <div><span>暖服被击倒</span><strong>{{ detail.warmupStats?.total_downed_received ?? 0 }}</strong></div>
              <div><span>暖服TK</span><strong>{{ warmupTotal(detail.warmupStats, "teamKills") }}</strong></div>
              <div><span>暖服死亡</span><strong>{{ detail.warmupStats?.total_deaths ?? 0 }}</strong></div>
              <div><span>暖服自杀</span><strong>{{ detail.warmupStats?.total_suicides ?? 0 }}</strong></div>
            </div>
          </div>

          <div class="db-card">
            <h3>行为记录</h3>
            <div class="db-grid">
              <div><span>被举报记录</span><strong>{{ detail.player?.total_reports_received ?? detail.reported?.length ?? 0 }}</strong></div>
              <div><span>举报记录</span><strong>{{ detail.player?.total_reports_submitted ?? detail.reports?.length ?? 0 }}</strong></div>
              <div><span>创建小队次数</span><strong>{{ detail.player?.total_squad_created ?? 0 }}</strong></div>
              <div><span>对局数量</span><strong>{{ detail.player?.total_matches ?? 0 }}</strong></div>
            </div>
          </div>

          <div class="db-card">
            <h3>曾用名（最近 20）</h3>
            <ul class="db-list-mini">
              <li v-for="alias in (detail.aliases || []).slice(0, 20)" :key="`${alias.alias_name}-${alias.seen_at}`">
                <span>{{ alias.alias_name }}</span>
                <small>{{ formatTime(alias.seen_at) }}</small>
              </li>
              <li v-if="!(detail.aliases || []).length">无</li>
            </ul>
          </div>

          <div class="db-card">
            <h3>历史 IP（最近 20）</h3>
            <ul class="db-list-mini">
              <li v-for="item in summarizeIpRows(detail.ips, 'seen_at').slice(0, 20)" :key="item.ip">
                <span class="login-ip">{{ item.ip }} <strong class="db-ip-repeat">*{{ item.count }}</strong></span>
                <small>最近 {{ formatTime(item.latestAt) }}</small>
              </li>
              <li v-if="!summarizeIpRows(detail.ips, 'seen_at').length">无</li>
            </ul>
          </div>

          <div class="db-card">
            <h3>登录记录（最近 50）</h3>
            <ul class="db-list-mini">
              <li v-for="item in summarizeIpRows(detail.logins, 'joined_at').slice(0, 50)" :key="`${item.ip}-${item.latestValue}`">
                <span class="login-ip">{{ item.ip }} <strong class="db-ip-repeat">*{{ item.count }}</strong></span>
                <small>最近 {{ formatTime(item.latestAt) }}</small>
              </li>
              <li v-if="!summarizeIpRows(detail.logins, 'joined_at').length">无</li>
            </ul>
          </div>

          <div class="db-card">
            <h3>战斗日志索引（最近 100）</h3>
            <ul class="db-list-mini">
              <li v-for="session in (detail.combatSessions || []).slice(0, 100)" :key="session.id || `${session.date_key}-${session.file_path}`">
                <span>{{ session.date_key || "--" }} · {{ fileName(session.file_path) }}</span>
                <small>{{ formatTime(session.first_event_at) }} ~ {{ formatTime(session.last_event_at) }}</small>
              </li>
              <li v-if="!(detail.combatSessions || []).length">无</li>
            </ul>
          </div>

          <div class="db-card">
            <h3>权限组修改</h3>
            <div class="console-toolbar db-action-toolbar">
              <input v-model="permissionGroup" class="console-input" placeholder="Permission group">
              <button type="button" :disabled="savingPermission || !permissionGroup.trim()" @click="savePermissionGroup">
                {{ savingPermission ? "保存中..." : "保存" }}
              </button>
              <button type="button" :disabled="refreshingPlayer" @click="refreshSelectedPlayerDuration">
                {{ refreshingPlayer ? "同步中..." : "刷新 Steam 时长" }}
              </button>
              <button type="button" class="console-clear-btn" :disabled="deletingPlayer" @click="deletePlayerProfile">
                {{ deletingPlayer ? "删除中..." : "删除玩家档案" }}
              </button>
            </div>
            <div class="db-action-status" :data-tone="actionTone">{{ actionText }}</div>
          </div>
        </template>
        <div v-else class="placeholder">请选择左侧玩家查看档案详情</div>
      </section>
    </div>

    <div v-if="showStatsModal" class="db-stats-modal" aria-hidden="false">
      <button class="db-stats-modal-backdrop" type="button" aria-label="关闭统计弹窗" @click="closeStatsModal" />
      <section class="db-stats-modal-card" role="dialog" aria-modal="true" aria-label="数据库统计弹窗">
        <header class="db-stats-modal-head">
          <div>
            <h2>数据库统计</h2>
            <p>{{ statsSubtitle }}</p>
          </div>
          <button type="button" class="console-clear-btn" @click="closeStatsModal">关闭</button>
        </header>

        <div v-if="statsLoading" class="placeholder">正在加载统计数据...</div>
        <div v-else-if="statsError" class="placeholder">{{ statsError }}</div>
        <section v-else class="db-analytics">
          <div class="db-analytics-grid">
            <div class="db-card db-analytics-card">
              <h3>Breakdowns 分布统计</h3>
              <div class="db-analytics-body">
                <section class="db-analytics-block">
                  <h4>权限组分布</h4>
                  <div v-if="stats?.breakdowns?.permissionGroups?.length" class="db-chip-wrap">
                    <span v-for="item in stats.breakdowns.permissionGroups" :key="item.permissionGroup" class="db-chip">
                      <span>{{ item.permissionGroup }}</span>
                      <small>{{ formatNumber(item.players) }}</small>
                    </span>
                  </div>
                  <div v-else class="placeholder">暂无权限组数据</div>
                </section>

                <section class="db-analytics-block">
                  <h4>角色标签分布</h4>
                  <div v-if="stats?.breakdowns?.roleTags?.length" class="db-chip-wrap">
                    <span v-for="item in stats.breakdowns.roleTags" :key="item.tagValue" class="db-chip">
                      <span>{{ item.tagValue }}</span>
                      <small>{{ formatNumber(item.players) }}</small>
                    </span>
                  </div>
                  <div v-else class="placeholder">暂无角色标签</div>
                </section>

                <section class="db-analytics-block">
                  <h4>成分标签分布</h4>
                  <div v-if="stats?.breakdowns?.componentTags?.length" class="db-chip-wrap">
                    <span v-for="item in stats.breakdowns.componentTags" :key="item.tagValue" class="db-chip">
                      <span>{{ item.tagValue }}</span>
                      <small>{{ formatNumber(item.players) }}</small>
                    </span>
                  </div>
                  <div v-else class="placeholder">暂无成分标签</div>
                </section>

                <section class="db-analytics-block">
                  <h4>违规类型分布</h4>
                  <div v-if="stats?.breakdowns?.violationTypes?.length" class="db-chip-wrap">
                    <span
                      v-for="item in stats.breakdowns.violationTypes"
                      :key="item.violationKey"
                      class="db-chip"
                    >
                      <span>{{ item.violationLabel || item.violationKey }}</span>
                      <small>{{ formatNumber(item.totalCount) }}</small>
                    </span>
                  </div>
                  <div v-else class="placeholder">暂无违规统计</div>
                </section>
              </div>
            </div>

            <div class="db-card db-analytics-card">
              <h3>Leaderboards 排行榜</h3>
              <div class="db-analytics-body">
                <section class="db-analytics-block">
                  <h4>击杀榜</h4>
                  <ol v-if="stats?.leaderboards?.byKills?.length" class="db-rank-list">
                    <li v-for="item in stats.leaderboards.byKills" :key="item.id">
                      <button type="button" class="name db-rank-player" @click="jumpToPlayerFromStats(item.id)">
                        {{ item.currentName || item.steamID || item.eosID || "未知玩家" }}
                      </button>
                      <span class="value">K {{ formatNumber(item.totalKills) }} / D {{ formatNumber(item.totalDeaths) }} / KD {{ item.kd ?? "--" }}</span>
                    </li>
                  </ol>
                  <div v-else class="placeholder">暂无击杀榜数据</div>
                </section>

                <section class="db-analytics-block">
                  <h4>时长榜</h4>
                  <ol v-if="stats?.leaderboards?.byPlaytime?.length" class="db-rank-list">
                    <li v-for="item in stats.leaderboards.byPlaytime" :key="item.id">
                      <button type="button" class="name db-rank-player" @click="jumpToPlayerFromStats(item.id)">
                        {{ item.currentName || item.steamID || item.eosID || "未知玩家" }}
                      </button>
                      <span class="value">{{ formatHoursFromSeconds(item.gameSeconds) }}</span>
                    </li>
                  </ol>
                  <div v-else class="placeholder">暂无时长榜数据</div>
                </section>

                <section class="db-analytics-block">
                  <h4>违规榜</h4>
                  <ol v-if="stats?.leaderboards?.byViolations?.length" class="db-rank-list">
                    <li v-for="item in stats.leaderboards.byViolations" :key="item.playerId">
                      <button type="button" class="name db-rank-player" @click="jumpToPlayerFromStats(item.playerId)">
                        {{ item.currentName || item.steamID || item.eosID || "未知玩家" }}
                      </button>
                      <span class="value">违规 {{ formatNumber(item.totalViolations) }}</span>
                    </li>
                  </ol>
                  <div v-else class="placeholder">暂无违规榜数据</div>
                </section>
              </div>
            </div>

            <div class="db-card db-analytics-card">
              <h3>Trends 趋势</h3>
              <div class="db-analytics-body">
                <section class="db-analytics-block">
                  <h4>近 N 天登录趋势</h4>
                  <ul v-if="stats?.trends?.loginsByDay?.length" class="db-trend-list">
                    <li v-for="item in stats.trends.loginsByDay" :key="item.day">
                      <span class="name">{{ item.day }}</span>
                      <span class="value">登录 {{ formatNumber(item.loginCount) }} · 去重 {{ formatNumber(item.uniquePlayers) }}</span>
                    </li>
                  </ul>
                  <div v-else class="placeholder">暂无登录趋势</div>
                </section>

                <section class="db-analytics-block">
                  <h4>近 N 天对局趋势</h4>
                  <ul v-if="stats?.trends?.matchesByDay?.length" class="db-trend-list">
                    <li v-for="item in stats.trends.matchesByDay" :key="item.day">
                      <span class="name">{{ item.day }}</span>
                      <span class="value">对局 {{ formatNumber(item.matchCount) }} · 已结束 {{ formatNumber(item.completedCount) }}</span>
                    </li>
                  </ul>
                  <div v-else class="placeholder">暂无对局趋势</div>
                </section>
              </div>
            </div>
          </div>
        </section>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet, apiPost, request } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import { useUiStore } from "../stores/ui.store";
import { usePlayerDatabaseQuery } from "../composables/usePlayerDatabaseQuery";

const ui = useUiStore();

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
const statsSubtitle = computed(() => {
  const generated = stats.value?.generatedAt ? formatTime(stats.value.generatedAt) : "--";
  return `统计窗口 ${statsDays.value} 天 · 排行榜前 ${statsTop.value} 名 · 更新于 ${generated}`;
});

const syncText = ref("等待操作");
const syncTone = ref<"idle" | "ok" | "warn" | "error">("idle");
const actionText = ref("准备执行档案操作。");
const actionTone = ref<"idle" | "ok" | "warn" | "error">("idle");

const selectedId = ref<number | null>(null);
const permissionGroup = ref("default");
const savingPermission = ref(false);
const refreshingPlayer = ref(false);
const refreshingOnline = ref(false);
const resettingKillStats = ref(false);
const deletingPlayer = ref(false);

const { query } = usePlayerDatabaseQuery(filters);

const rows = computed(() => query.data.value?.items ?? query.data.value?.players ?? []);
const listLoading = computed(() => query.isLoading.value && !rows.value.length);
const listError = computed(() => (query.error.value && !rows.value.length ? renderApiError(query.error.value, "Failed to load the player database.") : ""));
const detailQuery = useQuery({
  queryKey: computed(() => ["player-database-detail", selectedId.value]),
  enabled: computed(() => selectedId.value !== null),
  queryFn: async () => apiGet<any>(`/api/db/players/${encodeURIComponent(String(selectedId.value))}`),
});

const detail = computed(() => detailQuery.data.value ?? null);
const detailLoading = computed(() => detailQuery.isLoading.value);
const detailError = computed(() => (detailQuery.error.value ? renderApiError(detailQuery.error.value, "Failed to load player detail.") : ""));
const currentIp = computed(() => detail.value?.player?.current_ip || detail.value?.logins?.[0]?.ip || detail.value?.ips?.[0]?.ip || "--");
const overviewCards = computed(() => {
  const overview = stats.value?.overview ?? {};
  return [
    { label: "玩家总数", value: formatNumber(overview.totalPlayers ?? 0) },
    { label: "窗口活跃", value: formatNumber(overview.activePlayersInWindow ?? 0) },
    { label: "总击杀 / 死亡", value: `${formatNumber(overview.totalKills ?? 0)} / ${formatNumber(overview.totalDeaths ?? 0)}` },
    { label: "总比赛", value: formatNumber(overview.totalMatches ?? 0) },
    { label: "总时长", value: formatHoursFromSeconds(overview.totalGameSeconds ?? 0) },
    { label: "天梯均值 / 极值", value: ratingSummary(overview.averageLadderRating, overview.minLadderRating, overview.maxLadderRating) },
  ];
});

watch(
  () => [filters.q, filters.sort],
  () => {
    selectedId.value = null;
  },
);

watch(
  rows,
  (value) => {
    if (!value.length) {
      selectedId.value = null;
      return;
    }
    if (selectedId.value == null || !value.some((row) => row.id === selectedId.value)) {
      selectedId.value = Number(value[0].id);
    }
  },
  { immediate: true },
);

watch(
  () => detail.value?.player?.permission_group,
  (value) => {
    permissionGroup.value = String(value ?? "default");
  },
  { immediate: true },
);

watch(
  [statsDays, statsTop],
  () => {
    void loadStats(true);
  },
);

let statsRefreshTimer: number | null = null;
onBeforeUnmount(() => {
  if (statsRefreshTimer != null) window.clearInterval(statsRefreshTimer);
});

void loadStats();
statsRefreshTimer = window.setInterval(() => {
  if (!document.hidden) {
    void loadStats(true);
  }
}, 30_000);

function openPlayer(id: number) {
  selectedId.value = Number(id);
}

function openStatsModal() {
  showStatsModal.value = true;
  void loadStats();
}

function closeStatsModal() {
  showStatsModal.value = false;
}

async function loadStats(silent = false) {
  statsLoading.value = true;
  statsError.value = "";
  try {
    const params = new URLSearchParams({
      days: String(statsDays.value),
      top: String(statsTop.value),
    });
    stats.value = await apiGet<any>(`/api/db/stats?${params.toString()}`);
    if (!silent) {
      setSyncStatus(`统计已刷新（${statsDays.value}天 / ${statsTop.value}条）`, "ok");
    }
  } catch (error) {
    statsError.value = renderApiError(error, "Failed to load database statistics.");
    if (!silent) {
      setSyncStatus(statsError.value, "error");
    }
  } finally {
    statsLoading.value = false;
  }
}

async function refreshStats() {
  await loadStats();
}

async function refreshOnlinePlayers() {
  if (refreshingOnline.value) return;
  refreshingOnline.value = true;
  setSyncStatus("正在同步在线玩家时长...", "warn");

  try {
    const job = await apiPost<any>("/api/playtime/online/refresh", { waitMs: 0 });
    const finalJob = await waitForPlaytimeJob(job.id, 60_000);
    if (finalJob.status !== "completed") {
      throw new Error(finalJob?.error?.message || "同步在线玩家时长失败。");
    }

    setSyncStatus(`在线玩家时长同步完成：${finalJob.result?.updated || 0}/${finalJob.result?.total || 0}`, "ok");
    ui.pushToast({
      title: "在线玩家时长已同步",
      message: "数据库列表与详情已刷新。",
      tone: "ok",
    });
    await query.refetch();
    if (selectedId.value) await detailQuery.refetch();
    if (showStatsModal.value) await loadStats(true);
  } catch (error) {
    const message = renderApiError(error, "Failed to sync online player durations.");
    setSyncStatus(message, "error");
    ui.pushToast({
      title: "同步失败",
      message,
      tone: "error",
    });
  } finally {
    refreshingOnline.value = false;
  }
}

async function refreshSelectedPlayerDuration() {
  const player = detail.value?.player;
  if (!player?.steam_id || refreshingPlayer.value) return;

  refreshingPlayer.value = true;
  setActionStatus("正在刷新 Steam 时长...", "warn");

  try {
    const job = await apiPost<any>("/api/playtime/players/refresh", {
      steamID: player.steam_id,
      name: player.current_name || player.name || null,
      eosID: player.eos_id || null,
      waitMs: 0,
    });
    const finalJob = await waitForPlaytimeJob(job.id, 60_000);
    if (finalJob.status !== "completed") {
      throw new Error(finalJob?.error?.message || "Steam 时长刷新失败。");
    }

    setActionStatus(`Steam 时长已刷新：${finalJob.result?.lookup?.gameHours ?? "--"}h`, "ok");
    ui.pushToast({
      title: "Steam 时长已更新",
      message: "当前玩家档案已刷新。",
      tone: "ok",
    });
    await query.refetch();
    await detailQuery.refetch();
  } catch (error) {
    const message = renderApiError(error, "Failed to refresh the selected player's Steam duration.");
    setActionStatus(message, "error");
    ui.pushToast({
      title: "Steam 时长刷新失败",
      message,
      tone: "error",
    });
  } finally {
    refreshingPlayer.value = false;
  }
}

async function savePermissionGroup() {
  const player = detail.value?.player;
  const nextValue = permissionGroup.value.trim();
  if (!player?.id || !nextValue || savingPermission.value) return;

  savingPermission.value = true;
  setActionStatus("正在保存权限组...", "warn");

  try {
    await request(`/api/db/players/${encodeURIComponent(String(player.id))}/permission-group`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissionGroup: nextValue }),
    });
    setActionStatus("权限组已更新", "ok");
    ui.pushToast({
      title: "权限组已保存",
      message: `玩家 ${player.current_name || player.name || player.id} 的权限组已更新。`,
      tone: "ok",
    });
    await query.refetch();
    await detailQuery.refetch();
  } catch (error) {
    const message = renderApiError(error, "Failed to update the permission group.");
    setActionStatus(message, "error");
    ui.pushToast({
      title: "权限组保存失败",
      message,
      tone: "error",
    });
  } finally {
    savingPermission.value = false;
  }
}

async function deletePlayerProfile() {
  const player = detail.value?.player;
  if (!player?.id || deletingPlayer.value) return;

  const confirmed = await ui.openConfirm({
    title: "删除玩家档案",
    message: `确认删除 ${player.current_name || player.name || player.id} 的数据库档案吗？此操作不可撤销。`,
    confirmText: "删除",
    cancelText: "取消",
    tone: "warn",
  });
  if (!confirmed) return;

  deletingPlayer.value = true;
  setActionStatus("正在删除玩家档案...", "warn");

  try {
    await request(`/api/db/players/${encodeURIComponent(String(player.id))}`, { method: "DELETE" });
    selectedId.value = null;
    setActionStatus("玩家档案已删除", "ok");
    ui.pushToast({
      title: "玩家档案已删除",
      message: "列表已刷新。",
      tone: "ok",
    });
    await query.refetch();
  } catch (error) {
    const message = renderApiError(error, "Failed to delete the player profile.");
    setActionStatus(message, "error");
    ui.pushToast({
      title: "删除失败",
      message,
      tone: "error",
    });
  } finally {
    deletingPlayer.value = false;
  }
}

async function resetKillStats() {
  if (resettingKillStats.value) return;
  const confirmed = await ui.openConfirm({
    title: "重置击杀记录",
    message: "确认重置所有玩家的击杀、击倒、TK、死亡与自杀统计吗？此操作不可撤销。",
    confirmText: "重置",
    cancelText: "取消",
    tone: "warn",
  });
  if (!confirmed) return;

  resettingKillStats.value = true;
  setSyncStatus("正在重置击杀记录...", "warn");

  try {
    const result = await apiPost<any>("/api/db/reset-kill-stats", {});
    setSyncStatus(`击杀统计已重置，影响 ${Number(result?.changed || 0)} 条玩家记录`, "ok");
    ui.pushToast({
      title: "击杀记录已重置",
      message: "数据库列表与详情已刷新。",
      tone: "ok",
    });
    await query.refetch();
    if (selectedId.value) await detailQuery.refetch();
  } catch (error) {
    const message = renderApiError(error, "Failed to reset kill statistics.");
    setSyncStatus(message, "error");
    ui.pushToast({
      title: "重置失败",
      message,
      tone: "error",
    });
  } finally {
    resettingKillStats.value = false;
  }
}

async function jumpToPlayerFromStats(playerId: number) {
  const id = Number(playerId);
  if (!Number.isFinite(id) || id <= 0) return;

  showStatsModal.value = false;
  selectedId.value = id;
  await detailQuery.refetch();
  setSyncStatus(`已定位到玩家档案 #${id}`, "ok");
}

async function waitForPlaytimeJob(jobId: string, waitMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitMs) {
    const job = await apiGet<any>(`/api/playtime/jobs/${encodeURIComponent(jobId)}?waitMs=3000`);
    if (job.status === "completed" || job.status === "failed") return job;
  }
  throw new Error("等待 Steam 时长任务超时。");
}

function setSyncStatus(text: string, tone: "idle" | "ok" | "warn" | "error" = "idle") {
  syncText.value = text;
  syncTone.value = tone;
}

function setActionStatus(text: string, tone: "idle" | "ok" | "warn" | "error" = "idle") {
  actionText.value = text;
  actionTone.value = tone;
}

function formatTime(value: unknown) {
  const time = Number(value ?? 0);
  if (!time) return "--";
  return new Date(time).toLocaleString("zh-CN");
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
  return new Intl.NumberFormat("zh-CN").format(Number(value ?? 0));
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

function fatalDownRate(player: any) {
  const kills = Number(player?.total_kills_light ?? 0);
  if (kills <= 0) return "--";
  const rate = Number(player?.total_downed_light_fatal ?? 0) / kills;
  return `${(rate * 100).toFixed(1)}%`;
}

function kd(player: any) {
  const deaths = Number(player?.total_deaths ?? 0);
  if (deaths <= 0) return "--";
  const kills = Number(player?.total_kills_light ?? 0) + Number(player?.total_kills_other ?? 0);
  return (kills / deaths).toFixed(2);
}

function teamKills(player: any) {
  return Number(player?.total_tk_down ?? 0) + Number(player?.total_tk_kill ?? 0);
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

function summarizeIpRows(rows: any[] | undefined, timeField: string) {
  const grouped = new Map<string, { ip: string; count: number; latestAt: unknown; latestValue: number }>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const ip = String(row?.ip || "").trim() || "--";
    const rawTime = row?.[timeField] || row?.seen_at || row?.joined_at || null;
    const timeValue = rawTime ? new Date(rawTime).getTime() : 0;
    const existing = grouped.get(ip);

    if (!existing) {
      grouped.set(ip, {
        ip,
        count: 1,
        latestAt: rawTime,
        latestValue: Number.isFinite(timeValue) ? timeValue : 0,
      });
      continue;
    }

    existing.count += 1;
    if (Number.isFinite(timeValue) && timeValue > existing.latestValue) {
      existing.latestAt = rawTime;
      existing.latestValue = timeValue;
    }
  }

  return [...grouped.values()].sort((a, b) => (b.latestValue || 0) - (a.latestValue || 0));
}

function fileName(pathValue: unknown) {
  return String(pathValue ?? "").split(/[\\/]/).pop() || "--";
}
</script>

<style scoped>
.db-page {
  gap: 12px;
}

.db-overview-card,
.db-toolbar-card,
.db-card,
.db-stats-modal-card {
  border: 1px solid rgba(42, 49, 68, 0.84);
  background: rgba(23, 29, 35, 0.96);
  border-radius: 20px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.26);
}

.db-overview-card {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  padding: 14px;
}

.db-stat-item {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid rgba(42, 49, 68, 0.82);
  background: rgba(255, 255, 255, 0.03);
}

.db-stat-item span {
  color: #98a5af;
  font-size: 12px;
}

.db-stat-item strong {
  font-size: 16px;
  line-height: 1.25;
}

.db-toolbar-card {
  padding: 14px;
}

.console-input,
.console-select {
  min-width: 0;
  border: 1px solid #38414c;
  background: #11171d;
  color: #edf2f4;
  border-radius: 12px;
  padding: 8px 10px;
}

.console-input {
  flex: 1 1 320px;
}

.console-select {
  flex: 0 0 auto;
}

.console-clear-btn {
  border-color: #7a3a3a;
  background: #312024;
}

.status-text {
  font-size: 12px;
  color: #8a93a8;
  white-space: nowrap;
}

.placeholder {
  width: 100%;
  min-height: 120px;
  display: grid;
  place-items: center;
  padding: 18px;
  border: 1px dashed rgba(42, 49, 68, 0.84);
  border-radius: 12px;
  color: #8a93a8;
  background: rgba(255, 255, 255, 0.02);
}

.db-toolbar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.db-search {
  width: min(420px, 100%);
  flex: 1 1 320px;
}

.db-panel {
  display: flex;
  min-height: 0;
  border-radius: 20px;
  overflow: hidden;
  border: 1px solid rgba(42, 49, 68, 0.84);
  background: rgba(17, 23, 29, 0.4);
}

.db-list-col {
  width: 340px;
  flex-shrink: 0;
  max-height: 100%;
  overflow-y: auto;
  border-right: 1px solid rgba(42, 49, 68, 0.84);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.db-row {
  display: block;
  width: 100%;
  text-align: left;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(42, 49, 68, 0.82);
  color: #edf2f4;
  border-radius: 12px;
  padding: 10px;
  cursor: pointer;
}

.db-row:hover {
  background: #232a3a;
}

.db-row.active {
  border-color: rgba(139, 182, 255, 0.38);
  box-shadow: inset 3px 0 0 #8bb6ff;
}

.db-row-name {
  font-size: 13px;
  font-weight: 600;
}

.db-row-meta {
  margin-top: 4px;
  font-size: 11px;
  color: #8a93a8;
}

.db-detail-col {
  flex: 1;
  min-width: 0;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
  max-height: 100%;
  overflow-y: auto;
}

.db-detail-top {
  width: min(100%, 1280px);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.db-card {
  width: min(100%, 1020px);
  padding: 12px;
}

.db-card h2,
.db-card h3 {
  margin: 0 0 10px;
  font-size: 15px;
}

.db-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(240px, 1fr));
  gap: 8px;
}

.db-grid div {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(42, 49, 68, 0.82);
  border-radius: 12px;
  padding: 8px;
  display: flex;
  flex-direction: column;
}

.db-grid span {
  color: #98a5af;
  font-size: 11px;
}

.db-grid strong {
  margin-top: 3px;
  font-size: 13px;
  word-break: break-all;
  line-height: 1.35;
}

.db-vivid-id {
  color: #88e2ff;
}

.db-vivid-ip {
  color: #a8ff7a;
}

.db-vivid-perm {
  color: #ffd67b;
  text-transform: uppercase;
}

.db-vivid-duration {
  color: #a8e6ff;
}

.db-vivid-rating {
  color: #ffd36e;
}

.db-vivid-kill {
  color: #62f0d0;
}

.db-vivid-danger {
  color: #ff7a90;
}

.db-list-mini {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
}

.db-list-mini li {
  background: #11171d;
  border: 1px solid rgba(42, 49, 68, 0.82);
  border-radius: 12px;
  padding: 6px 8px;
  font-size: 12px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  align-items: baseline;
}

.db-list-mini small {
  color: #5d6781;
}

.login-ip {
  font-weight: 600;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.db-ip-repeat {
  color: #8bb6ff;
  font-weight: 800;
}

.db-action-toolbar {
  margin-top: 10px;
  flex-wrap: wrap;
}

.db-action-status {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(42, 49, 68, 0.82);
  background: rgba(255, 255, 255, 0.03);
  color: #8a93a8;
  font-size: 12px;
}

.db-action-status[data-tone="warn"] {
  color: #f0d38a;
  border-color: rgba(224, 175, 104, 0.26);
  background: color-mix(in srgb, #f0d38a 10%, transparent);
}

.db-action-status[data-tone="ok"] {
  color: #a6e3a1;
  border-color: rgba(158, 206, 106, 0.26);
  background: color-mix(in srgb, #a6e3a1 10%, transparent);
}

.db-action-status[data-tone="error"] {
  color: #ff8ea1;
  border-color: rgba(247, 118, 142, 0.26);
  background: color-mix(in srgb, #ff8ea1 10%, transparent);
}

.status-text[data-tone="warn"] {
  color: #f0d38a;
}

.status-text[data-tone="ok"] {
  color: #a6e3a1;
}

.status-text[data-tone="error"] {
  color: #ff8ea1;
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
  width: min(1200px, calc(100vw - 28px));
  max-height: calc(100vh - 40px);
  overflow: auto;
  padding: 14px;
}

.db-stats-modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.db-stats-modal-head h2 {
  margin: 0;
  font-size: 18px;
}

.db-stats-modal-head p {
  margin: 6px 0 0;
  color: #8a93a8;
  font-size: 12px;
}

.db-analytics {
  margin-top: 12px;
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
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  padding: 8px;
}

.db-analytics-block h4 {
  margin: 0 0 8px;
  font-size: 12px;
  color: #8a93a8;
}

.db-chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.db-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid rgba(108, 122, 160, 0.22);
  background: rgba(255, 255, 255, 0.04);
  font-size: 11px;
}

.db-chip small {
  color: #5d6781;
}

.db-rank-list,
.db-trend-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 5px;
}

.db-rank-list li,
.db-trend-list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  border: 1px solid rgba(42, 49, 68, 0.82);
  border-radius: 10px;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.03);
}

.db-rank-list .name,
.db-trend-list .name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.db-rank-player {
  border: 0;
  padding: 0;
  background: transparent;
  text-align: left;
  color: #edf2f4;
  cursor: pointer;
}

.db-rank-player:hover {
  color: #8bb6ff;
  text-decoration: underline;
}

.db-rank-list .value,
.db-trend-list .value {
  color: #8a93a8;
  font-variant-numeric: tabular-nums;
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
    flex-direction: column;
  }

  .db-list-col {
    width: 100%;
    border-right: 0;
    border-bottom: 1px solid rgba(42, 49, 68, 0.84);
  }

  .db-detail-top,
  .db-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .db-overview-card {
    grid-template-columns: 1fr;
  }

  .db-toolbar-row {
    align-items: stretch;
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
