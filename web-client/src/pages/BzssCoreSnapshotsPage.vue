<template>
  <section class="bzss-page">
    <header class="page-hero">
      <div class="hero-left">
        <div class="title-row">
          <h1>BZSS-Core 玩家快照</h1>
          <span class="stream-badge" :class="{ 'stream-badge--active': bzssCoreStore.streamActive }">
            <span class="pulse-dot"></span>
            {{ bzssCoreStore.streamActive ? "SSE 监听中" : "轮询更新" }}
          </span>
        </div>
        <p class="hero-subtitle">
          列表视图仅保留单一玩家列表。底部原始数据面板展示最近一次完整原始数据，以及运行时、计分板和场景原始块。
        </p>
      </div>

      <div class="hero-actions">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="loading" @click="fetchData">
          <span v-if="loading" class="spinner"></span>
          刷新快照
        </button>
        <button type="button" class="btn btn-secondary btn-sm" :disabled="rawLoading" @click="fetchRawData">
          <span v-if="rawLoading" class="spinner"></span>
          刷新原始数据
        </button>
      </div>
    </header>

    <div v-if="error" class="error-banner">
      <span class="warning-icon">!</span>
      <div class="error-content">
        <strong>快照错误：</strong><span>{{ error }}</span>
      </div>
    </div>

    <div v-if="rawError" class="error-banner error-banner--soft">
      <span class="warning-icon">!</span>
      <div class="error-content">
        <strong>原始数据错误：</strong><span>{{ rawError }}</span>
      </div>
    </div>

    <section class="status-ribbon">
      <div class="status-item">
        <span class="status-dot-indicator" :class="payload?.status || 'idle'"></span>
        <span class="lbl">核心状态</span>
        <strong class="val" :class="statusColorClass">{{ statusLabel }}</strong>
        <span class="sub text-muted">({{ statusDetail }})</span>
      </div>

      <div class="status-separator">|</div>

      <div class="status-item">
        <span class="lbl">运行时玩家：</span>
        <strong class="val">{{ runtimePlayers.length }} 人</strong>
        <span class="sub text-muted">({{ payload?.state?.runtimePlayerCount ?? 0 }})</span>
      </div>

      <div class="status-separator">|</div>

      <div class="status-item">
        <span class="lbl">计分板玩家：</span>
        <strong class="val">{{ scoreboardPlayers.length }} 人</strong>
        <span class="sub text-muted">({{ payload?.state?.scoreboardPlayerCount ?? 0 }})</span>
      </div>

      <div class="status-separator">|</div>

      <div class="status-item">
        <span class="lbl">场景对象：</span>
        <strong class="val">{{ totalSceneCount }} 项</strong>
        <span class="sub text-muted">({{ payload?.captureZones?.length ?? 0 }} 点 / {{ payload?.fobs?.length ?? 0 }} FOB)</span>
      </div>
    </section>

    <div class="dashboard-layout">
      <section class="dashboard-col main-panel">
        <header class="panel-header-wrapper">
          <div class="panel-header-top">
            <h2>玩家快照 ({{ sortedFilteredPairs.length }} / {{ playerPairs.length }})</h2>

            <div class="header-controls">
              <div class="search-box">
                <input
                  v-model.trim="query"
                  class="search-input"
                  type="text"
                  placeholder="搜索玩家、ID、队伍、小队..."
                />
                <button v-if="query" type="button" class="clear-search" @click="query = ''">清除</button>
              </div>

              <label class="toggle-switch">
                <input v-model="showRaw" type="checkbox" />
                <span class="slider"></span>
                <span class="label-text">显示行原始 JSON</span>
              </label>
            </div>
          </div>
        </header>

        <div class="player-list-scroll">
          <div v-if="sortedFilteredPairs.length > 0" class="table-view-container fade-in">
            <div class="table-responsive">
              <table class="player-table">
                <thead>
                  <tr>
                    <th class="sortable" @click="handleSort('playerIndex')">
                      Index <span v-if="sortKey === 'playerIndex'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="sortable" @click="handleSort('playerId')">
                      Player ID <span v-if="sortKey === 'playerId'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="sortable" @click="handleSort('teamId')">
                      Team <span v-if="sortKey === 'teamId'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="sortable" @click="handleSort('squadId')">
                      Squad <span v-if="sortKey === 'squadId'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th>Status</th>
                    <th class="sortable text-center" @click="handleSort('kills')">
                      K <span v-if="sortKey === 'kills'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="sortable text-center" @click="handleSort('deaths')">
                      D <span v-if="sortKey === 'deaths'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="sortable text-center" @click="handleSort('woundeds')">
                      W <span v-if="sortKey === 'woundeds'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="sortable text-center" @click="handleSort('lives')">
                      Lives <span v-if="sortKey === 'lives'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="sortable text-center" @click="handleSort('teamworkScore')">
                      Teamwork <span v-if="sortKey === 'teamworkScore'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="sortable text-center" @click="handleSort('objectiveScore')">
                      Objective <span v-if="sortKey === 'objectiveScore'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="sortable text-center" @click="handleSort('combatScore')">
                      Combat <span v-if="sortKey === 'combatScore'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="pair in sortedFilteredPairs" :key="pair.playerIndex">
                    <tr
                      class="player-row"
                      :class="[
                        pair.scoreboard?.teamId === 1 ? 'player-row--blue' : pair.scoreboard?.teamId === 2 ? 'player-row--red' : '',
                        { 'player-row--expanded': expandedPlayers[pair.playerIndex] },
                      ]"
                      @click="togglePlayerExpand(pair.playerIndex)"
                    >
                      <td class="mono font-bold">
                        {{ getPlayerName(pair) || `Player ${pair.playerIndex}` }}
                        <span class="text-muted text-xs font-normal">({{ pair.playerIndex }})</span>
                      </td>
                      <td class="mono text-muted">{{ pair.runtime?.playerId ?? pair.scoreboard?.playerId ?? "--" }}</td>
                      <td>
                        <span
                          v-if="pair.scoreboard?.teamId != null"
                          class="badge"
                          :class="pair.scoreboard.teamId === 1 ? 'badge--blue' : 'badge--red'"
                        >
                          {{ getTeamChineseName(pair.scoreboard.teamId) || `Team ${pair.scoreboard.teamId}` }}
                        </span>
                        <span v-else class="text-muted">-</span>
                      </td>
                      <td>
                        <span class="badge badge--team">Squad {{ pair.scoreboard?.squadId ?? "--" }}</span>
                      </td>
                      <td>
                        <div class="flex-inline gap-4">
                          <span
                            class="player-status-dot"
                            :class="pair.runtime?.stale ? 'player-status-dot--stale' : 'player-status-dot--live'"
                            :title="pair.runtime?.stale ? '数据已过期' : '数据在线'"
                          ></span>
                          <span v-if="pair.scoreboard?.isCommander" class="badge badge--gold">指挥</span>
                          <span v-if="pair.scoreboard?.isAdmin" class="badge badge--admin">Admin</span>
                        </div>
                      </td>
                      <td class="mono text-center font-bold text-green-glow">{{ pair.scoreboard?.kills ?? 0 }}</td>
                      <td class="mono text-center text-red-soft">{{ pair.scoreboard?.deaths ?? 0 }}</td>
                      <td class="mono text-center">{{ pair.scoreboard?.woundeds ?? 0 }}</td>
                      <td class="mono text-center text-muted">{{ pair.scoreboard?.lives ?? 0 }}</td>
                      <td class="mono text-center">{{ pair.scoreboard?.teamworkScore ?? 0 }}</td>
                      <td class="mono text-center">{{ pair.scoreboard?.objectiveScore ?? 0 }}</td>
                      <td class="mono text-center">{{ pair.scoreboard?.combatScore ?? 0 }}</td>
                      <td class="text-right" @click.stop>
                        <button
                          type="button"
                          class="btn btn-secondary btn-sm table-expand-btn"
                          @click="togglePlayerExpand(pair.playerIndex)"
                        >
                          {{ expandedPlayers[pair.playerIndex] ? "收起" : "展开" }}
                        </button>
                      </td>
                    </tr>

                    <tr v-if="expandedPlayers[pair.playerIndex]" class="detail-row" @click.stop>
                      <td colspan="13">
                        <div class="table-expanded-content">
                          <div class="expanded-grid">
                            <div class="grid-card">
                              <h5>基础信息</h5>
                              <ul>
                                <li><span>Player Index:</span> <strong class="mono">{{ pair.playerIndex }}</strong></li>
                                <li><span>Player ID:</span> <strong class="mono">{{ pair.runtime?.playerId ?? pair.scoreboard?.playerId ?? "--" }}</strong></li>
                                <li><span>Player Name:</span> <strong class="mono">{{ getPlayerName(pair) || "--" }}</strong></li>
                                <li><span>Player GUID:</span> <strong class="mono">{{ rawPlayerGuid(pair) }}</strong></li>
                                <li><span>Team:</span> <strong class="mono">{{ pair.scoreboard?.teamId ?? "--" }}</strong></li>
                                <li><span>Squad:</span> <strong class="mono">{{ pair.scoreboard?.squadId ?? "--" }}</strong></li>
                                <li><span>Commander:</span> <strong class="mono">{{ boolText(pair.scoreboard?.isCommander) }}</strong></li>
                                <li><span>Admin:</span> <strong class="mono">{{ boolText(pair.scoreboard?.isAdmin) }}</strong></li>
                                <li><span>FireTeam:</span> <strong class="mono">{{ pair.scoreboard?.fireTeamIndex ?? "--" }}/{{ pair.scoreboard?.fireTeamPosition ?? "--" }}</strong></li>
                              </ul>
                            </div>

                            <div class="grid-card">
                              <h5>运行时信息</h5>
                              <ul>
                                <li><span>Position:</span> <strong class="mono">{{ formatVector(pair.runtime?.position) }}</strong></li>
                                <li><span>Yaw:</span> <strong class="mono">{{ pair.runtime?.yaw ?? "--" }}</strong></li>
                                <li><span>Observed At:</span> <strong class="mono">{{ formatDateTime(pair.runtime?.observedAt) }}</strong></li>
                                <li><span>Stale:</span> <strong class="mono">{{ boolText(pair.runtime?.stale) }}</strong></li>
                                <li><span>Combat Info:</span> <strong class="mono">{{ pair.runtime?.combatInfo || "--" }}</strong></li>
                              </ul>
                            </div>

                            <div class="grid-card">
                              <h5>计分板信息</h5>
                              <ul>
                                <li><span>Ping:</span> <strong class="mono">{{ pair.scoreboard?.ping != null ? `${pair.scoreboard.ping} ms` : "--" }}</strong></li>
                                <li><span>Kills:</span> <strong class="mono">{{ pair.scoreboard?.kills ?? 0 }}</strong></li>
                                <li><span>Deaths:</span> <strong class="mono">{{ pair.scoreboard?.deaths ?? 0 }}</strong></li>
                                <li><span>Woundeds:</span> <strong class="mono">{{ pair.scoreboard?.woundeds ?? 0 }}</strong></li>
                                <li><span>Wounds:</span> <strong class="mono">{{ pair.scoreboard?.wounds ?? 0 }}</strong></li>
                                <li><span>TeamKills:</span> <strong class="mono">{{ pair.scoreboard?.teamKills ?? 0 }}</strong></li>
                                <li><span>Heal Points:</span> <strong class="mono">{{ pair.scoreboard?.healPoints ?? 0 }}</strong></li>
                                <li><span>Revived Points:</span> <strong class="mono">{{ pair.scoreboard?.revivedPoints ?? 0 }}</strong></li>
                                <li><span>Teamwork:</span> <strong class="mono">{{ pair.scoreboard?.teamworkScore ?? 0 }}</strong></li>
                                <li><span>Objective:</span> <strong class="mono">{{ pair.scoreboard?.objectiveScore ?? 0 }}</strong></li>
                                <li><span>Combat:</span> <strong class="mono">{{ pair.scoreboard?.combatScore ?? 0 }}</strong></li>
                              </ul>
                            </div>
                          </div>

                          <details v-if="showRaw" class="player-json-details">
                            <summary>行原始 JSON</summary>
                            <pre class="json-block">{{ formatPlayerPairJson(pair) }}</pre>
                          </details>
                        </div>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </div>

          <div v-else class="empty-list-state">
            <p>当前没有可展示的玩家快照。</p>
          </div>
        </div>
      </section>

      <aside class="dashboard-col raw-panel">
        <header class="panel-header-wrapper">
          <div class="panel-header-top">
            <h2>最近一次原始数据</h2>
            <div class="header-controls">
              <span class="raw-pill">{{ rawDataStatusLabel }}</span>
            </div>
          </div>
        </header>

        <div class="raw-data-panel">
          <div class="raw-meta-row">
            <span><strong>Revision:</strong> {{ rawData?.revision ?? "--" }}</span>
            <span><strong>Updated:</strong> {{ formatDateTime(rawData?.updatedAt) }}</span>
            <span><strong>Hash:</strong> {{ rawData?.rawLineHash || "--" }}</span>
          </div>

          <details open class="raw-accordion">
            <summary>
              <span>完整快照</span>
              <button type="button" class="btn btn-secondary copy-btn" @click.stop="copyToClipboard(fullRawSnapshotBlock, 'full')">
                {{ copiedBlock === 'full' ? '已复制' : '复制' }}
              </button>
            </summary>
            <pre class="raw-code-block">{{ fullRawSnapshotBlock }}</pre>
          </details>

          <details open class="raw-accordion">
            <summary>
              <span>运行时原始数据</span>
              <button type="button" class="btn btn-secondary copy-btn" @click.stop="copyToClipboard(runtimeRawBlock, 'runtime')">
                {{ copiedBlock === 'runtime' ? '已复制' : '复制' }}
              </button>
            </summary>
            <pre class="raw-code-block">{{ runtimeRawBlock }}</pre>
          </details>

          <details open class="raw-accordion">
            <summary>
              <span>计分板原始数据</span>
              <button type="button" class="btn btn-secondary copy-btn" @click.stop="copyToClipboard(scoreboardRawBlock, 'scoreboard')">
                {{ copiedBlock === 'scoreboard' ? '已复制' : '复制' }}
              </button>
            </summary>
            <pre class="raw-code-block">{{ scoreboardRawBlock }}</pre>
          </details>

          <details class="raw-accordion">
            <summary>
              <span>场景原始数据</span>
              <button type="button" class="btn btn-secondary copy-btn" @click.stop="copyToClipboard(sceneRawBlock, 'scene')">
                {{ copiedBlock === 'scene' ? '已复制' : '复制' }}
              </button>
            </summary>
            <pre class="raw-code-block">{{ sceneRawBlock }}</pre>
          </details>
        </div>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from "vue";
import {
  type BzssCorePlayerInfoResponse,
  type BzssCoreRawDataResponse,
  type BzssCoreRuntimePlayerInfo,
  type BzssCoreScoreboardPlayerInfo,
} from "../app/bzssCoreApi";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import { useSquadStore } from "../stores/squad.store";
import { useServerStore } from "../stores/server.store";
import { usePlayerStore } from "../stores/player.store";
import { useBzssCoreStore } from "../stores/bzss-core.store";
import { getChineseNameFromTeamName } from "../shared/faction-assets/faction-data";

type PlayerPair = {
  playerIndex: number | string;
  runtime: BzssCoreRuntimePlayerInfo | null;
  scoreboard: BzssCoreScoreboardPlayerInfo | null;
};

const bzssCoreStore = useBzssCoreStore();
const squadStore = useSquadStore();
const serverStore = useServerStore();
const playerStore = usePlayerStore();

const payload = computed(() => bzssCoreStore.snapshot);
const rawData = computed(() => bzssCoreStore.rawData);
const loading = computed(() => bzssCoreStore.loading);
const rawLoading = computed(() => bzssCoreStore.rawLoading);
const error = computed(() => bzssCoreStore.error);
const rawError = computed(() => bzssCoreStore.rawError);

const query = ref("");
const showRaw = ref(false);
const copiedBlock = ref<string | null>(null);
const sortKey = ref<keyof BzssCoreScoreboardPlayerInfo | "playerIndex" | "playerId">("playerIndex");
const sortOrder = ref<"asc" | "desc">("asc");
const expandedPlayers = ref<Record<string | number, boolean>>({});

function getPlayerName(pair: PlayerPair) {
  const playerId = pair.runtime?.playerId ?? pair.scoreboard?.playerId;
  if (playerId != null) {
    const player = playerStore.byPlayerID[playerId];
    if (player?.name) return player.name;
  }
  return "";
}

const teamNames = computed(() => {
  let team1 = "";
  let team2 = "";

  const squadTeam1 = squadStore.list.find((s) => s.teamID === 1);
  if (squadTeam1?.teamName) team1 = squadTeam1.teamName;
  const squadTeam2 = squadStore.list.find((s) => s.teamID === 2);
  if (squadTeam2?.teamName) team2 = squadTeam2.teamName;

  const snapshotTeams = serverStore.snapshot?.matchState?.teams;
  if (Array.isArray(snapshotTeams)) {
    const t1 = snapshotTeams.find((t: any) => t.teamId === 1 || t.teamID === 1);
    const t2 = snapshotTeams.find((t: any) => t.teamId === 2 || t.teamID === 2);
    if (t1?.teamName) team1 = t1.teamName;
    if (t2?.teamName) team2 = t2.teamName;
  }

  const webStatus = serverStore.snapshot?.webStatus;
  if (webStatus) {
    if (webStatus.team1Name) team1 = webStatus.team1Name;
    if (webStatus.team2Name) team2 = webStatus.team2Name;
  }

  return {
    t1Raw: team1 || "Team 1",
    t2Raw: team2 || "Team 2",
  };
});

function getTeamChineseName(teamId: number) {
  if (teamId === 1) return getChineseNameFromTeamName(teamNames.value.t1Raw);
  if (teamId === 2) return getChineseNameFromTeamName(teamNames.value.t2Raw);
  return "";
}

function togglePlayerExpand(playerIndex: string | number) {
  expandedPlayers.value[playerIndex] = !expandedPlayers.value[playerIndex];
}

function handleSort(key: "playerIndex" | "playerId" | keyof BzssCoreScoreboardPlayerInfo) {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
    return;
  }
  sortKey.value = key;
  sortOrder.value = "desc";
}

const runtimePlayers = computed(() => payload.value?.runtimePlayers ?? []);
const scoreboardPlayers = computed(() => payload.value?.scoreboardPlayers ?? []);

const totalSceneCount = computed(() => {
  return (payload.value?.captureZones?.length ?? 0) + (payload.value?.fobs?.length ?? 0) + (payload.value?.mainZones?.length ?? 0);
});

const playerPairs = computed<PlayerPair[]>(() => {
  const map = new Map<string, PlayerPair>();
  const addPlayer = (player: BzssCoreRuntimePlayerInfo | BzssCoreScoreboardPlayerInfo | undefined, side: "runtime" | "scoreboard") => {
    if (!player) return;
    const key = String(player.playerIndex ?? player.playerId ?? "");
    if (!key) return;
    const current = map.get(key) ?? {
      playerIndex: player.playerIndex ?? player.playerId ?? key,
      runtime: null,
      scoreboard: null,
    };
    if (side === "runtime") current.runtime = player as BzssCoreRuntimePlayerInfo;
    if (side === "scoreboard") current.scoreboard = player as BzssCoreScoreboardPlayerInfo;
    map.set(key, current);
  };

  runtimePlayers.value.forEach((player) => addPlayer(player, "runtime"));
  scoreboardPlayers.value.forEach((player) => addPlayer(player, "scoreboard"));
  return [...map.values()].sort((a, b) => Number(a.playerIndex) - Number(b.playerIndex));
});

const filteredPairs = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return playerPairs.value;
  return playerPairs.value.filter((pair) => {
    const values = [
      pair.playerIndex,
      pair.runtime?.playerId,
      pair.runtime?.combatInfo,
      pair.scoreboard?.playerId,
      pair.scoreboard?.teamId,
      pair.scoreboard?.squadId,
      getPlayerName(pair),
      rawPlayerGuid(pair),
    ];
    return values.some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
});

const sortedFilteredPairs = computed(() => {
  const list = [...filteredPairs.value];
  const order = sortOrder.value === "asc" ? 1 : -1;
  const key = sortKey.value;

  list.sort((a, b) => {
    let valA: number | string = 0;
    let valB: number | string = 0;

    if (key === "playerIndex") {
      valA = Number(a.playerIndex);
      valB = Number(b.playerIndex);
    } else if (key === "playerId") {
      valA = a.runtime?.playerId ?? a.scoreboard?.playerId ?? 999999;
      valB = b.runtime?.playerId ?? b.scoreboard?.playerId ?? 999999;
    } else if (key === "teamId") {
      valA = a.scoreboard?.teamId ?? 999;
      valB = b.scoreboard?.teamId ?? 999;
    } else if (key === "squadId") {
      valA = a.scoreboard?.squadId ?? 999;
      valB = b.scoreboard?.squadId ?? 999;
    } else {
      valA = (a.scoreboard as any)?.[key] ?? 0;
      valB = (b.scoreboard as any)?.[key] ?? 0;
    }

    if (valA < valB) return -1 * order;
    if (valA > valB) return 1 * order;
    return 0;
  });

  return list;
});

const fullRawSnapshotBlock = computed(() => JSON.stringify(rawData.value ?? {}, null, 2));
const runtimeRawBlock = computed(() => JSON.stringify(runtimePlayers.value, null, 2));
const scoreboardRawBlock = computed(() => JSON.stringify(scoreboardPlayers.value, null, 2));
const sceneRawBlock = computed(() =>
  JSON.stringify(
    {
      captureZones: payload.value?.captureZones ?? [],
      fobs: payload.value?.fobs ?? [],
      mainZones: payload.value?.mainZones ?? [],
      explosions: payload.value?.explosions ?? [],
    },
    null,
    2,
  ),
);

const rawDataStatusLabel = computed(() => {
  const data = rawData.value;
  if (!data) return "尚未获取原始数据";
  if (data.lastError) return `原始数据错误: ${data.lastError}`;
  return `更新于 ${formatDateTime(data.updatedAt)}，完整原始快照已同步`;
});

const statusLabel = computed(() => {
  const status = String(payload.value?.status ?? "").trim();
  if (status === "ready") return "正常";
  if (status === "error") return "失败";
  if (status === "unavailable") return "不可用";
  return "空闲";
});

const statusColorClass = computed(() => {
  const status = String(payload.value?.status ?? "").trim();
  if (status === "ready") return "text-success";
  if (status === "error") return "text-danger";
  return "text-warning";
});

const statusDetail = computed(() => {
  const state = payload.value?.state;
  if (!state) return "无运行时状态";
  if (state.lastError) return `错误: ${state.lastError}`;
  if (state.updatedAt) return `同步时间: ${formatDateTime(state.updatedAt)}`;
  return "等待数据刷新";
});

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatVector(value?: BzssCoreRuntimePlayerInfo["position"]) {
  if (!value) return "--";
  const x = value.x != null ? value.x.toFixed(1) : "--";
  const y = value.y != null ? value.y.toFixed(1) : "--";
  const z = value.z != null ? value.z.toFixed(1) : "--";
  return `X:${x}, Y:${y}, Z:${z}`;
}

function formatPlayerPairJson(pair: PlayerPair) {
  return JSON.stringify(
    {
      runtime: pair.runtime ?? null,
      scoreboard: pair.scoreboard ?? null,
    },
    null,
    2,
  );
}

function rawPlayerGuid(pair: PlayerPair) {
  return (
    (pair.runtime as unknown as { playerGuid?: string })?.playerGuid ??
    (pair.scoreboard as unknown as { playerGuid?: string })?.playerGuid ??
    "--"
  );
}

function boolText(value: boolean | null | undefined) {
  if (value === true) return "是";
  if (value === false) return "否";
  return "--";
}

async function copyToClipboard(text: string, blockName: string) {
  try {
    await navigator.clipboard.writeText(text);
    copiedBlock.value = blockName;
    window.setTimeout(() => {
      if (copiedBlock.value === blockName) copiedBlock.value = null;
    }, 2000);
  } catch {
    // ignore clipboard failures
  }
}

let refreshTimer: number | null = null;

async function fetchData() {
  await bzssCoreStore.fetchSnapshot();
}

async function fetchRawData() {
  await bzssCoreStore.fetchRaw();
}

function clearRefresh() {
  if (refreshTimer != null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleRefresh() {
  clearRefresh();
  refreshTimer = window.setTimeout(async () => {
    if (canAutoRefreshNow() && !bzssCoreStore.streamActive) {
      await fetchData();
      await fetchRawData();
    }
    scheduleRefresh();
  }, bzssCoreStore.streamActive ? 1500 : 1000);
}

function startStreamIfNeeded() {
  if (!bzssCoreStore.streamActive) {
    bzssCoreStore.startStream();
  }
}

function stopStreamIfNeeded() {
  if (bzssCoreStore.streamActive) {
    bzssCoreStore.stopStream();
  }
}

onMounted(async () => {
  await fetchData();
  await fetchRawData();
  startStreamIfNeeded();
  scheduleRefresh();
});

onActivated(() => {
  startStreamIfNeeded();
  scheduleRefresh();
});

onDeactivated(() => {
  stopStreamIfNeeded();
  clearRefresh();
});

onBeforeUnmount(() => {
  stopStreamIfNeeded();
  clearRefresh();
});
</script>

<style scoped>
.bzss-page {
  position: relative;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  overflow: hidden;
  background: var(--color-bg-page);
}

.page-hero {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-border-soft);
}

.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.title-row h1 {
  font-size: 18px;
  font-weight: 800;
  margin: 0;
  background: linear-gradient(135deg, var(--color-text-primary) 30%, var(--color-brand-primary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-subtitle {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.hero-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.stream-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-soft);
}

.stream-badge--active {
  color: var(--color-status-success);
  border-color: rgba(0, 200, 120, 0.35);
  background: rgba(0, 200, 120, 0.08);
}

.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 0 currentColor;
  animation: pulse 1.8s infinite;
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(0, 180, 120, 0.45); }
  70% { box-shadow: 0 0 0 8px rgba(0, 180, 120, 0); }
  100% { box-shadow: 0 0 0 0 rgba(0, 180, 120, 0); }
}

.status-ribbon {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.12);
}

.status-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}

.status-separator {
  color: var(--color-text-muted);
}

.status-dot-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
}

.status-dot-indicator.ready { background: var(--color-status-success); }
.status-dot-indicator.error { background: var(--color-status-danger); }
.status-dot-indicator.unavailable { background: var(--color-status-warning); }
.status-dot-indicator.idle { background: var(--color-text-muted); }

.dashboard-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr);
  gap: 12px;
}

.dashboard-col {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.08);
}

.panel-header-wrapper {
  flex-shrink: 0;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-soft);
}

.panel-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.panel-header-top h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
}

.search-input {
  min-width: 220px;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  outline: none;
}

.clear-search {
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  cursor: pointer;
}

.toggle-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-secondary);
  user-select: none;
}

.toggle-switch input {
  accent-color: var(--color-brand-primary);
}

.player-list-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.table-view-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.table-responsive {
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
}

.player-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.player-table th,
.player-table td {
  padding: 10px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  white-space: nowrap;
}

.player-table th {
  position: sticky;
  top: 0;
  background: rgba(0, 0, 0, 0.3);
  text-align: left;
  font-weight: 700;
}

.player-table th.sortable {
  cursor: pointer;
}

.player-row {
  cursor: pointer;
  transition: background 0.2s ease;
}

.player-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.player-row--blue {
  box-shadow: inset 3px 0 0 rgba(60, 130, 255, 0.9);
}

.player-row--red {
  box-shadow: inset 3px 0 0 rgba(255, 80, 80, 0.9);
}

.player-row--expanded {
  background: rgba(255, 255, 255, 0.03);
}

.table-expand-btn {
  min-width: 72px;
}

.detail-row td {
  padding: 12px 8px 14px;
  background: rgba(255, 255, 255, 0.02);
}

.table-expanded-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.expanded-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.grid-card {
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.15);
  padding: 10px;
}

.grid-card h5 {
  margin: 0 0 8px;
  font-size: 12px;
}

.grid-card ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 6px;
}

.grid-card li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.player-json-details summary {
  cursor: pointer;
  user-select: none;
  font-size: 12px;
}

.json-block,
.raw-code-block {
  margin: 8px 0 0;
  padding: 10px;
  border-radius: 8px;
  overflow: auto;
  font-size: 11px;
  line-height: 1.5;
  background: rgba(0, 0, 0, 0.35);
  color: var(--color-text-primary);
}

.raw-panel {
  min-width: 0;
}

.raw-data-panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.raw-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-soft);
  font-size: 11px;
  color: var(--color-text-muted);
}

.raw-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-soft);
  background: rgba(0, 0, 0, 0.16);
}

.raw-meta-row strong {
  color: var(--color-text-primary);
}

.raw-accordion {
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.12);
}

.raw-accordion summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  font-weight: 700;
}

.raw-accordion summary::-webkit-details-marker {
  display: none;
}

.copy-btn {
  height: 24px;
  padding: 0 8px;
  font-size: 10px;
}

.empty-list-state {
  text-align: center;
  padding: 24px 10px;
  color: var(--color-text-muted);
  border: 1px dashed var(--color-border-soft);
  border-radius: 10px;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-right: 6px;
  vertical-align: middle;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.fade-in {
  animation: fadeIn 0.35s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--control-height-md, 34px);
  padding: 0 16px;
  border-radius: var(--control-radius, 10px);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid transparent;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
}

.btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.25);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  height: var(--control-height-sm, 30px);
  padding: 0 10px;
  font-size: 12px;
}

.error-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 80, 80, 0.35);
  background: rgba(255, 80, 80, 0.08);
  color: var(--color-text-primary);
}

.error-banner--soft {
  border-color: rgba(255, 193, 7, 0.35);
  background: rgba(255, 193, 7, 0.08);
}

.warning-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: currentColor;
  color: #000;
  font-size: 12px;
  font-weight: 800;
}

.error-content {
  font-size: 12px;
}

.text-muted {
  color: var(--color-text-muted) !important;
}

.text-danger {
  color: var(--color-status-danger) !important;
}

.text-success {
  color: var(--color-status-success) !important;
}

.text-warning {
  color: var(--color-status-warning) !important;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.flex-inline {
  display: inline-flex;
  align-items: center;
}

.gap-4 {
  gap: 4px;
}

.font-bold {
  font-weight: 700;
}

.text-center {
  text-align: center;
}

.text-right {
  text-align: right;
}

.text-green-glow {
  color: var(--color-status-success);
}

.text-red-soft {
  color: var(--color-status-danger);
}

.player-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.player-status-dot--live {
  background: var(--color-status-success);
}

.player-status-dot--stale {
  background: var(--color-status-warning);
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid transparent;
}

.badge--blue {
  background: rgba(50, 120, 255, 0.14);
  border-color: rgba(50, 120, 255, 0.35);
  color: #b8d3ff;
}

.badge--red {
  background: rgba(255, 80, 80, 0.14);
  border-color: rgba(255, 80, 80, 0.35);
  color: #ffb6b6;
}

.badge--team {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--color-border-soft);
  color: var(--color-text-secondary);
}

.badge--gold {
  background: rgba(255, 193, 7, 0.14);
  border-color: rgba(255, 193, 7, 0.35);
  color: #ffe08a;
}

.badge--admin {
  background: rgba(0, 200, 255, 0.14);
  border-color: rgba(0, 200, 255, 0.35);
  color: #a8ecff;
}

@media (max-width: 1200px) {
  .dashboard-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .page-hero,
  .panel-header-top,
  .status-ribbon {
    align-items: flex-start;
  }

  .player-table {
    min-width: 980px;
  }

  .expanded-grid {
    grid-template-columns: 1fr;
  }

  .search-input {
    min-width: 180px;
  }
}
</style>
