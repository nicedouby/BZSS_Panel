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
        <div class="player-title-row">
          <img v-if="rconDetail?.steamAvatar" :src="rconDetail.steamAvatar" class="steam-avatar-mini" alt="avatar" />
          <span class="player-name" :title="displayPlayerName">{{ displayPlayerName }}</span>
          <span
            v-if="player.ping != null || (rconDetail && rconDetail.ping != null)"
            class="player-ping-badge"
            :class="pingToneClass"
            :title="player.ping != null ? `BZSS-Core 延迟: ${player.ping}ms` : `RCON 延迟: ${rconDetail.ping}ms`"
          >
            {{ player.ping != null ? player.ping : rconDetail.ping }}ms
          </span>
        </div>
        <button class="close-btn" @click="$emit('close')" title="关闭">×</button>
      </div>
      <div class="header-sub font-mono">
        <span class="team-badge" :class="`team-${player.teamId}`">TEAM {{ player.teamId }}</span>
        <span class="squad-badge" v-if="player.squadId">SQUAD #{{ player.squadId }}</span>
        <span class="leader-badge" v-if="isSL">LEADER</span>
        <span
          v-if="bzssCoreFtBadge"
          class="bzss-core-ft-badge"
          :class="bzssCoreFtBadge.tone"
          :title="bzssCoreFtBadge.title"
        >
          {{ bzssCoreFtBadge.label }}
        </span>
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
      <!-- Role & Weapon/Vehicle -->
      <div class="grid-row-header">
        <div class="role-block">
          <span v-if="roleIconImage" class="role-mask-icon" :style="roleIconStyle"></span>
          <span v-else class="role-fallback-icon">{{ roleInfo.icon || '?' }}</span>
          <span class="role-name">{{ displayRole(roleInfo.label) }}</span>
        </div>
        <div class="weapon-block" v-if="vehicleName || (weaponName && weaponName !== '-')">
          <span class="weapon-val" :class="vehicleName ? 'text-orange' : 'text-highlight'">
            {{ vehicleName ? vehicleName : weaponName }}
          </span>
        </div>
      </div>

      <div class="grid-divider"></div>

      <!-- 2-Column Info Grid -->
      <div class="info-columns-grid">
        <div class="info-cell">
          <span class="cell-label">坐标 POS</span>
          <span class="cell-val text-cyan">{{ Math.round(gameX) }}, {{ Math.round(gameY) }}</span>
        </div>
        <div class="info-cell">
          <span class="cell-label">速度 VEL</span>
          <span class="cell-val">{{ speedText }}</span>
        </div>
        
        <div class="info-cell">
          <span class="cell-label">延迟 PNG</span>
          <span class="cell-val text-green" :class="{ 'high-ping': (rconDetail?.ping ?? player.ping ?? 0) > 150 }">
            {{ rconDetail?.ping != null ? `${rconDetail.ping} ms` : (player.ping != null ? `${player.ping} ms` : '--') }}
          </span>
        </div>
        <div class="info-cell" v-if="rconDetail && rconDetail.playtimeHours !== null">
          <span class="cell-label">时长 HRS</span>
          <span class="cell-val text-yellow">{{ Math.round(rconDetail.playtimeHours) }}h</span>
        </div>
      </div>

      <div class="grid-divider" v-if="rconDetail?.combatStats || rconDetail?.steamId || rconDetail?.eosId || player.playerGuid"></div>

      <!-- KDW & Core Status Row -->
      <div class="grid-row compact-row" v-if="rconDetail?.combatStats">
        <span class="label">战绩 KDW</span>
        <span class="val text-cyan">
          {{ rconDetail.combatStats.kills }} / {{ rconDetail.combatStats.deaths }} / {{ rconDetail.combatStats.downs }}
        </span>
      </div>

      <div class="grid-row compact-row">
        <span class="label">BZSS CORE</span>
        <span class="val sync-status">
          <span class="status-dot animate-pulse"></span>
          {{ coreStatusText || 'ONLINE' }}
        </span>
      </div>

      <!-- Tiny copyable / debugging IDs -->
      <div class="ids-section" v-if="rconDetail?.steamId || rconDetail?.eosId || player.playerGuid">
        <div class="id-item" v-if="rconDetail?.steamId" :title="`Steam64: ${rconDetail.steamId}`">
          <span class="id-lbl">STM</span>
          <span class="id-val">{{ rconDetail.steamId }}</span>
        </div>
        <div class="id-item" v-if="rconDetail?.eosId" :title="`EOSID: ${rconDetail.eosId}`">
          <span class="id-lbl">EOS</span>
          <span class="id-val">{{ rconDetail.eosId }}</span>
        </div>
        <div class="id-item" v-if="player.playerGuid" :title="`GUID: ${player.playerGuid}`">
          <span class="id-lbl">GID</span>
          <span class="id-val">{{ player.playerGuid }}</span>
        </div>
      </div>
    </div>

    <!-- Footer Commands Hint -->
    <div class="panel-footer font-mono">
      双击: 个人资料 | 右键: 管理菜单
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, nextTick, watch } from "vue";
import { t } from "../../i18n";
import type { BzssCoreTrackedPlayerInfo } from "../../app/bzssCoreApi";
import { resolveRoleIcon } from "../../utils/role-icons";
import { resolveVehicleIcon } from "../../utils/vehicle-icons";

function displayRole(role: string | null | undefined) {
  const raw = String(role ?? "").trim();
  if (!raw || raw === "Unknown Role") return t("role.unknownRole");
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const keyMap: Record<string, string> = {
    squadleader: "role.squadLeader",
    medic: "role.medic",
    heavyantitank: "role.heavyAntiTank",
    lightantitank: "role.lightAntiTank",
    machinegunner: "role.machineGunner",
    automaticrifleman: "role.automaticRifleman",
    engineer: "role.engineer",
    sapper: "role.sapper",
    marksman: "role.marksman",
    sniper: "role.sniper",
    grenadier: "role.grenadier",
    crewman: "role.crewman",
    pilot: "role.pilot",
    rifleman: "role.rifleman",
  };
  const key = keyMap[normalized];
  return key ? t(key, raw) : raw;
}

const props = defineProps<{
  player: BzssCoreTrackedPlayerInfo;
  x: number;
  y: number;
  tone: "friendly" | "enemy" | "neutral";
  speedText: string;
  coreStatusText?: string;
  rconDetail?: any;
  linkConfidence?: "exact" | "strong" | "weak" | "none";
  linkReason?: string;
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
  const source = props.player as any;
  if (source?.match?.isLeader === true) return true;
  if (source?.isLeader === true) return true;
  if (source?.raw?.rcon?.isLeader === true) return true;
  if (source?.raw?.bzss?.isLeader === true) return true;
  const role = [
    source?.match?.role,
    source?.role,
    source?.soldierInfo?.soldierClass,
    source?.telemetry?.soldierClass,
  ].map((value) => String(value ?? "").toLowerCase()).join(" ");
  return role.includes("squadleader") || role.includes("officer") || /\bsl\b/.test(role);
});

const bzssCoreFtBadge = computed(() => {
  const ftIndex = props.player.ftIndex;
  if (ftIndex == null || !Number.isFinite(Number(ftIndex))) return null;
  const index = Math.trunc(Number(ftIndex));
  const badgeMap: Record<number, { label: string; tone: string }> = {
    0: { label: "A组", tone: "ft-green" },
    1: { label: "B组", tone: "ft-purple" },
    2: { label: "C组", tone: "ft-blue" },
  };
  const badge = badgeMap[index];
  if (!badge) {
    return {
      label: `FT ${index}`,
      tone: "ft-neutral",
      title: `BZSS-Core ftIndex: ${index}`,
    };
  }
  return {
    ...badge,
    title: `BZSS-Core ftIndex: ${index}`,
  };
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
  
  let roleSource = "";
  if (props.rconDetail?.role && props.rconDetail.role !== "Unknown Role") {
    roleSource = props.rconDetail.role;
  } else if ((props.player as any).role && (props.player as any).role !== "Unknown Role") {
    roleSource = (props.player as any).role;
  } else {
    roleSource = [props.player.soldierInfo?.soldierClass, props.player.soldierInfo?.weaponClass]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ");
  }

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

const displayPlayerName = computed(() => {
  return String(
    props.player?.playerName
    || props.rconDetail?.name
    || (props.player as any)?.identity?.name
    || (props.player as any)?.name
    || "Unknown Player",
  ).trim() || "Unknown Player";
});

const pingToneClass = computed(() => {
  const ping = Number(props.player?.ping ?? props.rconDetail?.ping ?? 0);
  if (ping > 120) return "high";
  if (ping > 60) return "medium";
  return "low";
});

const linkConfidenceText = computed(() => {
  const confidence = props.linkConfidence ?? "none";
  if (confidence === "exact") return "Exact";
  if (confidence === "strong") return "Strong";
  if (confidence === "weak") return "Weak";
  return "Unlinked";
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

function syncPanelPosition() {
  void nextTick(() => {
    if (!panelRef.value) return;
    const rect = panelRef.value.getBoundingClientRect();
    const parentRect = panelRef.value.parentElement?.getBoundingClientRect() || {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    let left = props.x;
    let top = props.y - 12;

    if (left + rect.width > parentRect.width) {
      left = parentRect.width - rect.width - 12;
    }
    if (top + rect.height > parentRect.height) {
      top = parentRect.height - rect.height - 12;
    }

    offsetLeft.value = Math.max(12, left);
    offsetTop.value = Math.max(12, top);
  });
}

onMounted(syncPanelPosition);
watch(() => [props.x, props.y], syncPanelPosition, { flush: "post" });
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

.player-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 200px;
}

.steam-avatar-mini {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  object-fit: cover;
  flex-shrink: 0;
}

.player-ping-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 9px;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: 0.02em;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.25);
}

.player-ping-badge.low {
  color: #d7ffe4;
  background: rgba(34, 197, 94, 0.85);
  border-color: rgba(34, 197, 94, 0.3);
}

.player-ping-badge.medium {
  color: #fff4d6;
  background: rgba(245, 158, 11, 0.88);
  border-color: rgba(245, 158, 11, 0.3);
}

.player-ping-badge.high {
  color: #ffe1e1;
  background: rgba(239, 68, 68, 0.9);
  border-color: rgba(239, 68, 68, 0.35);
}

.text-green {
  color: #10b981;
}

.text-yellow {
  color: #fbbf24;
}

.high-ping {
  color: #ef5350 !important;
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
  gap: 4px;
  background: rgba(0, 0, 0, 0.2);
  padding: 8px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.grid-row-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 2px;
}

.role-block {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
}

.weapon-block {
  font-size: 11px;
  font-weight: 700;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grid-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 4px 0;
}

.info-columns-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px 8px;
}

.info-cell {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.cell-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  font-weight: 700;
}

.cell-val {
  font-size: 11px;
  font-weight: 700;
}

.compact-row {
  margin: 1px 0;
}

.ids-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
  border-top: 1px dashed rgba(255, 255, 255, 0.06);
  padding-top: 4px;
}

.id-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
}

.id-lbl {
  color: rgba(255, 255, 255, 0.3);
  font-weight: 700;
}

.id-val {
  color: rgba(255, 255, 255, 0.5);
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grid-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  line-height: 1.4;
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

.bzss-core-ft-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 10px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.bzss-core-ft-badge.ft-green {
  color: #d7ffe4;
  background: rgba(34, 197, 94, 0.2);
  border-color: rgba(34, 197, 94, 0.35);
}

.bzss-core-ft-badge.ft-purple {
  color: #efe3ff;
  background: rgba(168, 85, 247, 0.2);
  border-color: rgba(168, 85, 247, 0.35);
}

.bzss-core-ft-badge.ft-blue {
  color: #d7ecff;
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.35);
}

.bzss-core-ft-badge.ft-neutral {
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.12);
}
</style>
