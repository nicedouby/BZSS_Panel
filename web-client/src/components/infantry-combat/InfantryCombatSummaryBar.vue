<template>
  <section class="summary-bar">
    <div class="tile primary">
      <span>总事件</span>
      <strong>{{ stats.total ?? 0 }}</strong>
      <small>{{ loading ? "正在刷新" : "当前筛选结果" }}</small>
    </div>
    <div class="tile">
      <span>伤害 / 击倒 / 击杀</span>
      <strong>{{ stats.damage ?? 0 }} / {{ stats.wound ?? 0 }} / {{ stats.kill ?? 0 }}</strong>
      <small>按当前筛选统计</small>
    </div>
    <div class="tile">
      <span>受害者提醒 / 攻击者提醒</span>
      <strong>{{ stats.victimWarned ?? 0 }} / {{ stats.attackerWarned ?? 0 }}</strong>
      <small>已发送的提醒数量</small>
    </div>
    <div class="tile">
      <span>跳过 / 失败</span>
      <strong>{{ stats.skipped ?? 0 }} / {{ stats.failed ?? 0 }}</strong>
      <small>提醒结果概览</small>
    </div>
    <div class="tile">
      <span>友伤 / 自伤 / 同人</span>
      <strong>{{ stats.friendlyFire ?? 0 }} / {{ stats.selfDamage ?? 0 }} / {{ stats.samePlayer ?? 0 }}</strong>
      <small>关系与抑制统计</small>
    </div>
    <div class="tile">
      <span>轻武器 / 非轻武器</span>
      <strong>{{ stats.lightWeapon ?? 0 }} / {{ stats.nonLightWeapon ?? 0 }}</strong>
      <small>武器分类统计</small>
    </div>

    <div class="status-panel">
      <div class="status-group">
        <span class="status-label">combat-clean</span>
        <span class="status-chip" :data-tone="combatCleanTone">{{ combatCleanText }}</span>
      </div>
      <div class="status-group">
        <span class="status-label">admin-warn</span>
        <span class="status-chip" :data-tone="adminWarnTone">{{ adminWarnText }}</span>
      </div>
      <div class="status-group">
        <span class="status-label">最近更新</span>
        <span class="status-chip neutral">{{ formatTime(overview?.lastUpdatedAt) }}</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { InfantryCombatOverview } from "../../types/infantry-combat-enhancer";

const props = defineProps<{
  overview: InfantryCombatOverview | null;
  loading?: boolean;
}>();

const stats = computed(() => props.overview?.stats ?? {});

const combatCleanTone = computed(() => {
  const state = props.overview?.dependencies?.combatClean;
  if (state?.connected) return "ok";
  if (state?.subscribed) return "warn";
  if (state?.loaded) return "muted";
  return "danger";
});

const combatCleanText = computed(() => {
  const state = props.overview?.dependencies?.combatClean;
  if (state?.connected) return "已连接";
  if (state?.subscribed) return "已订阅";
  if (state?.loaded) return "已加载";
  return "未加载";
});

const adminWarnTone = computed(() => (props.overview?.dependencies?.adminWarn?.available ? "ok" : "danger"));
const adminWarnText = computed(() => (props.overview?.dependencies?.adminWarn?.available ? "可用" : "不可用"));

function formatTime(value: unknown) {
  const text = String(value ?? "");
  if (!text) return "-";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}
</script>

<style scoped>
.summary-bar {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.tile,
.status-panel {
  border: 1px solid #29323b;
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.015)),
    #12181f;
  padding: 14px;
}

.tile {
  display: grid;
  gap: 4px;
}

.tile.primary {
  border-color: rgba(96, 165, 250, 0.3);
  background:
    radial-gradient(circle at 0% 0%, rgba(96, 165, 250, 0.14), transparent 40%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.015)),
    #111720;
}

.tile span,
.status-label {
  color: #8fa2b3;
  font-size: 12px;
}

.tile strong {
  color: #edf2f4;
  font-size: 22px;
  line-height: 1.1;
}

.tile small {
  color: #70808e;
  font-size: 11px;
}

.status-panel {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
}

.status-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid #32404d;
  background: #10171d;
  color: #dbe2e8;
  font-size: 11px;
}

.status-chip.neutral {
  color: #9aa7b2;
}

.status-chip[data-tone="ok"] {
  border-color: rgba(74, 222, 128, 0.35);
  background: rgba(74, 222, 128, 0.08);
}

.status-chip[data-tone="warn"] {
  border-color: rgba(251, 191, 36, 0.35);
  background: rgba(251, 191, 36, 0.08);
}

.status-chip[data-tone="muted"] {
  color: #9aa7b2;
}

.status-chip[data-tone="danger"] {
  border-color: rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.08);
}

@media (max-width: 1100px) {
  .summary-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .summary-bar {
    grid-template-columns: 1fr;
  }
}
</style>
