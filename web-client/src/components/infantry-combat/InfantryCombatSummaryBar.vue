<template>
  <section class="bz-card ice-summary-card">
    <div class="bz-card-body compact">
      <div class="summary-bar">
        <div class="tile tile--primary">
          <span>总事件</span>
          <strong>{{ stats.total ?? 0 }}</strong>
          <small>{{ loading ? "正在刷新" : "当前筛选结果" }}</small>
        </div>
        <div class="tile">
          <span>伤 / 击倒 / 击杀</span>
          <strong>{{ stats.damage ?? 0 }} / {{ stats.wound ?? 0 }} / {{ stats.kill ?? 0 }}</strong>
          <small>按当前筛选统计</small>
        </div>
        <div class="tile">
          <span>受害 / 攻击</span>
          <strong>{{ stats.victimWarned ?? 0 }} / {{ stats.attackerWarned ?? 0 }}</strong>
          <small>已发送提醒</small>
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
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.tile {
  display: grid;
  gap: 4px;
  min-height: 96px;
  padding: 12px 13px;
  border: 1px solid rgba(95, 130, 160, 0.22);
  border-radius: 14px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.015)),
    rgba(12, 20, 28, 0.9);
}

.tile--primary {
  border-color: rgba(96, 165, 250, 0.3);
  background:
    radial-gradient(circle at 0% 0%, rgba(96, 165, 250, 0.12), transparent 40%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.015)),
    rgba(12, 20, 28, 0.95);
}

.tile span {
  color: #8fa2b3;
  font-size: 11px;
  line-height: 1.1;
}

.tile strong {
  color: #edf2f4;
  font-size: 18px;
  line-height: 1.05;
}

.tile small {
  color: #70808e;
  font-size: 10px;
  line-height: 1.1;
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
}
</style>
