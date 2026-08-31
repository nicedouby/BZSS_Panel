<template>
  <AppPage class="astrbot-interactions-page" full-bleed>
    <h1 class="sr-only">机器人互动记录</h1>

    <WorkspaceToolbar>
      <div class="toolbar-status">
        <AppStatusBadge :tone="bridgeEnabled ? 'ok' : 'warn'">
          {{ bridgeEnabled ? "网关已启用" : "网关未启用" }}
        </AppStatusBadge>
        <AppStatusBadge :tone="websocketClients > 0 ? 'ok' : 'idle'">
          机器人客户端 {{ websocketClients }}
        </AppStatusBadge>
        <AppStatusBadge tone="idle">当前保留 {{ interactions.length }} 条</AppStatusBadge>
      </div>

      <template #actions>
        <button class="toolbar-button" type="button" :class="{ active: autoRefresh }" @click="toggleAutoRefresh">
          {{ autoRefresh ? "自动刷新 3s" : "自动刷新已暂停" }}
        </button>
        <button class="toolbar-button primary" type="button" :disabled="loading" @click="load">
          {{ loading ? "刷新中" : "立即刷新" }}
        </button>
      </template>
    </WorkspaceToolbar>

    <section class="summary-grid" aria-label="机器人互动摘要">
      <article>
        <span>QQ群命令</span>
        <strong>{{ commandCount }}</strong>
        <small>绑定、查询、快照与解绑</small>
      </article>
      <article>
        <span>Panel 推送</span>
        <strong>{{ eventCount }}</strong>
        <small>发往机器人的事件</small>
      </article>
      <article>
        <span>送达确认</span>
        <strong>{{ ackCount }}</strong>
        <small>机器人返回的 ACK</small>
      </article>
      <article :data-tone="failedCount ? 'danger' : 'ok'">
        <span>失败记录</span>
        <strong>{{ failedCount }}</strong>
        <small>{{ failedCount ? "需要检查详情" : "当前无失败" }}</small>
      </article>
    </section>

    <section class="filter-bar" aria-label="互动记录筛选">
      <label class="search-field">
        <span>搜索</span>
        <input v-model.trim="search" type="search" placeholder="QQ、玩家、Steam64、事件 ID" />
      </label>
      <label>
        <span>记录类型</span>
        <select v-model="kindFilter">
          <option value="all">全部</option>
          <option value="command">QQ群命令</option>
          <option value="event">Panel 推送</option>
          <option value="ack">送达确认</option>
        </select>
      </label>
      <label>
        <span>执行结果</span>
        <select v-model="resultFilter">
          <option value="all">全部</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
        </select>
      </label>
    </section>

    <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>

    <section class="table-region">
      <AppTable compact>
        <thead>
          <tr>
            <th>时间</th>
            <th>互动</th>
            <th>QQ 用户</th>
            <th>关联玩家</th>
            <th>方向</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && !interactions.length">
            <td colspan="6" class="empty-cell">正在读取机器人互动记录</td>
          </tr>
          <tr v-else-if="!filteredInteractions.length">
            <td colspan="6" class="empty-cell">暂无符合条件的互动记录</td>
          </tr>
          <template v-else>
            <tr
              v-for="item in filteredInteractions"
              :key="item.id"
              class="record-row"
              @click="selected = item"
            >
              <td class="time-cell">{{ formatTime(item.createdAt) }}</td>
              <td class="interaction-cell">
                <span class="kind-mark" :data-kind="item.kind">{{ kindLabel(item.kind) }}</span>
                <div>
                  <strong>{{ actionLabel(item.action) }}</strong>
                  <small>{{ item.summary || item.eventId || "—" }}</small>
                </div>
              </td>
              <td>
                <strong v-if="item.qqName">{{ item.qqName }}</strong>
                <small v-if="item.qqNumber">{{ item.qqNumber }}</small>
                <span v-if="!item.qqName && !item.qqNumber">—</span>
              </td>
              <td>
                <strong v-if="item.playerName">{{ item.playerName }}</strong>
                <small v-if="item.steam64">{{ item.steam64 }}</small>
                <span v-if="!item.playerName && !item.steam64">—</span>
              </td>
              <td>{{ directionLabel(item.direction) }}</td>
              <td><span class="result-pill" :data-ok="item.ok">{{ item.ok ? "成功" : "失败" }}</span></td>
            </tr>
          </template>
        </tbody>
      </AppTable>
    </section>

    <div v-if="selected" class="detail-backdrop" @click.self="selected = null">
      <aside class="detail-drawer" role="dialog" aria-modal="true">
        <header>
          <div>
            <p>{{ kindLabel(selected.kind) }}</p>
            <h2>{{ actionLabel(selected.action) }}</h2>
          </div>
          <button type="button" aria-label="关闭" @click="selected = null">×</button>
        </header>
        <dl>
          <div><dt>发生时间</dt><dd>{{ formatTime(selected.createdAt, true) }}</dd></div>
          <div><dt>方向</dt><dd>{{ directionLabel(selected.direction) }}</dd></div>
          <div><dt>QQ 用户</dt><dd>{{ selected.qqName || "—" }} {{ selected.qqNumber || "" }}</dd></div>
          <div><dt>关联玩家</dt><dd>{{ selected.playerName || "—" }} {{ selected.steam64 || "" }}</dd></div>
          <div><dt>来源 IP</dt><dd>{{ selected.clientIp || "—" }}</dd></div>
          <div><dt>Event ID</dt><dd>{{ selected.eventId || "—" }}</dd></div>
        </dl>
        <section class="detail-json">
          <h3>互动详情</h3>
          <pre>{{ prettyJson(selected.detail) }}</pre>
        </section>
      </aside>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

import AppPage from "../components/common/AppPage.vue";
import AppStatusBadge from "../components/common/AppStatusBadge.vue";
import AppTable from "../components/common/AppTable.vue";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";

type InteractionKind = "command" | "event" | "ack" | string;

interface BotInteraction {
  id: string;
  createdAt: string;
  kind: InteractionKind;
  direction: string;
  action: string;
  qqNumber?: string;
  qqName?: string;
  steam64?: string;
  playerId?: number | null;
  playerName?: string;
  clientIp?: string;
  eventId?: string;
  ok: boolean;
  summary?: string;
  detail?: Record<string, unknown>;
}

const interactions = ref<BotInteraction[]>([]);
const bridgeEnabled = ref(false);
const websocketClients = ref(0);
const loading = ref(true);
const errorMessage = ref("");
const autoRefresh = ref(true);
const search = ref("");
const kindFilter = ref("all");
const resultFilter = ref("all");
const selected = ref<BotInteraction | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

const commandCount = computed(() => interactions.value.filter((item) => item.kind === "command").length);
const eventCount = computed(() => interactions.value.filter((item) => item.kind === "event").length);
const ackCount = computed(() => interactions.value.filter((item) => item.kind === "ack").length);
const failedCount = computed(() => interactions.value.filter((item) => !item.ok).length);

const filteredInteractions = computed(() => {
  const needle = search.value.toLowerCase();
  return interactions.value.filter((item) => {
    if (kindFilter.value !== "all" && item.kind !== kindFilter.value) return false;
    if (resultFilter.value === "success" && !item.ok) return false;
    if (resultFilter.value === "failed" && item.ok) return false;
    if (!needle) return true;
    return [
      item.action,
      item.summary,
      item.qqNumber,
      item.qqName,
      item.steam64,
      item.playerName,
      item.eventId,
      JSON.stringify(item.detail ?? {}),
    ].some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
});

async function load() {
  loading.value = true;
  try {
    const response = await fetch("/api/astrbot/panel-status", { credentials: "include" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    const state = payload?.data ?? {};
    interactions.value = Array.isArray(state?.interactions?.recent) ? state.interactions.recent : [];
    bridgeEnabled.value = Boolean(state?.enabled);
    websocketClients.value = Number(state?.websocket?.clients ?? 0);
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "互动记录加载失败";
  } finally {
    loading.value = false;
  }
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  if (autoRefresh.value) startTimer();
  else stopTimer();
}

function startTimer() {
  stopTimer();
  timer = setInterval(load, 3000);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function kindLabel(kind: string) {
  return ({ command: "QQ群命令", event: "Panel 推送", ack: "送达确认" } as Record<string, string>)[kind] ?? kind;
}

function directionLabel(direction: string) {
  return direction === "outgoing" ? "Panel → 机器人" : "机器人 → Panel";
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    bind: "绑定 Steam",
    status: "查询绑定状态",
    serverInfo: "查询服务器信息",
    serverInfoSnapshot: "服务器信息快照",
    query: "玩家综合查询",
    queryMyInfo: "查询我的信息",
    queryMySnapshot: "玩家信息快照",
    unbind: "解除账号绑定",
    "event.ack": "群消息送达确认",
  };
  return labels[action] ?? action;
}

function formatTime(value?: string, full = false) {
  const date = new Date(value ?? "");
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", full
    ? { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }
    : { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }
  ).format(date);
}

function prettyJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

onMounted(() => {
  load();
  startTimer();
});

onUnmounted(stopTimer);
</script>

<style scoped>
.astrbot-interactions-page { min-height: 100%; background: #091018; color: #dce7f2; }
.toolbar-status { display: flex; flex-wrap: wrap; gap: .5rem; }
.toolbar-button { border: 1px solid #30445a; border-radius: 8px; background: #132131; color: #dce7f2; padding: .55rem .85rem; cursor: pointer; }
.toolbar-button.primary, .toolbar-button.active { border-color: #2f9e75; background: #163c33; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; padding: .9rem 1rem; }
.summary-grid article { display: grid; gap: .25rem; min-height: 96px; padding: .85rem 1rem; border: 1px solid #22364a; border-radius: 12px; background: linear-gradient(145deg, #111d2a, #0c151f); }
.summary-grid article[data-tone="danger"] { border-color: #743942; }
.summary-grid article[data-tone="ok"] { border-color: #285c4d; }
.summary-grid span, .summary-grid small { color: #8297aa; }
.summary-grid strong { font-size: 1.8rem; line-height: 1; }
.filter-bar { display: grid; grid-template-columns: minmax(260px, 1fr) 180px 180px; gap: .75rem; padding: 0 1rem .9rem; }
.filter-bar label { display: grid; gap: .35rem; color: #91a7ba; font-size: .78rem; }
.filter-bar input, .filter-bar select { min-height: 38px; border: 1px solid #2b4054; border-radius: 8px; background: #0d1823; color: #e7eff7; padding: 0 .7rem; }
.error-banner { margin: 0 1rem .75rem; border: 1px solid #7c3540; border-radius: 8px; background: #351820; color: #ffb8c1; padding: .7rem .85rem; }
.table-region { margin: 0 1rem 1rem; overflow: auto; border: 1px solid #22364a; border-radius: 12px; }
.record-row { cursor: pointer; }
.record-row:hover { background: #142435; }
.time-cell { white-space: nowrap; color: #91a7ba; }
.interaction-cell { display: flex; align-items: center; gap: .65rem; min-width: 260px; }
.interaction-cell div, td { min-width: 0; }
.interaction-cell strong, td > strong, td > small { display: block; }
.interaction-cell small, td > small { overflow: hidden; color: #8297aa; text-overflow: ellipsis; white-space: nowrap; }
.kind-mark { flex: none; border: 1px solid #345069; border-radius: 999px; padding: .2rem .5rem; color: #a9c0d4; font-size: .72rem; }
.kind-mark[data-kind="command"] { border-color: #2b8064; color: #72d8b4; }
.kind-mark[data-kind="event"] { border-color: #3566a1; color: #8bbcff; }
.kind-mark[data-kind="ack"] { border-color: #8a6a28; color: #e8c46c; }
.result-pill { display: inline-flex; border-radius: 999px; padding: .2rem .55rem; background: #51262d; color: #ffb1bb; font-size: .75rem; }
.result-pill[data-ok="true"] { background: #173d32; color: #79dcb7; }
.empty-cell { height: 180px; text-align: center; color: #8297aa; }
.detail-backdrop { position: fixed; z-index: 80; inset: 0; display: flex; justify-content: flex-end; background: #02070db8; }
.detail-drawer { width: min(560px, 94vw); height: 100%; overflow: auto; border-left: 1px solid #2b4054; background: #0c1621; box-shadow: -20px 0 60px #0008; padding: 1.1rem; }
.detail-drawer header { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 1rem; border-bottom: 1px solid #22364a; }
.detail-drawer header p { margin: 0 0 .25rem; color: #6f8da7; font-size: .75rem; text-transform: uppercase; }
.detail-drawer h2 { margin: 0; }
.detail-drawer header button { border: 0; background: transparent; color: #c8d7e5; font-size: 1.7rem; cursor: pointer; }
.detail-drawer dl { display: grid; grid-template-columns: 1fr 1fr; gap: .7rem; }
.detail-drawer dl div { min-width: 0; border: 1px solid #203447; border-radius: 8px; padding: .65rem; background: #101d29; }
.detail-drawer dt { color: #7891a7; font-size: .72rem; }
.detail-drawer dd { overflow-wrap: anywhere; margin: .25rem 0 0; }
.detail-json { margin-top: 1rem; }
.detail-json pre { overflow: auto; max-height: 360px; border: 1px solid #22364a; border-radius: 8px; background: #071019; padding: .8rem; color: #a9c4dc; }
@media (max-width: 900px) { .summary-grid { grid-template-columns: 1fr 1fr; } .filter-bar { grid-template-columns: 1fr 1fr; } .search-field { grid-column: 1 / -1; } }
@media (max-width: 560px) { .summary-grid, .filter-bar { grid-template-columns: 1fr; } .search-field { grid-column: auto; } .detail-drawer dl { grid-template-columns: 1fr; } }
</style>
