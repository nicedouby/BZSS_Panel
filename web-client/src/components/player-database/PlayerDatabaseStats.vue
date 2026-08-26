<template>
  <section class="db-stats" aria-label="数据库概览">
    <article
      v-for="item in stats"
      :key="item.label"
      class="stat-card"
      :class="`tone-${item.tone || 'neutral'}`"
    >
      <div class="stat-head">
        <span class="stat-icon" aria-hidden="true">{{ item.icon }}</span>
        <span class="stat-label">{{ item.label }}</span>
      </div>
      <strong class="stat-value">{{ item.value }}</strong>
      <span v-if="item.hint" class="stat-hint">{{ item.hint }}</span>
    </article>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  stats: Array<{
    label: string;
    value: string;
    hint?: string;
    icon?: string;
    tone?: "neutral" | "blue" | "green" | "amber" | "violet";
  }>;
}>();
</script>

<style scoped>
.db-stats {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.stat-card {
  --stat-accent: #7f8c99;
  position: relative;
  min-width: 0;
  padding: 13px 14px 12px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--stat-accent) 22%, var(--color-border-default));
  border-radius: 14px;
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--stat-accent) 8%, transparent), transparent 62%),
    var(--color-bg-panel);
}

.stat-card::after {
  position: absolute;
  inset: auto 0 0;
  height: 2px;
  content: "";
  background: linear-gradient(90deg, var(--stat-accent), transparent);
  opacity: 0.65;
}

.tone-blue { --stat-accent: #4aa8ff; }
.tone-green { --stat-accent: #3fcf8e; }
.tone-amber { --stat-accent: #f2b84b; }
.tone-violet { --stat-accent: #a78bfa; }

.stat-head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.stat-icon {
  width: 23px;
  height: 23px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 7px;
  background: color-mix(in srgb, var(--stat-accent) 14%, transparent);
  color: var(--stat-accent);
  font-size: 12px;
  font-weight: 800;
}

.stat-label,
.stat-hint {
  overflow: hidden;
  color: var(--color-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-label {
  font-size: 11px;
  font-weight: 650;
}

.stat-value {
  display: block;
  margin-top: 8px;
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: clamp(18px, 1.4vw, 24px);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.035em;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-hint {
  display: block;
  margin-top: 7px;
  font-size: 10px;
}

@media (max-width: 1350px) {
  .db-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 700px) {
  .db-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
  .stat-card { padding: 10px 11px; border-radius: 11px; }
  .stat-value { font-size: 18px; }
}
</style>
