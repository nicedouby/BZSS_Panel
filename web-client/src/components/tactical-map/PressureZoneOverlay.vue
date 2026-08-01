<template>
  <svg
    v-if="visible && state?.active"
    class="pressure-zone-overlay"
    viewBox="0 0 1000 1000"
    preserveAspectRatio="none"
    aria-label="动态压家区域"
  >
    <g v-if="showConnections && connectionPoints.length > 1" class="pressure-zone-connections">
      <line
        v-for="(segment, index) in connectionSegments"
        :key="`connection-${index}`"
        :x1="segment.a.x"
        :y1="segment.a.y"
        :x2="segment.b.x"
        :y2="segment.b.y"
        vector-effect="non-scaling-stroke"
      />
    </g>

    <g v-for="zone in orderedZones" :key="zone.id" :class="['pressure-zone', `pressure-zone--${zone.type}`, `team-${zone.teamId ?? 0}`]">
      <ellipse
        v-if="zone.geometry.type === 'circle' && zone.geometry.center"
        :cx="projectX(zone.geometry.center.x)"
        :cy="projectY(zone.geometry.center.y)"
        :rx="radiusX(zone.geometry.radius ?? 0)"
        :ry="radiusY(zone.geometry.radius ?? 0)"
        vector-effect="non-scaling-stroke"
      />
      <polygon
        v-else-if="zone.geometry.type === 'capsule'"
        :points="polygonPoints(zone)"
        vector-effect="non-scaling-stroke"
      />
    </g>

    <g v-if="showDiagnostics && combatPoints" class="pressure-zone-debug">
      <line
        :x1="combatPoints.a.x"
        :y1="combatPoints.a.y"
        :x2="combatPoints.b.x"
        :y2="combatPoints.b.y"
        vector-effect="non-scaling-stroke"
      />
      <circle :cx="combatPoints.a.x" :cy="combatPoints.a.y" r="7" vector-effect="non-scaling-stroke" />
      <circle :cx="combatPoints.b.x" :cy="combatPoints.b.y" r="7" vector-effect="non-scaling-stroke" />
      <text :x="combatPoints.a.x + 10" :y="combatPoints.a.y - 10">{{ state?.combat?.team1ObjectiveId }}</text>
      <text :x="combatPoints.b.x + 10" :y="combatPoints.b.y - 10">{{ state?.combat?.team2ObjectiveId }}</text>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PressureZoneItem, PressureZoneState, TacticalMapBoundsLike } from "../../app/dynamicPressureZoneApi";

const props = withDefaults(defineProps<{
  state: PressureZoneState | null;
  mapBounds: TacticalMapBoundsLike;
  visible?: boolean;
  showHard?: boolean;
  showSoft?: boolean;
  showCombat?: boolean;
  showDiagnostics?: boolean;
  showConnections?: boolean;
  connectionPoints?: Array<{ x: number; y: number }>;
}>(), {
  visible: true,
  showHard: true,
  showSoft: true,
  showCombat: true,
  showDiagnostics: false,
  showConnections: false,
  connectionPoints: () => [],
});

const width = computed(() => Math.max(1, Number(props.mapBounds.maxX) - Number(props.mapBounds.minX)));
const height = computed(() => Math.max(1, Number(props.mapBounds.maxY) - Number(props.mapBounds.minY)));
const orderedZones = computed(() => (Array.isArray(props.state?.zones) ? props.state!.zones : [])
  .filter((zone) => (zone.type === "hard" && props.showHard)
    || (zone.type === "soft" && props.showSoft)
    || (zone.type === "combat" && props.showCombat))
  .sort((left, right) => Number(left.priority ?? 0) - Number(right.priority ?? 0)));

const connectionSegments = computed(() => props.connectionPoints.slice(0, -1).map((point, index) => ({
  a: { x: projectX(point.x), y: projectY(point.y) },
  b: { x: projectX(props.connectionPoints[index + 1].x), y: projectY(props.connectionPoints[index + 1].y) },
})));

const combatPoints = computed(() => {
  const a = props.state?.combat?.pointA;
  const b = props.state?.combat?.pointB;
  if (!a || !b) return null;
  return {
    a: { x: projectX(a.x), y: projectY(a.y) },
    b: { x: projectX(b.x), y: projectY(b.y) },
  };
});

function projectX(value: number) {
  return ((Number(value) - Number(props.mapBounds.minX)) / width.value) * 1000;
}

function projectY(value: number) {
  return ((Number(value) - Number(props.mapBounds.minY)) / height.value) * 1000;
}

function radiusX(radius: number) {
  return (Number(radius) / width.value) * 1000;
}

function radiusY(radius: number) {
  return (Number(radius) / height.value) * 1000;
}

function polygonPoints(zone: PressureZoneItem) {
  return (zone.geometry.polygon ?? []).map((point) => `${projectX(point.x)},${projectY(point.y)}`).join(" ");
}
</script>

<style scoped>
.pressure-zone-overlay { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 3; pointer-events: none; overflow: hidden; }
.pressure-zone ellipse, .pressure-zone polygon { stroke-width: 2px; }
.pressure-zone--soft ellipse { fill: rgba(249, 115, 22, .10); stroke: rgba(251, 146, 60, .82); stroke-dasharray: 10 8; }
.pressure-zone--combat polygon { fill: rgba(45, 212, 191, .08); stroke: rgba(94, 234, 212, .56); }
.pressure-zone--hard ellipse { fill: rgba(239, 68, 68, .19); stroke: rgba(248, 113, 113, .9); }
.pressure-zone--hard.team-1 ellipse { fill: rgba(239, 68, 68, .17); }
.pressure-zone-connections line { stroke: rgba(226, 232, 240, .5); stroke-width: 1.5px; stroke-dasharray: 8 6; }
.pressure-zone-debug line { stroke: rgba(240, 253, 250, .85); stroke-width: 2px; stroke-dasharray: 6 4; }
.pressure-zone-debug circle { fill: #0f172a; stroke: #5eead4; stroke-width: 2px; }
.pressure-zone-debug text { fill: #ccfbf1; font-size: 18px; font-weight: 700; paint-order: stroke; stroke: #020617; stroke-width: 4px; }
</style>
