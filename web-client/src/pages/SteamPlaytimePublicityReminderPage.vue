<template>
  <section class="page">
    <header class="page-header">
      <div>
        <div class="eyebrow">STEAM PROFILE PUBLICITY</div>
        <h1>督促时长公开</h1>
        <p>管理未公开 Steam 游戏时长提醒。页面只读取本地时长缓存，不会主动请求 Steam API。</p>
      </div>
      <div class="header-actions">
        <span class="updated">{{ loading ? "读取中…" : `更新于 ${lastUpdated}` }}</span>
        <button class="button" :disabled="loading" @click="refreshAll">刷新</button>
      </div>
    </header>

    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="notice" class="banner notice">{{ notice }}</div>

    <section class="hero-grid">
      <article class="control-card" :class="{ disabled: !form.featureEnabled }">
        <div>
          <span class="label">功能状态</span>
          <strong>{{ form.featureEnabled ? "运行中" : "已关闭" }}</strong>
          <p>{{ form.featureEnabled ? "开局 5 分钟后执行小队长警告与未公开玩家广播。" : "不会发送警告或广播；管理页面仍可使用。" }}</p>
        </div>
        <button
          class="power-button"
          :class="form.featureEnabled ? 'danger' : 'primary'"
          :disabled="saving || !pluginLoaded"
          @click="toggleFeature"
        >
          {{ saving ? "保存中…" : form.featureEnabled ? "关闭功能" : "启用功能" }}
        </button>
      </article>

      <article class="metric">
        <span>在线玩家</span>
        <strong>{{ onlinePlayers.length }}</strong>
        <small>来自当前 RCON / Match State</small>
      </article>
      <article class="metric">
        <span>已确认未公开</span>
        <strong>{{ privatePlayers.length }}</strong>
        <small>仅统计已有刷新时间且本地时长为 0</small>
      </article>
      <article class="metric">
        <span>未公开小队长</span>
        <strong>{{ privateLeaders.length }}</strong>
        <small>这些玩家会收到持续提醒</small>
      </article>
    </section>

    <section class="grid two">
      <article class="panel">
        <div class="panel-head">
          <div>
            <h2>运行参数</h2>
            <p>修改后保存即可生效。Steam 判定始终使用本地缓存。</p>
          </div>
          <button class="button primary" :disabled="saving || !pluginLoaded" @click="saveConfig">
            {{ saving ? "保存中…" : "保存配置" }}
          </button>
        </div>

        <div class="form-grid">
          <label>
            <span>开局后启用（秒）</span>
            <input v-model.number="form.startAfterSeconds" type="number" min="0" max="86400">
          </label>
          <label>
            <span>小队长重复警告间隔（秒）</span>
            <input v-model.number="leaderWarningSeconds" type="number" min="1" max="3600">
          </label>
          <label>
            <span>每批广播人数</span>
            <input v-model.number="form.broadcastBatchSize" type="number" min="1" max="20">
          </label>
          <label>
            <span>广播批次间隔（分钟）</span>
            <input v-model.number="broadcastBatchMinutes" type="number" min="1" max="60">
          </label>
          <label>
            <span>完整轮播冷却（分钟）</span>
            <input v-model.number="broadcastCooldownMinutes" type="number" min="1" max="1440">
          </label>
          <label class="wide">
            <span>小队长警告内容</span>
            <textarea v-model="form.warningMessage" rows="4" />
          </label>
          <label class="wide">
            <span>广播标题</span>
            <input v-model="form.broadcastPrefix" type="text">
          </label>
        </div>

        <div class="cache-note">
          <strong>Steam 查询策略：本地缓存模式</strong>
          <p>本插件不会调用 lookupSteamID、refreshPlayer 或 refreshOnline。刚进服、尚未完成本地时长刷新的玩家不会被认定为“未公开”。</p>
        </div>
      </article>

      <article class="panel">
        <div class="panel-head">
          <div>
            <h2>消息预览</h2>
            <p>当前实际警告和广播格式。</p>
          </div>
        </div>

        <div class="preview-block">
          <span>发送给未公开资料的小队长</span>
          <pre>{{ form.warningMessage }}</pre>
        </div>
        <div class="preview-block">
          <span>全服广播 · 每批最多 {{ form.broadcastBatchSize }} 人</span>
          <pre>{{ broadcastPreview }}</pre>
        </div>

        <dl class="status-list">
          <div><dt>插件已加载</dt><dd :class="pluginLoaded ? 'ok' : 'bad'">{{ pluginLoaded ? "是" : "否" }}</dd></div>
          <div><dt>Steam API 额外请求</dt><dd class="ok">0（插件自身）</dd></div>
          <div><dt>小队长缓存复查</dt><dd>{{ leaderWarningSeconds }} 秒</dd></div>
          <div><dt>广播批次间隔</dt><dd>{{ broadcastBatchMinutes }} 分钟</dd></div>
          <div><dt>轮播完成冷却</dt><dd>{{ broadcastCooldownMinutes }} 分钟</dd></div>
        </dl>
      </article>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>当前已确认未公开的玩家</h2>
          <p>这里只展示“存在有效 fetchedAt 且 Steam 时长为 0”的在线玩家。未刷新玩家不会出现在这里。</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>玩家</th><th>阵营</th><th>小队</th><th>身份</th><th>SteamID</th><th>本地刷新时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="player in privatePlayers" :key="player.key">
              <td>{{ player.name }}</td>
              <td>{{ player.teamID || "--" }}</td>
              <td>{{ player.squadID || "--" }}</td>
              <td><span :class="player.isLeader ? 'leader-pill' : 'member-pill'">{{ player.isLeader ? "小队长" : "玩家" }}</span></td>
              <td class="mono">{{ player.steamID }}</td>
              <td>{{ formatFetchedAt(playtimeItems[player.steamID]) }}</td>
            </tr>
            <tr v-if="!privatePlayers.length"><td colspan="6" class="empty">当前没有已确认未公开的在线玩家</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { apiGet, apiPatch } from "../app/apiClient";

const PLUGIN_ID = "plugin.steam-playtime-publicity-reminder";
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const notice = ref("");
const lastUpdated = ref("--");
const pluginEntry = ref<any>(null);
const overview = ref<any>({});
const playtimeItems = ref<Record<string, any>>({});
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const form = reactive({
  featureEnabled: true,
  startAfterSeconds: 300,
  leaderWarningIntervalMs: 10_000,
  broadcastBatchSize: 5,
  broadcastBatchIntervalMs: 120_000,
  broadcastCycleCooldownMs: 600_000,
  warningMessage: "你的steam个人资料尚未公开\n为了其他玩家的游戏体验，请公开你的steam个人资料",
  broadcastPrefix: "当前未公开steam个人资料的玩家有",
});

const pluginLoaded = computed(() => Boolean(pluginEntry.value));
const leaderWarningSeconds = computed({
  get: () => Math.max(1, Math.round(form.leaderWarningIntervalMs / 1000)),
  set: (value: number) => { form.leaderWarningIntervalMs = Math.max(1000, Number(value || 1) * 1000); },
});
const broadcastBatchMinutes = computed({
  get: () => Math.max(1, Math.round(form.broadcastBatchIntervalMs / 60_000)),
  set: (value: number) => { form.broadcastBatchIntervalMs = Math.max(60_000, Number(value || 1) * 60_000); },
});
const broadcastCooldownMinutes = computed({
  get: () => Math.max(1, Math.round(form.broadcastCycleCooldownMs / 60_000)),
  set: (value: number) => { form.broadcastCycleCooldownMs = Math.max(60_000, Number(value || 1) * 60_000); },
});

const onlinePlayers = computed(() => mergePlayers(extractPlayers(overview.value)));
const privatePlayers = computed(() => onlinePlayers.value
  .filter((player) => isConfirmedPrivate(playtimeItems.value[player.steamID]))
  .sort((a, b) => Number(b.isLeader) - Number(a.isLeader) || a.name.localeCompare(b.name, "zh-CN")));
const privateLeaders = computed(() => privatePlayers.value.filter((player) => player.isLeader && player.teamID && player.squadID));
const broadcastPreview = computed(() => {
  const names = privatePlayers.value.slice(0, Math.max(1, form.broadcastBatchSize)).map((player) => player.name);
  return `${form.broadcastPrefix}\n${names.length ? names.join("  ") : "玩家A  玩家B  玩家C  玩家D  玩家E"}`;
});

async function refreshAll() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const [plugins, matchOverview] = await Promise.all([
      apiGet<any[]>("/api/plugins"),
      apiGet<any>("/api/match/overview"),
    ]);
    pluginEntry.value = (Array.isArray(plugins) ? plugins : []).find((item: any) => item.id === PLUGIN_ID) ?? null;
    overview.value = matchOverview ?? {};
    applyConfig(pluginEntry.value?.config ?? {});
    await refreshPlaytimeCache();
    lastUpdated.value = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  } catch (err: any) {
    error.value = err?.message ?? "读取督促时长公开状态失败";
  } finally {
    loading.value = false;
  }
}

async function refreshPlaytimeCache() {
  const steamIDs = Array.from(new Set(onlinePlayers.value.map((player) => player.steamID).filter(Boolean)));
  if (!steamIDs.length) {
    playtimeItems.value = {};
    return;
  }
  const response: any = await apiGet(`/api/query/playtime-cache?steamIDs=${encodeURIComponent(steamIDs.join(","))}`);
  playtimeItems.value = response?.items ?? {};
}

function applyConfig(value: any) {
  form.featureEnabled = value.featureEnabled !== false;
  form.startAfterSeconds = finite(value.startAfterSeconds, 300);
  form.leaderWarningIntervalMs = finite(value.leaderWarningIntervalMs, 10_000);
  form.broadcastBatchSize = finite(value.broadcastBatchSize, 5);
  form.broadcastBatchIntervalMs = finite(value.broadcastBatchIntervalMs, 120_000);
  form.broadcastCycleCooldownMs = finite(value.broadcastCycleCooldownMs, 600_000);
  form.warningMessage = String(value.warningMessage ?? form.warningMessage);
  form.broadcastPrefix = String(value.broadcastPrefix ?? form.broadcastPrefix);
}

async function toggleFeature() {
  const next = !form.featureEnabled;
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await apiPatch(`/api/plugins/${encodeURIComponent(PLUGIN_ID)}/config`, { config: { featureEnabled: next } });
    form.featureEnabled = next;
    notice.value = next ? "督促时长公开已启用。" : "督促时长公开已关闭，不会再发送警告或广播。";
    await refreshAll();
  } catch (err: any) {
    error.value = err?.message ?? "切换功能状态失败";
  } finally {
    saving.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await apiPatch(`/api/plugins/${encodeURIComponent(PLUGIN_ID)}/config`, {
      config: {
        featureEnabled: form.featureEnabled,
        startAfterSeconds: Number(form.startAfterSeconds),
        leaderWarningIntervalMs: Number(form.leaderWarningIntervalMs),
        broadcastBatchSize: Number(form.broadcastBatchSize),
        broadcastBatchIntervalMs: Number(form.broadcastBatchIntervalMs),
        broadcastCycleCooldownMs: Number(form.broadcastCycleCooldownMs),
        warningMessage: form.warningMessage,
        broadcastPrefix: form.broadcastPrefix,
      },
    });
    notice.value = "配置已保存。";
    await refreshAll();
  } catch (err: any) {
    error.value = err?.message ?? "保存配置失败";
  } finally {
    saving.value = false;
  }
}

function extractPlayers(value: any): any[] {
  if (Array.isArray(value?.players)) return value.players;
  if (Array.isArray(value?.matchState?.players?.list)) return value.matchState.players.list;
  if (Array.isArray(value?.players?.list)) return value.players.list;
  return [];
}

function mergePlayers(players: any[]) {
  const map = new Map<string, any>();
  for (const raw of players ?? []) {
    const steamID = String(raw?.steamID ?? raw?.steamId ?? raw?.steam64ID ?? raw?.rcon?.steamID ?? "").trim();
    const eosID = String(raw?.eosID ?? raw?.eosId ?? raw?.rcon?.eosID ?? "").trim();
    const playerID = normalizeId(raw?.playerID ?? raw?.playerId ?? raw?.playerIndex ?? raw?.rcon?.playerID);
    const name = String(raw?.name ?? raw?.playerName ?? raw?.displayName ?? raw?.rcon?.name ?? "").trim();
    if (!name || !steamID) continue;
    const key = steamID || eosID || playerID || name;
    const previous = map.get(key) ?? {};
    map.set(key, {
      ...previous,
      key,
      name: name || previous.name,
      steamID: steamID || previous.steamID,
      eosID: eosID || previous.eosID,
      playerID: playerID || previous.playerID,
      teamID: normalizeId(raw?.teamID ?? raw?.teamId ?? raw?.team ?? raw?.rcon?.teamID) || previous.teamID,
      squadID: normalizeId(raw?.squadID ?? raw?.squadId ?? raw?.squad ?? raw?.rcon?.squadID) || previous.squadID,
      isLeader: Boolean(previous.isLeader || raw?.isLeader || raw?.isSquadLeader || raw?.rcon?.isLeader),
      online: raw?.online ?? raw?.rcon?.online ?? previous.online,
      stale: raw?.stale ?? previous.stale,
    });
  }
  return [...map.values()].filter((player) => player.online !== false && player.stale !== true);
}

function isConfirmedPrivate(row: any) {
  if (!row || typeof row !== "object") return false;
  const fetchedAt = Number(row.fetched_at ?? row.fetchedAt ?? 0);
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return false;
  const rawSeconds = row.steam_game_seconds ?? row.steamGameSeconds ?? row.game_seconds ?? row.gameSeconds;
  if (rawSeconds == null || String(rawSeconds).trim() === "") return false;
  return Number(rawSeconds) === 0;
}

function formatFetchedAt(row: any) {
  const value = Number(row?.fetched_at ?? row?.fetchedAt ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "--";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function normalizeId(value: any) {
  const result = String(value ?? "").trim();
  return result && result !== "0" && result.toLowerCase() !== "n/a" ? result : "";
}

function finite(value: any, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

onMounted(() => {
  void refreshAll();
  refreshTimer = setInterval(() => void refreshAll(), 5000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
});
</script>

<style scoped>
.page { padding: 24px; min-height: 100%; color: var(--text-primary, #e5e7eb); }
.page-header { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; margin-bottom: 20px; }
.eyebrow { font-size: 11px; letter-spacing: .18em; opacity: .55; margin-bottom: 6px; }
h1 { margin: 0; font-size: 28px; }
.page-header p, .panel-head p, .control-card p, .cache-note p { margin: 6px 0 0; opacity: .68; line-height: 1.6; }
.header-actions { display: flex; align-items: center; gap: 10px; }
.updated { font-size: 12px; opacity: .55; }
.button, .power-button { border: 1px solid rgba(148,163,184,.24); border-radius: 8px; padding: 9px 14px; background: rgba(15,23,42,.65); color: inherit; cursor: pointer; }
.button:disabled, .power-button:disabled { opacity: .45; cursor: default; }
.button.primary, .power-button.primary { background: rgba(37,99,235,.2); border-color: rgba(96,165,250,.45); }
.power-button.danger { background: rgba(220,38,38,.16); border-color: rgba(248,113,113,.4); }
.banner { margin-bottom: 14px; padding: 10px 12px; border-radius: 8px; border: 1px solid; }
.banner.error { border-color: rgba(248,113,113,.4); background: rgba(127,29,29,.18); }
.banner.notice { border-color: rgba(74,222,128,.35); background: rgba(20,83,45,.18); }
.hero-grid { display: grid; grid-template-columns: minmax(320px, 2fr) repeat(3, minmax(150px, 1fr)); gap: 12px; margin-bottom: 12px; }
.control-card, .metric, .panel { border: 1px solid rgba(148,163,184,.16); background: rgba(15,23,42,.46); border-radius: 12px; }
.control-card { padding: 18px; display: flex; justify-content: space-between; align-items: center; gap: 18px; }
.control-card.disabled { opacity: .78; }
.control-card .label, .metric span { font-size: 12px; opacity: .6; }
.control-card strong { display: block; margin-top: 5px; font-size: 22px; }
.metric { padding: 18px; }
.metric strong { display: block; font-size: 30px; margin: 8px 0; }
.metric small { opacity: .55; line-height: 1.4; }
.grid.two { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(320px, .65fr); gap: 12px; margin-bottom: 12px; }
.panel { padding: 18px; margin-bottom: 12px; }
.panel-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 16px; }
.panel-head h2 { margin: 0; font-size: 18px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
.form-grid label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; opacity: .82; }
.form-grid .wide { grid-column: 1 / -1; }
input, textarea { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid rgba(148,163,184,.2); border-radius: 7px; background: rgba(2,6,23,.52); color: inherit; font: inherit; }
textarea { resize: vertical; }
.cache-note { margin-top: 14px; padding: 12px; border: 1px solid rgba(34,197,94,.22); border-radius: 8px; background: rgba(20,83,45,.1); }
.cache-note strong { font-size: 13px; }
.preview-block { margin-bottom: 14px; }
.preview-block > span { display: block; font-size: 12px; opacity: .6; margin-bottom: 6px; }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; padding: 12px; border-radius: 8px; background: rgba(2,6,23,.52); border: 1px solid rgba(148,163,184,.12); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.status-list { margin: 8px 0 0; }
.status-list div { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-bottom: 1px solid rgba(148,163,184,.1); }
.status-list dt { opacity: .6; }
.status-list dd { margin: 0; }
.ok { color: #86efac; }
.bad { color: #fca5a5; }
.table-wrap { overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 10px 9px; border-bottom: 1px solid rgba(148,163,184,.1); white-space: nowrap; }
th { position: sticky; top: 0; background: rgba(15,23,42,.96); font-size: 11px; opacity: .65; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.leader-pill, .member-pill { display: inline-flex; padding: 2px 7px; border-radius: 999px; font-size: 11px; }
.leader-pill { background: rgba(245,158,11,.16); color: #fcd34d; }
.member-pill { background: rgba(59,130,246,.14); color: #93c5fd; }
.empty { text-align: center; opacity: .5; padding: 24px; }
@media (max-width: 1050px) { .hero-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } .control-card { grid-column: 1 / -1; } .grid.two { grid-template-columns: 1fr; } }
@media (max-width: 700px) { .page { padding: 14px; } .page-header { flex-direction: column; } .hero-grid { grid-template-columns: 1fr; } .form-grid { grid-template-columns: 1fr; } .form-grid .wide { grid-column: auto; } }
</style>
