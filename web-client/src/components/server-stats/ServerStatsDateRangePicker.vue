<template>
  <div v-if="open" class="date-picker-overlay" v-backdrop-close="() => emit('close')">
    <AppCard class="date-picker-card" title="选择历史日期" description="可多选，选好后点击应用以加载所选日期的数据。">
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

        <div v-if="availableDates.length === 0" class="empty-state">暂无可选日期。</div>
      </div>

      <div class="dialog-footer">
        <button type="button" class="secondary-btn" @click="emit('reset')">清空选择</button>
        <button type="button" class="primary-btn" @click="emit('apply')">确认应用</button>
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
.date-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: var(--theme-overlay-scrim);
  backdrop-filter: blur(10px);
}

.date-picker-card {
  width: min(500px, 100%);
  animation: dialog-pop 0.18s ease-out;
}

.dialog-body {
  margin-top: 14px;
}

.date-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  max-height: 40vh;
  overflow-y: auto;
  padding-right: 4px;
}

.date-button {
  min-height: 42px;
  padding: 8px 12px;
  border-radius: var(--control-radius, 10px);
  border: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-elevated) 86%, transparent);
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.16s ease;
}

.date-button:hover {
  border-color: var(--color-border-highlight);
  background: var(--color-bg-hover);
}

.date-button.active {
  border-color: rgba(96, 165, 250, 0.6);
  background: rgba(96, 165, 250, 0.15);
  color: #60a5fa;
}

.empty-state {
  text-align: center;
  color: var(--color-text-muted);
  padding: 24px 0;
  font-size: 13px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.secondary-btn,
.primary-btn {
  height: 36px;
  padding: 0 16px;
  border-radius: var(--control-radius, 10px);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}

.secondary-btn {
  background: color-mix(in srgb, var(--color-bg-elevated) 86%, transparent);
  color: var(--color-text-secondary);
  border-color: var(--color-border-default);
}

.secondary-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.primary-btn {
  color: #fff;
  background: #2563eb;
}

.primary-btn:hover {
  background: #1d4ed8;
}

@keyframes dialog-pop {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
