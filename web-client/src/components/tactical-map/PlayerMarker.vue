<template>
  <button
    class="player-marker"
    :class="[
      `tone-${tone}`,
      { 'is-dead': isDead },
      { 'is-squadleader': isSquadLeader },
      { 'is-focused': isFocused },
      { 'is-hovered': isHovered },
      { 'no-pointer': disableInteraction },
      { 'is-disengaged': isDisengaged },
      { 'is-vehicle': hasVehicle },
      `mode-${mode}`
    ]"
    :style="markerStyle"
    type="button"
    @click="$emit('click', $event)"
    @mouseenter="$emit('mouseenter', $event)"
    @mouseleave="$emit('mouseleave', $event)"
  >
    <!-- Marker Aura/Pulse -->
    <div class="marker-pulse"></div>

    <!-- Player Direction Pointer -->
    <div
      v-if="yaw !== null && !isDead"
      class="marker-direction"
      :style="{
        transform: `translate(-50%, -50%) rotate(${yaw + 90}deg)`
      }"
    >
      <div class="direction-arrow"></div>
    </div>

    <!-- Marker Outer Ring & Inner Icon -->
    <div class="marker-ring">
      <template v-if="mode === 'tactical'">
        <!-- Role/Kit Mask Image -->
        <template v-if="isRoleIconImage(roleIcon)">
          <span
            class="kit-icon-mask"
            :style="roleIconStyle"
            :aria-label="roleLabel"
          ></span>
        </template>
        <span v-else class="kit-icon-fallback" :aria-label="roleLabel">
          {{ roleIcon || '?' }}
        </span>
      </template>
      <template v-else>
        <!-- Minimal / Replay Mode: Simple dot -->
        <span class="preview-dot"></span>
      </template>
    </div>

    <!-- Small Squad Index Tag -->
    <span v-if="mode === 'tactical' && squadId" class="squad-index-tag">
      {{ squadId }}
    </span>

    <!-- Text Tag for Player Name & Coords -->
    <span v-if="showName" class="tag">
      <span v-if="isDisengaged && mode === 'tactical'" class="player-disengaged-tag">脱战</span>
      <span class="player-name-tag">{{ playerName }}</span>
      <span v-if="mode === 'tactical' && squadId" class="player-squad-tag">#{{ squadId }}</span>
      <span v-if="showCoords && hasCoords" class="player-coords-tag">
        [{{ Math.round(gameX ?? 0) }}, {{ Math.round(gameY ?? 0) }}]
      </span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    mode?: "tactical" | "minimal";
    playerName: string;
    teamId: number | null;
    mapX: number; // percentage (0-100)
    mapY: number; // percentage (0-100)
    yaw?: number | null;
    health?: number | null;
    squadId?: number | null;
    isSquadLeader?: boolean;
    roleIcon?: string;
    roleLabel?: string;
    vehicleType?: string | null;
    isFocused?: boolean;
    isHovered?: boolean;
    isDisengaged?: boolean;
    showName?: boolean;
    showCoords?: boolean;
    gameX?: number | null;
    gameY?: number | null;
    scale?: number;
    tone?: "friendly" | "enemy" | "neutral";
    disableInteraction?: boolean;
  }>(),
  {
    mode: "tactical",
    yaw: null,
    health: 100,
    squadId: null,
    isSquadLeader: false,
    roleIcon: "",
    roleLabel: "",
    vehicleType: null,
    isFocused: false,
    isHovered: false,
    isDisengaged: false,
    showName: true,
    showCoords: true,
    gameX: null,
    gameY: null,
    scale: 1.0,
    tone: "neutral",
    disableInteraction: false
  }
);

defineEmits<{
  (e: "click", event: MouseEvent): void;
  (e: "mouseenter", event: MouseEvent): void;
  (e: "mouseleave", event: MouseEvent): void;
}>();

const isDead = computed(() => props.health !== null && props.health <= 0);
const hasVehicle = computed(() => props.vehicleType && props.vehicleType !== "None");
const hasCoords = computed(() => props.gameX !== null && props.gameY !== null);

// Perspective colors palette definitions based on tone
const palette = computed(() => {
  if (props.tone === "friendly") {
    return {
      primary: "#37c8ff",
      soft: "#7de6ff",
      deep: "#0b6fa3",
      glow: "rgba(55, 200, 255, 0.35)",
      pulse: "#00c8ff",
      tooltip: "rgba(55, 200, 255, 0.6)",
      chip: "rgba(55, 200, 255, 0.15)",
      textGlow: "rgba(55, 200, 255, 0.3)",
      icon: "#7de6ff"
    };
  }
  if (props.tone === "enemy") {
    return {
      primary: "#ff5b6e",
      soft: "#ff97a3",
      deep: "#a32032",
      glow: "rgba(255, 91, 110, 0.35)",
      pulse: "#ff3366",
      tooltip: "rgba(255, 91, 110, 0.6)",
      chip: "rgba(255, 91, 110, 0.15)",
      textGlow: "rgba(255, 91, 110, 0.3)",
      icon: "#ff97a3"
    };
  }
  // Neutral
  return {
    primary: "#94a3b8",
    soft: "#cbd5e1",
    deep: "#334155",
    glow: "rgba(148, 163, 184, 0.25)",
    pulse: "#94a3b8",
    tooltip: "rgba(148, 163, 184, 0.45)",
    chip: "rgba(148, 163, 184, 0.14)",
    textGlow: "rgba(148, 163, 184, 0.2)",
    icon: "#cbd5e1"
  };
});

const markerStyle = computed(() => {
  return {
    left: `${props.mapX}%`,
    top: `${props.mapY}%`,
    transform: `translate(-50%, -50%) scale(${props.scale})`,
    "--perspective-primary": palette.value.primary,
    "--perspective-soft": palette.value.soft,
    "--perspective-deep": palette.value.deep,
    "--perspective-glow": palette.value.glow,
    "--perspective-pulse": palette.value.pulse,
    "--perspective-tooltip": palette.value.tooltip,
    "--perspective-chip": palette.value.chip,
    "--perspective-text-glow": palette.value.textGlow,
    "--perspective-icon": palette.value.icon
  };
});

const roleIconStyle = computed(() => {
  if (!props.roleIcon) return {};
  return {
    backgroundColor: palette.value.icon,
    WebkitMaskImage: `url("${props.roleIcon}")`,
    maskImage: `url("${props.roleIcon}")`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain"
  };
});

function isRoleIconImage(icon: string | undefined) {
  return String(icon ?? "").startsWith("/");
}
</script>

<style scoped>
.player-marker {
  position: absolute;
  width: 28px;
  height: 28px;
  pointer-events: auto;
  cursor: pointer;
  border: none;
  background: transparent;
  padding: 0;
  outline: none;
  /* Hardware accelerated transforms for buttery-smooth movements */
  will-change: left, top, transform;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.player-marker.no-pointer {
  pointer-events: none;
}

/* Pulsing aura */
.marker-pulse {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  opacity: 0;
  transform: scale(1);
  border: 2px solid var(--perspective-pulse);
  animation: pulse-ring 2.4s infinite cubic-bezier(0.215, 0.610, 0.355, 1);
}

@keyframes pulse-ring {
  0% { transform: scale(0.9); opacity: 0.8; }
  80% { transform: scale(2.2); opacity: 0; }
  100% { transform: scale(2.2); opacity: 0; }
}

/* Outer ring centered */
.marker-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  border: 2px solid var(--perspective-primary);
  background-color: var(--perspective-deep);
  box-shadow: 0 0 8px var(--perspective-glow);
  transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
}

/* Vehicle custom shape (rotated square/diamond in minimal mode) */
.is-vehicle.mode-minimal .marker-ring {
  border-radius: 2px;
  transform: translate(-50%, -50%) rotate(45deg);
}

/* Dead marker styling */
.is-dead .marker-ring {
  filter: saturate(0.5) brightness(0.6);
  opacity: 0.75;
  box-shadow: none;
  background-color: #334155;
  border-color: #64748b;
}

/* Squad Leader star indicator size adjustment */
.is-squadleader .marker-ring {
  transform: translate(-50%, -50%) scale(1.15);
}

.is-vehicle.mode-minimal.is-squadleader .marker-ring {
  transform: translate(-50%, -50%) rotate(45deg) scale(1.15);
}

/* Inner elements */
.kit-icon-fallback {
  width: 11px;
  height: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  color: #cbd5e1;
  font-weight: 700;
}

.kit-icon-mask {
  width: 11px;
  height: 11px;
  display: inline-block;
}

.is-dead .kit-icon-mask {
  opacity: 0.5;
  filter: grayscale(1) brightness(0.8);
}

/* Squad number index badge */
.squad-index-tag {
  position: absolute;
  bottom: -5px;
  right: -3px;
  background-color: #0f172a;
  color: var(--perspective-primary);
  font-size: 7.5px;
  line-height: 1;
  padding: 1px 3px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  font-family: monospace;
  font-weight: bold;
  z-index: 3;
  box-shadow: 0 1px 3px rgba(0,0,0,0.5);
}

/* Direction indicators */
.marker-direction {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 26px;
  height: 26px;
  transform-origin: center center;
  pointer-events: none;
  z-index: 1;
  transition: transform 0.16s linear; /* Smooth micro-rotation */
}

.direction-arrow {
  position: absolute;
  top: -5px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
  border-bottom: 5px solid var(--perspective-primary);
}

/* Text tag underneath */
.player-marker .tag {
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translate(-50%, 3px);
  display: flex;
  align-items: center;
  gap: 3.5px;
  padding: 1.5px 4px;
  border-radius: 3px;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 8px;
  white-space: nowrap;
  line-height: 1.15;
  pointer-events: none;
  color: #cbd5e1;
  z-index: 5;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.player-name-tag {
  font-weight: 500;
}

.player-squad-tag {
  font-size: 7.5px;
  font-family: monospace;
  font-weight: 700;
  color: var(--perspective-primary);
  background: var(--perspective-chip);
  padding: 0px 2.5px;
  border-radius: 2px;
  line-height: 1;
}

.player-coords-tag {
  font-size: 7.5px;
  font-family: monospace;
  font-weight: 700;
  color: #a7f3d0;
  background: rgba(16, 185, 129, 0.15);
  padding: 0px 2.5px;
  border-radius: 2px;
  line-height: 1;
}

.player-disengaged-tag {
  font-size: 7px;
  font-weight: 800;
  color: #fb923c;
  background: rgba(249, 115, 22, 0.15);
  padding: 0px 2px;
  border-radius: 2.5px;
  line-height: 1;
}

/* Minimalist rendering (Mode Replay) styles */
.mode-minimal {
  width: 20px;
  height: 20px;
}

.mode-minimal .marker-ring {
  width: 10px;
  height: 10px;
  border-width: 1.5px;
}

.preview-dot {
  display: block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background-color: #ffffff;
}

/* Rotated square doesn't need internal dot */
.is-vehicle.mode-minimal .preview-dot {
  display: none;
}

.mode-minimal .marker-direction {
  width: 16px;
  height: 16px;
}

.mode-minimal .direction-arrow {
  top: -4px;
  border-left-width: 2.5px;
  border-right-width: 2.5px;
  border-bottom-width: 4px;
}

/* Interactive Hover / Focus Zoom effects */
.player-marker.is-hovered .marker-ring,
.player-marker:hover .marker-ring {
  transform: translate(-50%, -50%) scale(1.3);
  z-index: 50;
  border-color: #ffffff !important;
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.95);
}

.is-vehicle.mode-minimal.is-hovered .marker-ring,
.is-vehicle.mode-minimal:hover .marker-ring {
  transform: translate(-50%, -50%) rotate(45deg) scale(1.3);
}

.player-marker.is-hovered.is-squadleader .marker-ring,
.player-marker:hover.is-squadleader .marker-ring {
  transform: translate(-50%, -50%) scale(1.4);
}

.is-vehicle.mode-minimal.is-hovered.is-squadleader .marker-ring,
.is-vehicle.mode-minimal:hover.is-squadleader .marker-ring {
  transform: translate(-50%, -50%) rotate(45deg) scale(1.4);
}

.player-marker.is-hovered .tag,
.player-marker:hover .tag {
  border-color: var(--perspective-primary);
  background: rgba(8, 14, 36, 0.95);
  color: #ffffff;
}
</style>
