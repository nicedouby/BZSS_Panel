<template>
  <div class="log-container">
    <RecycleScroller
      ref="scrollerRef"
      class="scroller"
      :items="lines"
      :item-size="32"
      key-field="seq"
      v-slot="{ item }"
    >
      <article class="log-line" :class="[`level-${safeClass(item.level)}`, `stream-${safeClass(item.stream)}`]">
        <div class="line-meta">
          <strong class="seq">#{{ item.seq }}</strong>
          <span class="time">{{ shortTime(item.time) }}</span>
          <span class="scope">{{ item.scope || item.channel || item.stream || t("common.unknown", "app") }}</span>
          <span class="level" v-if="item.level !== 'info'">{{ item.level }}</span>
        </div>
        <div class="line-body">
          <span v-if="item.label" class="line-label">[{{ item.label }}]</span>
          {{ lineMessage(item) }}
        </div>
      </article>
    </RecycleScroller>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { RecycleScroller } from "vue-virtual-scroller";
import type { ConsoleLine } from "../../composables/useConsoleLines";
import { t } from "../../i18n";

const props = defineProps<{
  lines: ConsoleLine[];
}>();

const scrollerRef = ref<any>(null);
const autoScroll = ref(true);

watch(
  () => props.lines.length,
  () => {
    if (autoScroll.value) {
      nextTick(() => {
        if (scrollerRef.value) {
          scrollerRef.value.scrollToItem(props.lines.length - 1);
        }
      });
    }
  }
);

function shortTime(value: unknown) {
  const text = String(value ?? "");
  const iso = text.match(/T(\d{2}:\d{2}:\d{2})/);
  if (iso) return iso[1];
  const plain = text.match(/(\d{2}:\d{2}:\d{2})/);
  if (plain) return plain[1];
  return text;
}

function lineMessage(line: ConsoleLine) {
  return [
    line.eventName,
    line.operation,
    line.message,
    line.dataSummary && line.dataSummary !== line.message ? `[${line.dataSummary}]` : "",
  ].filter(Boolean).join(" | ");
}

function safeClass(value: unknown) {
  return String(value ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
}
</script>

<style scoped>
.log-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.012), transparent 14%),
    var(--color-bg-panel);
  border: 1px solid var(--color-border-default);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: var(--shadow-md);
}

.scroller {
  flex: 1;
  min-height: 0;
  background: rgba(255, 255, 255, 0.01);
}

.log-line {
  height: 34px;
  max-height: 34px;
  padding: 0 14px;
  border-bottom: 1px solid rgba(140, 160, 185, 0.08);
  display: flex;
  gap: 8px;
  align-items: center;
  font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
  overflow: hidden;
}

.line-meta {
  display: flex;
  gap: 8px;
  color: var(--color-text-muted);
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}

.line-meta .seq {
  color: rgba(148, 163, 184, 0.75);
  width: 40px;
}

.line-meta .level {
  text-transform: uppercase;
  font-weight: bold;
}

.line-body {
  color: var(--color-text-secondary);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.line-label {
  color: var(--color-status-info);
  margin-right: 4px;
  font-weight: bold;
}

.level-error .line-body {
  color: #ff9b9b;
}

.level-error .line-meta .level {
  color: #ff9b9b;
}

.level-warn .line-body {
  color: #f4c861;
}

.level-warn .line-meta .level {
  color: #f4c861;
}

.level-debug .line-body {
  color: var(--color-text-muted);
}
</style>
