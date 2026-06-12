<template>
  <section class="settings-section reserve-slots-section">
    <div class="reserve-head">
      <div>
        <h3>预留位管理</h3>
        <p>读取并写入 admins.CFG 的预留位区块，新增玩家后会同步本地展示数据。</p>
      </div>
      <div class="reserve-actions">
        <button type="button" class="reserve-btn primary" :disabled="!canEdit || importing" @click="syncFromAdmin">
          {{ importing ? "同步中..." : "从管理员文件同步" }}
        </button>
        <button type="button" class="reserve-btn" :disabled="loading || importing || exporting" @click="exportCsv">
          导出 CSV
        </button>
        <button type="button" class="reserve-btn danger" :disabled="!canEdit || deletingExpired || loading || importing" @click="removeExpiredMembers">
          {{ deletingExpired ? "删除中..." : "一键删除过期" }}
        </button>
        <button type="button" class="reserve-btn" :disabled="!canEdit || loading || importing" @click="triggerImportFile">
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
      </div>

      <div class="reserve-summary-grid">
        <div class="reserve-summary-card">
          <span>总数</span>
          <strong>{{ state?.summary?.memberCount ?? 0 }}</strong>
        </div>
        <div class="reserve-summary-card active">
          <span>有效</span>
          <strong>{{ state?.summary?.activeCount ?? 0 }}</strong>
        </div>
        <div class="reserve-summary-card expired">
          <span>过期</span>
          <strong>{{ state?.summary?.expiredCount ?? 0 }}</strong>
        </div>
        <div class="reserve-summary-card">
          <span>预留组</span>
          <strong>{{ groupOptions.length }}</strong>
        </div>
      </div>

      <div class="reserve-workspace">
        <div class="reserve-list-panel">
          <div class="reserve-list-head">
            <div>
              <h4>预留位列表</h4>
              <p>按玩家名、SteamID 或预留组筛选。</p>
            </div>
            <span>{{ filteredMemberRows.length }} / {{ memberRows.length }}</span>
          </div>

          <div class="reserve-filter-row">
            <input v-model.trim="filterText" class="reserve-input" type="search" placeholder="搜索玩家名 / SteamID / 组">
            <select v-model="statusFilter" class="reserve-select">
              <option value="all">全部状态</option>
              <option value="active">有效</option>
              <option value="expired">过期</option>
            </select>
          </div>

          <div v-if="!filteredMemberRows.length" class="reserve-empty">暂无匹配的预留位数据。</div>
          <div v-else class="reserve-list-scroll">
            <button
              v-for="member in filteredMemberRows"
              :key="member.rawLine || member.steamId"
              type="button"
              class="reserve-row"
              :class="{ active: selectedMember?.steamId === member.steamId, expired: member.isExpired }"
              @click="selectedSteamId = member.steamId"
            >
              <div class="reserve-row-main">
                <div class="reserve-row-title">
                  <span class="reserve-player-name">{{ member.name || "未命名玩家" }}</span>
                  <span class="reserve-pill" :class="member.isExpired ? 'expired' : 'active'">
                    {{ member.isExpired ? "已过期" : "有效" }}
                  </span>
                </div>
                <div class="reserve-row-sub">
                  <span class="mono">{{ member.steamId }}</span>
                  <span>组 {{ member.group }}</span>
                  <span>剩余 {{ getRemainingText(member) }}</span>
                </div>
              </div>
              <div class="reserve-row-meta">
                <span>{{ member.expireAt ?? "未设置" }}</span>
                <button type="button" class="reserve-mini-btn" @click.stop="copyMember(member)">复制</button>
                <button type="button" class="reserve-mini-btn danger" :disabled="!canEdit || deletingSteamId === member.steamId" @click.stop="removeMember(member)">
                  {{ deletingSteamId === member.steamId ? "删除中..." : "删除" }}
                </button>
              </div>
            </button>
          </div>
        </div>

        <aside class="reserve-side">
          <form class="reserve-edit-panel" @submit.prevent="saveMember">
            <div class="reserve-panel-head">
              <h4>添加 / 续期</h4>
              <span>{{ canEdit ? "写入 admins.CFG" : "仅 SuperAdmin 可编辑" }}</span>
            </div>

            <label class="reserve-field">
              <span>玩家搜索</span>
              <div class="reserve-search-row">
                <input v-model.trim="playerKeyword" class="reserve-input" type="search" placeholder="玩家名或 SteamID">
                <button type="button" class="reserve-mini-btn" :disabled="searchingPlayers || !playerKeyword" @click="searchPlayerDatabase">
                  {{ searchingPlayers ? "搜索中" : "搜索" }}
                </button>
              </div>
            </label>

            <div v-if="playerResults.length" class="reserve-player-results">
              <button
                v-for="player in playerResults"
                :key="player.steamId || player.eosId || player.name"
                type="button"
                class="reserve-player-result"
                :disabled="!player.steamId"
                @click="selectPlayer(player)"
              >
                <strong>{{ player.name }}</strong>
                <span>{{ player.steamId || "无 SteamID" }}</span>
              </button>
            </div>

            <label class="reserve-field">
              <span>Steam64</span>
              <input v-model.trim="form.steamId" class="reserve-input mono" type="text" placeholder="7656119..." required>
            </label>

            <label class="reserve-field">
              <span>预留组</span>
              <select v-model="form.group" class="reserve-select" required>
                <option v-for="group in groupOptions" :key="group" :value="group">{{ group }}</option>
              </select>
            </label>

            <label class="reserve-field">
              <span>玩家名</span>
              <input v-model.trim="form.name" class="reserve-input" type="text" placeholder="可选">
            </label>

            <div class="reserve-expire-tabs">
              <button type="button" :class="{ active: expireMode === 'quick' }" @click="expireMode = 'quick'">快捷时长</button>
              <button type="button" :class="{ active: expireMode === 'exact' }" @click="expireMode = 'exact'">精确时间</button>
            </div>

            <div v-if="expireMode === 'quick'" class="reserve-duration-row">
              <button v-for="days in quickDays" :key="days" type="button" class="reserve-duration-btn" :class="{ active: form.durationDays === days }" @click="setDurationDays(days)">
                {{ days }} 天
              </button>
              <label class="reserve-field compact">
                <span>自定义天数</span>
                <input v-model.number="form.durationDays" class="reserve-input" type="number" min="1" step="1">
              </label>
            </div>

            <label v-else class="reserve-field">
              <span>到期时间</span>
              <input v-model="form.exactExpireAt" class="reserve-input" type="datetime-local" required>
            </label>

            <label class="reserve-field">
              <span>原因</span>
              <input v-model.trim="form.reason" class="reserve-input" type="text" placeholder="可选，仅进入审计参数">
            </label>

            <div class="reserve-save-preview">
              <span>将写入</span>
              <strong>{{ computedExpireAt || "请选择到期时间" }}</strong>
            </div>

            <button type="submit" class="reserve-btn primary full" :disabled="!canEdit || saving || !canSubmit">
              {{ saving ? "保存中..." : "保存到 admins.CFG" }}
            </button>
          </form>

          <div class="reserve-detail-panel">
            <template v-if="selectedMember">
              <div class="reserve-detail-head">
                <div>
                  <h4>
                    <button type="button" class="reserve-name-link detail" @click="openPlayerDatabase(selectedMember.name || selectedMember.steamId)">
                      {{ selectedMember.name || "未命名玩家" }}
                    </button>
                  </h4>
                  <p>SteamID: {{ selectedMember.steamId }}</p>
                </div>
                <button type="button" class="reserve-mini-btn" :disabled="!canEdit" @click="fillFromSelectedMember">续期</button>
              </div>

              <div class="reserve-detail-grid">
                <div class="reserve-detail-card">
                  <span>预留组</span>
                  <strong>{{ selectedMember.group }}</strong>
                </div>
                <div class="reserve-detail-card">
                  <span>到期时间</span>
                  <strong>{{ selectedMember.expireAt ?? "未设置" }}</strong>
                </div>
                <div class="reserve-detail-card">
                  <span>剩余时间</span>
                  <strong>{{ getRemainingText(selectedMember) }}</strong>
                </div>
              </div>
              <div class="reserve-detail-actions">
                <button type="button" class="reserve-mini-btn" @click="copyMember(selectedMember)">复制这一条</button>
                <button type="button" class="reserve-mini-btn danger" :disabled="!canEdit || deletingSteamId === selectedMember.steamId" @click="removeMember(selectedMember)">
                  {{ deletingSteamId === selectedMember.steamId ? "删除中..." : "删除此人预留位" }}
                </button>
              </div>
            </template>

            <div v-else class="reserve-detail-empty">
              <strong>未选择条目</strong>
              <p>从左侧列表选择一个预留位，查看状态或快速填入续期表单。</p>
            </div>
          </div>
        </aside>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ApiError } from "../../app/apiClient";
import {
  deleteExpiredReserveSlotMembers,
  deleteReserveSlotMember,
  exportReserveSlotsCsv,
  fetchReserveSlotsState,
  importReserveSlotsCsv,
  importReserveSlotsFromAdmin,
  upsertReserveSlotMember,
  type ReserveSlotMember,
  type ReserveSlotsState,
} from "../../app/reserveSlotsApi";
import { searchPlayers, type SearchablePlayer } from "../../features/group-report/playerSearch";
import { copyTextWithToast } from "../../utils/clipboard";
import { goToPlayerDatabaseSearch } from "../../utils/player-database";
import { useUiStore } from "../../stores/ui.store";

const props = defineProps<{
  canEdit: boolean;
}>();

const quickDays = [7, 30, 90, 180];
const loading = ref(false);
const importing = ref(false);
const exporting = ref(false);
const saving = ref(false);
const searchingPlayers = ref(false);
const deletingExpired = ref(false);
const deletingSteamId = ref("");
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const state = ref<ReserveSlotsState | null>(null);
const nowTick = ref(Date.now());
const selectedSteamId = ref<string>("");
const importInput = ref<HTMLInputElement | null>(null);
const filterText = ref("");
const statusFilter = ref<"all" | "active" | "expired">("all");
const playerKeyword = ref("");
const playerResults = ref<SearchablePlayer[]>([]);
const expireMode = ref<"quick" | "exact">("quick");
const router = useRouter();
const ui = useUiStore();

const form = reactive({
  steamId: "",
  group: "BZSSVIP",
  name: "",
  reason: "",
  durationDays: 30,
  exactExpireAt: toDatetimeLocal(addDays(new Date(), 30)),
});

const canEdit = computed(() => Boolean(props.canEdit));
const memberRows = computed(() => Array.isArray(state.value?.members) ? state.value.members : []);
const groupOptions = computed(() => {
  const parsed = (state.value?.groups ?? [])
    .filter((group) => group.permission === "reserve")
    .map((group) => group.name)
    .filter(Boolean);
  return parsed.length ? [...new Set(parsed)] : ["BZSSVIP"];
});
const filteredMemberRows = computed(() => {
  const query = filterText.value.toLowerCase();
  return memberRows.value.filter((member) => {
    if (statusFilter.value === "active" && member.isExpired) return false;
    if (statusFilter.value === "expired" && !member.isExpired) return false;
    if (!query) return true;
    return [
      member.name,
      member.steamId,
      member.group,
      member.expireAt ?? "",
    ].some((value) => String(value ?? "").toLowerCase().includes(query));
  });
});
const selectedMember = computed(() => {
  const list = memberRows.value;
  if (!list.length) return null;
  return list.find((member) => member.steamId === selectedSteamId.value) ?? filteredMemberRows.value[0] ?? list[0] ?? null;
});
const computedExpireAt = computed(() => {
  if (expireMode.value === "exact") return fromDatetimeLocal(form.exactExpireAt);
  const days = Number(form.durationDays);
  if (!Number.isFinite(days) || days <= 0) return "";
  return formatLocalDateTime(addDays(new Date(), days));
});
const canSubmit = computed(() => /^7656119\d{10}$/.test(form.steamId) && Boolean(form.group) && Boolean(computedExpireAt.value));

let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  void loadState();
  timer = setInterval(() => {
    nowTick.value = Date.now();
  }, 30_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

watch(groupOptions, (groups) => {
  if (!groups.includes(form.group)) form.group = groups[0] ?? "BZSSVIP";
});

async function loadState(force = false) {
  if (loading.value && !force) return;

  loading.value = true;
  error.value = null;
  notice.value = null;

  try {
    const next = await fetchReserveSlotsState();
    applyState(next);
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
    applyState(next);
    notice.value = next.message ?? "已从管理员文件同步预留位数据。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    importing.value = false;
  }
}

async function saveMember() {
  if (!canEdit.value || !canSubmit.value || saving.value) return;

  saving.value = true;
  error.value = null;
  notice.value = null;

  try {
    const next = await upsertReserveSlotMember({
      steamId: form.steamId,
      group: form.group,
      expireAt: computedExpireAt.value,
      name: form.name,
      reason: form.reason,
    });
    applyState(next);
    selectedSteamId.value = form.steamId;
    notice.value = next.message ?? "预留位已保存到管理员配置文件。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    saving.value = false;
  }
}

async function removeMember(member: ReserveSlotMember) {
  if (!canEdit.value || deletingSteamId.value) return;

  deletingSteamId.value = member.steamId;
  error.value = null;
  notice.value = null;

  try {
    const next = await deleteReserveSlotMember(member.steamId);
    applyState(next);
    if (selectedSteamId.value === member.steamId) {
      selectedSteamId.value = next.members?.[0]?.steamId ?? "";
    }
    notice.value = next.message ?? "预留位已删除。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    deletingSteamId.value = "";
  }
}

async function removeExpiredMembers() {
  if (!canEdit.value || deletingExpired.value) return;

  deletingExpired.value = true;
  error.value = null;
  notice.value = null;

  try {
    const next = await deleteExpiredReserveSlotMembers();
    applyState(next);
    if (selectedMember.value?.isExpired && !next.members.some((member) => member.steamId === selectedSteamId.value)) {
      selectedSteamId.value = next.members?.[0]?.steamId ?? "";
    }
    notice.value = next.message ?? "过期预留位已删除。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    deletingExpired.value = false;
  }
}

async function searchPlayerDatabase() {
  const query = playerKeyword.value.trim();
  if (!query || searchingPlayers.value) return;

  searchingPlayers.value = true;
  error.value = null;
  try {
    playerResults.value = await searchPlayers(query);
  } catch (err) {
    error.value = renderError(err);
  } finally {
    searchingPlayers.value = false;
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
    applyState(result);
    notice.value = result.message ?? "CSV 导入完成。";
    if (input) input.value = "";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    importing.value = false;
  }
}

function applyState(next: ReserveSlotsState) {
  state.value = next;
  if (!selectedSteamId.value && next.members?.length) {
    selectedSteamId.value = next.members[0].steamId;
  }
  if (!groupOptions.value.includes(form.group)) {
    form.group = groupOptions.value[0] ?? "BZSSVIP";
  }
}

function selectPlayer(player: SearchablePlayer) {
  if (!player.steamId) return;
  form.steamId = player.steamId;
  form.name = player.name;
  playerKeyword.value = player.name || player.steamId;
}

function fillFromSelectedMember() {
  if (!selectedMember.value) return;
  form.steamId = selectedMember.value.steamId;
  form.group = selectedMember.value.group || groupOptions.value[0] || "BZSSVIP";
  form.name = selectedMember.value.name || "";
  expireMode.value = "quick";
  form.durationDays = 30;
}

async function copyMember(member: ReserveSlotMember) {
  const line = buildCopyText(member);
  await copyTextWithToast(line, ui, {
    label: "复制预留位",
    successMessage: "预留位内容已复制。",
    errorMessage: "复制预留位内容失败。",
  });
}

function setDurationDays(days: number) {
  form.durationDays = days;
}

function openPlayerDatabase(value: string) {
  goToPlayerDatabaseSearch(router, value);
}

function getRemainingText(member: ReserveSlotMember) {
  if (!member.expireAt) return "未设置";
  if (member.isExpired) return "已过期";

  const expireAt = Date.parse(member.expireAt.replace(" ", "T"));
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

function buildCopyText(member: ReserveSlotMember) {
  const parts = [
    member.name || "未命名玩家",
    member.steamId,
    member.group,
    member.expireAt || "未设置",
  ];
  return parts.join(" | ");
}

function renderError(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "加载预留位数据失败。";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatLocalDateTime(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function toDatetimeLocal(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(value: string) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return formatLocalDateTime(date);
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

.reserve-head h3,
.reserve-list-head h4,
.reserve-panel-head h4,
.reserve-detail-head h4 {
  margin: 0;
}

.reserve-head p,
.reserve-list-head p,
.reserve-panel-head span,
.reserve-detail-head p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-actions,
.reserve-filter-row,
.reserve-search-row,
.reserve-duration-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reserve-btn,
.reserve-mini-btn,
.reserve-duration-btn {
  border: 1px solid var(--color-border-soft);
  background: #ffffff08;
  color: var(--color-text-primary);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}

.reserve-btn.primary,
.reserve-duration-btn.active {
  border-color: rgba(96, 165, 250, 0.45);
  background: #2563eb2b;
}

.reserve-btn.danger,
.reserve-mini-btn.danger {
  border-color: rgba(248, 113, 113, 0.32);
  background: #7f1d1d26;
}

.reserve-btn.full {
  width: 100%;
}

.reserve-btn:disabled,
.reserve-mini-btn:disabled,
.reserve-duration-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.reserve-mini-btn {
  padding: 7px 10px;
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
.reserve-notice,
.reserve-meta-line,
.reserve-summary-card,
.reserve-list-panel,
.reserve-edit-panel,
.reserve-detail-panel {
  border: 1px solid var(--color-border-soft);
  background: #ffffff05;
  border-radius: 8px;
}

.reserve-state-box,
.reserve-notice {
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
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.reserve-summary-card {
  display: grid;
  gap: 6px;
  padding: 12px;
}

.reserve-summary-card span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-summary-card strong {
  font-size: 24px;
  line-height: 1;
}

.reserve-summary-card.active strong {
  color: #8ee6ad;
}

.reserve-summary-card.expired strong {
  color: #ffaaa6;
}

.reserve-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(340px, 0.9fr);
  gap: 12px;
  min-height: 0;
}

.reserve-list-panel,
.reserve-edit-panel,
.reserve-detail-panel {
  min-height: 0;
  padding: 12px;
}

.reserve-list-panel,
.reserve-edit-panel,
.reserve-side {
  display: grid;
  gap: 10px;
  align-content: start;
}

.reserve-list-head,
.reserve-panel-head,
.reserve-detail-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
}

.reserve-input,
.reserve-select {
  min-width: 0;
  border: 1px solid var(--color-border-soft);
  background: #05081066;
  color: var(--color-text-primary);
  border-radius: 8px;
  padding: 8px 10px;
}

.reserve-filter-row .reserve-input,
.reserve-search-row .reserve-input {
  flex: 1 1 220px;
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
  border-radius: 8px;
  padding: 12px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  text-align: left;
}

.reserve-row:hover {
  border-color: #60a5fa66;
}

.reserve-row.active {
  border-color: #60a5fa9c;
  background: #2563eb24;
}

.reserve-row.expired {
  opacity: 0.84;
}

.reserve-row-main,
.reserve-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.reserve-row-main {
  flex: 1 1 auto;
}

.reserve-row-title,
.reserve-row-sub,
.reserve-row-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.reserve-row-sub,
.reserve-row-meta,
.reserve-field span,
.reserve-save-preview span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-player-name,
.reserve-name-link {
  font-weight: 700;
}

.reserve-player-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reserve-name-link {
  border: 0;
  background: transparent;
  color: var(--color-text-primary);
  font: inherit;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.reserve-name-link:hover {
  color: #8fc4ff;
}

.reserve-row-meta {
  justify-content: flex-end;
  align-content: flex-start;
  flex: 0 0 auto;
  min-width: 150px;
}

.reserve-player-name,
.reserve-row-sub,
.reserve-row-meta span {
  user-select: text;
}

.reserve-pill {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
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

.reserve-player-results {
  display: grid;
  gap: 6px;
  max-height: 168px;
  overflow: auto;
}

.reserve-player-result {
  border: 1px solid var(--color-border-soft);
  background: #ffffff06;
  color: inherit;
  border-radius: 8px;
  padding: 8px 10px;
  display: grid;
  gap: 4px;
  text-align: left;
}

.reserve-player-result span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-player-result:disabled {
  opacity: 0.55;
}

.reserve-expire-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  overflow: hidden;
}

.reserve-expire-tabs button {
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  padding: 8px 10px;
}

.reserve-expire-tabs button.active {
  background: #2563eb2b;
  color: var(--color-text-primary);
}

.reserve-field.compact {
  flex: 1 1 140px;
}

.reserve-save-preview {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  border: 1px dashed var(--color-border-soft);
  border-radius: 8px;
  padding: 10px;
}

.reserve-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reserve-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.reserve-detail-card {
  border: 1px solid var(--color-border-soft);
  background: #ffffff06;
  border-radius: 8px;
  padding: 12px;
  display: grid;
  gap: 4px;
}

.reserve-detail-card span {
  color: var(--color-text-muted);
  font-size: 11px;
}

.reserve-empty,
.reserve-detail-empty {
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-detail-empty {
  border: 1px dashed var(--color-border-soft);
  border-radius: 8px;
  padding: 16px;
  display: grid;
  gap: 6px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace;
}

@media (max-width: 1080px) {
  .reserve-workspace {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .reserve-head,
  .reserve-state-box.error,
  .reserve-row {
    flex-direction: column;
    align-items: stretch;
  }

  .reserve-actions,
  .reserve-btn,
  .reserve-mini-btn {
    width: 100%;
  }

  .reserve-summary-grid,
  .reserve-detail-grid {
    grid-template-columns: 1fr;
  }

  .reserve-row-meta {
    justify-content: flex-start;
    min-width: 0;
  }
}
</style>
