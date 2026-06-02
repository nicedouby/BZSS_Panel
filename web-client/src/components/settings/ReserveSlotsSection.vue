<template>
  <section class="settings-section reserve-slots-section">
    <div class="settings-section-head reserve-head">
      <div>
        <h3>预留位管理</h3>
        <p>与玩家数据库关联，支持从管理员文件同步，以及 CSV 导入 / 导出。</p>
      </div>
      <div class="reserve-actions">
        <button type="button" class="reserve-sync-btn" :disabled="!canEdit || importing" @click="syncFromAdmin">
          {{ importing ? "同步中..." : "从管理员文件同步" }}
        </button>
        <button type="button" class="reserve-sync-btn secondary" :disabled="loading || importing || exporting" @click="exportCsv">
          导出 CSV
        </button>
        <button type="button" class="reserve-sync-btn secondary" :disabled="!canEdit || loading || importing" @click="triggerImportFile">
          导入 CSV
        </button>
        <input ref="importInput" class="hidden-input" type="file" accept=".csv,text/csv" @change="onImportFileChange">
      </div>
    </div>

    <div v-if="loading" class="reserve-state-box">正在加载预留位数据...</div>
    <div v-else-if="error" class="reserve-state-box error">
      <span>{{ error }}</span>
      <button type="button" class="reserve-mini-btn" @click="loadState(true)">重试</button>
    </div>
    <template v-else>
      <div v-if="notice" class="reserve-notice">{{ notice }}</div>

      <div class="reserve-meta-line">
        <span>本地文件：{{ state?.localReserveFileExists ? "已存在" : "不存在" }}</span>
        <span>管理员文件：{{ state?.adminFilePath || "未配置" }}</span>
        <span>上次同步：{{ formatDate(state?.lastImportedAt) }}</span>
        <span>当前统计：{{ state?.summary?.memberCount ?? 0 }} 人</span>
      </div>

      <div class="reserve-workspace">
        <div class="reserve-list-panel">
          <div class="reserve-list-head">
            <div>
              <h4>预留位列表</h4>
              <p>点击任意条目查看详情和原因。</p>
            </div>
            <span>{{ state?.summary?.memberCount ?? 0 }} 条</span>
          </div>

          <div v-if="!memberRows.length" class="reserve-empty">暂无预留位数据。</div>
          <div v-else class="reserve-list-scroll">
            <button
              v-for="member in memberRows"
              :key="member.rawLine"
              type="button"
              class="reserve-row"
              :class="{ active: selectedMember?.rawLine === member.rawLine, expired: member.isExpired }"
              @click="selectedSteamId = member.steamId"
            >
              <div class="reserve-row-main">
                <div class="reserve-row-title">
                  <button
                    type="button"
                    class="reserve-name-link"
                    @click.stop="openPlayerDatabase(member.name || member.steamId)"
                  >
                    {{ member.name || "未命名玩家" }}
                  </button>
                  <span class="reserve-pill" :class="member.isExpired ? 'expired' : (member.expireAt ? 'active' : 'empty')">
                    {{ member.isExpired ? "已过期" : (member.expireAt ? "有效" : "永久") }}
                  </span>
                </div>
                <div class="reserve-row-sub">
                  <span class="mono">{{ member.steamId }}</span>
                  <span>组: {{ member.group }}</span>
                  <span>剩余: {{ getRemainingText(member) }}</span>
                </div>
              </div>
              <div class="reserve-row-meta">
                <span>{{ member.expireAt ?? "永久" }}</span>
              </div>
            </button>
          </div>
        </div>

        <aside class="reserve-detail-panel">
          <template v-if="selectedMember">
            <div class="reserve-detail-head">
              <div>
                <h4>
                  <button
                    type="button"
                    class="reserve-name-link detail"
                    @click="openPlayerDatabase(selectedMember.name || selectedMember.steamId)"
                  >
                    {{ selectedMember.name || "未命名玩家" }}
                  </button>
                </h4>
                <p>SteamID: {{ selectedMember.steamId }}</p>
              </div>
            </div>

            <div class="reserve-detail-grid">
              <div class="reserve-detail-card">
                <span class="reserve-detail-label">预留组</span>
                <strong>{{ selectedMember.group }}</strong>
              </div>
              <div class="reserve-detail-card">
                <span class="reserve-detail-label">到期时间</span>
                <strong>{{ selectedMember.expireAt ?? "永久" }}</strong>
              </div>
              <div class="reserve-detail-card">
                <span class="reserve-detail-label">剩余时间</span>
                <strong>{{ getRemainingText(selectedMember) }}</strong>
              </div>
            </div>

            <div class="reserve-detail-block">
              <div class="reserve-detail-block-head">
                <h5>添加原因</h5>
              </div>
              <div v-if="selectedMember.reasons.length" class="reserve-reason-tags">
                <span v-for="reason in selectedMember.reasons" :key="reason" class="reserve-reason-tag">{{ reason }}</span>
              </div>
              <div v-else class="reserve-empty compact">暂无原因记录。</div>
            </div>

            <div class="reserve-detail-block">
              <div class="reserve-detail-block-head">
                <h5>原始备注</h5>
              </div>
              <p class="reserve-detail-text">{{ selectedMember.remark || "无" }}</p>
            </div>
          </template>

          <div v-else class="reserve-detail-empty">
            <strong>未选择条目</strong>
            <p>从左侧列表选择一个预留位，查看姓名、原因和剩余时间。</p>
          </div>
        </aside>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiError } from "../../app/apiClient";
import {
  exportReserveSlotsCsv,
  fetchReserveSlotsState,
  importReserveSlotsCsv,
  importReserveSlotsFromAdmin,
  type ReserveSlotMember,
  type ReserveSlotsState,
} from "../../app/reserveSlotsApi";
import { goToPlayerDatabaseSearch } from "../../utils/player-database";

const props = defineProps<{
  canEdit: boolean;
}>();

const loading = ref(false);
const importing = ref(false);
const exporting = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const state = ref<ReserveSlotsState | null>(null);
const nowTick = ref(Date.now());
const selectedSteamId = ref<string>("");
const importInput = ref<HTMLInputElement | null>(null);
const router = useRouter();

const memberRows = computed(() => Array.isArray(state.value?.members) ? state.value.members : []);
const selectedMember = computed(() => {
  const list = memberRows.value;
  if (!list.length) return null;
  return list.find((member) => member.steamId === selectedSteamId.value) ?? list[0] ?? null;
});
const canEdit = computed(() => Boolean(props.canEdit));

let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  void loadState();
  timer = setInterval(() => {
    nowTick.value = Date.now();
  }, 30_000);
});

onUnmounted(() => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
});

async function loadState(force = false) {
  if (loading.value && !force) return;

  loading.value = true;
  error.value = null;
  notice.value = null;

  try {
    const next = await fetchReserveSlotsState();
    state.value = next;
    if (!selectedSteamId.value && next.members?.length) {
      selectedSteamId.value = next.members[0].steamId;
    }
  } catch (err) {
    error.value = renderError(err);
  } finally {
    loading.value = false;
  }
}

async function syncFromAdmin() {
  if (!canEdit.value) return;

  importing.value = true;
  error.value = null;
  notice.value = null;

  try {
    const next = await importReserveSlotsFromAdmin();
    state.value = next;
    if (!selectedSteamId.value && next.members?.length) {
      selectedSteamId.value = next.members[0].steamId;
    }
    notice.value = next.message ?? "已从管理员文件同步预留位数据。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    importing.value = false;
  }
}

async function exportCsv() {
  exporting.value = true;
  error.value = null;
  notice.value = null;

  try {
    const result = await exportReserveSlotsCsv();
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "reserve-slots.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    notice.value = "CSV 已导出。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    exporting.value = false;
  }
}

function triggerImportFile() {
  importInput.value?.click();
}

async function onImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0] ?? null;
  if (!file) return;

  importing.value = true;
  error.value = null;
  notice.value = null;

  try {
    const csvText = await file.text();
    const result = await importReserveSlotsCsv(csvText);
    state.value = result;
    if (!selectedSteamId.value && result.members?.length) {
      selectedSteamId.value = result.members[0].steamId;
    }
    notice.value = result.message ?? "CSV 导入完成。";
    if (input) input.value = "";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    importing.value = false;
  }
}

function openPlayerDatabase(value: string) {
  goToPlayerDatabaseSearch(router, value);
}

function getRemainingText(member: ReserveSlotMember) {
  if (!member.expireAt) return "永久";
  if (member.isExpired) return "已过期";

  const expireAt = Date.parse(member.expireAt);
  if (!Number.isFinite(expireAt)) return member.expireAt;

  const remaining = Math.max(0, expireAt - nowTick.value);
  const totalSeconds = Math.floor(remaining / 1000);
  if (totalSeconds <= 0) return "即将过期";

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

function renderError(err: unknown) {
  if (err instanceof ApiError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "加载预留位数据失败。";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
</script>

<style scoped>
.reserve-slots-section {
  display: grid;
  gap: 12px;
}

.reserve-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.reserve-head h3 {
  margin: 0;
}

.reserve-head p {
  margin: 4px 0 0;
}

.reserve-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reserve-sync-btn,
.reserve-mini-btn {
  border: 1px solid rgba(96, 165, 250, 0.28);
  background: #60a5fa24;
  color: var(--color-text-primary);
  border-radius: 12px;
  padding: 8px 12px;
}

.reserve-sync-btn.secondary {
  border-color: var(--color-border-soft);
  background: #ffffff08;
}

.reserve-sync-btn:disabled {
  opacity: 0.55;
}

.reserve-mini-btn {
  padding: 6px 10px;
  flex: 0 0 auto;
}

.hidden-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.reserve-state-box,
.reserve-notice {
  border: 1px solid var(--color-border-default);
  background: linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), #ffffff02), var(--color-bg-card);
  border-radius: 14px;
  padding: 12px 14px;
  color: var(--color-text-secondary);
}

.reserve-state-box.error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #ffc4c4;
}

.reserve-meta-line {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #ffffff05;
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(300px, 0.9fr);
  gap: 12px;
  min-height: 0;
}

.reserve-list-panel,
.reserve-detail-panel {
  min-height: 0;
  border: 1px solid var(--color-border-soft);
  background: #ffffff05;
  border-radius: 16px;
  padding: 12px;
}

.reserve-list-panel {
  display: grid;
  gap: 10px;
}

.reserve-list-head,
.reserve-detail-head,
.reserve-detail-block-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.reserve-list-head h4,
.reserve-detail-head h4,
.reserve-detail-block h5 {
  margin: 0;
}

.reserve-list-head p,
.reserve-detail-head p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-list-scroll {
  max-height: 58vh;
  overflow: auto;
  display: grid;
  gap: 8px;
  padding-right: 2px;
}

.reserve-row {
  width: 100%;
  border: 1px solid var(--color-border-soft);
  background: #ffffff08;
  color: inherit;
  border-radius: 14px;
  padding: 12px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  text-align: left;
}

.reserve-row:hover {
  border-color: #60a5fa66;
  background: #60a5fa14;
}

.reserve-row.active {
  border-color: #60a5fa9c;
  background: #60a5fa22;
}

.reserve-row.expired {
  opacity: 0.88;
}

.reserve-row-main {
  display: grid;
  gap: 6px;
  min-width: 0;
  flex: 1 1 auto;
}

.reserve-row-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.reserve-name-link {
  border: 0;
  background: transparent;
  color: var(--color-text-primary);
  font: inherit;
  font-weight: 700;
  padding: 0;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reserve-name-link:hover {
  color: #8fc4ff;
}

.reserve-name-link.detail {
  font-size: 15px;
}

.reserve-row-sub,
.reserve-row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-row-meta {
  justify-content: flex-end;
  align-content: flex-start;
  flex: 0 0 auto;
  min-width: 120px;
}

.reserve-pill {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  flex: 0 0 auto;
}

.reserve-pill.active {
  border: 1px solid rgba(74, 222, 128, 0.28);
  background: #4ade801f;
  color: #b8f7cc;
}

.reserve-pill.expired {
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: #f871711f;
  color: #ffcbc9;
}

.reserve-pill.empty {
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #94a3b81a;
  color: #d4dde5;
}

.reserve-detail-panel {
  display: grid;
  gap: 12px;
  align-content: start;
}

.reserve-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.reserve-detail-card,
.reserve-detail-block {
  border: 1px solid var(--color-border-soft);
  background: #ffffff06;
  border-radius: 14px;
  padding: 12px;
  display: grid;
  gap: 4px;
}

.reserve-detail-label {
  color: var(--color-text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.reserve-detail-card strong {
  color: var(--color-text-primary);
}

.reserve-reason-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reserve-reason-tag {
  border: 1px solid var(--color-border-soft);
  background: #ffffff08;
  border-radius: 999px;
  padding: 6px 10px;
  color: var(--color-text-primary);
  font-size: 12px;
}

.reserve-detail-text {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.reserve-empty {
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 8px 0 2px;
}

.reserve-empty.compact {
  padding: 4px 0 0;
}

.reserve-detail-empty {
  min-height: 100%;
  border: 1px dashed var(--color-border-soft);
  border-radius: 14px;
  padding: 16px;
  display: grid;
  gap: 6px;
  color: var(--color-text-muted);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace;
}

@media (max-width: 980px) {
  .reserve-workspace {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .reserve-head,
  .reserve-state-box.error {
    flex-direction: column;
    align-items: stretch;
  }

  .reserve-actions,
  .reserve-sync-btn,
  .reserve-mini-btn {
    width: 100%;
  }

  .reserve-detail-grid {
    grid-template-columns: 1fr;
  }

  .reserve-row {
    flex-direction: column;
  }

  .reserve-row-meta {
    justify-content: flex-start;
    min-width: 0;
  }
}
</style>
