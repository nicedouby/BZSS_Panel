<template>
  <div class="kpi-card" :class="[toneClass, { 'is-empty': isEmpty }]">
    <div class="card-inner">
      <div class="card-head">
        <span class="card-title">{{ title }}</span>
        <span v-if="statusLabel" class="status-badge" :class="toneClass">{{ statusLabel }}</span>
      </div>

      <div class="card-main">
        <span class="main-value">{{ value }}</span>
        <span v-if="suffix" class="value-suffix">{{ suffix }}</span>
      </div>

      <div class="card-meta">
        <div class="meta-row">
          <span class="meta-label">{{ subLabel }}</span>
          <span class="meta-value" :class="subValueClass">{{ subValue }}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">{{ peakLabel }}</span>
          <span class="meta-value">{{ peakValue }}</span>
        </div>
      </div>

      <!-- Bottom progress bar -->
      <div class="card-progress">
        <div class="progress-bar-track">
          <div class="progress-bar-fill" :style="{ width: `${progressPct}%`, backgroundColor: progressColor }" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    title: string;
    value: string | number;
    suffix?: string;
    statusLabel?: string;
    subLabel: string;
    subValue: string | number;
    subValueClass?: string;
    peakLabel: string;
    peakValue: string | number;
    progressPct: number;
    progressColor?: string;
    tone?: "ok" | "warn" | "critical" | "neutral" | "info";
    isEmpty?: boolean;
  }>(),
  {
    suffix: "",
    statusLabel: "",
    subValueClass: "",
    progressColor: "var(--color-brand-primary)",
    tone: "neutral",
    isEmpty: false,
  }
);

const toneClass = computed(() => `tone-${props.tone}`);
</script>

<style scoped>
.kpi-card {
  position: relative;
  background: var(--stats-panel, var(--color-bg-card));
  border: 1px solid var(--stats-panel-border, var(--color-border-soft));
  border-radius: var(--card-radius, 14px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  transition: border-color 0.16s ease, transform 0.16s ease;
}

.kpi-card:hover {
  border-color: var(--color-border-highlight);
  transform: translateY(-1px);
}

.card-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.card-title {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.status-badge {
  font-size: 9px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.status-badge.tone-ok {
  background: rgba(64, 185, 131, 0.15);
  color: var(--stats-tps-good, #40b983);
}

.status-badge.tone-warn {
  background: rgba(231, 184, 75, 0.15);
  color: var(--stats-tps-warning, #e7b84b);
}

.status-badge.tone-critical {
  background: rgba(229, 104, 104, 0.15);
  color: var(--stats-tps-critical, #e56868);
}

.status-badge.tone-info {
  background: rgba(77, 163, 255, 0.15);
  color: var(--stats-player, #4da3ff);
}

.status-badge.tone-neutral {
  background: color-mix(in srgb, var(--color-border-soft) 80%, transparent);
  color: var(--color-text-muted);
}

.card-main {
  display: flex;
  align-items: baseline;
  margin-bottom: 12px;
}

.main-value {
  font-size: 26px;
  font-weight: 900;
  color: var(--color-text-primary);
  font-family: 'JetBrains Mono', monospace;
  line-height: 1.1;
}

.value-suffix {
  font-size: 11px;
  color: var(--color-text-secondary);
  font-family: 'JetBrains Mono', monospace;
  margin-left: 4px;
}

.card-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
  border-top: 1px solid var(--color-border-soft);
  padding-top: 8px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.meta-label {
  color: var(--color-text-muted);
}

.meta-value {
  color: var(--color-text-secondary);
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
}

.meta-value.text-green {
  color: var(--stats-tps-good, #40b983);
}

.meta-value.text-orange {
  color: var(--stats-tps-warning, #e7b84b);
}

.meta-value.text-red {
  color: var(--stats-tps-critical, #e56868);
}

/* Progress bar at the bottom */
.card-progress {
  margin-top: auto;
}

.progress-bar-track {
  height: 3px;
  width: 100%;
  background: var(--color-border-soft);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease;
}

/* Empty or neutral styling */
.is-empty {
  opacity: 0.85;
}
</style>
