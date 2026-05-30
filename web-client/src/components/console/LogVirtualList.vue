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
  background: #0d1117;
}

.scroller {
  flex: 1;
  min-height: 0;
}

.log-line {
  height: 32px;
  max-height: 32px;
  padding: 0 12px;
  border-bottom: 1px solid #1a2128;
  display: flex;
  gap: 8px;
  align-items: center;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  overflow: hidden;
}

.line-meta {
  display: flex;
  gap: 8px;
  color: #6a7680;
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}

.line-meta .seq {
  color: #444c56;
  width: 40px;
}

.line-meta .level {
  text-transform: uppercase;
  font-weight: bold;
}

.line-body {
  color: #d1d5da;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.line-label {
  color: #58a6ff;
  margin-right: 4px;
  font-weight: bold;
}

.level-error .line-body {
  color: #f85149;
}

.level-error .line-meta .level {
  color: #f85149;
}

.level-warn .line-body {
  color: #d29922;
}

.level-warn .line-meta .level {
  color: #d29922;
}

.level-debug .line-body {
  color: #8b949e;
}
</style>
