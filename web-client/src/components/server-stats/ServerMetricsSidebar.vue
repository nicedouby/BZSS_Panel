<template>
  <div class="server-metrics-sidebar">
    <AppCard title="时间窗口" description="选择最近窗口、当前对局或自定义日期。">
      <div class="range-grid">
        <button
          v-for="range in ranges"
          :key="range.key"
          type="button"
          class="range-button"
          :class="{ active: isRangeActive(range.key) }"
          @click="emit('select-range', range.key)"
        >
          <span class="range-label">{{ range.label }}</span>
          <span class="range-key">{{ range.key }}</span>
        </button>
      </div>

      <p v-if="rangeHint" class="hint-text">{{ rangeHint }}</p>
    </AppCard>

    <AppCard title="指标通道" description="控制图表中显示的曲线。">
      <div class="channel-list">
        <button
          v-for="channel in channels"
          :key="channel.key"
          type="button"
          class="channel-button"
          :class="{ enabled: enabledChannels[channel.key] !== false }"
          @click="emit('toggle-channel', channel.key)"
        >
          <div class="channel-title">
            <span class="channel-color" :style="{ backgroundColor: channel.color }"></span>
            <span class="channel-name">{{ channel.label }}</span>
          </div>
          <span class="channel-value">{{ formatMetricValue(currentMetrics[channel.key], channel.axis === "tps" ? 1 : 0) }}</span>
        </button>
      </div>
    </AppCard>

    <div class="sidebar-footer">
      <div>
        <span class="footer-label">最后更新</span>
        <span class="footer-value">{{ lastUpdatedLabel }}</span>
      </div>
      <div class="footer-note">
        <span class="footer-label">自动刷新</span>
        <span class="footer-value">{{ refreshModeLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppCard from "../common/AppCard.vue";

import type { ServerMetricChannel, ServerMetricRangeKey, ServerMetricRangeOption } from "../../composables/useServerMetrics";

const props = defineProps<{
  ranges: readonly ServerMetricRangeOption[];
  selectedRange: ServerMetricRangeKey;
  currentMetrics: Record<string, number>;
  channels: ServerMetricChannel[];
  enabledChannels: Record<string, boolean>;
  lastUpdatedLabel: string;
  rangeHint: string;
  refreshModeLabel: string;
  hasCustomSelection: boolean;
}>();

const emit = defineEmits<{
  (event: "select-range", range: ServerMetricRangeKey): void;
  (event: "toggle-channel", key: string): void;
}>();

function isRangeActive(rangeKey: ServerMetricRangeKey) {
  return !props.hasCustomSelection && props.selectedRange === rangeKey;
}

function formatMetricValue(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (digits > 0) return value.toFixed(digits);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
</script>

<style scoped>
.server-metrics-sidebar {
  display: grid;
  gap: 16px;
}

.range-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.range-button {
  display: grid;
  gap: 4px;
  align-items: start;
  justify-items: start;
  min-height: 54px;
  padding: 11px 12px;
  border-radius: 14px;
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01)),
    rgba(255, 255, 255, 0.02);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: border-color 0.16s ease, transform 0.16s ease, background-color 0.16s ease;
}

.range-button:hover {
  transform: translateY(-1px);
  border-color: rgba(96, 165, 250, 0.35);
}

.range-button.active {
  border-color: rgba(96, 165, 250, 0.58);
  background:
    linear-gradient(180deg, rgba(96, 165, 250, 0.12), rgba(96, 165, 250, 0.04)),
    rgba(255, 255, 255, 0.03);
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.18);
}

.range-label {
  font-size: 13px;
  font-weight: 700;
}

.range-key {
  font-size: 11px;
  color: var(--color-text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hint-text {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.channel-list {
  display: grid;
  gap: 10px;
}

.channel-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 12px 13px;
  border-radius: 14px;
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01)),
    rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: border-color 0.16s ease, transform 0.16s ease, opacity 0.16s ease;
}

.channel-button:hover {
  transform: translateY(-1px);
  border-color: rgba(96, 165, 250, 0.28);
}

.channel-button:not(.enabled) {
  opacity: 0.46;
}

.channel-button.enabled {
  border-color: rgba(96, 165, 250, 0.22);
}

.channel-title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.channel-color {
  width: 4px;
  height: 16px;
  border-radius: 999px;
  flex: none;
}

.channel-name {
  font-size: 13px;
  font-weight: 600;
}

.channel-value {
  font-size: 14px;
  font-weight: 800;
  font-family: "JetBrains Mono", monospace;
  color: var(--color-text-primary);
}

.sidebar-footer {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01)),
    rgba(255, 255, 255, 0.02);
}

.footer-label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-muted);
}

.footer-value {
  display: block;
  margin-top: 4px;
  font-size: 13px;
  font-weight: 700;
}

.footer-note {
  padding-top: 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.12);
}
</style>
