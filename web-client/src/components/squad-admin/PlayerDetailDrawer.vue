<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="player-detail-drawer-backdrop" @click="close" />
    </Transition>
    <Transition name="drawer">
      <div v-if="open && props.player" class="player-detail-drawer" @click.self="close">
        <header class="drawer-header">
          <div class="drawer-header-content">
            <h2 class="drawer-player-name">{{ props.player.name }}</h2>
            <div class="drawer-header-badges">
              <StatusBadge :tone="props.player.isOnline ? 'ok' : 'idle'">
                {{ props.player.isOnline ? 'Online' : 'Offline' }}
              </StatusBadge>
              <StatusBadge v-if="props.player.isLeader" tone="ok">SL</StatusBadge>
            </div>
          </div>
          <button type="button" class="drawer-close-button" @click="close" title="Close (Esc)">
            ✕
          </button>
        </header>

        <div class="drawer-body">
          <!-- Player Summary -->
          <section class="detail-section">
            <div class="detail-section-title">Player</div>
            <div class="player-summary">
              <div class="summary-row">
                <span class="summary-label">Role</span>
                <span class="summary-value">{{ props.player.role }}</span>
              </div>
              <div class="summary-row">
                <span class="summary-label">Team</span>
                <span class="summary-value team-badge" :class="teamColorClass">
                  Team {{ props.player.teamId ?? '?' }}
                </span>
              </div>
              <div class="summary-row">
                <span class="summary-label">Squad</span>
                <span class="summary-value">Squad {{ props.player.squadId ?? 'Unassigned' }}</span>
              </div>
              <div v-if="props.player.playtimeHours" class="summary-row">
                <span class="summary-label">Steam Time</span>
                <span class="summary-value">{{ props.player.playtimeHours }}h</span>
              </div>
            </div>
          </section>

          <!-- Identity -->
          <section class="detail-section">
            <div class="detail-section-title">Identity</div>
            <CopyableValue
              label="Steam ID"
              :value="props.player.steamId"
              :truncate="32"
            />
            <CopyableValue
              label="EOS ID"
              :value="props.player.eosId"
              :truncate="32"
            />
            <CopyableValue
              label="IP"
              :value="props.player.ip"
            />
          </section>

          <!-- Current Match -->
          <section class="detail-section">
            <div class="detail-section-title">Current Match</div>
            <div class="detail-rows">
              <div class="detail-row">
                <span class="detail-label">Player ID</span>
                <span class="detail-value">{{ props.player.playerId ?? '-' }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Team ID</span>
                <span class="detail-value">{{ props.player.teamId ?? '-' }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Squad ID</span>
                <span class="detail-value">{{ props.player.squadId ?? '-' }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Leader</span>
                <span class="detail-value">{{ props.player.isLeader ? 'Yes' : 'No' }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Status</span>
                <span class="detail-value">{{ props.player.isOnline ? 'Online' : 'Offline' }}</span>
              </div>
            </div>
          </section>

          <!-- Actions -->
          <section class="detail-section">
            <div class="detail-section-title">Actions</div>
            <button type="button" class="action-button primary" @click="openDatabase">
              Open Database
            </button>
            <button type="button" class="action-button secondary" @click="copyValue(props.player.steamId, 'Steam ID')" :disabled="!props.player.steamId">
              Copy Steam ID
            </button>
            <button type="button" class="action-button secondary" @click="copyValue(props.player.eosId, 'EOS ID')" :disabled="!props.player.eosId">
              Copy EOS ID
            </button>
            <button type="button" class="action-button secondary" @click="copyValue(props.player.ip, 'IP')" :disabled="!props.player.ip">
              Copy IP
            </button>
          </section>

          <!-- Advanced -->
          <section class="detail-section advanced-section">
            <button type="button" class="detail-section-title advanced-toggle" @click="showAdvanced = !showAdvanced">
              {{ showAdvanced ? '▼' : '▶' }} Advanced
            </button>
            <div v-if="showAdvanced" class="advanced-content">
              <div class="detail-rows">
                <div class="detail-row">
                  <span class="detail-label">Source</span>
                  <span class="detail-value">{{ props.player.source || 'unknown' }}</span>
                </div>
                <div v-if="props.player.controller" class="detail-row">
                  <span class="detail-label">Controller</span>
                  <span class="detail-value ellipsis">{{ props.player.controller }}</span>
                </div>
              </div>
              <pre v-if="props.player.raw" class="raw-data"><code>{{ JSON.stringify(props.player.raw, null, 2) }}</code></pre>
            </div>
          </section>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import type { PlayerDetailViewModel } from "../../types/squad-admin.types";
import { useUiStore } from "../../stores/ui.store";
import { copyTextWithToast } from "../../utils/clipboard";
import { goToPlayerDatabaseSearch } from "../../utils/player-database";
import StatusBadge from "../common/StatusBadge.vue";
import CopyableValue from "./CopyableValue.vue";

const props = withDefaults(
  defineProps<{
    player: PlayerDetailViewModel | null;
    open: boolean;
  }>(),
  {
    player: null,
  },
);

const emit = defineEmits<{
  (event: "close"): void;
}>();

const ui = useUiStore();
const router = useRouter();
const showAdvanced = ref(false);

const teamColorClass = computed(() => {
  if (!props.player) return "neutral";
  if (props.player.teamId === 1) return "team1";
  if (props.player.teamId === 2) return "team2";
  return "neutral";
});

function close() {
  emit("close");
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === "Escape" && props.open) {
    close();
  }
}

async function copyValue(value: string | null | undefined, label: string) {
  if (!value) return;
  await copyTextWithToast(value, ui, {
    label: `${label} copied`,
    successMessage: value,
  });
}

function openDatabase() {
  if (!props.player) return;
  const searchKey = props.player.name || props.player.steamId || props.player.eosId || "";
  if (searchKey) {
    goToPlayerDatabaseSearch(router, searchKey);
  }
}

onMounted(() => {
  document.addEventListener("keydown", handleEscape);
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleEscape);
});
</script>

<style scoped>
.player-detail-drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 39;
}

.player-detail-drawer {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: 420px;
  background: var(--color-bg-panel);
  border-left: 1px solid var(--color-border-default);
  display: grid;
  grid-template-rows: auto 1fr;
  z-index: 40;
  box-shadow: var(--shadow-lg);
}

.drawer-enter-active,
.drawer-leave-active {
  transition: all 0.2s ease;
}

.drawer-enter-from {
  transform: translateX(100%);
}

.drawer-leave-to {
  transform: translateX(100%);
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  border-bottom: 1px solid var(--color-border-default);
  flex-shrink: 0;
}

.drawer-header-content {
  display: grid;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.drawer-player-name {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-header-badges {
  display: flex;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.drawer-close-button {
  padding: 6px 10px;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 18px;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: all 0.15s ease;
  flex-shrink: 0;
  line-height: 1;
}

.drawer-close-button:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.drawer-body {
  overflow-y: auto;
  padding: var(--spacing-lg);
  display: grid;
  gap: var(--spacing-lg);
}

.detail-section {
  display: grid;
  gap: var(--spacing-md);
}

.detail-section-title {
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: default;
}

.advanced-toggle {
  cursor: pointer;
  display: flex;
  gap: 6px;
  align-items: center;
  transition: color 0.15s ease;
}

.advanced-toggle:hover {
  color: var(--color-text-primary);
}

.player-summary {
  display: grid;
  gap: var(--spacing-sm);
}

.summary-row {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: var(--spacing-md);
  align-items: center;
  padding: var(--spacing-sm) 0;
  border-bottom: 1px solid var(--color-border-soft);
  min-height: 28px;
}

.summary-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.summary-value {
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-value.team-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
  font-size: var(--font-size-sm);
  width: fit-content;
}

.summary-value.team-badge.team1 {
  background: rgba(56, 189, 248, 0.1);
  color: var(--color-team1-primary);
  border: 1px solid var(--color-team1-border);
}

.summary-value.team-badge.team2 {
  background: rgba(251, 146, 60, 0.1);
  color: var(--color-team2-primary);
  border: 1px solid var(--color-team2-border);
}

.detail-rows {
  display: grid;
  gap: 0;
}

.detail-row {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: var(--spacing-md);
  align-items: center;
  padding: var(--spacing-sm) 0;
  border-bottom: 1px solid var(--color-border-soft);
  min-height: 28px;
  font-size: var(--font-size-sm);
}

.detail-label {
  color: var(--color-text-secondary);
  font-weight: 500;
}

.detail-value {
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-value.ellipsis {
  font-family: "Courier New", monospace;
}

.action-button {
  width: 100%;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}

.action-button.primary {
  background: var(--color-status-info);
  color: white;
  border-color: var(--color-status-info);
}

.action-button.primary:hover:not(:disabled) {
  background: rgba(96, 165, 250, 0.9);
}

.action-button.secondary {
  background: transparent;
  color: var(--color-status-info);
  border-color: var(--color-status-info);
}

.action-button.secondary:hover:not(:disabled) {
  background: rgba(96, 165, 250, 0.1);
}

.action-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.advanced-content {
  display: grid;
  gap: var(--spacing-md);
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--color-border-soft);
}

.raw-data {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
  font-size: 11px;
  font-family: "Courier New", monospace;
  color: var(--color-text-secondary);
  max-height: 300px;
  overflow: auto;
  margin: 0;
  line-height: 1.4;
}

@media (max-width: 768px) {
  .player-detail-drawer {
    width: 100%;
  }
}

@media (max-width: 500px) {
  .drawer-header {
    padding: var(--spacing-md);
  }

  .drawer-body {
    padding: var(--spacing-md);
    gap: var(--spacing-md);
  }

  .summary-row,
  .detail-row {
    grid-template-columns: 80px 1fr;
    gap: var(--spacing-sm);
  }
}
</style>
