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
      { 'is-vehicle': hasVehicle },
      `mode-${mode}`
    ]"
    :style="markerStyle"
    type="button"
    @click="$emit('click', $event)"
    @dblclick="$emit('dblclick', $event)"
    @contextmenu.prevent.stop="$emit('contextmenu', $event)"
    @mouseenter="$emit('mouseenter', $event)"
    @mouseleave="$emit('mouseleave', $event)"
  >


    <!-- Player Direction Pointer -->
    <div
      v-if="yaw !== null && !isDead"
      class="marker-direction"
      :style="{
        // Yaw comes in on the game convention used by BZSS Core; the map arrow uses the opposite screen-space turn.
        transform: `translate(-50%, -50%) rotate(${yaw + 90}deg)`
      }"
    >
      <div class="direction-arrow"></div>
    </div>

    <!-- Marker Icon -->
    <div class="marker-icon">
      <template v-if="mode === 'tactical'">
        <!-- Role/Kit Mask Image -->
        <template v-if="isRoleIconImage(roleIcon)">
          <span class="kit-icon-stack" :aria-label="roleLabel" role="img">
            <span class="kit-icon-mask kit-icon-ao" :style="roleIconAoStyle"></span>
            <span class="kit-icon-mask kit-icon-outline" :style="roleIconOutlineStyle"></span>
            <span class="kit-icon-mask kit-icon-fill" :style="roleIconStyle"></span>
          </span>
        </template>
        <span v-else class="kit-icon-stack" :aria-label="roleLabel" role="img">
          <span class="kit-icon-fallback kit-icon-ao" aria-hidden="true">
            {{ roleIcon || "?" }}
          </span>
          <span class="kit-icon-fallback kit-icon-outline" aria-hidden="true">
            {{ roleIcon || "?" }}
          </span>
          <span class="kit-icon-fallback kit-icon-fill" aria-hidden="true">
            {{ roleIcon || "?" }}
          </span>
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
      <span class="player-name-tag">{{ playerName }}</span>
      <span v-if="mode === 'tactical' && squadId" class="player-squad-tag">#{{ squadId }}</span>
      <span v-if="showCoords && hasCoords" class="player-coords-tag">
        [{{ Math.round(gameX ?? 0) }}, {{ Math.round(gameY ?? 0) }}]
      </span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed, watchEffect } from "vue";

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
  (e: "dblclick", event: MouseEvent): void;
  (e: "contextmenu", event: MouseEvent): void;
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
      primary: "#2563eb",
      soft: "#60a5fa",
      deep: "#1e40af",
      glow: "rgba(37, 99, 235, 0.25)",
      pulse: "#2563eb",
      tooltip: "rgba(37, 99, 235, 0.5)",
      chip: "rgba(37, 99, 235, 0.12)",
      textGlow: "rgba(37, 99, 235, 0.18)",
      icon: "#3b82f6"
    };
  }
  if (props.tone === "enemy") {
    return {
      primary: "#dc2626",
      soft: "#f87171",
      deep: "#991b1b",
      glow: "rgba(220, 38, 38, 0.25)",
      pulse: "#dc2626",
      tooltip: "rgba(220, 38, 38, 0.5)",
      chip: "rgba(220, 38, 38, 0.12)",
      textGlow: "rgba(220, 38, 38, 0.18)",
      icon: "#ef4444"
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

const zIndex = computed(() => {
  let z = 20; // Default base for alive player
  if (isDead.value) {
    z = 10;
  } else if (props.isSquadLeader) {
    z = 40;
  }
  
  if (hasVehicle.value) {
    z += 5;
  }
  if (props.isFocused) {
    z += 100;
  }
  if (props.isHovered) {
    z += 200;
  }
  return z;
});

const markerStyle = computed(() => {
  return {
    left: `${props.mapX}%`,
    top: `${props.mapY}%`,
    transform: `translate(-50%, -50%) scale(${props.scale})`,
    zIndex: zIndex.value,
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

const roleIconOutlineStyle = computed(() => {
  if (!props.roleIcon) return {};
  return {
    backgroundColor: "#000000",
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

const roleIconAoStyle = computed(() => {
  if (!props.roleIcon) return {};
  return {
    backgroundColor: "#000000",
    opacity: 0.2,
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

const preloadedRoleIcons = new Set<string>();

function preloadRoleIcon(icon: string | undefined) {
  const src = String(icon ?? "");
  if (!isRoleIconImage(src) || preloadedRoleIcons.has(src)) return;
  preloadedRoleIcons.add(src);

  const image = new Image();
  image.decoding = "sync";
  image.loading = "eager";
  (image as HTMLImageElement & { fetchPriority?: "high" }).fetchPriority = "high";
  image.src = src;
}

watchEffect(() => {
  preloadRoleIcon(props.roleIcon);
});

function isRoleIconImage(icon: string | undefined) {
  return String(icon ?? "").startsWith("/");
}
</script>

<style scoped>
.player-marker {
  position: absolute;
  width: 38px;
  height: 38px;
  pointer-events: auto;
  cursor: pointer;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  -webkit-tap-highlight-color: transparent;
  will-change: transform;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: none;
}

.player-marker.no-pointer {
  pointer-events: none;
}

/* Centered icon shell without background chrome */
.marker-icon {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 31px;
  height: 31px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  filter: none;
  transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.16s ease, opacity 0.16s ease;
}

/* Dead marker styling */
.is-dead .marker-icon {
  filter: grayscale(0.9) brightness(0.6);
  opacity: 0.72;
}

/* Squad Leader amber/gold indicator styling */
.is-squadleader .marker-icon {
  transform: translate(-50%, -50%) scale(1.15);
}

/* Inner elements */
.kit-icon-stack {
  position: relative;
  width: 24px;
  height: 24px;
  display: inline-block;
  overflow: visible;
  --kit-icon-source-size: 64px;
}

.kit-icon-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  line-height: 1;
  color: var(--perspective-icon);
  font-weight: 700;
  text-shadow: none;
  transition: transform 0.16s ease, filter 0.16s ease, opacity 0.16s ease;
}

.kit-icon-mask {
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--kit-icon-source-size);
  height: var(--kit-icon-source-size);
  display: inline-block;
  image-rendering: auto;
  shape-rendering: geometricPrecision;
  transition: transform 0.16s ease, filter 0.16s ease, opacity 0.16s ease;
}

.kit-icon-ao {
  transform: translate(-50%, -50%) scale(0.484375);
}

.kit-icon-outline {
  transform: translate(-50%, -50%) scale(0.40625);
}

.kit-icon-fill {
  transform: translate(-50%, -50%) scale(0.34375);
}

.kit-icon-ao.kit-icon-mask {
  background-color: #000000 !important;
}

.kit-icon-outline.kit-icon-mask {
  background-color: #000000 !important;
}

.kit-icon-ao.kit-icon-fallback {
  color: #000000;
  opacity: 0.18;
}

.kit-icon-outline.kit-icon-fallback {
  color: #000000;
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
  width: 32px;
  height: 32px;
  transform-origin: center center;
  pointer-events: none;
  z-index: 1;
  /* Smooth rotation updates */
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.direction-arrow {
  position: absolute;
  top: -7px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 3.5px solid transparent;
  border-right: 3.5px solid transparent;
  border-bottom: 6px solid var(--perspective-primary);
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.9)) drop-shadow(0 0 3px var(--perspective-primary));
}

/* Text tag underneath */
.player-marker .tag {
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translate(-50%, 3px);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 5px;
  border-radius: 3px;
  background: rgba(2, 6, 23, 0.78);
  border: 1px solid rgba(226, 232, 240, 0.18);
  font-size: 10px;
  white-space: nowrap;
  line-height: 1.05;
  pointer-events: none;
  z-index: 5;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.55);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 1);
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
  transition: color 0.2s ease, transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
  backdrop-filter: blur(2px);
}

/* Perspective/Team soft colors */
.tone-friendly .tag {
  color: #c0f0ff;
}
.tone-enemy .tag {
  color: #ffd0d5;
}
.tone-neutral .tag {
  color: #cbd5e1;
}

.player-name-tag {
  font-weight: 800;
  letter-spacing: 0;
  -webkit-text-stroke: 0.2px rgba(0, 0, 0, 0.85);
}

.player-squad-tag {
  font-size: 9px;
  font-family: monospace;
  font-weight: 800;
  color: var(--perspective-soft);
  line-height: 1;
}

.player-coords-tag {
  font-size: 9px;
  font-family: monospace;
  font-weight: 800;
  color: #bbf7d0;
  line-height: 1;
  opacity: 1;
}

/* Minimalist rendering (Mode Replay) styles */
.mode-minimal {
  width: 20px;
  height: 20px;
}

.mode-minimal .marker-icon {
  width: 9px;
  height: 9px;
}

.preview-dot {
  display: block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background-color: #ffffff;
}

.mode-minimal .marker-direction {
  width: 16px;
  height: 16px;
}

.mode-minimal .direction-arrow {
  top: -4px;
  border-left-width: 2px;
  border-right-width: 2px;
  border-bottom-width: 3px;
}

/* Interactive Hover / Focus Zoom effects */
.player-marker.is-hovered .marker-icon,
.player-marker:hover .marker-icon {
  transform: translate(-50%, -50%) scale(1.08);
  z-index: 50;
}

.player-marker.is-hovered.is-squadleader .marker-icon,
.player-marker:hover.is-squadleader .marker-icon {
  transform: translate(-50%, -50%) scale(1.12);
}

.player-marker.is-hovered .tag,
.player-marker:hover .tag {
  color: #ffffff;
  transform: translate(-50%, 3px);
}

.player-marker.is-hovered .tag .player-name-tag,
.player-marker:hover .tag .player-name-tag {
  text-shadow: 0 0 4px var(--perspective-primary), 0 1px 2px rgba(0, 0, 0, 0.95);
}
</style>
