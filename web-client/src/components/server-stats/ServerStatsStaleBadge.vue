<template>
  <div class="stale-badge-container">
    <span v-if="isStale" class="badge tone-error" title="超过 15 秒未收到新数据">
      <span class="pulse-dot red" />
      数据已过期
    </span>
    <span v-else-if="!isPolling" class="badge tone-paused" title="已暂停实时轮询">
      <span class="pulse-dot orange" />
      已暂停
    </span>
    <span v-else class="badge tone-polling" title="每 5 秒自动刷新数据">
      <span class="pulse-dot green" />
      实时监控
    </span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  isPolling: boolean;
  isStale: boolean;
}>();
</script>

<style scoped>
.stale-badge-container {
  display: inline-flex;
  align-items: center;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  border: 1px solid transparent;
}

.tone-polling {
  border-color: rgba(52, 211, 153, 0.25);
  background: rgba(52, 211, 153, 0.08);
  color: #34d399;
}

.tone-paused {
  border-color: rgba(245, 158, 11, 0.25);
  background: rgba(245, 158, 11, 0.08);
  color: #f59e0b;
}

.tone-error {
  border-color: rgba(239, 68, 68, 0.25);
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pulse-dot.green {
  background: #34d399;
  box-shadow: 0 0 6px rgba(52, 211, 153, 0.6);
  animation: pulse 2s infinite;
}

.pulse-dot.orange {
  background: #f59e0b;
}

.pulse-dot.red {
  background: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.6);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.9);
  }
}
</style>
