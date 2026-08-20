<template>
  <AppPage class="combat-records-page" full-bleed>
    <h1 class="sr-only">战斗记录</h1>

    <WorkspaceToolbar>
      <div class="toolbar-status">
        <AppStatusBadge :tone="replayTone">溯源 {{ replayStatusLabel }}</AppStatusBadge>
        <AppStatusBadge :tone="loading ? 'warn' : 'ok'">
          {{ loading ? "同步中" : `已载入 ${overview.count} 条` }}
        </AppStatusBadge>
        <AppStatusBadge v-if="overview.nullptrActors || overview.nullptrWeapons" tone="warn">
          nullptr 角色 {{ overview.nullptrActors }} / 武器 {{ overview.nullptrWeapons }}
        </AppStatusBadge>
      </div>
      <template #actions>
        <span class="updated-at">{{ lastUpdatedLabel }}</span>
        <button class="toolbar-button" type="button" :disabled="loading" @click="fetchRecords()">刷新</button>
      </template>
    </WorkspaceToolbar>

    <section class="summary-grid" aria-label="战斗记录统计">
      <article class="summary-card"><span>全部记录</span><strong>{{ overview.count }}</strong></article>
      <article class="summary-card damage"><span>伤害</span><strong>{{ overview.damage }}</strong></article>
      <article class="summary-card wound"><span>击倒</span><strong>{{ overview.wound }}</strong></article>
      <article class="summary-card death"><span>死亡</span><strong>{{ overview.death }}</strong></article>
      <article class="summary-card"><span>日志溯源进度</span><strong>{{ replayProgress }}</strong></article>
    </section>

    <section class="filter-bar" aria-label="战斗记录筛选">
      <label>
        <span>事件类型</span>
        <select v-model="filters.type" @change="applyFilters">
          <option value="all">全部</option>
          <option value="damage">伤害</option>
          <option value="wound">击倒</option>
          <option value="death">死亡</option>
        </select>
      </label>
      <label>
        <span>收集来源</span>
        <select v-model="filters.sourceMode" @change="applyFilters">
          <option value="all">全部来源</option>
          <option value="live">实时事件</option>
          <option value="replay">日志溯源</option>
        </select>
      </label>
      <label class="search-field">
        <span>搜索</span>
        <input v-model.trim="filters.search" type="search" placeholder="玩家 / ID / 武器 / 文件 / 哈希" @keyup.enter="applyFilters" />
      </label>
      <button class="toolbar-button primary" type="button" :disabled="loading" @click="applyFilters">查询</button>
      <button class="toolbar-button" type="button" :disabled="loading || !filters.search" @click="clearSearch">清空</button>
      <div class="pagination">
        <button class="toolbar-button" type="button" :disabled="loading || offset === 0" @click="previousPage">上一页</button>
        <span>{{ rangeLabel }}</span>
        <button class="toolbar-button" type="button" :disabled="loading || offset + pageSize >= total" @click="nextPage">下一页</button>
      </div>
    </section>

    <section class="table-region">
      <AppTable compact>
        <thead>
          <tr>
            <th>时间</th><th>类型</th><th>来源</th><th>攻击者</th><th>受害者</th><th>武器</th><th>伤害</th><th>日志位置</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && !records.length"><td colspan="8" class="empty-cell">正在加载战斗记录…</td></tr>
          <tr v-else-if="errorMessage"><td colspan="8" class="empty-cell danger">{{ errorMessage }}</td></tr>
          <tr v-else-if="!records.length"><td colspan="8" class="empty-cell">暂无符合条件的战斗记录</td></tr>
          <template v-else>
            <tr v-for="record in records" :key="record.id" class="record-row" @click="selected = record">
              <td class="time-cell">{{ formatTime(record.time) }}</td>
              <td><span class="type-pill" :data-type="record.type">{{ typeLabel(record.type) }}</span></td>
              <td><span class="source-mode">{{ sourceLabel(record.observedModes) }}</span></td>
              <td><ActorCell :actor="record.attacker" /></td>
              <td><ActorCell :actor="record.victim" /></td>
              <td><NullableValue :value="record.weapon ?? undefined" :state="record.weaponState" /></td>
              <td>{{ record.damage ?? "" }}</td>
              <td class="source-cell" :title="record.sourceFile || '-'">
                <strong v-if="record.sourceFile">{{ shortFile(record.sourceFile) }}</strong>
                <small v-if="record.sourceOffset != null">offset {{ record.sourceOffset }}</small>
              </td>
            </tr>
          </template>
        </tbody>
      </AppTable>
    </section>

    <div v-if="selected" class="detail-backdrop" @click.self="selected = null">
      <aside class="detail-drawer" role="dialog" aria-modal="true" aria-label="战斗记录详情">
        <header>
          <div><p>完整记录与溯源</p><h2>{{ typeLabel(selected.type) }} · {{ formatTime(selected.time) }}</h2></div>
          <button class="icon-button" type="button" aria-label="关闭" @click="selected = null">×</button>
        </header>

        <dl class="detail-grid">
          <div v-for="item in detailItems(selected)" :key="item.label">
            <dt>{{ item.label }}</dt><dd>{{ item.value }}</dd>
          </div>
        </dl>

        <section v-if="selected.rawLog" class="raw-panel"><h3>原始日志</h3><pre>{{ selected.rawLog }}</pre></section>
        <section class="raw-panel"><h3>完整缓存记录</h3><pre>{{ prettyJson(selected) }}</pre></section>
      </aside>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, onUnmounted, reactive, ref } from "vue";

import { apiGet } from "../app/apiClient";
import AppPage from "../components/common/AppPage.vue";
import AppStatusBadge from "../components/common/AppStatusBadge.vue";
import AppTable from "../components/common/AppTable.vue";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";

type ValueState = "present" | "nullptr" | "missing";

interface CombatActor {
  name: string | null;
  rawName: string;
  nameState: ValueState;
  steam64ID: string | null;
  eosID: string | null;
  controllerID: string | null;
  teamID: number | null;
  squadID: number | null;
}

interface CombatRecord {
  id: string;
  type: "damage" | "wound" | "death";
  serverId: string;
  time: string;
  logTime: string;
  attacker: CombatActor;
  victim: CombatActor;
  weapon: string | null;
  weaponState: ValueState;
  rawWeapon: string;
  damage: number | null;
  observedModes: string[];
  sourceFile: string;
  sourceFileId: string;
  sourceOffset: number | null;
  sourceEventId: string;
  rawLineHash: string;
  rawLog: string;
  parse?: Record<string, string>;
  [key: string]: unknown;
}

interface CollectorOverview {
  count: number;
  damage: number;
  wound: number;
  death: number;
  nullptrActors: number;
  nullptrWeapons: number;
  replay?: { status?: string; progress?: number; error?: string };
}

const emptyOverview = (): CollectorOverview => ({ count: 0, damage: 0, wound: 0, death: 0, nullptrActors: 0, nullptrWeapons: 0 });
const records = ref<CombatRecord[]>([]);
const selected = ref<CombatRecord | null>(null);
const overview = ref<CollectorOverview>(emptyOverview());
const total = ref(0);
const offset = ref(0);
const pageSize = 200;
const loading = ref(false);
const errorMessage = ref("");
const lastUpdatedAt = ref(0);
const filters = reactive({ type: "all", sourceMode: "all", search: "" });
let refreshTimer = 0;

const replayStatusLabel = computed(() => {
  const status = overview.value.replay?.status ?? "idle";
  return ({ idle: "等待", starting: "启动中", running: "进行中", completed: "已完成", failed: "失败", source_changed: "源文件变化", stopped: "已停止" } as Record<string, string>)[status] ?? status;
});
const replayTone = computed<"ok" | "warn" | "error" | "idle">(() => {
  const status = overview.value.replay?.status;
  if (status === "completed") return "ok";
  if (status === "failed") return "error";
  if (status === "running" || status === "starting" || status === "source_changed") return "warn";
  return "idle";
});
const replayProgress = computed(() => `${Number(overview.value.replay?.progress ?? 0).toFixed(1)}%`);
const rangeLabel = computed(() => total.value ? `${offset.value + 1}-${Math.min(offset.value + pageSize, total.value)} / ${total.value}` : "0 / 0");
const lastUpdatedLabel = computed(() => lastUpdatedAt.value ? `更新于 ${formatTime(new Date(lastUpdatedAt.value).toISOString())}` : "尚未更新");

const NullableValue = defineComponent({
  props: { value: { type: String, default: null }, state: { type: String, default: "missing" } },
  setup(props) {
    return () => props.state === "missing"
      ? null
      : h("span", { class: ["nullable-value", `is-${props.state}`] }, nullableLabel(props.value, props.state));
  },
});

const ActorCell = defineComponent({
  props: { actor: { type: Object as () => CombatActor, required: true } },
  setup(props) {
    return () => h("div", { class: "actor-cell" }, [
      h(NullableValue, { value: props.actor?.name ?? undefined, state: props.actor?.nameState }),
      ...actorIdentities(props.actor).map((identity) => h("small", { class: "actor-identity" }, identity)),
    ]);
  },
});

async function fetchRecords(options: { silent?: boolean } = {}) {
  if (loading.value) return;
  loading.value = true;
  if (!options.silent) errorMessage.value = "";
  try {
    const query = new URLSearchParams({
      type: filters.type,
      sourceMode: filters.sourceMode,
      search: filters.search,
      offset: String(offset.value),
      limit: String(pageSize),
    });
    const response = await apiGet<{ records: CombatRecord[]; total: number; overview: CollectorOverview }>(`/api/combat-records?${query}`);
    records.value = response.records ?? [];
    total.value = Number(response.total ?? records.value.length);
    overview.value = { ...emptyOverview(), ...(response.overview ?? {}) };
    lastUpdatedAt.value = Date.now();
    errorMessage.value = "";
  } catch (error: any) {
    errorMessage.value = error?.message ?? "加载战斗记录失败";
  } finally {
    loading.value = false;
  }
}

function applyFilters() { offset.value = 0; void fetchRecords(); }
function clearSearch() { filters.search = ""; applyFilters(); }
function previousPage() { offset.value = Math.max(0, offset.value - pageSize); void fetchRecords(); }
function nextPage() { if (offset.value + pageSize < total.value) { offset.value += pageSize; void fetchRecords(); } }
function typeLabel(type: string) { return ({ damage: "伤害", wound: "击倒", death: "死亡" } as Record<string, string>)[type] ?? type ?? "-"; }
function sourceLabel(modes: string[] = []) { return modes.map((mode) => mode === "live" ? "实时" : mode === "replay" ? "日志溯源" : mode).join(" + "); }
function nullableLabel(value: unknown, state: unknown) { return state === "nullptr" ? "nullptr" : String(value ?? ""); }
function actorIdentities(actor?: CombatActor) {
  return [
    actor?.steam64ID ? `Steam64 ${actor.steam64ID}` : "",
    actor?.eosID ? `EOS ${actor.eosID}` : "",
  ].filter(Boolean);
}
function actorDetail(actor?: CombatActor) {
  return [
    actor?.nameState === "nullptr" ? "nullptr" : actor?.name,
    ...actorIdentities(actor),
    actor?.controllerID ? `Controller ${actor.controllerID}` : "",
    actor?.teamID != null ? `Team ${actor.teamID}` : "",
    actor?.squadID != null ? `Squad ${actor.squadID}` : "",
  ].filter(Boolean).join(" · ");
}
function detailItems(record: CombatRecord) {
  return [
    ["记录 ID", record.id],
    ["来源模式", sourceLabel(record.observedModes)],
    ["攻击者", actorDetail(record.attacker)],
    ["受害者", actorDetail(record.victim)],
    ["武器", record.weaponState === "nullptr" ? "nullptr" : record.weapon],
    ["伤害", record.damage],
    ["源文件", record.sourceFile],
    ["源文件 ID", record.sourceFileId],
    ["字节偏移", record.sourceOffset],
    ["源事件 ID", record.sourceEventId],
    ["原始行哈希", record.rawLineHash],
    ["解析状态", parseLabel(record.parse)],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value]) => ({ label: String(label), value: String(value) }));
}
function shortFile(value: string) { return String(value || "").split(/[\\/]/).pop() || ""; }
function parseLabel(value?: Record<string, string>) { return value ? [value.status, value.confidence, value.identityConfidence, value.parseConfidence].filter(Boolean).join(" / ") : ""; }
function prettyJson(value: unknown) { return JSON.stringify(value ?? null, null, 2); }
function formatTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}

onMounted(() => {
  void fetchRecords();
  refreshTimer = window.setInterval(() => void fetchRecords({ silent: true }), 3000);
});
onUnmounted(() => window.clearInterval(refreshTimer));
</script>

<style scoped>
.combat-records-page { height: 100%; min-height: 0; overflow: hidden; display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); gap: 10px; }
.toolbar-status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.updated-at { color: var(--color-text-muted); font-size: 12px; }
.summary-grid { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 8px; }
.summary-card { display: grid; gap: 5px; min-height: 58px; padding: 9px 12px; border: 1px solid var(--color-border-soft); border-radius: 8px; background: var(--color-bg-card); }
.summary-card span { color: var(--color-text-muted); font-size: 11px; }
.summary-card strong { font-size: 20px; line-height: 1; }
.summary-card.damage strong { color: #60a5fa; } .summary-card.wound strong { color: #fbbf24; } .summary-card.death strong { color: #f87171; }
.filter-bar { display: grid; grid-template-columns: 150px 160px minmax(220px, 1fr) auto auto auto; gap: 8px; align-items: end; padding: 10px 12px; border: 1px solid var(--color-border-soft); border-radius: 8px; background: rgba(255,255,255,.02); }
.filter-bar label { display: grid; gap: 4px; min-width: 0; }.filter-bar label > span { color: var(--color-text-muted); font-size: 11px; }
.filter-bar input, .filter-bar select { min-width: 0; height: 34px; padding: 0 10px; border: 1px solid var(--color-border-default); border-radius: 6px; background: var(--color-bg-card); color: var(--color-text-primary); }
.toolbar-button, .icon-button { height: 34px; padding: 0 12px; border: 1px solid var(--color-border-default); border-radius: 6px; background: var(--color-bg-card); color: var(--color-text-primary); cursor: pointer; }
.toolbar-button:disabled { opacity: .45; cursor: default; }.toolbar-button.primary { border-color: rgba(96,165,250,.45); background: rgba(96,165,250,.14); }
.pagination { display: flex; align-items: center; justify-content: flex-end; gap: 8px; white-space: nowrap; color: var(--color-text-muted); font-size: 12px; }
.table-region { min-height: 0; overflow: auto; border: 1px solid var(--color-border-soft); border-radius: 8px; background: var(--color-bg-card); }
.record-row { cursor: pointer; transition: background-color .15s ease; }.record-row:hover { background: rgba(96,165,250,.06); }.time-cell { white-space: nowrap; }.source-cell { max-width: 180px; }.source-cell strong, .source-cell small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.source-cell small { margin-top: 3px; color: var(--color-text-muted); font-size: 10px; }
.actor-cell { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; max-width: 280px; vertical-align: middle; }.actor-identity { color: var(--color-text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; line-height: 1.2; white-space: nowrap; }
.type-pill, .source-mode, .nullable-value { display: inline-flex; align-items: center; min-height: 22px; padding: 2px 7px; border-radius: 999px; background: rgba(148,163,184,.12); font-size: 11px; white-space: nowrap; }
.type-pill[data-type="damage"] { color: #93c5fd; background: rgba(59,130,246,.14); }.type-pill[data-type="wound"] { color: #fde68a; background: rgba(245,158,11,.14); }.type-pill[data-type="death"] { color: #fca5a5; background: rgba(239,68,68,.14); }
.nullable-value.is-nullptr { color: #fbbf24; background: rgba(245,158,11,.16); font-family: ui-monospace, monospace; }
.empty-cell { padding: 40px !important; text-align: center; color: var(--color-text-muted); }.empty-cell.danger { color: #fca5a5; }
.detail-backdrop { position: fixed; inset: 0; z-index: 80; display: flex; justify-content: flex-end; background: rgba(0,0,0,.55); }
.detail-drawer { width: min(760px, 92vw); height: 100%; overflow: auto; padding: 18px; border-left: 1px solid var(--color-border-default); background: var(--color-bg-card); box-shadow: -20px 0 50px rgba(0,0,0,.35); }
.detail-drawer header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }.detail-drawer header p { margin: 0 0 4px; color: var(--color-text-muted); font-size: 12px; }.detail-drawer h2 { margin: 0; font-size: 18px; }.icon-button { width: 34px; padding: 0; font-size: 20px; }
.detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 18px 0; }.detail-grid div { min-width: 0; padding: 10px; border: 1px solid var(--color-border-soft); border-radius: 6px; }.detail-grid dt { margin-bottom: 5px; color: var(--color-text-muted); font-size: 10px; text-transform: uppercase; }.detail-grid dd { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, monospace; font-size: 12px; }
.raw-panel { margin-top: 10px; }.raw-panel h3 { margin: 0 0 6px; font-size: 12px; }.raw-panel pre { max-height: 260px; margin: 0; overflow: auto; padding: 12px; border: 1px solid var(--color-border-soft); border-radius: 6px; background: rgba(0,0,0,.2); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
@media (max-width: 1100px) { .summary-grid { grid-template-columns: repeat(3, minmax(120px, 1fr)); }.filter-bar { grid-template-columns: repeat(2, minmax(140px, 1fr)); }.search-field, .pagination { grid-column: span 2; }.actor-cell { max-width: 210px; } }
@media (max-width: 720px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.detail-grid { grid-template-columns: 1fr; } }
</style>
