<template>
  <div class="admin-warns-page">
    <header class="dashboard-header">
      <div class="header-left">
        <h1 class="title">广播与警告指挥中心</h1>
        <p class="subtitle">实时监控与下发 RCON 指令</p>
      </div>
      <div class="header-right">
        <div class="header-stat">
          <span class="l">总记录</span>
          <span class="v">{{ (warningRecords.length + broadcastRecords.length) }}</span>
        </div>
        <button type="button" class="action-btn" :class="{ spinning: isFetching }" @click="refetchAll">
          <span class="icon">↻</span> 同步
        </button>
      </div>
    </header>

    <main class="dashboard-grid">
      <!-- 左栏：玩家警告 -->
      <section class="dashboard-col">
        <div class="col-head">
          <div class="op-label"><span class="dot warn"></span> 玩家警告 / WARNING</div>
        </div>
        
        <div class="op-card warning-op-card">
          <div class="input-row">
            <input v-model="warningForm.targetName" type="text" placeholder="玩家名称 (必填)" class="hero-input" />
          </div>
          <div class="input-row sub">
            <input v-model="warningForm.targetSteamId" type="text" placeholder="SteamID64" />
            <input v-model="warningForm.targetEosId" type="text" placeholder="EOS ID" />
          </div>

          <!-- 场景模板磁贴 -->
          <div class="input-row tpl-tiles warning-tpl">
            <button v-for="t in templates.warning" :key="t.label" class="tpl-tile" @click="applyTemplate('warning', t)">
              <div class="t-name">{{ t.label }}</div>
              <div class="t-reason">{{ t.reason }}</div>
            </button>
          </div>

          <div class="input-row msg">
            <textarea v-model="warningForm.message" placeholder="警告内容..." maxlength="180"></textarea>
            <div class="char-count" :class="{ limit: warningForm.message.length > 170 }">{{ warningForm.message.length }}/180</div>
          </div>
          <div class="card-ctrl">
            <div class="meta">
              <input v-model="warningForm.reason" type="text" placeholder="原因" />
              <input v-model="warningForm.sourceModule" type="text" placeholder="来源" />
            </div>
            <button class="send-btn warn" :disabled="warningBusy" @click="sendWarning">
              {{ warningBusy ? '...' : '发送警告' }}
            </button>
          </div>
        </div>

        <div class="log-area">
          <div class="log-toolbar">
            <span>警告审计记录</span>
            <input v-model="warningFilters.targetName" placeholder="筛选..." />
          </div>
          <div class="log-viewport">
            <DataState :loading="warningQuery.isLoading.value && !warningRecords.length" :empty="!warningRecords.length">
              <div class="log-scroll">
                <div v-for="item in warningRecords" :key="item.id" class="log-line" :data-status="item.success ? (item.skipped ? 'skipped' : 'success') : 'error'">
                  <div class="line-status"></div>
                  <div class="line-time">{{ formatTimeOnly(item.createdAt) }}</div>
                  <div class="line-body">
                    <div class="line-id"><strong>{{ item.targetName }}</strong> <span>{{ item.reason }}</span></div>
                    <div class="line-msg">{{ item.message }}</div>
                  </div>
                </div>
              </div>
            </DataState>
          </div>
        </div>
      </section>

      <!-- 右栏：全服广播 -->
      <section class="dashboard-col">
        <div class="col-head">
          <div class="op-label"><span class="dot broadcast"></span> 全服广播 / BROADCAST</div>
        </div>

        <div class="op-card broadcast-op-card">
          <!-- 消息前缀栏 -->
          <div class="input-row prefix-row">
            <div class="prefix-selector">
              <span class="lbl">消息前缀</span>
              <div class="p-chips">
                <button v-for="p in ['[ADMIN]', '[NOTICE]', '[RULES]', '[VOTE]']" :key="p" @click="addPrefix(p)">{{ p }}</button>
              </div>
            </div>
          </div>

          <!-- 场景模板磁贴 -->
          <div class="input-row tpl-tiles">
            <button v-for="t in templates.broadcast" :key="t.label" class="tpl-tile" @click="applyTemplate('broadcast', t)">
              <div class="t-name">{{ t.label }}</div>
              <div class="t-reason">{{ t.reason }}</div>
            </button>
          </div>

          <!-- 消息区 -->
          <div class="input-row broadcast-msg">
            <textarea v-model="broadcastForm.message" placeholder="全服广播内容..." maxlength="250"></textarea>
            <div class="char-count" :class="{ limit: broadcastForm.message.length > 240 }">{{ broadcastForm.message.length }}/250</div>
          </div>

          <div class="card-ctrl">
            <div class="meta">
              <input v-model="broadcastForm.reason" type="text" placeholder="原因" />
              <input v-model="broadcastForm.sourceModule" type="text" placeholder="来源" />
            </div>
            <button class="send-btn broadcast" :disabled="broadcastBusy" @click="sendBroadcast">
              {{ broadcastBusy ? '...' : '立即下发' }}
            </button>
          </div>
        </div>

        <div class="log-area">
          <div class="log-toolbar">
            <span>广播审计记录</span>
            <input v-model="broadcastFilters.sourceModule" placeholder="筛选..." />
          </div>
          <div class="log-viewport">
            <DataState :loading="broadcastQuery.isLoading.value && !broadcastRecords.length" :empty="!broadcastRecords.length">
              <div class="log-scroll">
                <div v-for="item in broadcastRecords" :key="item.id" class="log-line" :data-status="item.success ? (item.skipped ? 'skipped' : 'success') : 'error'">
                  <div class="line-status"></div>
                  <div class="line-time">{{ formatTimeOnly(item.createdAt) }}</div>
                  <div class="line-body">
                    <div class="line-id"><span class="src">{{ item.sourceModule }}</span> <span>{{ item.reason }}</span></div>
                    <div class="line-msg">{{ item.message }}</div>
                  </div>
                </div>
              </div>
            </DataState>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet } from "../app/apiClient";
import { broadcastMessage, warnPlayer } from "../app/squadManagementApi";
import { useUiStore } from "../stores/ui.store";
import DataState from "../components/common/DataState.vue";

interface ModuleRecord {
  id: string;
  createdAt?: number;
  sourceModule?: string;
  reason?: string;
  targetName?: string;
  message?: string;
  success?: boolean;
  skipped?: boolean;
}

interface ModuleRecentResponse {
  records: ModuleRecord[];
}

const ui = useUiStore();
const warningBusy = ref(false);
const broadcastBusy = ref(false);

const templates = {
  warning: [
    { label: "压家意图警告", reason: "main_camping_intent", message: "请注意，已有压家意图，请立即离开该区域。" },
    { label: "压家警告", reason: "main_camping", message: "严禁压家行为，请立即撤离，否则将被处理。" },
    { label: "擦边压家警告", reason: "main_camping_border", message: "您当前位置属于擦边压家，请保持距离。" },
    { label: "禁止单载", reason: "solo_vehicle", message: "本服严禁单人驾驶重要载具，请组队或下车。" },
    { label: "步兵队禁止锁队", reason: "infantry_lock", message: "步兵小队禁止锁队，请保持队伍开放。" },
    { label: "5人队禁锁", reason: "infantry_lock_5", message: "大于等于五人为步兵队，步兵队禁止锁队。" },
  ],
  broadcast: [
    { label: "欢迎语", reason: "welcome", message: "欢迎来到 BZSS 社区服务器！请遵守规则，祝您游戏愉快。" },
    { label: "Discord", reason: "discord", message: "加入我们的 Discord：discord.gg/bzss。" },
    { label: "服规提醒", reason: "rules", message: "温馨提示：本服严禁开挂、恶意TK。如遇违规请前往群组或管理中心举报。" },
    { label: "地图投票", reason: "map_vote", message: "本局即将结束，请大家做好准备，稍后将进行下一局地图投票。" },
  ]
};

const warningForm = reactive({ targetName: "", targetSteamId: "", targetEosId: "", message: "", reason: "manual_warn", sourceModule: "web.broadcastModule" });
const broadcastForm = reactive({ message: "", reason: "manual_broadcast", sourceModule: "web.broadcastModule" });

const warningFilters = reactive({ targetName: "", sourceModule: "", reason: "", success: "", skipped: "", limit: 50 });
const broadcastFilters = reactive({ sourceModule: "", reason: "", success: "", skipped: "", limit: 50 });

const REFRESH_INTERVAL_MS = 8000;
const timeCache = new Map<number, string>();

const warningQuery = useQuery({
  queryKey: computed(() => ["admin-warns", "warning", warningFilters.targetName, warningFilters.sourceModule, warningFilters.success]),
  queryFn: () => fetchRecords("warning", warningFilters),
  refetchInterval: REFRESH_INTERVAL_MS,
});

const broadcastQuery = useQuery({
  queryKey: computed(() => ["admin-warns", "broadcast", broadcastFilters.sourceModule, broadcastFilters.success]),
  queryFn: () => fetchRecords("broadcast", broadcastFilters),
  refetchInterval: REFRESH_INTERVAL_MS,
});

async function fetchRecords(kind: string, filters: any) {
  const params = new URLSearchParams({ kind, limit: String(filters.limit) });
  if (filters.targetName?.trim()) params.set("targetName", filters.targetName.trim());
  if (filters.sourceModule?.trim()) params.set("sourceModule", filters.sourceModule.trim());
  if (filters.success) params.set("success", filters.success);
  return apiGet<ModuleRecentResponse>(`/api/admin-warns/recent?${params.toString()}`);
}

const warningRecords = computed(() => warningQuery.data.value?.records ?? []);
const broadcastRecords = computed(() => broadcastQuery.data.value?.records ?? []);
const isFetching = computed(() => warningQuery.isFetching.value || broadcastQuery.isFetching.value);

function refetchAll() { warningQuery.refetch(); broadcastQuery.refetch(); }

function applyTemplate(type: 'warning' | 'broadcast', tpl: any) {
  if (type === 'warning') { warningForm.reason = tpl.reason; warningForm.message = tpl.message; }
  else { broadcastForm.reason = tpl.reason; broadcastForm.message = tpl.message; }
}

function addPrefix(p: string) {
  if (broadcastForm.message.startsWith(p)) return;
  broadcastForm.message = p + ' ' + broadcastForm.message;
}

async function sendWarning() {
  const { targetName, message } = warningForm;
  if (!targetName.trim() || !message.trim()) { ui.pushToast({ title: "输入不完整", message: "玩家名和内容必填", tone: "warn" }); return; }
  warningBusy.value = true;
  try {
    const res = await warnPlayer({ ...warningForm });
    if (!res.success) throw new Error(res.errorMessage || "RCON ERROR");
    warningForm.message = ""; ui.pushToast({ title: "警告已发送", message: `已下发警告`, tone: "ok" }); warningQuery.refetch();
  } catch (e) { ui.pushToast({ title: "发送失败", message: String(e), tone: "error" }); }
  finally { warningBusy.value = false; }
}

async function sendBroadcast() {
  if (!broadcastForm.message.trim()) { ui.pushToast({ title: "内容为空", message: "请输入内容", tone: "warn" }); return; }
  broadcastBusy.value = true;
  try {
    const res = await broadcastMessage({ ...broadcastForm });
    if (!res.success) throw new Error(res.errorMessage || "RCON ERROR");
    broadcastForm.message = ""; ui.pushToast({ title: "广播已发送", message: "已送达", tone: "ok" }); broadcastQuery.refetch();
  } catch (e) { ui.pushToast({ title: "发送失败", message: String(e), tone: "error" }); }
  finally { broadcastBusy.value = false; }
}

function formatTimeOnly(v: any) {
  const n = Number(v); if (!n) return "--:--";
  if (timeCache.has(n)) return timeCache.get(n);
  const t = new Date(n).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  timeCache.set(n, t); return t;
}
</script>

<style scoped>
.admin-warns-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--theme-background-rich);
  color: var(--color-text-primary);
  overflow: hidden;
  font-family: 'Inter', -apple-system, sans-serif;
}

/* Header: Tactical Glass Look */
.dashboard-header {
  padding: 8px 24px;
  background: color-mix(in srgb, var(--color-bg-panel) 92%, transparent);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--color-border-soft);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  z-index: 10;
}
.dashboard-header .title { font-size: 15px; font-weight: 900; margin: 0; color: var(--color-text-primary); letter-spacing: 1px; text-transform: uppercase; }
.dashboard-header .subtitle { font-size: 10px; margin: 0; color: var(--color-text-muted); font-weight: 700; }

.header-right { display: flex; align-items: center; gap: 24px; }
.header-stat { display: flex; align-items: baseline; gap: 8px; }
.header-stat .l { font-size: 9px; color: #475569; font-weight: 800; text-transform: uppercase; }
.header-stat .v { font-size: 14px; font-weight: 900; color: #38bdf8; font-family: 'JetBrains Mono', monospace; text-shadow: 0 0 10px rgba(56, 189, 248, 0.4); }
.action-btn { background: rgba(51, 65, 85, 0.5); border: 1px solid rgba(255, 255, 255, 0.1); color: #fff; padding: 4px 10px; border-radius: 4px; font-size: 10px; font-weight: 800; cursor: pointer; transition: all 0.2s; }
.action-btn:hover { background: #334155; border-color: #38bdf8; }
.spinning .icon { display: inline-block; animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* Grid */
.dashboard-grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--color-border-soft); min-height: 0; }
.dashboard-col { background: transparent; display: flex; flex-direction: column; min-height: 0; padding: 12px; gap: 12px; }

.col-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: -4px; }
.op-label { font-size: 11px; font-weight: 900; display: flex; align-items: center; gap: 8px; color: #94a3b8; letter-spacing: 0.5px; }
.dot { width: 6px; height: 6px; border-radius: 50%; }
.dot.warn { background: #ef4444; box-shadow: 0 0 8px #ef4444; }
.dot.broadcast { background: #3b82f6; box-shadow: 0 0 8px #3b82f6; }

/* Op Card: Glassmorphism */
.op-card {
  background: color-mix(in srgb, var(--color-bg-card) 88%, transparent);
  backdrop-filter: blur(8px);
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
  height: 270px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

.input-row { display: flex; gap: 8px; position: relative; }
.hero-input { flex: 1; background: var(--color-bg-elevated); border: 1px solid var(--color-border-default); color: var(--color-text-primary); font-size: 13px; font-weight: 800; padding: 6px 10px; border-radius: 4px; }
.hero-input:focus { border-color: rgba(56, 189, 248, 0.5); outline: none; }
.input-row.sub input { flex: 1; background: color-mix(in srgb, var(--color-bg-elevated) 92%, transparent); border: 1px solid var(--color-border-soft); color: var(--color-text-muted); font-size: 10px; padding: 4px 8px; border-radius: 4px; }

.input-row textarea { flex: 1; background: var(--color-bg-elevated); border: 1px solid var(--color-border-default); color: var(--color-text-primary); padding: 8px; border-radius: 4px; font-size: 12px; resize: none; width: 100%; line-height: 1.5; }
.input-row textarea:focus { border-color: rgba(56, 189, 248, 0.5); outline: none; }

/* Broadcast Specific */
.prefix-row { height: 28px; }
.prefix-selector { display: flex; align-items: center; gap: 8px; }
.prefix-selector .lbl { font-size: 8px; color: #475569; text-transform: uppercase; font-weight: 900; }
.p-chips { display: flex; gap: 4px; }
.p-chips button { background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.05); color: #38bdf8; font-size: 9px; font-weight: 900; padding: 1px 6px; border-radius: 3px; cursor: pointer; transition: all 0.2s; }
.p-chips button:hover { background: #38bdf8; color: #000; }

.tpl-tiles { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; min-height: 36px; }
.tpl-tile { background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 4px; padding: 2px 8px; text-align: left; cursor: pointer; display: flex; flex-direction: column; justify-content: center; transition: all 0.2s; color: inherit; }
.tpl-tile:hover { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.2); }
.tpl-tile .t-name { font-size: 9px; font-weight: 900; color: #cbd5e1; }
.tpl-tile .t-reason { font-size: 7px; color: #475569; text-transform: uppercase; }

.broadcast-msg textarea { height: 74px !important; }
.warning-op-card .msg textarea { height: 60px; }

.char-count { position: absolute; right: 8px; bottom: 8px; font-size: 8px; color: #475569; font-family: 'JetBrains Mono', monospace; font-weight: 700; }
.char-count.limit { color: #f87171; text-shadow: 0 0 5px #ef4444; }

.card-ctrl { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 8px; }
.meta { display: flex; gap: 6px; }
.meta input { width: 64px; background: transparent; border: 1px solid rgba(255, 255, 255, 0.05); color: #475569; font-size: 9px; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; font-weight: 700; }
.send-btn { border: none; color: #fff; font-weight: 900; padding: 6px 24px; border-radius: 4px; cursor: pointer; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; transition: all 0.2s; }
.send-btn.warn { background: #dc2626; box-shadow: 0 0 15px rgba(220, 38, 38, 0.2); }
.send-btn.warn:hover { background: #ef4444; box-shadow: 0 0 20px rgba(239, 68, 68, 0.4); transform: translateY(-1px); }
.send-btn.broadcast { background: #2563eb; box-shadow: 0 0 15px rgba(37, 99, 235, 0.2); }
.send-btn.broadcast:hover { background: #3b82f6; box-shadow: 0 0 20px rgba(59, 130, 246, 0.4); transform: translateY(-1px); }

/* Log Area */
.log-area { flex: 1; display: flex; flex-direction: column; min-height: 0; gap: 6px; }
.log-toolbar { display: flex; justify-content: space-between; align-items: center; font-size: 10px; font-weight: 900; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; }
.log-toolbar input { background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.05); color: #fff; font-size: 9px; padding: 2px 8px; border-radius: 3px; width: 100px; }

.log-viewport { flex: 1; background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255, 255, 255, 0.03); border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; }
.log-scroll { overflow-y: auto; flex: 1; scrollbar-gutter: stable; }
.log-scroll::-webkit-scrollbar { width: 3px; }
.log-scroll::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }

.log-line { display: flex; border-bottom: 1px solid rgba(255, 255, 255, 0.02); align-items: stretch; min-height: 34px; transition: background 0.2s; }
.log-line:hover { background: rgba(255, 255, 255, 0.02); }
.line-status { width: 2px; }
.log-line[data-status="success"] .line-status { background: #10b981; box-shadow: 0 0 5px #10b981; }
.log-line[data-status="error"] .line-status { background: #ef4444; box-shadow: 0 0 5px #ef4444; }
.log-line[data-status="skipped"] .line-status { background: #f59e0b; box-shadow: 0 0 5px #f59e0b; }

.line-time { width: 44px; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #475569; display: flex; align-items: center; justify-content: center; border-right: 1px solid rgba(255, 255, 255, 0.02); }
.line-body { flex: 1; padding: 4px 10px; display: flex; flex-direction: column; justify-content: center; gap: 1px; }
.line-id { font-size: 9px; line-height: 1; margin-bottom: 2px; }
.line-id strong { color: #94a3b8; font-weight: 800; }
.line-id .src { color: #38bdf8; font-weight: 900; }
.line-id span { color: #334155; margin-left: 6px; font-weight: 800; }
.line-msg { font-size: 11px; color: #cbd5e1; white-space: pre-wrap; line-height: 1.4; }

@media (max-width: 1000px) {
  .dashboard-grid { grid-template-columns: 1fr; overflow-y: auto; }
  .dashboard-col { height: auto; flex: none; }
  .log-viewport { height: 320px; }
}
</style>
