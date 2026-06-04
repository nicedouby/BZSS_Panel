<template>
  <section class="bz-card ice-summary-card">
    <div class="bz-card-body compact">
      <div class="summary-bar">
        <div class="metric metric--primary">
          <span class="metric__label">总事件</span>
          <strong class="metric__value">{{ stats.total ?? 0 }}</strong>
          <small class="metric__hint">{{ loading ? "正在刷新" : "当前筛选结果" }}</small>
        </div>
        <div class="metric">
          <span class="metric__label">伤 / 击倒 / 击杀 / 复苏</span>
          <strong class="metric__value">{{ stats.damage ?? 0 }} / {{ stats.wound ?? 0 }} / {{ stats.kill ?? 0 }} / {{ stats.revive ?? 0 }}</strong>
        </div>
        <div class="metric">
          <span class="metric__label">受害 / 攻击</span>
          <strong class="metric__value">{{ stats.victimWarned ?? 0 }} / {{ stats.attackerWarned ?? 0 }}</strong>
        </div>
        <div class="metric">
          <span class="metric__label">跳过 / 失败</span>
          <strong class="metric__value">{{ stats.skipped ?? 0 }} / {{ stats.failed ?? 0 }}</strong>
        </div>
        <div class="metric">
          <span class="metric__label">友伤 / 自伤 / 同人</span>
          <strong class="metric__value">{{ stats.friendlyFire ?? 0 }} / {{ stats.selfDamage ?? 0 }} / {{ stats.samePlayer ?? 0 }}</strong>
        </div>
        <div class="metric metric--compact">
          <span class="metric__label">轻武器 / 非轻武器</span>
          <strong class="metric__value">{{ stats.lightWeapon ?? 0 }} / {{ stats.nonLightWeapon ?? 0 }}</strong>
        </div>
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
</script>

<style scoped>
.summary-bar {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.metric {
  display: grid;
  gap: 2px;
  min-height: 56px;
  padding: 8px 10px;
  border: 1px solid rgba(95, 130, 160, 0.22);
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.015)),
    rgba(12, 20, 28, 0.9);
}

.metric--primary {
  border-color: rgba(96, 165, 250, 0.3);
  background:
    radial-gradient(circle at 0% 0%, rgba(96, 165, 250, 0.12), transparent 40%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.015)),
    rgba(12, 20, 28, 0.95);
}

.metric__label {
  color: #8fa2b3;
  font-size: 11px;
  line-height: 1.1;
}

.metric__value {
  color: #edf2f4;
  font-size: 15px;
  line-height: 1.05;
}

.metric__hint {
  color: #76879a;
  font-size: 10px;
  line-height: 1.1;
}

.metric--compact {
  min-height: 46px;
  align-content: center;
}

.metric--compact .metric__label {
  font-size: 10px;
}

.metric--compact .metric__value {
  font-size: 14px;
}

@media (max-width: 1400px) {
  .summary-bar {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
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

  .metric {
    min-height: 52px;
  }
}
</style>
