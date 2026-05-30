<template>
  <span class="decision-badge" :data-tone="tone" :title="text">
    <strong>{{ title }}</strong>
    <small>{{ shortText }}</small>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { InfantryCombatWarningDecision } from "../../types/infantry-combat-enhancer";
import { warningDecisionText, warningDecisionTone, warningDecisionStatus } from "../../utils/warning-decision";

const props = defineProps<{
  decision?: InfantryCombatWarningDecision | null;
  roleLabel?: string;
}>();

const tone = computed(() => warningDecisionTone(props.decision));
const text = computed(() => warningDecisionText(props.decision));
const title = computed(() => {
  const role = props.roleLabel?.trim();
  if (role) return role;
  return decisionTitle(props.decision);
});
const shortText = computed(() => shortWarningText(text.value));

function decisionTitle(decision?: InfantryCombatWarningDecision | null) {
  const status = warningDecisionStatus(decision);
  if (status === "sent") return "已发送";
  if (status === "skipped") return "已跳过";
  if (status === "failed") return "失败";
  return "无决策";
}

function shortWarningText(value: string) {
  const text = String(value ?? "").trim();
  if (!text) return "无";
  const normalized = text
    .replace(/^已发送$/, "已发")
    .replace(/^已跳过[:：]?\s*/, "跳过 ")
    .replace(/^失败[:：]?\s*/, "失败 ");
  if (normalized.length <= 18) return normalized;
  return `${normalized.slice(0, 16)}…`;
}
</script>

<style scoped>
.decision-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 5px 8px;
  border-radius: 999px;
  border: 1px solid #2f3944;
  background: #11171d;
  color: #dbe2e8;
  max-width: 100%;
}

.decision-badge[data-tone="ok"] {
  border-color: rgba(74, 222, 128, 0.35);
  background: rgba(74, 222, 128, 0.08);
}

.decision-badge[data-tone="muted"] {
  border-color: #39424c;
  color: #9aa7b2;
}

.decision-badge[data-tone="danger"] {
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
}

.decision-badge strong {
  font-size: 11px;
  white-space: nowrap;
}

.decision-badge small {
  font-size: 11px;
  color: inherit;
  opacity: 0.85;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
