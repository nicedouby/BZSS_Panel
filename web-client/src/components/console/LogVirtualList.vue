<template>
  <PageCard class="log-card" compact>
    <RecycleScroller
      class="scroller"
      :items="lines"
      :item-size="60"
      key-field="seq"
      v-slot="{ item }"
    >
      <article class="log-line" :class="[`level-${safeClass(item.level)}`, `stream-${safeClass(item.stream)}`]">
        <div class="line-meta">
          <strong>#{{ item.seq }}</strong>
          <span>{{ shortTime(item.time) }}</span>
          <span>{{ item.scope || item.channel || item.stream || "app" }}</span>
          <span>{{ item.level || "info" }}</span>
        </div>
        <div class="line-body">{{ lineMessage(item) }}</div>
      </article>
    </RecycleScroller>
  </PageCard>
</template>

<script setup lang="ts">
import { RecycleScroller } from "vue-virtual-scroller";
import type { ConsoleLine } from "../../composables/useConsoleLines";
import PageCard from "../common/PageCard.vue";

defineProps<{
  lines: ConsoleLine[];
}>();

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
.log-card {
  min-height: 520px;
}

.scroller {
  height: 520px;
}

.log-line {
  min-height: 60px;
  padding: 10px 12px;
  border-bottom: 1px solid #26303a;
  display: grid;
  gap: 6px;
}

.line-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  color: #98a5af;
  font-size: 12px;
}

.line-body {
  color: #e4eaee;
  font-size: 13px;
  line-height: 1.45;
  word-break: break-word;
}

.level-error .line-body {
  color: #ffbcbc;
}

.level-warn .line-body {
  color: #f1d58b;
}
</style>
