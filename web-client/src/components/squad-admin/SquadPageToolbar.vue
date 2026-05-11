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
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  searchQuery: string;
  densityMode: "comfortable" | "compact";
}>();

const emit = defineEmits<{
  (event: "search", query: string): void;
  (event: "density-change", mode: "comfortable" | "compact"): void;
}>();

const searchQuery = ref(props.searchQuery);

watch(
  () => props.searchQuery,
  (newVal) => {
    searchQuery.value = newVal;
  },
);
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

@media (max-width: 768px) {
  .toolbar-row {
    flex-direction: column;
  }

  .squad-search-input {
    width: 100%;
  }
}
</style>
