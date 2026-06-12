<template>
  <div v-if="open" class="server-metrics-dialog-overlay" @click.self="emit('close')">
    <AppCard class="server-metrics-dialog-card" title="历史日期" description="选择一个或多个日期后点击应用。">
      <div class="dialog-body">
        <div class="date-grid">
          <button
            v-for="date in availableDates"
            :key="date"
            type="button"
            class="date-button"
            :class="{ active: selectedDates.includes(date) }"
            @click="emit('toggle-date', date)"
          >
            {{ date }}
          </button>
        </div>

        <p v-if="availableDates.length === 0" class="empty-state">暂无可选日期。</p>
      </div>

      <div class="dialog-footer">
        <button type="button" class="secondary-button" @click="emit('reset')">清空选择</button>
        <button type="button" class="primary-button" @click="emit('apply')">应用选择</button>
      </div>
    </AppCard>
  </div>
</template>

<script setup lang="ts">
import AppCard from "../common/AppCard.vue";

defineProps<{
  open: boolean;
  availableDates: string[];
  selectedDates: string[];
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "toggle-date", date: string): void;
  (event: "reset"): void;
  (event: "apply"): void;
}>();
</script>

<style scoped>
.server-metrics-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: var(--theme-overlay-scrim);
  backdrop-filter: blur(10px);
}

.server-metrics-dialog-card {
  width: min(560px, 100%);
  animation: dialog-pop 0.16s ease-out;
}

.dialog-body {
  display: grid;
  gap: 12px;
}

.date-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  max-height: 48vh;
  overflow: auto;
  padding-right: 2px;
}

.date-button {
  min-height: 46px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--color-border-default);
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-elevated) 86%, transparent);
  color: var(--color-text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.16s ease, transform 0.16s ease, background-color 0.16s ease;
}

.date-button:hover {
  transform: translateY(-1px);
  border-color: rgba(96, 165, 250, 0.3);
}

.date-button.active {
  border-color: rgba(96, 165, 250, 0.64);
  background:
    linear-gradient(180deg, rgba(96, 165, 250, 0.12), rgba(96, 165, 250, 0.04)),
    color-mix(in srgb, var(--color-bg-elevated) 86%, transparent);
  color: color-mix(in srgb, var(--color-brand-primary) 70%, white 30%);
}

.empty-state {
  margin: 0;
  padding: 14px 0 4px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}

.secondary-button,
.primary-button {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.16s ease, border-color 0.16s ease, background-color 0.16s ease;
}

.secondary-button {
  background: color-mix(in srgb, var(--color-bg-elevated) 86%, transparent);
  color: var(--color-text-secondary);
  border-color: var(--color-border-default);
}

.secondary-button:hover,
.primary-button:hover {
  transform: translateY(-1px);
}

.primary-button {
  color: #fff;
  background: linear-gradient(180deg, rgba(96, 165, 250, 0.95), rgba(59, 130, 246, 0.95));
  border-color: rgba(96, 165, 250, 0.34);
}

@keyframes dialog-pop {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
