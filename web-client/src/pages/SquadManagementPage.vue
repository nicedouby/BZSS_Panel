<template>
  <section class="squad-management-modern">
    <!-- PAGE HEADER -->
    <header class="mgmt-header">
      <div class="mgmt-title-group">
        <div class="mgmt-eyebrow">COMMAND & CONTROL</div>
        <h1 class="mgmt-title">小队战务管理 <small>Squad Management</small></h1>
      </div>
      <div class="mgmt-header-actions">
        <div class="sync-status" :class="{ active: loading }">
          <span class="pulse"></span>
          {{ loading ? "同步中..." : "实时监听中" }}
        </div>
        <button class="glass-btn" @click="reload" :disabled="loading">
          <span class="icon">🔄</span> 刷新数据
        </button>
      </div>
    </header>

    <div class="mgmt-container">
      <!-- LEFT COLUMN: QUICK ACTIONS -->
      <aside class="mgmt-actions-panel">
        <div class="panel-inner">
          <div class="panel-section">
            <h2 class="section-label">核心指令 <small>CORE COMMANDS</small></h2>
            
            <!-- DISBAND -->
            <div class="action-card glass">
              <div class="card-head">
                <span class="dot danger"></span>
                <h3>解散指定小队</h3>
              </div>
              <div class="card-form">
                <div class="form-row">
                  <div class="field">
                    <label>Team</label>
                    <input v-model="disbandTeamId" type="number" placeholder="1 / 2" />
                  </div>
                  <div class="field">
                    <label>Squad #</label>
                    <input v-model="disbandSquadId" type="number" placeholder="ID" />
                  </div>
                </div>
                <div class="field">
                  <label>操作来源</label>
                  <input v-model="disbandSource" type="text" placeholder="manual / discord" />
                </div>
                <div class="field">
                  <label>审计原因</label>
                  <input v-model="disbandReason" type="text" placeholder="为什么解散？" />
                </div>
                <button class="action-btn danger-filled" :disabled="!viewerCanDisband || actionBusy || !canSubmitDisband" @click="handleDisband">
                  确认执行解散
                </button>
              </div>
            </div>

            <!-- KICK -->
            <div class="action-card glass">
              <div class="card-head">
                <span class="dot danger"></span>
                <h3>踢出服务器</h3>
              </div>
              <div class="card-form">
                <div class="field">
                  <label>目标玩家</label>
                  <input v-model="kickTarget" type="text" placeholder="名称, SteamID 或 EOS" />
                </div>
                <div class="field">
                  <label>审计原因</label>
                  <input v-model="kickReason" type="text" placeholder="踢出理由" />
                </div>
                <button class="action-btn danger-outline" :disabled="!viewerCanKick || actionBusy || !canSubmitKick" @click="handleKick">
                  将玩家踢出
                </button>
              </div>
            </div>

            <!-- REMOVE -->
            <div class="action-card glass">
              <div class="card-head">
                <span class="dot warn"></span>
                <h3>移出所在小队</h3>
              </div>
              <div class="card-form">
                <div class="field">
                  <label>目标玩家</label>
                  <input v-model="removeTarget" type="text" placeholder="名称, SteamID 或 EOS" />
                </div>
                <button class="action-btn warn-outline" :disabled="!viewerCanRemove || actionBusy || !canSubmitRemove" @click="handleRemove">
                  确认移出小队
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- RIGHT COLUMN: MONITORING & AUDIT -->
      <main class="mgmt-monitor">
        <!-- TOP: LIVE CREATION RADAR -->
        <section class="monitor-radar glass-panel">
          <header class="panel-header">
            <h2 class="panel-title">实时建队动态 <small>Creation Feed</small></h2>
            <div class="panel-meta">{{ recentCreations.length }} 个最近记录</div>
          </header>
          <div class="radar-horizontal-list">
            <div v-if="!recentCreations.length" class="empty-state">等待数据扫描...</div>
            <article v-for="log in recentCreations" :key="log.recordKey" class="radar-item glass">
              <div class="item-header">
                <span class="team-badge" :class="'team-' + log.teamId">T{{ log.teamId }}</span>
                <span class="sq-id">#{{ log.squadId }}</span>
                <span class="time">{{ formatTimeShort(log.time) }}</span>
              </div>
              <div class="item-body">
                <div class="sq-name">{{ log.squadName }}</div>
                <div class="creator">BY: {{ log.creatorName }}</div>
              </div>
            </article>
          </div>
        </section>

        <!-- BOTTOM: FULL AUDIT TABLE -->
        <section class="monitor-audit glass-panel">
          <header class="panel-header">
            <h2 class="panel-title">系统操作审计 <small>Audit Log</small></h2>
            <div class="audit-filters">
              <button 
                v-for="item in kindOptions" 
                :key="item.value"
                class="filter-chip"
                :class="{ active: selectedKind === item.value }"
                @click="selectedKind = item.value"
              >
                {{ item.label }} <span class="badge">{{ item.count }}</span>
              </button>
            </div>
          </header>

          <div class="audit-table-wrap">
            <table class="modern-table">
              <thead>
                <tr>
                  <th>时间 / 节点</th>
                  <th>指令类型</th>
                  <th>详细负荷 (来源 / 操作 / 目标)</th>
                  <th>执行状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!filteredRecords.length">
                  <td colspan="4" class="empty-row">无审计记录数据</td>
                </tr>
                <tr v-for="record in filteredRecords" :key="record.recordKey">
                  <td class="col-time">
                    <div class="time-stack">
                      <span class="clock">{{ formatTime(record.time).split(' ')[1] }}</span>
                      <span class="date">{{ formatTime(record.time).split(' ')[0] }}</span>
                    </div>
                  </td>
                  <td class="col-type">
                    <span class="type-tag" :data-kind="record.kind">{{ kindLabel(record.kind) }}</span>
                  </td>
                  <td class="col-detail">
                    <div class="detail-payload">
                      <div class="payload-meta">
                        <span class="source">{{ record.source || "Manual" }}</span>
                        <span v-if="record.operatorName" class="operator">BY {{ record.operatorName }}</span>
                      </div>
                      <div class="payload-main">
                        <strong>{{ recordTargetTitle(record) }}</strong>
                        <span class="sub">{{ recordTargetSubline(record) }}</span>
                      </div>
                      <div v-if="record.reason" class="payload-reason">
                        {{ record.reason }}
                      </div>
                    </div>
                  </td>
                  <td class="col-result">
                    <div class="result-box" :data-status="resultTone(record.result, record.error)">
                      <span class="res-label">{{ record.result || 'FAILED' }}</span>
                      <div v-if="record.error" class="res-error">{{ record.error }}</div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { renderApiError } from "../app/errors";
import {
  disbandSquad,
  kickPlayer,
  removePlayerFromSquad,
  getSquadManagementRecords,
  type SquadManagementRecord,
  type SquadManagementRecordsResponse,
} from "../app/squadManagementApi";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";

const auth = useAuthStore();
const ui = useUiStore();

const actionBusy = ref(false);
const selectedKind = ref<string>("all");

const disbandTeamId = ref("");
const disbandSquadId = ref("");
const disbandSource = ref("manual");
const disbandReason = ref("");

const kickTarget = ref("");
const kickSource = ref("manual");
const kickReason = ref("");

const removeTarget = ref("");
const removeSource = ref("manual");
const removeReason = ref("");

const query = useQuery<SquadManagementRecordsResponse>({
  queryKey: ["squad-management-records"],
  queryFn: async () => getSquadManagementRecords({ limit: 1000, offset: 0 }),
  refetchInterval: 5000,
});

const records = computed(() => [...(query.data.value?.records ?? [])]);
const summary = computed(() => query.data.value?.summary ?? null);
const viewer = computed(() => query.data.value?.viewer ?? null);
const pageError = computed(() => query.error.value ? renderApiError(query.error.value, "加载失败") : "");
const loading = computed(() => Boolean(query.isLoading.value || query.isFetching.value));

const viewerCanDisband = computed(() => Boolean(viewer.value?.canDisband || auth.user?.isSuperAdmin));
const viewerCanKick = computed(() => Boolean(viewer.value?.canKick || auth.user?.isSuperAdmin));
const viewerCanRemove = computed(() => Boolean(viewer.value?.canRemove || auth.user?.isSuperAdmin));

const kindOptions = computed(() => [
  { value: "all", label: "全部记录", count: summary.value?.total ?? 0 },
  { value: "squad_created", label: "建队动态", count: summary.value?.created ?? 0 },
  { value: "disband", label: "解散指令", count: summary.value?.disbanded ?? 0 },
  { value: "kick", label: "踢出指令", count: summary.value?.kicked ?? 0 },
  { value: "remove", label: "移出指令", count: summary.value?.removed ?? 0 },
  { value: "switch_team", label: "跳边指令", count: summary.value?.switched ?? 0 },
] as const);

const filteredRecords = computed(() => {
  if (selectedKind.value === "all") return records.value;
  return records.value.filter((record) => record.kind === selectedKind.value);
});

const recentCreations = computed(() => {
  return records.value
    .filter((r) => r.kind === "squad_created")
    .slice(0, 15);
});

const canSubmitDisband = computed(() => {
  return Boolean(disbandTeamId.value && disbandSquadId.value);
});

const canSubmitKick = computed(() => {
  return Boolean(kickTarget.value.trim());
});

const canSubmitRemove = computed(() => {
  return Boolean(removeTarget.value.trim());
});

onMounted(() => {
  console.log(">>> SQUAD_MANAGEMENT_MODERN_UI_V7_LOADED");
});

async function reload() {
  await query.refetch();
}

async function handleDisband() {
  if (!viewerCanDisband.value || actionBusy.value || !canSubmitDisband.value) return;
  const confirmed = await ui.openConfirm({
    title: "确认解散指令？",
    message: `TEAM ${disbandTeamId.value} SQUAD ${disbandSquadId.value}`,
    tone: "warn",
  });
  if (!confirmed) return;

  actionBusy.value = true;
  try {
    const res = await disbandSquad({
      teamId: Number(disbandTeamId.value),
      squadId: Number(disbandSquadId.value),
      source: disbandSource.value,
      reason: disbandReason.value.trim(),
    });
    if (!res.ok) throw new Error(res.message || "指令执行失败");
    ui.pushToast({ title: "指令已送达", message: "小队解散请求已处理", tone: "ok" });
    disbandTeamId.value = ""; disbandSquadId.value = ""; disbandReason.value = "";
    void reload();
  } catch (e) {
    ui.pushToast({ title: "指令失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

async function handleKick() {
  if (!viewerCanKick.value || actionBusy.value || !canSubmitKick.value) return;
  const confirmed = await ui.openConfirm({
    title: "确认踢出指令？",
    message: kickTarget.value,
    tone: "warn",
  });
  if (!confirmed) return;

  actionBusy.value = true;
  try {
    const res = await kickPlayer({
      anyId: kickTarget.value.trim(),
      source: kickSource.value,
      reason: kickReason.value.trim(),
    });
    if (!res.ok) throw new Error(res.message || "指令执行失败");
    ui.pushToast({ title: "指令已送达", message: "踢出玩家请求已处理", tone: "ok" });
    kickTarget.value = ""; kickReason.value = "";
    void reload();
  } catch (e) {
    ui.pushToast({ title: "指令失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

async function handleRemove() {
  if (!viewerCanRemove.value || actionBusy.value || !canSubmitRemove.value) return;
  const confirmed = await ui.openConfirm({
    title: "确认移出指令？",
    message: removeTarget.value,
    tone: "warn",
  });
  if (!confirmed) return;

  actionBusy.value = true;
  try {
    const res = await removePlayerFromSquad({
      anyId: removeTarget.value.trim(),
      source: removeSource.value,
      reason: removeReason.value.trim(),
    });
    if (!res.ok) throw new Error(res.message || "指令执行失败");
    ui.pushToast({ title: "指令已送达", message: "玩家移出请求已处理", tone: "ok" });
    removeTarget.value = ""; removeReason.value = "";
    void reload();
  } catch (e) {
    ui.pushToast({ title: "指令失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

function kindLabel(kind: string) {
  if (kind === "squad_created") return "新建小队";
  if (kind === "disband") return "解散指令";
  if (kind === "kick") return "踢出指令";
  if (kind === "remove") return "移出指令";
  return kind;
}

function kindTone(kind: string) {
  if (kind === "squad_created") return "ok";
  if (kind === "disband") return "danger";
  if (kind === "kick") return "danger";
  if (kind === "remove") return "warn";
  return "neutral";
}

function resultTone(result: string, error: string) {
  if (error) return "danger";
  if (result === "success" || result === "created") return "ok";
  return "neutral";
}

function recordTargetTitle(record: SquadManagementRecord) {
  if (record.kind === "kick" || record.kind === "remove") return record.playerName || "Unknown Player";
  return `T${record.teamId ?? "?"} S${record.squadId ?? "?"}`;
}

function recordTargetSubline(record: SquadManagementRecord) {
  if (record.kind === "kick" || record.kind === "remove") return record.steamId || record.eosId || "";
  return record.squadName || "";
}

function formatTime(v: any) {
  if (!v) return "--";
  return new Date(v).toLocaleString("zh-CN", { hour12: false });
}

function formatTimeShort(v: any) {
  if (!v) return "--";
  const date = new Date(v);
  return date.toLocaleTimeString("zh-CN", { hour12: false, hour: '2-digit', minute: '2-digit' });
}
</script>

<style scoped>
.squad-management-modern {
  height: 100vh;
  background: var(--app-background, #070b10);
  color: var(--color-text-primary, #eef5fb);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: Inter, "Microsoft YaHei", sans-serif;
}

/* GLASS EFFECT HELPER */
.glass {
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  box-shadow: 0 4px 24px -1px rgba(0, 0, 0, 0.2);
}

.glass-panel {
  background: rgba(13, 20, 28, 0.45);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-border-soft, rgba(130, 154, 180, 0.15));
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

/* HEADER */
.mgmt-header {
  padding: 16px 32px;
  background: linear-gradient(to bottom, rgba(0,0,0,0.3), transparent);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.mgmt-eyebrow {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 2px;
  color: var(--color-status-info, #60a5fa);
  margin-bottom: 4px;
}

.mgmt-title {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
}

.mgmt-title small {
  font-size: 13px;
  font-weight: 400;
  color: var(--color-text-muted);
  margin-left: 12px;
  opacity: 0.7;
}

.mgmt-header-actions {
  display: flex;
  align-items: center;
  gap: 20px;
}

.sync-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.sync-status.active { color: var(--color-status-info); }

.pulse {
  width: 6px;
  height: 6px;
  background: var(--color-status-online);
  border-radius: 50%;
  box-shadow: 0 0 6px var(--color-status-online);
  animation: mgmt-pulse 2s infinite;
}

@keyframes mgmt-pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.5); opacity: 0.5; }
  100% { transform: scale(1); opacity: 1; }
}

.glass-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #fff;
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 13px;
  font-weight: 600;
}

.glass-btn:hover { background: rgba(255, 255, 255, 0.1); border-color: var(--color-status-info); }

/* CONTAINER LAYOUT */
.mgmt-container {
  flex: 1;
  display: grid;
  grid-template-columns: 320px 1fr;
  padding: 0 24px 24px;
  gap: 20px;
  min-height: 0;
}

/* ACTIONS SIDEBAR */
.mgmt-actions-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.panel-inner {
  flex: 1;
  overflow-y: auto;
  padding-right: 10px;
  scrollbar-gutter: stable;
}

.section-label {
  font-size: 11px;
  font-weight: 800;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  margin: 0 0 12px 4px;
}

.action-card {
  padding: 18px;
  margin-bottom: 16px;
  transition: border-color 0.2s;
  overflow: hidden;
}

.action-card:hover {
  border-color: rgba(255, 255, 255, 0.15);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.card-head h3 { margin: 0; font-size: 14px; font-weight: 700; color: #fff; }

.dot { width: 6px; height: 6px; border-radius: 50%; }
.dot.danger { background: #ff4757; box-shadow: 0 0 8px #ff4757; }
.dot.warn { background: #ffa502; box-shadow: 0 0 8px #ffa502; }

.card-form { display: flex; flex-direction: column; gap: 14px; }

.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.field label { font-size: 10px; font-weight: 800; color: var(--color-text-muted); text-transform: uppercase; }

.field input {
  background: rgba(0,0,0,0.25);
  border: 1px solid rgba(255,255,255,0.08);
  color: #fff;
  height: 38px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 13px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  width: 100%;
  box-sizing: border-box;
}

.field input:focus { 
  outline: none; 
  border-color: var(--color-status-info); 
  background: rgba(0,0,0,0.4);
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.15);
}

.action-btn {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-weight: 700;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.action-btn.danger-filled { background: #ff4757; border: none; color: #fff; }
.action-btn.danger-filled:hover:not(:disabled) { background: #ff6b81; transform: translateY(-1px); }

.action-btn.danger-outline { background: transparent; border: 1px solid #ff4757; color: #ff4757; }
.action-btn.danger-outline:hover:not(:disabled) { background: rgba(255, 71, 87, 0.1); }

.action-btn.warn-outline { background: transparent; border: 1px solid #ffa502; color: #ffa502; }
.action-btn.warn-outline:hover:not(:disabled) { background: rgba(255, 165, 2, 0.1); }

/* MONITOR VIEWPORT */
.mgmt-monitor {
  display: grid;
  grid-template-rows: 200px 1fr;
  gap: 20px;
  min-height: 0;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  background: rgba(255, 255, 255, 0.01);
}

.panel-title { margin: 0; font-size: 15px; font-weight: 700; }
.panel-title small { font-size: 11px; font-weight: 400; color: var(--color-text-muted); margin-left: 8px; opacity: 0.7; }
.panel-meta { font-size: 11px; color: var(--color-text-muted); font-weight: 600; }

/* RADAR */
.monitor-radar { display: flex; flex-direction: column; overflow: hidden; }

.radar-horizontal-list {
  flex: 1;
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  overflow-x: auto;
  align-items: stretch;
}

.radar-item {
  min-width: 220px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.2s;
}
.radar-item:hover { transform: scale(1.02); background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.15); }

.item-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }

.team-badge {
  font-size: 9px;
  font-weight: 900;
  padding: 1px 6px;
  border-radius: 4px;
  letter-spacing: 0.5px;
}
.team-badge.team-1 { background: rgba(55, 200, 255, 0.15); color: #37c8ff; }
.team-badge.team-2 { background: rgba(255, 155, 69, 0.15); color: #ff9b45; }

.sq-id { font-weight: 800; color: #fff; font-family: monospace; }
.radar-item .time { font-size: 10px; font-weight: 600; font-family: monospace; color: var(--color-text-muted); margin-left: auto; opacity: 0.7; }

.sq-name { font-size: 14px; font-weight: 700; color: #fff; line-height: 1.2; }
.creator { font-size: 10px; color: var(--color-text-secondary); margin-top: 4px; opacity: 0.8; }

/* AUDIT LOG */
.monitor-audit { display: flex; flex-direction: column; overflow: hidden; }

.audit-filters { display: flex; gap: 6px; }

.filter-chip {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  color: var(--color-text-secondary);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.filter-chip.active { background: #388bfd; border-color: #388bfd; color: #fff; box-shadow: 0 0 12px rgba(56, 139, 253, 0.3); }
.filter-chip .badge { opacity: 0.7; margin-left: 4px; font-weight: 800; }

.audit-table-wrap { 
  flex: 1; 
  overflow-y: auto; 
  padding: 0 20px 20px;
  scrollbar-gutter: stable;
}

.modern-table { width: 100%; border-collapse: separate; border-spacing: 0 6px; }
.modern-table th {
  position: sticky; top: 0; background: #0d141c;
  text-align: left; padding: 10px 16px; font-size: 10px; font-weight: 800;
  color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 1.5px;
  z-index: 2;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.modern-table td { padding: 14px 16px; background: rgba(255,255,255,0.03); vertical-align: middle; }
.modern-table tr:hover td { background: rgba(255,255,255,0.05); }

.modern-table tr td:first-child { border-top-left-radius: 10px; border-bottom-left-radius: 10px; }
.modern-table tr td:last-child { border-top-right-radius: 10px; border-bottom-right-radius: 10px; }

.time-stack { display: flex; flex-direction: column; }
.time-stack .clock { font-size: 13px; font-weight: 700; font-family: monospace; color: #fff; }
.time-stack .date { font-size: 10px; color: var(--color-text-muted); margin-top: 2px; }

.type-tag {
  font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 4px;
  text-transform: uppercase; background: rgba(255,255,255,0.05); letter-spacing: 0.5px;
}
.type-tag[data-kind="disband"] { color: #ff4757; background: rgba(255, 71, 87, 0.1); }
.type-tag[data-kind="kick"] { color: #ff4757; background: rgba(255, 71, 87, 0.1); }
.type-tag[data-kind="remove"] { color: #ffa502; background: rgba(255, 165, 2, 0.1); }
.type-tag[data-kind="squad_created"] { color: #2ed573; background: rgba(46, 213, 115, 0.1); }

.detail-payload { display: flex; flex-direction: column; gap: 4px; }
.payload-meta { display: flex; gap: 10px; font-size: 10px; margin-bottom: 2px; }
.payload-meta .source { color: var(--color-text-muted); background: rgba(0,0,0,0.25); padding: 1px 6px; border-radius: 4px; }
.payload-meta .operator { color: #58a6ff; font-weight: 800; }

.payload-main { display: flex; align-items: baseline; gap: 8px; }
.payload-main strong { font-size: 14px; font-weight: 700; color: #fff; }
.payload-main .sub { font-size: 11px; color: var(--color-text-muted); font-family: monospace; opacity: 0.8; }
.payload-reason { font-size: 11px; background: rgba(0,0,0,0.15); padding: 4px 8px; border-radius: 4px; display: inline-block; color: var(--color-text-secondary); font-style: italic; margin-top: 4px; }

.result-box { display: flex; flex-direction: column; }
.res-label { font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
.result-box[data-status="ok"] .res-label { color: #2ed573; }
.result-box[data-status="danger"] .res-label { color: #ff4757; }
.res-error { font-size: 10px; color: #ff4757; margin-top: 4px; max-width: 160px; word-break: break-all; opacity: 0.8; }

.empty-state, .empty-row { padding: 40px; text-align: center; color: var(--color-text-muted); font-style: italic; font-size: 12px; letter-spacing: 1px; }

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }

@media (max-width: 1100px) {
  .mgmt-container { grid-template-columns: 1fr; padding: 0 16px 16px; }
  .mgmt-monitor { grid-template-rows: auto 1fr; }
  .radar-horizontal-list { flex-wrap: wrap; }
}
</style>
