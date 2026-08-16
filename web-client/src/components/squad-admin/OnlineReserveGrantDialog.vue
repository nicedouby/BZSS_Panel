<template>
  <Teleport to="body">
    <transition name="online-reserve-dialog">
      <div v-if="open" class="dialog-backdrop" role="presentation" @mousedown.self="requestClose">
        <section class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="online-reserve-title">
          <header class="dialog-header">
            <div>
              <h2 id="online-reserve-title">为当前对局玩家激活预留位</h2>
              <p>先锁定在线名单，再一次性写入。名单变化时系统会拒绝执行。</p>
            </div>
            <button type="button" class="close-button" :disabled="submitting" aria-label="关闭" @click="requestClose">×</button>
          </header>

          <div class="dialog-body">
            <label class="days-field">
              <span>激活天数</span>
              <input
                v-model.number="durationDays"
                type="number"
                min="1"
                max="30"
                step="1"
                :disabled="submitting"
                @input="invalidatePreview"
              />
              <small>每名在线玩家增加相同天数，最多 30 天。</small>
            </label>

            <div class="preview-panel" :data-tone="previewTone">
              <div class="preview-head">
                <strong>在线名单快照</strong>
                <button type="button" class="secondary-button" :disabled="loadingPreview || submitting || !validDays" @click="loadPreview">
                  {{ loadingPreview ? "检查中…" : "重新检查名单" }}
                </button>
              </div>
              <p v-if="previewError" class="error-text">{{ previewError }}</p>
              <p v-else-if="!preview">正在读取当前对局玩家…</p>
              <template v-else>
                <div class="preview-stats">
                  <span>在线 {{ preview.activePlayerCount }}</span>
                  <span>可发放 {{ preview.playerCount }}</span>
                  <span :class="{ danger: preview.missingIdentityCount > 0 }">
                    身份缺失 {{ preview.missingIdentityCount }}
                  </span>
                </div>
                <p>{{ preview.message }}</p>
                <div v-if="preview.players.length" class="player-preview">
                  <span v-for="player in preview.players.slice(0, 12)" :key="player.steamId">{{ player.name }}</span>
                  <span v-if="preview.players.length > 12">另有 {{ preview.players.length - 12 }} 人</span>
                </div>
              </template>
            </div>

            <label class="confirmation-row" :class="{ disabled: !preview?.canGrant || previewStale }">
              <input
                v-model="confirmed"
                type="checkbox"
                :disabled="!preview?.canGrant || previewStale || submitting"
              />
              <span>
                我确认给名单中的
                <strong>{{ preview?.playerCount ?? 0 }}</strong>
                名玩家每人激活
                <strong>{{ durationDays }}</strong>
                天预留位。
              </span>
            </label>

            <p class="safety-note">
              预留位会在原有有效期基础上累加。重复点击或网络重试不会重复加天。
            </p>
          </div>

          <footer class="dialog-footer">
            <button type="button" class="secondary-button" :disabled="submitting" @click="requestClose">取消</button>
            <button type="button" class="primary-button" :disabled="!canSubmit" @click="submitGrant">
              {{ submitting ? "正在安全写入…" : `确认激活 ${durationDays} 天` }}
            </button>
          </footer>
        </section>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { renderApiError } from "../../app/errors";
import {
  executeOnlineReserveGrant,
  previewOnlineReserveGrant,
  type OnlineReserveGrantPreview,
  type OnlineReserveGrantResult,
} from "../../app/reserveSlotsApi";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "success", result: OnlineReserveGrantResult): void;
}>();

const durationDays = ref(1);
const preview = ref<OnlineReserveGrantPreview | null>(null);
const previewDays = ref<number | null>(null);
const previewError = ref("");
const loadingPreview = ref(false);
const submitting = ref(false);
const confirmed = ref(false);
const requestId = ref("");

const validDays = computed(() =>
  Number.isInteger(Number(durationDays.value))
  && Number(durationDays.value) >= 1
  && Number(durationDays.value) <= 30,
);
const previewStale = computed(() => previewDays.value !== Number(durationDays.value));
const canSubmit = computed(() =>
  Boolean(preview.value?.canGrant)
  && !previewStale.value
  && confirmed.value
  && validDays.value
  && !loadingPreview.value
  && !submitting.value,
);
const previewTone = computed(() => {
  if (previewError.value || (preview.value && !preview.value.canGrant)) return "danger";
  if (preview.value?.canGrant && !previewStale.value) return "ok";
  return "idle";
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    durationDays.value = 1;
    preview.value = null;
    previewDays.value = null;
    previewError.value = "";
    confirmed.value = false;
    requestId.value = createRequestId();
    void loadPreview();
  },
);

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `online_grant_${crypto.randomUUID().replaceAll("-", "")}`;
  }
  return `online_grant_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function invalidatePreview() {
  confirmed.value = false;
}

async function loadPreview() {
  if (!validDays.value) {
    previewError.value = "激活天数必须是 1 到 30 之间的整数。";
    return;
  }
  loadingPreview.value = true;
  previewError.value = "";
  confirmed.value = false;
  try {
    const result = await previewOnlineReserveGrant(Number(durationDays.value));
    preview.value = result;
    previewDays.value = Number(durationDays.value);
    requestId.value = createRequestId();
  } catch (error) {
    preview.value = null;
    previewDays.value = null;
    previewError.value = renderApiError(error, "读取在线玩家名单失败。");
  } finally {
    loadingPreview.value = false;
  }
}

async function submitGrant() {
  if (!canSubmit.value || !preview.value) return;
  submitting.value = true;
  previewError.value = "";
  try {
    const result = await executeOnlineReserveGrant({
      durationDays: Number(durationDays.value),
      rosterToken: preview.value.rosterToken,
      requestId: requestId.value,
      confirmed: true,
    });
    emit("success", result);
  } catch (error) {
    previewError.value = renderApiError(error, "批量激活失败，未确认成功前请不要重新生成请求。");
    if (/名单|roster|OnlineGrantRosterChanged/i.test(previewError.value)) {
      confirmed.value = false;
      preview.value = null;
      previewDays.value = null;
    }
  } finally {
    submitting.value = false;
  }
}

function requestClose() {
  if (submitting.value) return;
  emit("close");
}
</script>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 6, 23, 0.72);
  backdrop-filter: blur(6px);
}

.dialog-card {
  width: min(620px, 100%);
  max-height: min(760px, calc(100vh - 40px));
  overflow: auto;
  border: 1px solid rgba(125, 211, 252, 0.28);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(18, 29, 48, 0.99), rgba(8, 15, 28, 0.99));
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.5);
  color: var(--color-text-primary);
}

.dialog-header,
.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
}

.dialog-header {
  border-bottom: 1px solid var(--color-border-default);
}

.dialog-header h2 {
  margin: 0;
  font-size: 19px;
}

.dialog-header p,
.preview-panel p,
.safety-note {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.close-button {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary);
  font-size: 22px;
  cursor: pointer;
}

.dialog-body {
  display: grid;
  gap: 16px;
  padding: 20px;
}

.days-field {
  display: grid;
  grid-template-columns: auto minmax(90px, 130px);
  align-items: center;
  gap: 8px 14px;
  font-weight: 700;
}

.days-field input {
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  background: rgba(2, 6, 23, 0.5);
  color: var(--color-text-primary);
  font: inherit;
}

.days-field small {
  grid-column: 1 / -1;
  color: var(--color-text-muted);
  font-weight: 400;
}

.preview-panel {
  padding: 14px;
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.025);
}

.preview-panel[data-tone="ok"] {
  border-color: rgba(34, 197, 94, 0.4);
}

.preview-panel[data-tone="danger"] {
  border-color: rgba(248, 113, 113, 0.48);
}

.preview-head,
.preview-stats,
.player-preview {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.preview-head {
  justify-content: space-between;
}

.preview-stats {
  margin-top: 12px;
}

.preview-stats span,
.player-preview span {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.055);
  color: var(--color-text-secondary);
  font-size: 12px;
}

.player-preview {
  margin-top: 12px;
  max-height: 104px;
  overflow: auto;
}

.danger,
.error-text {
  color: #fca5a5 !important;
}

.confirmation-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 13px 14px;
  border: 1px solid rgba(245, 158, 11, 0.34);
  border-radius: 12px;
  background: rgba(245, 158, 11, 0.07);
  cursor: pointer;
}

.confirmation-row.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.confirmation-row input {
  margin-top: 3px;
}

.dialog-footer {
  justify-content: flex-end;
  border-top: 1px solid var(--color-border-default);
}

.primary-button,
.secondary-button {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  font-weight: 700;
  cursor: pointer;
}

.primary-button {
  border-color: rgba(34, 197, 94, 0.5);
  background: rgba(34, 197, 94, 0.18);
  color: #bbf7d0;
}

.secondary-button {
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
}

.primary-button:disabled,
.secondary-button:disabled,
.close-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.online-reserve-dialog-enter-active,
.online-reserve-dialog-leave-active {
  transition: opacity 0.16s ease;
}

.online-reserve-dialog-enter-from,
.online-reserve-dialog-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .dialog-backdrop {
    align-items: end;
    padding: 0;
  }

  .dialog-card {
    max-height: 92vh;
    border-radius: 18px 18px 0 0;
  }
}
</style>
