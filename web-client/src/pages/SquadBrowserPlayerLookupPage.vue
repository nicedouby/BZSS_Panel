<template>
  <section class="lookup-page">
    <!-- Main Page Header -->
    <header class="lookup-header">
      <div>
        <p class="eyebrow">PLAYER INTELLIGENCE</p>
        <h1>查成分</h1>
        <p class="subtitle">输入玩家名称检索本地数据库，或使用 Steam64 直接查询 SquadBrowser 档案与最近游玩记录。</p>
      </div>
      <a class="source-link" :href="result?.sourceUrl || 'https://squadbrowser.app/players'" target="_blank" rel="noreferrer">
        <span>打开 SquadBrowser</span>
        <span class="arrow">↗</span>
      </a>
    </header>

    <!-- Quick Navigation to Related Player Moderation Features -->
    <nav class="related-features-nav" aria-label="关联玩家管理功能">
      <span class="nav-label">关联功能：</span>
      <div class="pill-group">
        <RouterLink to="/black-edge-privilege" class="feature-pill">
          <span class="pill-icon">🔑</span>
          <span>黑奴跳边 CDK</span>
        </RouterLink>
        <RouterLink to="/player-session-records" class="feature-pill">
          <span class="pill-icon">🕛</span>
          <span>进出服记录</span>
        </RouterLink>
        <RouterLink to="/squad-management" class="feature-pill">
          <span class="pill-icon">💻</span>
          <span>小队管理</span>
        </RouterLink>
        <RouterLink to="/plugins/group-report" class="feature-pill">
          <span class="pill-icon">🚩</span>
          <span>组队举报</span>
        </RouterLink>
        <RouterLink to="/squad-rule-chain" class="feature-pill">
          <span class="pill-icon">🔗</span>
          <span>建队规则链</span>
        </RouterLink>
        <RouterLink to="/plugins/squad-leader-impeachment" class="feature-pill">
          <span class="pill-icon">⚖️</span>
          <span>弹劾队长</span>
        </RouterLink>
        <RouterLink to="/plugins/panel-ban" class="feature-pill">
          <span class="pill-icon">🚫</span>
          <span>面板封禁</span>
        </RouterLink>
        <RouterLink to="/player-database" class="feature-pill">
          <span class="pill-icon">🗄️</span>
          <span>玩家数据库</span>
        </RouterLink>
      </div>
    </nav>

    <!-- Search Form -->
    <form class="lookup-form" @submit.prevent="lookup">
      <div class="form-header">
        <label for="player-query">玩家名称或 Steam64</label>
        <span v-if="steam64Valid" class="valid-badge">
          {{ /^\d{17}$/.test(queryInput.trim()) ? "✓ Steam64 已就绪" : "✓ 已选择数据库玩家" }}
        </span>
      </div>

      <div class="form-row search-row">
        <div ref="queryBoxRef" class="query-box">
          <div class="input-wrapper">
            <span class="search-icon">🔍</span>
            <input
              id="player-query"
              v-model.trim="queryInput"
              inputmode="search"
              autocomplete="off"
              placeholder="输入玩家名称自动联想，或直接输入 17 位 Steam64"
              :disabled="loading"
              aria-autocomplete="list"
              aria-controls="player-suggestions"
              :aria-expanded="suggestionPanelVisible"
              :aria-activedescendant="activeSuggestionId"
              @input="onQueryInput"
              @focus="onSearchFocus"
              @keydown="onSearchKeydown"
            />
            <button
              v-if="queryInput"
              type="button"
              class="clear-btn"
              title="清空"
              @click="clearInput"
            >
              ✕
            </button>
          </div>

          <!-- Autocomplete Dropdown -->
          <div
            v-if="suggestionPanelVisible"
            id="player-suggestions"
            class="suggestions"
            role="listbox"
            aria-label="数据库玩家候选"
          >
            <div v-if="suggestionsLoading" class="suggestion-state" role="status">
              <span class="spin-icon">↻</span>
              <span>正在检索玩家数据库…</span>
            </div>
            <template v-else>
              <button
                v-for="(candidate, index) in suggestions"
                :id="`player-suggestion-${index}`"
                :key="candidate.id"
                type="button"
                :class="['suggestion', { active: index === activeSuggestionIndex }]"
                role="option"
                :aria-selected="index === activeSuggestionIndex"
                @mouseenter="activeSuggestionIndex = index"
                @click="selectPlayer(candidate)"
              >
                <img
                  v-if="candidate.avatar"
                  class="suggestion-avatar suggestion-avatar-image"
                  :src="candidate.avatar"
                  alt=""
                  loading="lazy"
                />
                <span v-else class="suggestion-avatar">
                  {{ String(candidate.name || "?").slice(0, 1).toUpperCase() }}
                </span>
                <span class="suggestion-main">
                  <strong>{{ candidate.name || "未命名玩家" }}</strong>
                  <small>
                    <code>{{ candidate.steam64 || "无 Steam64" }}</code>
                    <span v-if="candidate.eos" class="eos-tag"> · EOS: {{ candidate.eos }}</span>
                  </small>
                </span>
                <span class="suggestion-time">{{ formatDate(candidate.updatedAt) }}</span>
              </button>
            </template>
            <div v-if="!suggestionsLoading && suggestionsError" class="suggestion-state error-inline" role="status">
              {{ suggestionsError }}
            </div>
            <div
              v-else-if="!suggestionsLoading && searchedName === queryInput.trim() && !suggestions.length"
              class="suggestion-state"
              role="status"
            >
              数据库中没有匹配的玩家；也可以直接输入 17 位 Steam64。
            </div>
          </div>
        </div>

        <button
          type="submit"
          class="submit-btn"
          :disabled="loading || !/^\d{17}$/.test(steam64)"
        >
          <span v-if="loading" class="spin-icon">↻</span>
          <span>{{ loading ? "查询中…" : "查询档案" }}</span>
        </button>
      </div>

      <p class="hint">
        💡 支持当前名字和历史曾用名的模糊检索。可用 ↑ ↓ 选择候选、Enter 确认、Esc 关闭；最终档案数据来源于 SquadBrowser。
      </p>
    </form>

    <!-- Error / Loading States -->
    <div v-if="error" class="state error-state">
      <span class="state-icon">⚠️</span>
      <div>
        <strong>查询出错</strong>
        <p>{{ error }}</p>
      </div>
    </div>
    <div v-else-if="loading" class="state loading-state">
      <span class="spin-icon large">↻</span>
      <p>正在连接 SquadBrowser 读取玩家档案与服务器游玩记录…</p>
    </div>

    <!-- Results Display -->
    <template v-if="result && !loading">
      <!-- Profile Card -->
      <section class="profile-card">
        <div class="identity">
          <div class="avatar-wrap">
            <img
              v-if="player.steamAvatar"
              class="avatar avatar-image"
              :src="player.steamAvatar"
              alt="玩家头像"
              loading="lazy"
            />
            <div v-else class="avatar">{{ initials }}</div>
            <span :class="['status-dot', player.isOnline ? 'online' : 'offline']" :title="player.isOnline ? '当前在服' : '离线'"></span>
          </div>

          <div class="identity-info">
            <div class="name-line">
              <h2>{{ player.displayName || "未知玩家" }}</h2>
              <span :class="['status-pill', player.isOnline ? 'online' : 'offline']">
                {{ player.isOnline ? "🟢 在线游玩" : "⚪ 离线" }}
              </span>
            </div>

            <div class="id-row">
              <span class="id-item">
                <span class="id-label">Steam64:</span>
                <code>{{ player.steamId }}</code>
                <button type="button" class="copy-btn" @click="copyText(player.steamId, 'Steam64')">
                  {{ copiedField === 'Steam64' ? "已复制 ✓" : "复制" }}
                </button>
              </span>
              <span class="id-item" v-if="player.eosId">
                <span class="id-label">EOS:</span>
                <code>{{ player.eosId }}</code>
                <button type="button" class="copy-btn" @click="copyText(player.eosId, 'EOS')">
                  {{ copiedField === 'EOS' ? "已复制 ✓" : "复制" }}
                </button>
              </span>
            </div>

            <small v-if="result.database?.playerId" class="db-note">
              ✓ 已同步至玩家数据库 · 新增/更新 {{ result.database.savedSessions ?? 0 }} 条游玩记录
            </small>
          </div>
        </div>

        <div class="profile-meta">
          <div class="meta-item">
            <span class="meta-label">📅 首次记录</span>
            <strong class="meta-val">{{ formatDate(player.firstSeen) }}</strong>
          </div>
          <div class="meta-item">
            <span class="meta-label">🕒 最近记录</span>
            <strong class="meta-val">{{ formatDate(player.lastSeen) }}</strong>
          </div>
          <div class="meta-item">
            <span class="meta-label">⚔️ Squad 游戏时长</span>
            <strong class="meta-val highlight">{{ player.squadHours == null ? "—" : `${player.squadHours.toLocaleString()} 小时` }}</strong>
          </div>
        </div>
      </section>

      <!-- 5-Metric Cards Grid -->
      <section class="metric-grid">
        <article v-for="item in metrics" :key="item.label" class="metric-card">
          <div class="metric-header">
            <span class="metric-icon">{{ item.icon }}</span>
            <span class="metric-label">{{ item.label }}</span>
          </div>
          <strong class="metric-value">{{ item.value }}</strong>
        </article>
      </section>

      <!-- Two-Column Server Analytics -->
      <section class="two-column">
        <article class="panel server-card">
          <header>
            <h3>当前 / 主要服务器</h3>
          </header>
          <div v-if="player.currentServer" class="server-highlight">
            <span class="pulse-dot"></span>
            <div class="server-details">
              <strong>{{ cleanServerName(player.currentServer.serverName) }}</strong>
              <div class="server-tags">
                <span class="tag">ID: {{ player.currentServer.serverId }}</span>
                <span class="tag map-tag">🗺️ {{ player.currentServer.currentMap || "地图未知" }}</span>
              </div>
            </div>
          </div>
          <div v-else class="empty-box">当前未在任何 SquadBrowser 监控服务器中上线</div>

          <div v-if="player.topServer" class="top-server-block">
            <span class="block-title">主要游玩服务器</span>
            <strong>{{ cleanServerName(player.topServer.serverName) }}</strong>
            <small>累计游玩 {{ formatPlaytime(player.topServer.playtimeMinutes) }}</small>
          </div>
        </article>

        <article class="panel favorite-servers-card">
          <header>
            <h3>常玩服务器排行</h3>
            <span class="count-badge">{{ player.favoriteServers?.length ?? 0 }} 个</span>
          </header>
          <div v-if="player.favoriteServers?.length" class="server-list">
            <div
              v-for="(server, idx) in player.favoriteServers"
              :key="server.serverId"
              class="server-row"
            >
              <span :class="['rank-badge', `rank-${Number(idx) + 1}`]">{{ Number(idx) + 1 }}</span>
              <div class="server-info">
                <strong>{{ cleanServerName(server.serverName) }}</strong>
                <div class="progress-bar-wrap">
                  <div
                    class="progress-bar"
                    :style="{ width: `${getPlaytimePercent(server.playtimeMinutes)}%` }"
                  ></div>
                </div>
              </div>
              <em class="playtime-text">{{ formatPlaytime(server.playtimeMinutes) }}</em>
            </div>
          </div>
          <div v-else class="empty-box">暂无常玩服务器排行数据</div>
        </article>
      </section>

      <!-- Complete Info Accordion -->
      <details class="panel complete-info" open>
        <summary>
          <div class="summary-title">
            <strong>📋 完整玩家 Raw 资料字段</strong>
            <span class="summary-hint">保留 SquadBrowser 返回的所有原始属性，可折叠</span>
          </div>
          <span class="toggle-icon">▼</span>
        </summary>
        <div class="detail-groups">
          <div class="detail-section">
            <h4>统计数据 (Stats)</h4>
            <div class="detail-grid">
              <div v-for="[key, value] in statEntries" :key="`stat-${key}`" class="detail-item">
                <span>{{ key }}</span>
                <strong>{{ formatDetailValue(value) }}</strong>
              </div>
            </div>
          </div>
          <div class="detail-section">
            <h4>其他资料 (Profile)</h4>
            <div v-if="profileEntries.length" class="detail-grid">
              <div v-for="[key, value] in profileEntries" :key="key" class="detail-item">
                <span>{{ key }}</span>
                <strong>{{ formatDetailValue(value) }}</strong>
              </div>
            </div>
            <div v-else class="empty-box">无额外原始字段</div>
          </div>
        </div>
      </details>

      <!-- Recent Play Session Records Table -->
      <section class="panel records-panel">
        <header>
          <div>
            <h3>最近游玩记录</h3>
            <p>已展示 {{ result.sessions.length }} 条最近会话{{ result.sessionLimit ? `（上游限制 ${result.sessionLimit} 条）` : "" }}</p>
          </div>
          <button class="secondary-btn" type="button" :disabled="loading" @click="lookup">
            <span>刷新记录</span>
          </button>
        </header>

        <div v-if="result.sessions.length" class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>进入时间</th>
                <th>离开时间</th>
                <th>服务器名称</th>
                <th>Server ID</th>
                <th>单次时长</th>
                <th>扩展属性</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="session in result.sessions" :key="session.id">
                <td>
                  <span class="time-cell">{{ formatDate(session.joinedAt) }}</span>
                </td>
                <td>
                  <span v-if="session.leftAt" class="time-cell">{{ formatDate(session.leftAt) }}</span>
                  <span v-else class="active-session-pill">🟢 仍在游玩</span>
                </td>
                <td class="server-cell">
                  <strong>{{ cleanServerName(session.serverName) }}</strong>
                </td>
                <td>
                  <code>{{ session.serverId || "—" }}</code>
                </td>
                <td>
                  <span class="duration-badge">
                    {{ session.durationMinutes == null ? "—" : formatPlaytime(session.durationMinutes) }}
                  </span>
                </td>
                <td>
                  <span v-if="extraSessionFields(session).length" class="session-extra">
                    {{ extraSessionFields(session).map(([k, v]) => `${k}: ${formatDetailValue(v)}`).join(" · ") }}
                  </span>
                  <span v-else class="muted-text">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty-box">未查询到最近的服务器游玩记录</div>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { apiGet } from "../app/apiClient";
import { renderApiError } from "../app/errors";

type LookupResult = {
  sourceUrl: string;
  sessionLimit?: number;
  player: any;
  sessions: Array<any>;
  database?: { playerId?: number; avatar?: string | null; savedSessions?: number } | null;
};

type PlayerCandidate = {
  id: number | string;
  name: string;
  steam64: string;
  eos: string;
  avatar: string;
  updatedAt: string | number | null;
};

const route = useRoute();
const router = useRouter();
const steam64 = ref(String(route.query.steam64 ?? ""));
const queryInput = ref(steam64.value);
const queryBoxRef = ref<HTMLElement | null>(null);
const suggestions = ref<PlayerCandidate[]>([]);
const suggestionsLoading = ref(false);
const suggestionsError = ref("");
const searchedName = ref("");
const activeSuggestionIndex = ref(-1);
let suggestionTimer: ReturnType<typeof setTimeout> | null = null;
let suggestionRequestSerial = 0;
const result = ref<LookupResult | null>(null);
const loading = ref(false);
const error = ref("");
const copiedField = ref("");

const player = computed(() => result.value?.player ?? {});
const initials = computed(() => String(player.value.displayName || "?").trim().slice(0, 1).toUpperCase());
const steam64Valid = computed(() => /^\d{17}$/.test(steam64.value));
const suggestionPanelVisible = computed(() => {
  const value = queryInput.value.trim();
  if (!value || /^\d{17}$/.test(value) || steam64Valid.value) return false;
  return suggestionsLoading.value
    || suggestions.value.length > 0
    || searchedName.value === value
    || Boolean(suggestionsError.value);
});
const activeSuggestionId = computed(() => (
  activeSuggestionIndex.value >= 0 ? `player-suggestion-${activeSuggestionIndex.value}` : undefined
));
const statEntries = computed(() => Object.entries(player.value.stats || {}));
const profileEntries = computed(() => Object.entries(player.value || {}).filter(([key]) => !["steamAvatar", "stats"].includes(key)));

const metrics = computed(() => [
  { icon: "⏱️", label: "总游玩时长", value: formatPlaytime(player.value.stats?.totalPlaytimeMinutes) },
  { icon: "🏆", label: "总场次", value: number(player.value.stats?.totalSessions) },
  { icon: "📈", label: "近 7 天场次", value: number(player.value.stats?.sessionsLast7Days) },
  { icon: "🗓️", label: "近 30 天场次", value: number(player.value.stats?.sessionsLast30Days) },
  { icon: "⌛", label: "平均场次时长", value: formatPlaytime(player.value.stats?.avgSessionMinutes) },
]);

const maxFavoritePlaytime = computed(() => {
  const list = player.value.favoriteServers ?? [];
  if (!list.length) return 1;
  return Math.max(...list.map((s: any) => Number(s.playtimeMinutes) || 0), 1);
});

onMounted(() => {
  if (/^\d{17}$/.test(steam64.value)) void lookup();
  document.addEventListener("pointerdown", onDocumentPointerDown);
});

onBeforeUnmount(() => {
  if (suggestionTimer) clearTimeout(suggestionTimer);
  suggestionRequestSerial += 1;
  document.removeEventListener("pointerdown", onDocumentPointerDown);
});

function clearInput() {
  suggestionRequestSerial += 1;
  queryInput.value = "";
  steam64.value = "";
  suggestions.value = [];
  suggestionsLoading.value = false;
  suggestionsError.value = "";
  searchedName.value = "";
  activeSuggestionIndex.value = -1;
  error.value = "";
}

function copyText(text: string, label: string) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    copiedField.value = label;
    setTimeout(() => { copiedField.value = ""; }, 2000);
  }).catch(() => {});
}

function onQueryInput() {
  const value = queryInput.value.trim();
  suggestionRequestSerial += 1;
  steam64.value = /^\d{17}$/.test(value) ? value : "";
  suggestions.value = [];
  suggestionsLoading.value = false;
  suggestionsError.value = "";
  searchedName.value = "";
  activeSuggestionIndex.value = -1;
  if (suggestionTimer) clearTimeout(suggestionTimer);
  if (!value || /^\d{17}$/.test(value)) return;
  const requestSerial = suggestionRequestSerial;
  suggestionTimer = setTimeout(() => void searchPlayers(value, requestSerial), 220);
}

function onSearchFocus() {
  const value = queryInput.value.trim();
  if (!value || /^\d{17}$/.test(value) || steam64Valid.value) return;
  if (searchedName.value !== value && !suggestionsLoading.value) onQueryInput();
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    suggestions.value = [];
    searchedName.value = "";
    activeSuggestionIndex.value = -1;
    return;
  }
  if (!suggestionPanelVisible.value) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!suggestions.value.length) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    const current = activeSuggestionIndex.value;
    activeSuggestionIndex.value = current < 0
      ? (step > 0 ? 0 : suggestions.value.length - 1)
      : (current + step + suggestions.value.length) % suggestions.value.length;
    return;
  }
  if (event.key === "Enter" && suggestions.value.length) {
    event.preventDefault();
    selectPlayer(suggestions.value[Math.max(0, activeSuggestionIndex.value)]);
  }
}

function onDocumentPointerDown(event: PointerEvent) {
  if (queryBoxRef.value?.contains(event.target as Node)) return;
  suggestions.value = [];
  searchedName.value = "";
  activeSuggestionIndex.value = -1;
}

async function searchPlayers(value: string, requestSerial: number) {
  suggestionsLoading.value = true;
  suggestionsError.value = "";
  try {
    const response = await apiGet<any>(`/api/player-database/list?q=${encodeURIComponent(value)}&limit=12&offset=0&sort=name_asc`, {}, { timeoutMs: 5_000 });
    if (requestSerial !== suggestionRequestSerial || queryInput.value.trim() !== value) return;
    const rows = Array.isArray(response)
      ? response
      : (Array.isArray(response?.players) ? response.players : (Array.isArray(response?.items) ? response.items : []));
    suggestions.value = rows
      .filter((row: any) => row?.steam64 || row?.steamID || row?.steam_id)
      .slice(0, 12)
      .map((row: any) => ({
        id: row.id ?? row.steam64 ?? row.steamID ?? row.steam_id,
        name: String(row.name ?? row.currentName ?? row.current_name ?? "未命名玩家"),
        steam64: String(row.steam64 ?? row.steamID ?? row.steam_id ?? ""),
        eos: String(row.eos ?? row.eosID ?? row.eos_id ?? ""),
        avatar: String(row.avatar ?? row.steamAvatar ?? row.steam_avatar ?? ""),
        updatedAt: row.updatedAt ?? row.updated_at ?? null,
      }));
    searchedName.value = value;
    activeSuggestionIndex.value = suggestions.value.length ? 0 : -1;
  } catch {
    if (requestSerial !== suggestionRequestSerial || queryInput.value.trim() !== value) return;
    suggestions.value = [];
    searchedName.value = value;
    suggestionsError.value = "玩家数据库检索失败，请稍后重试。";
  } finally {
    if (requestSerial === suggestionRequestSerial) suggestionsLoading.value = false;
  }
}

function selectPlayer(candidate: PlayerCandidate) {
  const id = String(candidate.steam64 ?? "").trim();
  if (!/^\d{17}$/.test(id)) return;
  queryInput.value = candidate.name || id;
  steam64.value = id;
  suggestions.value = [];
  suggestionsError.value = "";
  searchedName.value = "";
  activeSuggestionIndex.value = -1;
  void lookup();
}

async function lookup() {
  if (!/^\d{17}$/.test(steam64.value)) {
    error.value = queryInput.value.trim()
      ? "请先从数据库候选列表中选择玩家，或输入正确的 17 位 Steam64。"
      : "请输入玩家名称或 17 位 Steam64。";
    return;
  }
  loading.value = true; error.value = "";
  try {
    result.value = await apiGet<LookupResult>(`/api/squadbrowser/player?steam64=${encodeURIComponent(steam64.value)}`, {}, { timeoutMs: 15_000 });
    void router.replace({ query: { ...route.query, steam64: steam64.value } }).catch(() => {});
  }
  catch (err) { result.value = null; error.value = renderApiError(err, "查询 SquadBrowser 失败，请稍后重试。"); }
  finally { loading.value = false; }
}

function number(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n.toLocaleString() : "—"; }
function formatPlaytime(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const hrs = Math.floor(n / 60);
  const mins = Math.round(n % 60);
  if (hrs > 0) return `${hrs} 小时 ${mins} 分钟`;
  return `${mins} 分钟`;
}
function getPlaytimePercent(value: unknown) {
  const n = Number(value) || 0;
  return Math.min(100, Math.max(8, Math.round((n / maxFavoritePlaytime.value) * 100)));
}
function formatDate(value: unknown) { if (!value) return "—"; const date = new Date(typeof value === "number" ? value : String(value)); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false }); }
function cleanServerName(value: unknown) { return String(value ?? "未知服务器").replace(/^\s+/, "").replace(/\s+/g, " ").trim() || "未知服务器"; }
function formatDetailValue(value: unknown) { if (value == null || value === "") return "—"; if (typeof value === "object") { try { return JSON.stringify(value); } catch { return String(value); } } return String(value); }
function extraSessionFields(session: any) { const known = new Set(["id", "serverId", "serverName", "joinedAt", "leftAt", "durationMinutes"]); return Object.entries(session || {}).filter(([key]) => !known.has(key)); }
</script>

<style scoped>
.lookup-page {
  max-width: 1480px;
  margin: 0 auto;
  padding: 24px 28px 64px;
  color: #e7eef8;
}

.lookup-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  margin-bottom: 18px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #38bdf8;
  font: 800 11px/1.2 ui-monospace, SFMono-Regular, monospace;
  letter-spacing: 0.18em;
}

.lookup-header h1 {
  margin: 0;
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -0.025em;
  background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.subtitle {
  max-width: 720px;
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 13.5px;
  line-height: 1.5;
}

.source-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid rgba(56, 189, 248, 0.28);
  border-radius: 999px;
  color: #38bdf8;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  background: rgba(14, 165, 233, 0.08);
  transition: all 0.15s ease;
  white-space: nowrap;
}

.source-link:hover {
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(56, 189, 248, 0.45);
  box-shadow: 0 0 16px rgba(56, 189, 248, 0.2);
}

.source-link .arrow {
  font-size: 14px;
}

/* Related Features Nav Strip */
.related-features-nav {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 20px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.75), rgba(11, 18, 32, 0.65));
  backdrop-filter: blur(12px);
  overflow-x: auto;
}

.nav-label {
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
  white-space: nowrap;
}

.pill-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.feature-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(30, 41, 59, 0.6);
  color: #cbd5e1;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.feature-pill:hover {
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(56, 189, 248, 0.35);
  color: #f1f5f9;
  transform: translateY(-1px);
}

.pill-icon {
  font-size: 13px;
}

/* Cards Common Styling */
.lookup-form,
.panel,
.profile-card,
.metric-card {
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: linear-gradient(145deg, rgba(15, 23, 42, 0.85), rgba(11, 18, 32, 0.9));
  border-radius: 16px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
}

/* Form Styles */
.lookup-form {
  padding: 20px 22px;
  margin-bottom: 20px;
}

.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.lookup-form label {
  color: #94a3b8;
  font-size: 13px;
  font-weight: 650;
}

.valid-badge {
  color: #34d399;
  font-size: 12px;
  font-weight: 650;
}

.form-row {
  display: flex;
  gap: 12px;
}

.query-box {
  position: relative;
  flex: 1;
  min-width: 0;
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 14px;
  font-size: 14px;
  color: #64748b;
  pointer-events: none;
}

.input-wrapper input {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 38px 12px 38px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 11px;
  background: #070d17;
  color: #f8fafc;
  font: 14px/1.4 ui-monospace, SFMono-Regular, monospace;
  outline: none;
  transition: all 0.15s ease;
}

.input-wrapper input:focus {
  border-color: #38bdf8;
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.14);
}

.clear-btn {
  position: absolute;
  right: 12px;
  padding: 4px 8px;
  border: 0;
  background: transparent;
  color: #64748b;
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
}

.clear-btn:hover {
  color: #f1f5f9;
}

.submit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 24px;
  border: 0;
  border-radius: 11px;
  background: linear-gradient(135deg, #0284c7, #2563eb);
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(2, 132, 199, 0.25);
  transition: all 0.15s ease;
  white-space: nowrap;
}

.submit-btn:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.submit-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
}

/* Autocomplete Suggestions */
.suggestions {
  position: absolute;
  z-index: 20;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  padding: 6px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  background: #091220;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(16px);
  max-height: 360px;
  overflow-y: auto;
}

.suggestion {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #e2e8f0;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.suggestion:hover,
.suggestion.active {
  background: rgba(56, 189, 248, 0.12);
}

.suggestion-avatar {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: linear-gradient(135deg, #0284c7, #3b82f6);
  color: #fff;
  font-weight: 800;
  font-size: 14px;
  flex: none;
}

.suggestion-avatar-image {
  object-fit: cover;
  background: #111827;
}

.suggestion-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 54px;
  padding: 10px 14px;
  color: #94a3b8;
  font-size: 12.5px;
  text-align: center;
}

.suggestion-state.error-inline {
  color: #fca5a5;
}

.suggestion-main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.suggestion-main strong {
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggestion-main small {
  color: #64748b;
  font-size: 12px;
}

.suggestion-main code {
  color: #38bdf8;
}

.eos-tag {
  color: #94a3b8;
}

.suggestion-time {
  color: #64748b;
  font-size: 11px;
  white-space: nowrap;
}

.hint {
  margin: 12px 0 0;
  color: #64748b;
  font-size: 12.5px;
}

/* Loading & Error States */
.state {
  padding: 36px 24px;
  text-align: center;
  border: 1px dashed rgba(148, 163, 184, 0.2);
  border-radius: 14px;
  color: #94a3b8;
}

.error-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.06);
  color: #fca5a5;
  text-align: left;
}

.error-state p {
  margin: 4px 0 0;
  font-size: 13px;
  color: #f87171;
}

.state-icon {
  font-size: 24px;
}

.spin-icon {
  display: inline-block;
  animation: spin 1s linear infinite;
}

.spin-icon.large {
  font-size: 28px;
  margin-bottom: 12px;
  color: #38bdf8;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Profile Card */
.profile-card {
  display: flex;
  justify-content: space-between;
  gap: 28px;
  padding: 24px;
  margin-bottom: 18px;
  position: relative;
  overflow: hidden;
}

.profile-card::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: linear-gradient(180deg, #38bdf8, #818cf8);
}

.identity {
  display: flex;
  gap: 18px;
  align-items: flex-start;
  min-width: 0;
}

.avatar-wrap {
  position: relative;
}

.avatar {
  width: 68px;
  height: 68px;
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 18px;
  background: linear-gradient(135deg, #0284c7, #6366f1);
  font-size: 26px;
  font-weight: 850;
  color: #fff;
  box-shadow: 0 8px 24px rgba(2, 132, 199, 0.3);
}

.avatar-image {
  object-fit: cover;
}

.status-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 3px solid #0f172a;
}

.status-dot.online {
  background: #10b981;
  box-shadow: 0 0 10px #10b981;
}

.status-dot.offline {
  background: #64748b;
}

.identity-info {
  min-width: 0;
}

.name-line {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.name-line h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.status-pill {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
}

.status-pill.online {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.status-pill.offline {
  background: rgba(100, 116, 139, 0.15);
  color: #94a3b8;
  border: 1px solid rgba(100, 116, 139, 0.3);
}

.id-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.id-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}

.id-label {
  color: #64748b;
}

.id-item code {
  color: #38bdf8;
  background: rgba(15, 23, 42, 0.6);
  padding: 2px 6px;
  border-radius: 5px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}

.copy-btn {
  border: 0;
  background: rgba(56, 189, 248, 0.1);
  color: #38bdf8;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.copy-btn:hover {
  background: rgba(56, 189, 248, 0.25);
}

.db-note {
  display: block;
  margin-top: 8px;
  color: #34d399;
  font-size: 11.5px;
  font-weight: 600;
}

/* Profile Meta Grid */
.profile-meta {
  display: flex;
  gap: 28px;
  align-items: center;
}

.meta-item {
  display: flex;
  flex-direction: column;
}

.meta-label {
  color: #64748b;
  font-size: 12px;
}

.meta-val {
  margin-top: 4px;
  color: #f1f5f9;
  font-size: 14px;
}

.meta-val.highlight {
  color: #38bdf8;
  font-size: 16px;
  font-weight: 800;
}

/* 5-Metric Cards Grid */
.metric-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}

.metric-card {
  padding: 16px;
}

.metric-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.metric-icon {
  font-size: 16px;
}

.metric-label {
  color: #94a3b8;
  font-size: 12px;
}

.metric-value {
  display: block;
  margin-top: 10px;
  color: #f8fafc;
  font-size: 21px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

/* Two-Column Analytics */
.two-column {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 18px;
}

.panel {
  padding: 20px;
}

.panel header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  padding-bottom: 12px;
  margin-bottom: 16px;
}

.panel h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 750;
  color: #f1f5f9;
}

.count-badge {
  color: #64748b;
  font-size: 12px;
}

.server-highlight {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.pulse-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 5px;
  background: #10b981;
  box-shadow: 0 0 12px #10b981;
}

.server-details strong {
  display: block;
  font-size: 14px;
  line-height: 1.45;
  color: #f8fafc;
}

.server-tags {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.tag {
  padding: 2px 7px;
  border-radius: 5px;
  background: rgba(148, 163, 184, 0.1);
  color: #94a3b8;
  font-size: 11.5px;
}

.map-tag {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.1);
}

.top-server-block {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid rgba(148, 163, 184, 0.1);
}

.block-title {
  display: block;
  font-size: 12px;
  color: #64748b;
}

.top-server-block strong {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  color: #e2e8f0;
}

.top-server-block small {
  display: block;
  color: #38bdf8;
  margin-top: 4px;
  font-size: 12px;
}

/* Server List */
.server-list {
  display: grid;
  gap: 8px;
}

.server-row {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.4);
  transition: background-color 0.12s ease;
}

.server-row:hover {
  background: rgba(56, 189, 248, 0.08);
}

.rank-badge {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: rgba(148, 163, 184, 0.1);
  color: #94a3b8;
  font: 700 12px ui-monospace, SFMono-Regular, monospace;
}

.rank-badge.rank-1 {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
}

.rank-badge.rank-2 {
  background: linear-gradient(135deg, #94a3b8, #64748b);
  color: #fff;
}

.rank-badge.rank-3 {
  background: linear-gradient(135deg, #b45309, #78350f);
  color: #fff;
}

.server-info {
  min-width: 0;
}

.server-info strong {
  display: block;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #e2e8f0;
}

.progress-bar-wrap {
  height: 4px;
  border-radius: 2px;
  background: rgba(148, 163, 184, 0.12);
  margin-top: 4px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #38bdf8, #818cf8);
}

.playtime-text {
  color: #38bdf8;
  font-size: 12px;
  font-style: normal;
  font-weight: 650;
  white-space: nowrap;
}

/* Accordion Details */
.complete-info {
  margin-bottom: 18px;
}

.complete-info summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  list-style: none;
}

.complete-info summary::-webkit-details-marker {
  display: none;
}

.summary-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.summary-title strong {
  font-size: 15px;
}

.summary-hint {
  color: #64748b;
  font-size: 12px;
}

.toggle-icon {
  color: #64748b;
  font-size: 12px;
  transition: transform 0.2s ease;
}

.complete-info[open] .toggle-icon {
  transform: rotate(180deg);
}

.detail-groups {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(148, 163, 184, 0.1);
}

.detail-section h4 {
  margin: 0 0 10px;
  color: #38bdf8;
  font-size: 13px;
  font-weight: 700;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.detail-item {
  padding: 8px 10px;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 8px;
  background: rgba(7, 13, 23, 0.5);
}

.detail-item span {
  display: block;
  color: #64748b;
  font-size: 11px;
}

.detail-item strong {
  display: block;
  margin-top: 3px;
  color: #cbd5e1;
  font-size: 12px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

/* Records Panel */
.secondary-btn {
  padding: 6px 14px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  background: rgba(30, 41, 59, 0.6);
  color: #cbd5e1;
  font-size: 12.5px;
  font-weight: 650;
  cursor: pointer;
  transition: all 0.12s ease;
}

.secondary-btn:hover {
  background: rgba(56, 189, 248, 0.12);
  border-color: rgba(56, 189, 248, 0.3);
  color: #f1f5f9;
}

.table-wrap {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.data-table th,
.data-table td {
  padding: 11px 12px;
  text-align: left;
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
  white-space: nowrap;
}

.data-table th {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.data-table td {
  color: #cbd5e1;
}

.time-cell {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  color: #94a3b8;
}

.active-session-pill {
  color: #34d399;
  font-size: 12px;
  font-weight: 650;
}

.server-cell {
  min-width: 240px;
  max-width: 480px;
  white-space: normal;
  word-break: break-word;
}

.server-cell strong {
  color: #f1f5f9;
}

.duration-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.1);
  color: #38bdf8;
  font-weight: 600;
  font-size: 12px;
}

.session-extra {
  display: block;
  max-width: 360px;
  white-space: normal;
  word-break: break-word;
  color: #64748b;
  font-size: 11.5px;
}

.empty-box {
  padding: 24px;
  color: #64748b;
  text-align: center;
  font-size: 13px;
}

.muted-text {
  color: #475569;
}

/* Responsive Media Queries */
@media (max-width: 1080px) {
  .profile-card,
  .lookup-header {
    flex-direction: column;
    align-items: flex-start;
  }
  .profile-meta {
    width: 100%;
    justify-content: space-between;
  }
  .metric-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 860px) {
  .two-column,
  .detail-groups {
    grid-template-columns: 1fr;
  }
  .lookup-page {
    padding: 16px 16px 40px;
  }
}

@media (max-width: 640px) {
  .metric-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .detail-grid {
    grid-template-columns: 1fr;
  }
  .form-row {
    flex-direction: column;
  }
  .submit-btn {
    height: 42px;
  }
  .profile-meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .suggestion-time,
  .eos-tag {
    display: none;
  }
}
</style>
