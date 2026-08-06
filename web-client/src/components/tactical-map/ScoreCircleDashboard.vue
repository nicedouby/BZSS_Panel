<template>
  <div class="score-circle-dashboard" @click.stop @pointerdown.stop>
    <!-- SVG Circular Dashboard -->
    <div class="dashboard-ring-container">
      <svg class="dashboard-svg" viewBox="0 0 100 100">
        <!-- Background track -->
        <circle class="track-bg" cx="50" cy="50" r="42" />

        <!-- Team 1 Arc (Left Semi-circle) -->
        <circle
          class="arc-team1"
          cx="50"
          cy="50"
          r="42"
          :stroke-dasharray="dashArray"
          :stroke-dashoffset="team1Offset"
          transform="rotate(90 50 50)"
        />

        <!-- Team 2 Arc (Right Semi-circle) -->
        <circle
          class="arc-team2"
          cx="50"
          cy="50"
          r="42"
          :stroke-dasharray="dashArray"
          :stroke-dashoffset="team2Offset"
          transform="rotate(-90 50 50) scale(1, -1) translate(0, -100)"
        />
      </svg>

      <!-- Center Text Readout -->
      <div class="dashboard-content font-mono">
        <span class="t1-score" :style="team1ColorStyle">{{ tickets.team1 }}</span>
        <span class="score-vs">VS</span>
        <span class="t2-score" :style="team2ColorStyle">{{ tickets.team2 }}</span>
      </div>
    </div>

    <!-- Settings Trigger Button -->
    <button
      v-if="canEdit"
      type="button"
      class="dashboard-settings-btn"
      title="修改/设置双方票数"
      aria-label="设置票数"
      @click="openEditor"
    >
      ⚙️
    </button>

    <!-- Built-in Ticket Editor Modal -->
    <Transition name="fade">
      <div v-if="editorOpen" class="dashboard-modal-backdrop" @click="closeEditor">
        <div class="dashboard-modal-panel" @click.stop>
          <header class="modal-header">
            <h3>票数配置 (RCON)</h3>
            <button type="button" class="close-btn" @click="closeEditor">✕</button>
          </header>

          <div class="modal-body">
            <!-- Team Selector Tabs -->
            <div class="team-tabs">
              <button
                type="button"
                class="team-tab-btn t1"
                :class="{ active: selectedTeam === 1 }"
                @click="selectedTeam = 1"
              >
                Team 1 ({{ tickets.team1 }})
              </button>
              <button
                type="button"
                class="team-tab-btn t2"
                :class="{ active: selectedTeam === 2 }"
                @click="selectedTeam = 2"
              >
                Team 2 ({{ tickets.team2 }})
              </button>
            </div>

            <!-- Quick Adjust Deltas -->
            <div class="quick-adjust">
              <span class="label">快速微调:</span>
              <div class="btn-group">
                <button
                  v-for="delta in [10, 50, 100, -10, -50, -100]"
                  :key="delta"
                  type="button"
                  class="adjust-btn"
                  :class="delta > 0 ? 'add' : 'sub'"
                  @click="adjustTickets(delta)"
                >
                  {{ delta > 0 ? `+${delta}` : delta }}
                </button>
              </div>
            </div>

            <!-- Custom Direct Write -->
            <form class="direct-write" @submit.prevent="writeTickets">
              <label class="field-label">直接覆盖 Team {{ selectedTeam }} 票数:</label>
              <div class="input-group">
                <input
                  v-model.trim="customValue"
                  type="text"
                  inputmode="numeric"
                  placeholder="输入新票数值"
                  class="write-input"
                />
                <button type="submit" class="submit-btn" :disabled="loading">
                  {{ loading ? "提交中..." : "覆写" }}
                </button>
              </div>
            </form>

            <!-- Error message display -->
            <div v-if="errorMsg" class="error-banner">{{ errorMsg }}</div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { apiPost } from "../../app/apiClient";

const props = defineProps<{
  tickets: { team1: number; team2: number };
  canEdit: boolean;
  serverId: string;
  team1Color?: string;
  team2Color?: string;
}>();

const emit = defineEmits<{
  (e: "tickets-updated"): void;
}>();

const editorOpen = ref(false);
const selectedTeam = ref<1 | 2>(1);
const customValue = ref("");
const loading = ref(false);
const errorMsg = ref("");

// SVG dash calculations
const dashArray = 2 * Math.PI * 42; // ~263.89

const team1ColorStyle = computed(() => props.team1Color ? { color: props.team1Color } : {});
const team2ColorStyle = computed(() => props.team2Color ? { color: props.team2Color } : {});

// Calculate offsets for semicircles
// Semicircle arc length is half of dashArray = ~131.95
const semicircleArc = dashArray / 2;

const team1Offset = computed(() => {
  const t1 = Math.max(0, props.tickets.team1);
  const t2 = Math.max(0, props.tickets.team2);
  const total = t1 + t2 || 1;
  const ratio = t1 / total;
  // Semicircle offset: from 0 (full) to semicircleArc (empty)
  return dashArray - (semicircleArc * ratio);
});

const team2Offset = computed(() => {
  const t1 = Math.max(0, props.tickets.team1);
  const t2 = Math.max(0, props.tickets.team2);
  const total = t1 + t2 || 1;
  const ratio = t2 / total;
  return dashArray - (semicircleArc * ratio);
});

function openEditor() {
  editorOpen.value = true;
  customValue.value = "";
  errorMsg.value = "";
}

function closeEditor() {
  editorOpen.value = false;
}

async function adjustTickets(delta: number) {
  if (!props.serverId) {
    errorMsg.value = "未识别的服务器 ID";
    return;
  }
  loading.value = true;
  errorMsg.value = "";
  try {
    const payload = selectedTeam.value === 1 
      ? { serverId: props.serverId, addT1: delta }
      : { serverId: props.serverId, addT2: delta };

    await apiPost("/api/remote-telemetry/adjust-tickets", payload);
    emit("tickets-updated");
  } catch (err: any) {
    errorMsg.value = err?.message || "微调票数失败";
  } finally {
    loading.value = false;
  }
}

async function writeTickets() {
  const val = parseInt(customValue.value, 10);
  if (isNaN(val) || val < 0) {
    errorMsg.value = "请输入有效的正整数票数";
    return;
  }
  if (!props.serverId) {
    errorMsg.value = "未识别的服务器 ID";
    return;
  }
  loading.value = true;
  errorMsg.value = "";
  try {
    const payload: any = { serverId: props.serverId };
    if (selectedTeam.value === 1) payload.t1 = val;
    else payload.t2 = val;

    await apiPost("/api/remote-telemetry/write-tickets", payload);
    emit("tickets-updated");
    customValue.value = "";
    closeEditor();
  } catch (err: any) {
    errorMsg.value = err?.message || "覆写票数失败";
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.score-circle-dashboard {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 99;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 50%;
  padding: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), inset 0 1px 1px rgba(255, 255, 255, 0.1);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.score-circle-dashboard:hover {
  background: rgba(15, 23, 42, 0.65);
  border-color: rgba(255, 255, 255, 0.15);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.8);
}

.dashboard-ring-container {
  position: relative;
  width: 90px;
  height: 90px;
}

.dashboard-svg {
  width: 100%;
  height: 100%;
}

.track-bg {
  fill: none;
  stroke: rgba(255, 255, 255, 0.04);
  stroke-width: 6;
}

.arc-team1 {
  fill: none;
  stroke: #3b82f6; /* Default Blue */
  stroke-width: 6.5;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.35s ease;
}

.arc-team2 {
  fill: none;
  stroke: #ef4444; /* Default Red */
  stroke-width: 6.5;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.35s ease;
}

/* Center score readout values */
.dashboard-content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.t1-score {
  font-size: 15px;
  font-weight: 800;
  color: #3b82f6;
  text-shadow: 0 0 8px rgba(59, 130, 246, 0.5);
  line-height: 1.1;
}

.t2-score {
  font-size: 15px;
  font-weight: 800;
  color: #ef4444;
  text-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
  line-height: 1.1;
}

.score-vs {
  font-size: 8px;
  color: rgba(255, 255, 255, 0.35);
  font-weight: 600;
  margin: 1px 0;
}

/* Gear configuration btn */
.dashboard-settings-btn {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(30, 41, 59, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #ffffff;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  transition: all 0.2s ease;
}

.dashboard-settings-btn:hover {
  transform: rotate(45deg);
  background: #1e293b;
  border-color: #00e5ff;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.4);
}

/* Modal configuration */
.dashboard-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(4, 6, 12, 0.7);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dashboard-modal-panel {
  width: 320px;
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid rgba(0, 229, 255, 0.3);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85), 0 0 25px rgba(0, 229, 255, 0.15);
  border-radius: 8px;
  padding: 16px;
  animation: modalEnter 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modalEnter {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.modal-header h3 {
  font-size: 14px;
  color: #00e5ff;
  font-weight: 800;
  margin: 0;
}

.close-btn {
  background: transparent;
  border: 0;
  color: rgba(255, 255, 255, 0.5);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
}

.close-btn:hover {
  color: #ffffff;
}

.team-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.team-tab-btn {
  flex: 1;
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  transition: all 0.2s ease;
}

.team-tab-btn.t1.active {
  background: rgba(59, 130, 246, 0.15);
  border-color: #3b82f6;
  color: #60a5fa;
}

.team-tab-btn.t2.active {
  background: rgba(239, 68, 68, 0.15);
  border-color: #ef4444;
  color: #f87171;
}

.quick-adjust {
  margin-bottom: 16px;
}

.quick-adjust .label {
  display: block;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 6px;
}

.btn-group {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.adjust-btn {
  padding: 6px;
  font-size: 11px;
  font-weight: 800;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.15s ease;
}

.adjust-btn.add {
  background: rgba(16, 185, 129, 0.08);
  color: #34d399;
}

.adjust-btn.add:hover {
  background: rgba(16, 185, 129, 0.2);
  border-color: #34d399;
}

.adjust-btn.sub {
  background: rgba(239, 68, 68, 0.08);
  color: #f87171;
}

.adjust-btn.sub:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: #f87171;
}

.direct-write {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 14px;
}

.field-label {
  display: block;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 6px;
}

.input-group {
  display: flex;
  gap: 8px;
}

.write-input {
  flex: 1;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 6px 10px;
  color: #ffffff;
  font-size: 12px;
}

.write-input:focus {
  border-color: #00e5ff;
  outline: none;
}

.submit-btn {
  background: #00e5ff;
  color: #090d16;
  border: 0;
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s ease;
}

.submit-btn:hover:not(:disabled) {
  box-shadow: 0 0 10px #00e5ff;
}

.error-banner {
  margin-top: 12px;
  font-size: 11px;
  color: #f87171;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 4px;
  padding: 6px 10px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
