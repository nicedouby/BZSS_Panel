<template>
  <section class="settings-section reserve-slots-section">
    <div class="settings-section-head">
      <h3>预留位系统</h3>
      <p>读取管理员配置文件中的预留位区块，并同步到本地 JSON，供页面展示。</p>
    </div>

    <div v-if="loading" class="reserve-state-box">正在加载预留位数据...</div>
    <div v-else-if="error" class="reserve-state-box error">
      <span>{{ error }}</span>
      <button type="button" @click="loadState(true)">重试</button>
    </div>
    <template v-else>
      <div class="reserve-summary-grid">
        <label class="reserve-toggle">
          <span>
            <strong>启用预留位系统</strong>
            <small>关闭后仍保留本地数据，但不影响配置编辑。</small>
          </span>
          <input v-model="draft.enabled" type="checkbox" :disabled="!canEdit || saving">
        </label>

        <div class="reserve-field">
          <label>管理员配置文件路径</label>
          <input
            v-model="draft.adminFilePath"
            type="text"
            class="reserve-input"
            placeholder="C:/Servers/Squad/SquadGame/ServerConfig/Admins.cfg"
            :disabled="!canEdit || saving"
          >
        </div>

        <div class="reserve-field">
          <label>本地预留位记录文件路径</label>
          <input
            v-model="draft.localReserveFilePath"
            type="text"
            class="reserve-input"
            placeholder="data/reserve-slots.json"
            :disabled="!canEdit || saving"
          >
        </div>
      </div>

      <div class="reserve-actions">
        <button type="button" class="reserve-action secondary" :disabled="saving || importing" @click="loadState(true)">
          重新加载
        </button>
        <button type="button" class="reserve-action secondary" :disabled="!canEdit || saving || importing" @click="saveSettings">
          {{ saving ? "保存中..." : "保存设置" }}
        </button>
        <button type="button" class="reserve-action" :disabled="!canEdit || saving || importing" @click="syncFromAdmin">
          {{ importing ? "同步中..." : "从管理员文件同步" }}
        </button>
      </div>

      <div v-if="notice" class="reserve-notice">{{ notice }}</div>

      <div class="reserve-status-grid">
        <div class="reserve-status-card">
          <span class="reserve-status-label">本地文件</span>
          <strong>{{ state?.localReserveFileExists ? "已存在" : "不存在" }}</strong>
          <small>{{ state?.localReserveFilePath || "data/reserve-slots.json" }}</small>
        </div>
        <div class="reserve-status-card">
          <span class="reserve-status-label">管理员文件</span>
          <strong>{{ state?.adminFilePath ? (state?.adminFileExists ? "已存在" : "不存在") : "未配置" }}</strong>
          <small>{{ state?.adminFilePath || "未配置管理员文件路径" }}</small>
        </div>
        <div class="reserve-status-card">
          <span class="reserve-status-label">上次同步时间</span>
          <strong>{{ formatDate(state?.lastImportedAt) }}</strong>
          <small>{{ state?.source?.adminFilePath ? `来源: ${state.source.adminFilePath}` : "尚未同步" }}</small>
        </div>
        <div class="reserve-status-card">
          <span class="reserve-status-label">当前统计</span>
          <strong>{{ state?.summary?.memberCount ?? 0 }} 人</strong>
          <small>过期 {{ state?.summary?.expiredCount ?? 0 }} · 无到期时间 {{ state?.summary?.noExpireCount ?? 0 }}</small>
        </div>
      </div>

      <div class="reserve-block">
        <div class="reserve-block-head">
          <h4>权限组</h4>
          <span>{{ state?.summary?.groupCount ?? 0 }} 个</span>
        </div>
        <div v-if="!groupRows.length" class="reserve-empty">暂无权限组。</div>
        <div v-else class="reserve-tags">
          <span v-for="group in groupRows" :key="group.rawLine" class="reserve-tag">
            <strong>{{ group.name }}</strong>
            <small>{{ group.permission }}</small>
          </span>
        </div>
      </div>

      <div class="reserve-block">
        <div class="reserve-block-head">
          <h4>预留位列表</h4>
          <span>{{ state?.summary?.memberCount ?? 0 }} 条</span>
        </div>

        <div class="reserve-table-wrap">
          <table class="reserve-table">
            <thead>
              <tr>
                <th>SteamID</th>
                <th>权限组</th>
                <th>到期时间</th>
                <th>状态</th>
                <th>原始行</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="member in memberRows" :key="member.rawLine">
                <td class="mono">{{ member.steamId }}</td>
                <td>{{ member.group }}</td>
                <td>{{ member.expireAt ?? "未设置到期时间" }}</td>
                <td>
                  <span class="reserve-pill" :class="member.isExpired ? 'expired' : (member.expireAt ? 'active' : 'empty')">
                    {{ member.isExpired ? "已过期" : (member.expireAt ? "正常" : "未设置到期时间") }}
                  </span>
                </td>
                <td class="raw-line">{{ member.rawLine }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ApiError } from "../../app/apiClient";
import {
  fetchReserveSlotsState,
  importReserveSlotsFromAdmin,
  updateReserveSlotsConfig,
  type ReserveSlotsState,
} from "../../app/reserveSlotsApi";

const props = defineProps<{
  canEdit: boolean;
}>();

const loading = ref(false);
const saving = ref(false);
const importing = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const state = ref<ReserveSlotsState | null>(null);

const draft = reactive({
  enabled: true,
  adminFilePath: "",
  localReserveFilePath: "data/reserve-slots.json",
});

const groupRows = computed(() => Array.isArray(state.value?.groups) ? state.value.groups : []);
const memberRows = computed(() => Array.isArray(state.value?.members) ? state.value.members : []);
const canEdit = computed(() => Boolean(props.canEdit));

onMounted(() => {
  void loadState();
});

async function loadState(force = false) {
  if (loading.value && !force) return;

  loading.value = true;
  error.value = null;
  notice.value = null;

  try {
    const next = await fetchReserveSlotsState();
    state.value = next;
    draft.enabled = Boolean(next.enabled);
    draft.adminFilePath = String(next.adminFilePath ?? "");
    draft.localReserveFilePath = String(next.localReserveFilePath ?? "data/reserve-slots.json");
  } catch (err) {
    error.value = renderError(err);
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  if (!canEdit.value) return;

  saving.value = true;
  error.value = null;
  notice.value = null;

  try {
    const next = await updateReserveSlotsConfig({
      enabled: draft.enabled,
      adminFilePath: draft.adminFilePath,
      localReserveFilePath: draft.localReserveFilePath,
    });
    state.value = next;
    draft.enabled = Boolean(next.enabled);
    draft.adminFilePath = String(next.adminFilePath ?? "");
    draft.localReserveFilePath = String(next.localReserveFilePath ?? "data/reserve-slots.json");
    notice.value = next.message ?? "预留位系统设置已保存。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    saving.value = false;
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
    draft.enabled = Boolean(next.enabled);
    draft.adminFilePath = String(next.adminFilePath ?? "");
    draft.localReserveFilePath = String(next.localReserveFilePath ?? "data/reserve-slots.json");
    notice.value = next.message ?? "已从管理员文件同步预留位数据。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    importing.value = false;
  }
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
  if (!value) return "未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
defineExpose({
  loadState,
});
</script>

<style scoped>
.reserve-slots-section {
  display: grid;
  gap: 12px;
}

.reserve-summary-grid {
  display: grid;
  gap: 10px;
}

.reserve-field {
  display: grid;
  gap: 6px;
}

.reserve-field label,
.reserve-toggle strong {
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.reserve-field small,
.reserve-toggle small,
.reserve-status-card small,
.reserve-tag small {
  color: var(--color-text-muted);
  font-size: 11px;
}

.reserve-input {
  width: 100%;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  border-radius: 12px;
  padding: 9px 10px;
}

.reserve-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.02);
  border-radius: 14px;
  padding: 10px 12px;
}

.reserve-toggle span {
  display: grid;
  gap: 2px;
}

.reserve-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reserve-action {
  border: 1px solid rgba(96, 165, 250, 0.28);
  background: rgba(96, 165, 250, 0.14);
  color: var(--color-text-primary);
  border-radius: 12px;
  padding: 8px 12px;
}

.reserve-action.secondary {
  border-color: var(--color-border-soft);
  background: rgba(255, 255, 255, 0.03);
}

.reserve-action:disabled {
  opacity: 0.55;
}

.reserve-notice,
.reserve-state-box {
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
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

.reserve-status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.reserve-status-card {
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.02);
  border-radius: 14px;
  padding: 12px;
  display: grid;
  gap: 4px;
}

.reserve-status-label {
  color: var(--color-text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.reserve-status-card strong {
  color: var(--color-text-primary);
  font-size: 14px;
}

.reserve-block {
  display: grid;
  gap: 10px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.02);
  border-radius: 16px;
  padding: 12px;
}

.reserve-block-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.reserve-block-head h4 {
  margin: 0;
  font-size: 14px;
}

.reserve-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reserve-tag {
  display: grid;
  gap: 2px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.025);
  border-radius: 999px;
  padding: 8px 10px;
  min-width: 0;
}

.reserve-tag strong {
  color: var(--color-text-primary);
  font-size: 12px;
}

.reserve-empty {
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-table-wrap {
  overflow: auto;
  border-radius: 12px;
}

.reserve-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 720px;
}

.reserve-table th,
.reserve-table td {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  text-align: left;
  vertical-align: top;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.reserve-table th {
  color: var(--color-text-primary);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.reserve-table .mono {
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  white-space: nowrap;
}

.reserve-table .raw-line {
  word-break: break-all;
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
  background: rgba(74, 222, 128, 0.12);
  color: #b8f7cc;
}

.reserve-pill.expired {
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: rgba(248, 113, 113, 0.12);
  color: #ffcbc9;
}

.reserve-pill.empty {
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(148, 163, 184, 0.1);
  color: #d4dde5;
}

@media (max-width: 1100px) {
  .reserve-status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .reserve-status-grid {
    grid-template-columns: 1fr;
  }

  .reserve-toggle {
    flex-direction: column;
    align-items: stretch;
  }

  .reserve-actions {
    flex-direction: column;
  }

  .reserve-action {
    width: 100%;
  }
}
</style>
