<template>
  <div class="squad-page-toolbar">
    <div class="toolbar-row">
      <input
        v-model="searchQuery"
        type="text"
        class="squad-search-input"
        placeholder="Search by name, role, ID, Steam, or IP..."
        @input="$emit('search', searchQuery)"
      >
      <div class="toolbar-controls">
        <div class="density-toggle">
          <button
            v-for="mode in ['comfortable', 'compact']"
            :key="mode"
            type="button"
            :class="{ active: densityMode === mode }"
            @click="$emit('density-change', mode as any)"
          >
            {{ mode === 'comfortable' ? 'Comfortable' : 'Compact' }}
          </button>
        </div>
        <div class="refresh-actions">
          <button type="button" :disabled="refreshingPlayers" @click="$emit('refresh-players')">
            {{ refreshingPlayers ? "Refreshing Players..." : "Refresh Players" }}
          </button>
          <button type="button" :disabled="refreshingSquads" @click="$emit('refresh-squads')">
            {{ refreshingSquads ? "Refreshing Squads..." : "Refresh Squads" }}
          </button>
          <button type="button" :disabled="refreshingAll" @click="$emit('refresh-all')">
            {{ refreshingAll ? "Refreshing All..." : "Refresh All" }}
          </button>
        </div>
      </div>
    </div>
    <div class="toolbar-status-row">
      <span>Server updated {{ formatTime(serverStatusUpdatedAt) }}</span>
      <span>Players updated {{ formatTime(playersUpdatedAt) }}</span>
      <span>Squads updated {{ formatTime(squadsUpdatedAt) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  searchQuery: string;
  densityMode: "comfortable" | "compact";
  refreshingPlayers?: boolean;
  refreshingSquads?: boolean;
  refreshingAll?: boolean;
  serverStatusUpdatedAt?: number;
  playersUpdatedAt?: number;
  squadsUpdatedAt?: number;
}>();

const emit = defineEmits<{
  (event: "search", query: string): void;
  (event: "density-change", mode: "comfortable" | "compact"): void;
  (event: "refresh-players"): void;
  (event: "refresh-squads"): void;
  (event: "refresh-all"): void;
}>();

const searchQuery = ref(props.searchQuery);

watch(
  () => props.searchQuery,
  (newVal) => {
    searchQuery.value = newVal;
  },
);

function formatTime(time?: number): string {
  if (!time) return "--:--:--";
  return new Date(time).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
</script>

<style scoped>
.squad-page-toolbar {
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-default);
  padding: var(--spacing-md) var(--spacing-lg);
  flex-shrink: 0;
}

.toolbar-row {
  display: flex;
  gap: var(--spacing-md);
  align-items: center;
}

.squad-search-input {
  flex: 1 1 auto;
  min-width: 200px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  transition: all 0.2s ease;
}

.squad-search-input:focus {
  outline: none;
  border-color: var(--color-status-info);
  background: var(--color-bg-elevated);
}

.squad-search-input::placeholder {
  color: var(--color-text-muted);
}

.toolbar-controls {
  display: flex;
  gap: var(--spacing-md);
  align-items: center;
  flex-wrap: wrap;
}

.density-toggle {
  display: flex;
  gap: 2px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  padding: 2px;
}

.density-toggle button {
  padding: 6px 12px;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all 0.15s ease;
  font-weight: 500;
}

.density-toggle button.active {
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-soft);
}

.density-toggle button:hover:not(.active) {
  color: var(--color-text-primary);
}

.refresh-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.refresh-actions button {
  padding: 6px 12px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: all 0.15s ease;
}

.refresh-actions button:hover:not(:disabled) {
  border-color: var(--color-status-info);
  background: var(--color-bg-card);
}

.refresh-actions button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.toolbar-status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 10px;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

@media (max-width: 768px) {
  .toolbar-row {
    flex-direction: column;
  }

  .squad-search-input {
    width: 100%;
  }
}
</style>
