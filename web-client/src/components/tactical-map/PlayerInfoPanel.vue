<template>
  <div
    ref="panelRef"
    class="player-info-panel map-floating-panel"
    :class="`tone-${tone}`"
    :style="panelStyle"
    @click.stop
    @contextmenu.prevent.stop
  >
    <!-- Panel Header -->
    <div class="panel-header">
      <div class="header-main">
        <span class="player-name">{{ player.playerName || 'Unknown Player' }}</span>
        <button class="close-btn" @click="$emit('close')" title="关闭">×</button>
      </div>
      <div class="header-sub font-mono">
        <span class="team-badge" :class="`team-${player.teamId}`">TEAM {{ player.teamId }}</span>
        <span class="squad-badge" v-if="player.squadId">SQUAD #{{ player.squadId }}</span>
        <span class="leader-badge" v-if="isSL">LEADER</span>
      </div>
    </div>

    <!-- Health Tracker -->
    <div class="panel-health-tracker">
      <div class="tracker-info font-mono">
        <span class="tracker-label">HEALTH TELEMETRY</span>
        <span class="tracker-val" :class="{ 'low-hp': health < 40, 'dead-hp': health <= 0 }">
          {{ health <= 0 ? 'DOWNED (0%)' : `${health}%` }}
        </span>
      </div>
      <div class="tracker-bar-bg">
        <div
          class="tracker-bar-fill"
          :style="{
            width: `${health}%`,
            backgroundColor: health <= 0 ? '#ef5350' : health < 40 ? '#fbbf24' : '#00e5ff'
          }"
        ></div>
      </div>
    </div>

    <!-- Grid Details -->
    <div class="panel-grid font-mono">
      <div class="grid-row">
        <span class="label">职业/ROLE</span>
        <span class="val">
          <span
            v-if="roleIconImage"
            class="role-mask-icon"
            :style="roleIconStyle"
          ></span>
          <span v-else class="role-fallback-icon">{{ roleInfo.icon || '?' }}</span>
          {{ roleInfo.label }}
        </span>
      </div>

      <div class="grid-row" v-if="weaponName && weaponName !== '-'">
        <span class="label">武器/WEAPON</span>
        <span class="val text-highlight">{{ weaponName }}</span>
      </div>

      <div class="grid-row" v-if="vehicleName">
        <span class="label">载具/VEHICLE</span>
        <span class="val text-orange">{{ vehicleName }}</span>
      </div>

      <div class="grid-row">
        <span class="label">坐标/POSITION</span>
        <span class="val text-cyan">{{ Math.round(gameX) }}, {{ Math.round(gameY) }}</span>
      </div>

      <div class="grid-row">
        <span class="label">速度/VELOCITY</span>
        <span class="val">{{ speedText }}</span>
      </div>

      <div class="grid-row">
        <span class="label">BZSS CORE</span>
        <span class="val sync-status">
          <span class="status-dot animate-pulse"></span>
          {{ coreStatusText || '已定位 (ONLINE)' }}
        </span>
      </div>

      <div class="grid-row player-id-row" v-if="player.playerGuid">
        <span class="label">GUID</span>
        <span class="val guid-text" :title="player.playerGuid">{{ player.playerGuid }}</span>
      </div>
    </div>

    <!-- Footer Commands Hint -->
    <div class="panel-footer font-mono">
      双击: 个人资料 | 右键: 管理菜单
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import type { BzssCoreTrackedPlayerInfo } from "../../app/bzssCoreApi";
import { resolveRoleIcon } from "../../utils/role-icons";
import { resolveVehicleIcon } from "../../utils/vehicle-icons";

const props = defineProps<{
  player: BzssCoreTrackedPlayerInfo;
  x: number;
  y: number;
  tone: "friendly" | "enemy" | "neutral";
  speedText: string;
  coreStatusText?: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const panelRef = ref<HTMLElement | null>(null);
const offsetLeft = ref(props.x);
const offsetTop = ref(props.y);

const panelStyle = computed(() => {
  return {
    left: `${offsetLeft.value}px`,
    top: `${offsetTop.value}px`,
  };
});

// Extract values reactively from player prop
const health = computed(() => {
  const hp = props.player.soldierInfo?.health;
  return hp != null && Number.isFinite(hp) ? hp : 100;
});

const isSL = computed(() => {
  const soldierClass = String(props.player.soldierInfo?.soldierClass ?? "").toLowerCase();
  return soldierClass.includes("squadleader") || soldierClass.includes("officer") || soldierClass.includes("sl");
});

const roleInfo = computed(() => {
  if (health.value <= 0) {
    return resolveRoleIcon("dead");
  }
  const vehicleInfo = props.player.vehicleInfo;
  if (vehicleInfo && vehicleInfo.vehicleType && vehicleInfo.vehicleType !== 'None') {
    const vehicleIcon = resolveVehicleIcon(vehicleInfo.vehicleType);
    return { icon: vehicleIcon.icon, label: `${vehicleIcon.label} (${vehicleInfo.vehicleType})`, tone: vehicleIcon.tone };
  }
  const roleSource = [props.player.soldierInfo?.soldierClass, props.player.soldierInfo?.weaponClass]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");

  return resolveRoleIcon(roleSource);
});

const roleIconImage = computed(() => {
  return String(roleInfo.value.icon ?? "").startsWith("/");
});

const roleIconStyle = computed(() => {
  const iconUrl = String(roleInfo.value.icon ?? "");
  const colorMap = {
    friendly: "#7de6ff",
    enemy: "#ff97a3",
    neutral: "#cbd5e1"
  };
  return {
    backgroundColor: colorMap[props.tone],
    WebkitMaskImage: `url("${iconUrl}")`,
    maskImage: `url("${iconUrl}")`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };
});

const weaponName = computed(() => {
  const weaponClass = props.player.soldierInfo?.weaponClass;
  if (!weaponClass) return "-";
  return weaponClass
    .replace(/^(BP_|Weapon_)/i, "")
    .replace(/(_\d+)?_C.*$/i, "")
    .replace(/_\d+$/, "");
});

const vehicleName = computed(() => {
  const vehicleType = props.player.vehicleInfo?.vehicleType;
  return vehicleType && vehicleType !== "None" ? vehicleType : null;
});

const gamePosition = computed(() => {
  return props.player.soldierInfo?.position ?? props.player.position ?? { x: 0, y: 0 };
});

const gameX = computed(() => gamePosition.value.x ?? 0);
const gameY = computed(() => gamePosition.value.y ?? 0);

onMounted(() => {
  if (panelRef.value) {
    const rect = panelRef.value.getBoundingClientRect();
    const parentRect = panelRef.value.parentElement?.getBoundingClientRect() || {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    let left = props.x;
    let top = props.y - 12; // offset upward slightly from target clicked marker

    if (left + rect.width > parentRect.width) {
      left = parentRect.width - rect.width - 12;
    }
    if (top + rect.height > parentRect.height) {
      top = parentRect.height - rect.height - 12;
    }

    offsetLeft.value = Math.max(12, left);
    offsetTop.value = Math.max(12, top);
  }
});
</script>

<style scoped>
.map-floating-panel {
  background: rgba(8, 12, 24, 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 229, 255, 0.25);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7), 0 0 15px rgba(0, 229, 255, 0.1);
  border-radius: 4px;
}

.player-info-panel {
  position: absolute;
  width: 250px;
  z-index: 999;
  padding: 12px;
  color: #e2e8f0;
  user-select: none;
  animation: panelAppear 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes panelAppear {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(5px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.panel-header {
  margin-bottom: 10px;
}

.header-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.player-name {
  font-size: 15px;
  font-weight: 700;
  color: #ffffff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 190px;
  text-shadow: 0 0 6px rgba(255, 255, 255, 0.25);
}

.close-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  transition: color 0.15s ease;
}

.close-btn:hover {
  color: #ef5350;
}

.header-sub {
  display: flex;
  gap: 6px;
  margin-top: 4px;
  font-size: 9px;
  font-weight: 700;
}

.team-badge {
  padding: 1px 4px;
  border-radius: 2px;
  background: rgba(148, 163, 184, 0.15);
  border: 1px solid rgba(148, 163, 184, 0.25);
  color: #cbd5e1;
}

.team-badge.team-1 {
  background: rgba(55, 200, 255, 0.15);
  border-color: rgba(55, 200, 255, 0.3);
  color: #7de6ff;
}

.team-badge.team-2 {
  background: rgba(255, 91, 110, 0.15);
  border-color: rgba(255, 91, 110, 0.3);
  color: #ff97a3;
}

.squad-badge {
  padding: 1px 4px;
  border-radius: 2px;
  background: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.25);
  color: #f59e0b;
}

.leader-badge {
  padding: 1px 4px;
  border-radius: 2px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: #34d399;
}

/* Health Tracker styles */
.panel-health-tracker {
  margin-bottom: 12px;
}

.tracker-info {
  display: flex;
  justify-content: space-between;
  font-size: 8px;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 3px;
  letter-spacing: 0.5px;
}

.tracker-val {
  font-weight: 700;
  color: #00e5ff;
}

.tracker-val.low-hp {
  color: #fbbf24;
}

.tracker-val.dead-hp {
  color: #ef5350;
}

.tracker-bar-bg {
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.tracker-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

/* Grid layout details */
.panel-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(0, 0, 0, 0.2);
  padding: 8px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.grid-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  line-height: 1.4;
}

.label {
  color: rgba(255, 255, 255, 0.4);
  font-size: 10px;
}

.val {
  color: #cbd5e1;
  display: flex;
  align-items: center;
  gap: 4px;
}

.text-highlight {
  color: #f1f5f9;
  font-weight: bold;
}

.text-cyan {
  color: #38bdf8;
}

.text-orange {
  color: #fb923c;
}

.guid-text {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  opacity: 0.7;
}

.player-id-row {
  border-top: 1px dashed rgba(255, 255, 255, 0.06);
  padding-top: 4px;
  margin-top: 2px;
}

.sync-status {
  color: #34d399;
  font-weight: bold;
}

.status-dot {
  width: 5px;
  height: 5px;
  background-color: #34d399;
  border-radius: 50%;
  box-shadow: 0 0 6px #34d399;
}

.role-mask-icon {
  width: 12px;
  height: 12px;
  display: inline-block;
}

.role-fallback-icon {
  font-weight: bold;
  font-size: 11px;
}

.panel-footer {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.3);
  text-align: center;
  margin-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 6px;
}

/* Tone styling overrides */
.tone-friendly {
  border-color: rgba(55, 200, 255, 0.35);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7), 0 0 15px rgba(55, 200, 255, 0.08);
}

.tone-enemy {
  border-color: rgba(255, 91, 110, 0.35);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7), 0 0 15px rgba(255, 91, 110, 0.08);
}
</style>
