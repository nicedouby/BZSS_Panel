<template>
  <section class="page">
    <header class="page-header">
      <div>
        <div class="eyebrow">ROUND PLAYTIME WARNING</div>
        <h1>开局时长提醒</h1>
        <p>管理 5 分钟小队名单、7 分 30 秒阵营队长名单，并检查 ABC 火力组来源。</p>
      </div>
      <div class="header-actions">
        <span class="updated">{{ loading ? "读取中…" : `更新于 ${lastUpdated}` }}</span>
        <button class="button" :disabled="loading" @click="refreshAll">刷新</button>
      </div>
    </header>

    <div v-if="error" class="error-banner">{{ error }}</div>
    <div v-if="notice" class="notice-banner">{{ notice }}</div>

    <section class="metrics">
      <article class="metric"><span>插件状态</span><strong :class="pluginLoaded ? 'ok' : 'bad'">{{ pluginLoaded ? "已加载" : "未加载" }}</strong></article>
      <article class="metric"><span>当前日志时间</span><strong>{{ formatClock(status?.logClockSeconds) }}</strong></article>
      <article class="metric"><span>在线玩家</span><strong>{{ mergedPlayers.length }}</strong></article>
      <article class="metric"><span>ABC 已识别</span><strong>{{ identifiedCount }}/{{ mergedPlayers.length }}</strong></article>
      <article class="metric"><span>冲突记录</span><strong :class="conflictCount ? 'warn' : 'ok'">{{ conflictCount }}</strong></article>
    </section>

    <section class="grid two">
      <article class="panel">
        <div class="panel-head">
          <div>
            <h2>插件配置</h2>
            <p>保存后插件会在下一次轮询时读取，无需重启。</p>
          </div>
          <button class="button primary" :disabled="saving || !pluginLoaded" @click="saveConfig">
            {{ saving ? "保存中…" : "保存配置" }}
          </button>
        </div>

        <div class="form-grid">
          <label class="toggle-row">
            <input v-model="form.enabled" type="checkbox">
            <span>启用自动提醒</span>
          </label>
          <label>
            <span>小队成员触发秒数</span>
            <input v-model.number="form.squadWarningSeconds" type="number" min="0" max="86400">
          </label>
          <label>
            <span>阵营队长触发秒数</span>
            <input v-model.number="form.leaderWarningSeconds" type="number" min="0" max="86400">
          </label>
          <label>
            <span>轮询间隔（毫秒）</span>
            <input v-model.number="form.pollIntervalMs" type="number" min="250" max="30000">
          </label>
          <label>
            <span>换行传输方式</span>
            <select v-model="form.lineBreakMode">
              <option value="escaped">RCON 转义 \n（推荐）</option>
              <option value="actual">真实换行</option>
              <option value="separator">竖线分隔</option>
            </select>
          </label>
          <label>
            <span>警告最大字符数</span>
            <input v-model.number="form.maxWarningChars" type="number" min="80" max="180">
          </label>
          <label class="toggle-row">
            <input v-model="form.liveLookupWhenMissing" type="checkbox">
            <span>缓存缺失时实时查询 Steam</span>
          </label>
          <label class="toggle-row">
            <input v-model="form.persistState" type="checkbox">
            <span>持久化本局发送状态</span>
          </label>
        </div>
      </article>

      <article class="panel">
        <div class="panel-head">
          <div>
            <h2>手动触发</h2>
            <p>手动触发不会修改本局自动发送标记，可重复用于校验。</p>
          </div>
        </div>
        <div class="trigger-grid">
          <button class="trigger squad" :disabled="triggering || !pluginLoaded || !form.enabled" @click="trigger('squad')">
            <strong>发送小队成员时长</strong>
            <span>向每个小队的全体成员发送该小队名单</span>
          </button>
          <button class="trigger leader" :disabled="triggering || !pluginLoaded || !form.enabled" @click="trigger('leader')">
            <strong>发送阵营队长时长</strong>
            <span>向两边阵营分别发送己方所有小队长名单</span>
          </button>
        </div>
        <dl class="status-list">
          <div><dt>日志锚点</dt><dd>{{ status?.logClockHasAnchor ? "有效" : "无效" }}</dd></div>
          <div><dt>手动日志时钟</dt><dd>{{ status?.logClockManual ? "是（自动触发暂停）" : "否" }}</dd></div>
          <div><dt>当前换行载荷</dt><dd class="mono">{{ separatorLabel }}</dd></div>
          <div><dt>最近插件记录</dt><dd>{{ recentRecords.length ? formatTime(recentRecords[0]?.createdAt) : "--" }}</dd></div>
        </dl>
      </article>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>消息预览</h2>
          <p>“游戏内预览”会将字面量 \n 展示为真正的分行；“RCON 载荷”显示实际发送字符串。</p>
        </div>
        <select v-model="selectedSquadKey" class="squad-select">
          <option v-for="item in squadOptions" :key="item.key" :value="item.key">{{ item.label }}</option>
        </select>
      </div>
      <div class="preview-grid">
        <article>
          <h3>小队成员 · 游戏内预览</h3>
          <pre>{{ selectedSquadPreview.display }}</pre>
          <small>{{ selectedSquadPreview.wire.length }}/{{ form.maxWarningChars }} 字符</small>
        </article>
        <article>
          <h3>小队成员 · RCON 载荷</h3>
          <pre class="wire">{{ selectedSquadPreview.wire }}</pre>
        </article>
        <article>
          <h3>阵营队长 · 游戏内预览</h3>
          <pre>{{ selectedTeamPreview.display }}</pre>
          <small>{{ selectedTeamPreview.wire.length }}/{{ form.maxWarningChars }} 字符</small>
        </article>
        <article>
          <h3>阵营队长 · RCON 载荷</h3>
          <pre class="wire">{{ selectedTeamPreview.wire }}</pre>
        </article>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>ABC 火力组诊断</h2>
          <p>优先级：明确 A/B/C 文本 → FireTeam ID → BZSS-Core / 记分板 Index。冲突项会标红。</p>
        </div>
        <div class="filters">
          <select v-model="teamFilter"><option value="">全部阵营</option><option v-for="team in teamIds" :key="team" :value="team">Team {{ team }}</option></select>
          <select v-model="fireFilter"><option value="">全部火力组</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="?">未识别</option></select>
          <input v-model.trim="query" placeholder="搜索玩家 / 兵种 / 来源">
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>阵营</th><th>小队</th><th>玩家</th><th>兵种</th><th>火力组</th><th>原始值</th><th>ftIndex</th><th>ftPosition</th><th>判定来源</th><th>状态</th></tr></thead>
          <tbody>
            <tr v-for="player in filteredPlayers" :key="player.key" :class="{ conflict: player.fireTeamConflict }">
              <td>{{ player.teamID || "--" }}</td>
              <td>{{ squadName(player) }}</td>
              <td>{{ player.name }}</td>
              <td>{{ player.role || "未知兵种" }}</td>
              <td><span class="fire-pill" :data-fire="player.fireTeam || '?'">{{ player.fireTeam || "?" }}</span></td>
              <td class="mono">{{ player.fireTeamRaw ?? "--" }}</td>
              <td class="mono">{{ player.ftIndex ?? "--" }}</td>
              <td class="mono">{{ player.ftPosition ?? "--" }}</td>
              <td class="source">{{ player.fireTeamSource || "unknown" }}</td>
              <td>{{ player.fireTeamConflict ? "来源冲突" : player.fireTeam ? "已识别" : "未识别" }}</td>
            </tr>
            <tr v-if="!filteredPlayers.length"><td colspan="10" class="empty">当前筛选条件下没有玩家</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>最近发送记录</h2>
          <p>来自广播模块当天审计；消息列会将字面量 \n 还原为多行显示。</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>玩家</th><th>原因</th><th>结果</th><th>消息</th><th>错误</th></tr></thead>
          <tbody>
            <tr v-for="record in recentRecords" :key="record.id">
              <td class="mono">{{ formatTime(record.createdAt) }}</td>
              <td>{{ record.targetName || "--" }}</td>
              <td class="mono">{{ record.reason || "--" }}</td>
              <td :class="record.success ? 'ok' : 'bad'">{{ record.success ? "成功" : record.skipped ? "跳过" : "失败" }}</td>
              <td><pre class="record-message">{{ decodeMessage(record.message) }}</pre></td>
              <td class="bad">{{ record.errorMessage || "--" }}</td>
            </tr>
            <tr v-if="!recentRecords.length"><td colspan="6" class="empty">暂无发送记录</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { apiGet, apiPatch } from "../app/apiClient";

const PLUGIN_ID = "round-playtime-roster-warning";
const loading = ref(false);
const saving = ref(false);
const triggering = ref(false);
const error = ref("");
const notice = ref("");
const lastUpdated = ref("--");
const pluginEntry = ref<any>(null);
const status = ref<any>({});
const matchOverview = ref<any>({});
const coreSnapshot = ref<any>({});
const playtimeItems = ref<Record<string, any>>({});
const recentRecords = ref<any[]>([]);
const selectedSquadKey = ref("");
const teamFilter = ref("");
const fireFilter = ref("");
const query = ref("");

const form = reactive({
  enabled: true,
  squadWarningSeconds: 300,
  leaderWarningSeconds: 450,
  pollIntervalMs: 1000,
  maxWarningChars: 180,
  lineBreakMode: "escaped",
  liveLookupWhenMissing: false,
  persistState: true,
});

const pluginLoaded = computed(() => Boolean(pluginEntry.value));
const separatorLabel = computed(() => form.lineBreakMode === "actual" ? "真实换行 LF" : form.lineBreakMode === "separator" ? "｜" : "\\n");
const mergedPlayers = computed(() => mergePlayers(
  extractMatchPlayers(matchOverview.value),
  extractCorePlayers(coreSnapshot.value),
).map((player) => ({
  ...player,
  gameSeconds: readSeconds(playtimeItems.value[player.steamID]),
})));
const identifiedCount = computed(() => mergedPlayers.value.filter((item) => item.fireTeam).length);
const conflictCount = computed(() => mergedPlayers.value.filter((item) => item.fireTeamConflict).length);
const teamIds = computed<string[]>(() => Array.from(new Set<string>(mergedPlayers.value.map((item) => String(item.teamID || "")).filter(Boolean))).sort());
const squadMap = computed<Map<string, string>>(() => new Map<string, string>(
  extractSquads(matchOverview.value).map((squad: any): [string, string] => [
    `${normalizeId(squad.teamID ?? squad.teamId)}|${normalizeId(squad.squadID ?? squad.squadId)}`,
    String(squad.squadName ?? squad.name ?? "").trim(),
  ]),
));
const groupedSquads = computed(() => groupBy(mergedPlayers.value.filter((player) => player.teamID && player.squadID), (player) => `${player.teamID}|${player.squadID}`));
const squadOptions = computed(() => Array.from(groupedSquads.value.entries()).map(([key, players]) => ({
  key,
  label: `Team ${players[0]?.teamID} · ${squadName(players[0])} · ${players.length}人`,
})).sort((a, b) => a.label.localeCompare(b.label, "zh-CN")));
const selectedSquadPlayers = computed(() => groupedSquads.value.get(selectedSquadKey.value) ?? []);
const selectedSquadPreview = computed(() => buildPreview(
  selectedSquadPlayers.value.slice().sort(memberSort).map((player) => `（${player.fireTeam || "未分"}组）${player.role || "未知兵种"} ${player.name} 游戏时长 ${formatHours(player.gameSeconds)}`),
));
const selectedTeamId = computed(() => selectedSquadPlayers.value[0]?.teamID || teamIds.value[0] || "");
const selectedTeamPreview = computed(() => {
  const leaders = mergedPlayers.value
    .filter((player) => player.teamID === selectedTeamId.value && player.isLeader && player.squadID)
    .sort((a, b) => squadName(a).localeCompare(squadName(b), "zh-CN"));
  return buildPreview(leaders.map((leader) => `${squadName(leader)} 队长游戏时长 ${formatHours(leader.gameSeconds)}`));
});
const filteredPlayers = computed(() => {
  const needle = query.value.toLowerCase();
  return mergedPlayers.value.filter((player) => {
    if (teamFilter.value && player.teamID !== teamFilter.value) return false;
    if (fireFilter.value === "?" && player.fireTeam) return false;
    if (fireFilter.value && fireFilter.value !== "?" && player.fireTeam !== fireFilter.value) return false;
    if (!needle) return true;
    return [player.name, player.role, player.fireTeamSource, player.fireTeamRaw, squadName(player)]
      .some((value) => String(value ?? "").toLowerCase().includes(needle));
  }).sort((a, b) => Number(a.teamID) - Number(b.teamID) || Number(a.squadID) - Number(b.squadID) || memberSort(a, b));
});

async function refreshAll() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const [plugins, overview, core, records] = await Promise.all([
      apiGet<any[]>("/api/plugins"),
      apiGet<any>("/api/match/overview"),
      apiGet<any>("/api/bzss-core/player-info?all=1"),
      apiGet<any>(`/api/admin-warns/recent?kind=warning&sourceModule=${encodeURIComponent(PLUGIN_ID)}&limit=100`),
    ]);
    pluginEntry.value = (Array.isArray(plugins) ? plugins : []).find((item: any) => item.id === PLUGIN_ID) ?? null;
    matchOverview.value = overview ?? {};
    coreSnapshot.value = core ?? {};
    recentRecords.value = Array.isArray(records?.records) ? records.records : [];
    status.value = overview?.status ?? overview?.matchState?.status ?? {};
    applyConfig(pluginEntry.value?.config ?? pluginEntry.value?.manifest?.config ?? {});
    await refreshPlaytimes();
    if (!selectedSquadKey.value || !groupedSquads.value.has(selectedSquadKey.value)) {
      selectedSquadKey.value = squadOptions.value[0]?.key ?? "";
    }
    lastUpdated.value = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  } catch (err: any) {
    error.value = err?.message ?? "读取插件数据失败";
  } finally {
    loading.value = false;
  }
}

async function refreshPlaytimes() {
  const steamIds = Array.from(new Set(mergedPlayers.value.map((player) => player.steamID).filter(Boolean)));
  if (!steamIds.length) {
    playtimeItems.value = {};
    return;
  }
  const response: any = await apiGet(`/api/query/playtime-cache?steamIDs=${encodeURIComponent(steamIds.join(","))}`);
  playtimeItems.value = response?.items ?? {};
}

function applyConfig(value: any) {
  form.enabled = value.enabled !== false;
  form.squadWarningSeconds = finite(value.squadWarningSeconds, 300);
  form.leaderWarningSeconds = finite(value.leaderWarningSeconds, 450);
  form.pollIntervalMs = finite(value.pollIntervalMs, 1000);
  form.maxWarningChars = finite(value.maxWarningChars, 180);
  form.lineBreakMode = ["escaped", "actual", "separator"].includes(value.lineBreakMode) ? value.lineBreakMode : "escaped";
  form.liveLookupWhenMissing = value.liveLookupWhenMissing === true;
  form.persistState = value.persistState !== false;
}

async function saveConfig() {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await apiPatch(`/api/plugins/${PLUGIN_ID}/config`, { config: { ...form } });
    notice.value = "配置已保存，插件将在下一次轮询时应用。";
    await refreshAll();
  } catch (err: any) {
    error.value = err?.message ?? "保存配置失败";
  } finally {
    saving.value = false;
  }
}

async function trigger(type: "squad" | "leader") {
  triggering.value = true;
  error.value = "";
  notice.value = "";
  try {
    const nonceKey = type === "squad" ? "manualSquadTriggerNonce" : "manualLeaderTriggerNonce";
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await apiPatch(`/api/plugins/${PLUGIN_ID}/config`, { config: { [nonceKey]: nonce } });
    notice.value = type === "squad" ? "已提交小队成员时长手动触发。" : "已提交阵营队长时长手动触发。";
    await sleep(Math.max(1200, Number(form.pollIntervalMs) + 300));
    await refreshAll();
  } catch (err: any) {
    error.value = err?.message ?? "手动触发失败";
  } finally {
    triggering.value = false;
  }
}

function mergePlayers(basePlayers: any[], corePlayers: any[]) {
  const output: any[] = [];
  const indexes = new Map<string, number>();
  const add = (raw: any, source: string) => {
    const next = normalizePlayer(raw, source);
    if (!next.name) return;
    const keys = identityKeys(next);
    const existingIndex = keys.map((key) => indexes.get(key)).find((value) => value != null);
    if (existingIndex == null) output.push(next);
    else output[existingIndex] = mergePlayer(output[existingIndex], next);
    const index = existingIndex ?? output.length - 1;
    for (const key of identityKeys(output[index])) indexes.set(key, index);
  };
  basePlayers.forEach((player) => add(player, "matchState"));
  corePlayers.forEach((player) => add(player, "bzssCore"));
  return output.map(finalizePlayer).filter((player) => player.online !== false && !(player.stale === true && player.online !== true));
}

function normalizePlayer(raw: any, source: string) {
  const evidence = collectFireTeamEvidence(raw, source);
  return {
    key: "",
    playerID: normalizeId(raw.playerID ?? raw.playerId ?? raw.playerIndex ?? raw?.rcon?.playerID),
    name: String(raw.name ?? raw.playerName ?? raw.displayName ?? raw?.rcon?.name ?? "").trim(),
    steamID: String(raw.steamID ?? raw.steamId ?? raw.steam64ID ?? raw?.rcon?.steamID ?? "").trim(),
    eosID: String(raw.eosID ?? raw.eosId ?? raw?.rcon?.eosID ?? "").trim(),
    teamID: normalizeId(raw.teamID ?? raw.teamId ?? raw?.rcon?.teamID),
    squadID: normalizeId(raw.squadID ?? raw.squadId ?? raw?.rcon?.squadID),
    isLeader: Boolean(raw.isLeader ?? raw?.rcon?.isLeader),
    role: cleanRole(raw.role ?? raw.roleName ?? raw?.rcon?.role ?? raw?.soldierInfo?.soldierClass),
    online: raw.online ?? raw?.rcon?.online,
    stale: raw.stale,
    ftIndex: nullableNumber(raw.ftIndex ?? raw.fireTeamIndex ?? raw?.playerScoreboard?.fireTeamIndex),
    ftPosition: nullableNumber(raw.ftPosition ?? raw.fireTeamPosition ?? raw?.playerScoreboard?.fireTeamPosition),
    evidence,
    fireTeam: "",
    fireTeamRaw: null,
    fireTeamSource: "",
    fireTeamConflict: false,
    gameSeconds: null,
  };
}

function collectFireTeamEvidence(raw: any, source: string) {
  const out: any[] = [];
  const add = (fireTeam: string, rawValue: any, path: string, priority: number) => {
    if (!fireTeam) return;
    out.push({ fireTeam, raw: rawValue, source: `${source}.${path}`, priority });
  };
  const label = normalizeFireLabel(raw.fireTeamName ?? raw.fireteamName ?? (typeof raw.fireTeam === "string" ? raw.fireTeam : ""));
  add(label, raw.fireTeamName ?? raw.fireteamName ?? raw.fireTeam, "fireTeamName", 500);
  add(normalizeFireId(raw.fireTeamID ?? raw.fireTeamId), raw.fireTeamID ?? raw.fireTeamId, "fireTeamID", 460);
  add(normalizeFireIndex(raw.ftIndex), raw.ftIndex, "ftIndex", source === "bzssCore" ? 410 : 330);
  add(normalizeFireIndex(raw.fireTeamIndex), raw.fireTeamIndex, "fireTeamIndex", source === "bzssCore" ? 410 : 330);
  add(normalizeFireIndex(raw?.playerScoreboard?.fireTeamIndex), raw?.playerScoreboard?.fireTeamIndex, "playerScoreboard.fireTeamIndex", 430);
  add(normalizeFireIndex(raw?.playerScoreboard?.ftIndex), raw?.playerScoreboard?.ftIndex, "playerScoreboard.ftIndex", 430);
  return out.sort((a, b) => b.priority - a.priority);
}

function mergePlayer(base: any, overlay: any) {
  const online = base.online === true || overlay.online === true ? true : overlay.online ?? base.online;
  return {
    ...base,
    playerID: overlay.playerID || base.playerID,
    name: overlay.name || base.name,
    steamID: overlay.steamID || base.steamID,
    eosID: overlay.eosID || base.eosID,
    teamID: overlay.teamID || base.teamID,
    squadID: overlay.squadID || base.squadID,
    isLeader: base.isLeader || overlay.isLeader,
    role: base.role || overlay.role,
    online,
    stale: online === true ? false : overlay.stale ?? base.stale,
    ftIndex: overlay.ftIndex ?? base.ftIndex,
    ftPosition: overlay.ftPosition ?? base.ftPosition,
    evidence: [...base.evidence, ...overlay.evidence].sort((a, b) => b.priority - a.priority),
  };
}

function finalizePlayer(player: any) {
  const selected = player.evidence[0] ?? {};
  const fireTeams = new Set(player.evidence.map((item: any) => item.fireTeam));
  return {
    ...player,
    key: player.steamID || player.eosID || player.playerID || player.name,
    fireTeam: selected.fireTeam || "",
    fireTeamRaw: selected.raw ?? null,
    fireTeamSource: selected.source || "unknown",
    fireTeamConflict: fireTeams.size > 1,
  };
}

function buildPreview(lines: string[]) {
  if (!lines.length) return { wire: "暂无可用数据", display: "暂无可用数据" };
  const separator = form.lineBreakMode === "actual" ? "\n" : form.lineBreakMode === "separator" ? "｜" : "\\n";
  const compacted = fitLines(lines, Math.max(80, Number(form.maxWarningChars) || 180), separator);
  const wire = compacted.join(separator);
  return { wire, display: form.lineBreakMode === "escaped" ? wire.replaceAll("\\n", "\n") : wire };
}

function fitLines(lines: string[], maxChars: number, separator: string) {
  const total = lines.join(separator);
  if (total.length <= maxChars) return lines;
  const separatorBytes = Math.max(0, lines.length - 1) * separator.length;
  const each = Math.max(1, Math.floor((maxChars - separatorBytes) / lines.length));
  return lines.map((line) => truncate(line, each));
}

function extractMatchPlayers(value: any) {
  if (Array.isArray(value?.players)) return value.players;
  if (Array.isArray(value?.matchState?.players?.list)) return value.matchState.players.list;
  return [];
}
function extractSquads(value: any) {
  if (Array.isArray(value?.squads)) return value.squads;
  if (Array.isArray(value?.matchState?.squads?.list)) return value.matchState.squads.list;
  return [];
}
function extractCorePlayers(value: any) {
  if (Array.isArray(value?.players)) return value.players;
  return [];
}
function identityKeys(player: any) {
  return [["steam", player.steamID], ["eos", player.eosID], ["player", player.playerID], ["name", player.name.toLowerCase()]]
    .filter(([, value]) => value)
    .map(([type, value]) => `${type}:${value}`);
}
function normalizeFireLabel(value: any) {
  const text = String(value ?? "").trim().toUpperCase();
  if (/^(A|ALPHA|A组|火力组A)$/.test(text)) return "A";
  if (/^(B|BRAVO|B组|火力组B)$/.test(text)) return "B";
  if (/^(C|CHARLIE|C组|火力组C)$/.test(text)) return "C";
  return text.match(/(?:FIRE\s*TEAM\s*|火力组\s*)?([ABC])/)?.[1] ?? "";
}
function normalizeFireId(value: any) { const number = Number(value); return number === 1 ? "A" : number === 2 ? "B" : number === 3 ? "C" : ""; }
function normalizeFireIndex(value: any) { const number = Number(value); return number === 0 ? "A" : number === 1 ? "B" : number === 2 ? "C" : ""; }
function cleanRole(value: any) { return String(value ?? "").split(/[/.\\]/).pop()?.replace(/_C$/i, "").replace(/^BP_/, "").replaceAll("_", " ") ?? ""; }
function groupBy<T>(items: T[], keyFn: (item: T) => string) { const map = new Map<string, T[]>(); for (const item of items) { const key = keyFn(item); if (!map.has(key)) map.set(key, []); map.get(key)!.push(item); } return map; }
function squadName(player: any): string {
  const key = `${player.teamID}|${player.squadID}`;
  const resolvedName = squadMap.value.get(key);
  return resolvedName || (player.squadID ? `${player.squadID}队（未命名）` : "未加入小队");
}
function memberSort(a: any, b: any) { return fireRank(a.fireTeam) - fireRank(b.fireTeam) || Number(b.isLeader) - Number(a.isLeader) || a.name.localeCompare(b.name, "zh-CN"); }
function fireRank(value: string) { return value === "A" ? 0 : value === "B" ? 1 : value === "C" ? 2 : 3; }
function readSeconds(row: any) { const value = Number(row?.game_seconds ?? row?.gameSeconds ?? row?.steam_game_seconds ?? row?.steamGameSeconds); return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null; }
function formatHours(seconds: number | null) { return seconds == null ? "未知" : `${Number((seconds / 3600).toFixed(1))}小时`; }
function decodeMessage(value: any) { return String(value ?? "").replaceAll("\\n", "\n"); }
function normalizeId(value: any) { const text = String(value ?? "").trim(); return text && text.toLowerCase() !== "n/a" ? text : ""; }
function nullableNumber(value: any) { if (value == null || value === "") return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function finite(value: any, fallback: number) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function truncate(value: string, max: number) { return value.length <= max ? value : max <= 1 ? value.slice(0, max) : `${value.slice(0, max - 1)}…`; }
function formatClock(value: any) { const seconds = Math.max(0, Number(value) || 0); return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; }
function formatTime(value: any) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "--" : date.toLocaleTimeString("zh-CN", { hour12: false }); }
function sleep(ms: number) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }

onMounted(refreshAll);
</script>

<style scoped>
.page { min-height:100%; padding:24px; color:var(--text-primary,#e5edf7); background:var(--bg-primary,#0b1220); }
.page-header,.panel-head { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
.page-header { margin-bottom:18px; }
.eyebrow { color:#60a5fa; font-size:11px; letter-spacing:.14em; margin-bottom:7px; }
h1 { margin:0 0 7px; font-size:28px; } h2 { margin:0 0 6px; font-size:17px; } h3 { margin:0 0 10px; font-size:13px; color:#cbd5e1; }
p { margin:0; color:#94a3b8; font-size:13px; }
.header-actions,.filters { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.updated { color:#94a3b8; font-size:12px; }
.button,select,input { border:1px solid rgba(148,163,184,.28); border-radius:7px; background:rgba(30,41,59,.86); color:inherit; padding:8px 10px; }
.button { cursor:pointer; } .button.primary { border-color:#3b82f6; color:#bfdbfe; } .button:disabled,.trigger:disabled { opacity:.5; cursor:not-allowed; }
.error-banner,.notice-banner { padding:11px 13px; border-radius:8px; margin-bottom:14px; }
.error-banner { color:#fecaca; background:rgba(127,29,29,.62); } .notice-banner { color:#bbf7d0; background:rgba(20,83,45,.62); }
.metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:11px; margin-bottom:15px; }
.metric,.panel { border:1px solid rgba(148,163,184,.18); border-radius:10px; background:rgba(15,23,42,.84); }
.metric { padding:13px; display:flex; flex-direction:column; gap:6px; } .metric span { color:#94a3b8; font-size:12px; } .metric strong { font-size:22px; }
.grid.two { display:grid; grid-template-columns:minmax(0,1.15fr) minmax(330px,.85fr); gap:15px; }
.panel { padding:16px; margin-bottom:15px; overflow:hidden; }
.form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:15px; }
.form-grid label { display:flex; flex-direction:column; gap:6px; color:#94a3b8; font-size:12px; }
.form-grid input,.form-grid select { width:100%; box-sizing:border-box; }
.toggle-row { flex-direction:row!important; align-items:center; padding:9px; border-radius:7px; background:rgba(30,41,59,.52); }
.toggle-row input { width:auto; }
.trigger-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:15px; }
.trigger { border:1px solid rgba(148,163,184,.25); border-radius:9px; padding:14px; text-align:left; color:inherit; cursor:pointer; background:rgba(30,41,59,.68); }
.trigger strong,.trigger span { display:block; } .trigger span { margin-top:6px; color:#94a3b8; font-size:12px; line-height:1.45; }
.trigger.squad { border-color:rgba(52,211,153,.45); } .trigger.leader { border-color:rgba(96,165,250,.45); }
.status-list { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:14px 0 0; }
.status-list div { padding:9px; border-radius:7px; background:rgba(30,41,59,.52); } .status-list dt { color:#94a3b8; font-size:11px; } .status-list dd { margin:4px 0 0; font-size:12px; }
.preview-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:14px; }
.preview-grid article { min-width:0; padding:12px; border-radius:8px; background:rgba(30,41,59,.5); }
pre { margin:0; white-space:pre-wrap; word-break:break-word; font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace; }
pre.wire { color:#fcd34d; } small { display:block; margin-top:8px; color:#94a3b8; }
.squad-select { max-width:340px; }
.table-wrap { overflow:auto; margin-top:13px; }
table { width:100%; min-width:1050px; border-collapse:collapse; } th,td { padding:9px 10px; text-align:left; vertical-align:top; border-bottom:1px solid rgba(148,163,184,.14); font-size:12px; }
th { color:#94a3b8; font-size:11px; white-space:nowrap; }
tr.conflict { background:rgba(127,29,29,.24); } .source { max-width:280px; word-break:break-all; }
.fire-pill { display:inline-flex; min-width:26px; height:22px; align-items:center; justify-content:center; border-radius:5px; font-weight:700; background:#334155; }
.fire-pill[data-fire=A] { background:#166534; } .fire-pill[data-fire=B] { background:#6d28d9; } .fire-pill[data-fire=C] { background:#0e7490; }
.record-message { min-width:300px; max-width:600px; }
.mono { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; } .ok { color:#86efac; } .bad { color:#fca5a5; } .warn { color:#fcd34d; } .empty { text-align:center; color:#64748b; padding:24px; }
@media (max-width:1000px) { .grid.two,.preview-grid { grid-template-columns:1fr; } .form-grid { grid-template-columns:1fr; } .page-header,.panel-head { flex-direction:column; } }
</style>