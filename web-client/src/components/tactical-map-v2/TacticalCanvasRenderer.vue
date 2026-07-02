<template>
  <canvas
    ref="canvasRef"
    width="2000"
    height="2000"
    class="tactical-canvas-renderer"
    :class="{ 'is-interactive': interactionEnabled }"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
    @click="onClick"
    @contextmenu.prevent="onContextMenu"
  ></canvas>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  players: any[];
  viewerTeamId: number | null;
  selectedPlayerKey: string | null;
  hoveredPlayerKey: string | null;
  scale: number;
  showPlayerNames: boolean;
  showPlayerCoords: boolean;
  zoom: number;
  interactionEnabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "hover-change", payload: CanvasInteractionPayload | null): void;
  (e: "click", payload: CanvasInteractionPayload): void;
  (e: "contextmenu", payload: CanvasInteractionPayload): void;
}>();

type CanvasInteractionPayload = {
  player: any | null;
  clientX: number;
  clientY: number;
  canvasX: number;
  canvasY: number;
  mapX: number;
  mapY: number;
};

const canvasRef = ref<HTMLCanvasElement | null>(null);
let drawFrameId = 0;
let lastHoverKey = "";

function getPerspectiveTone(teamId: number | null | undefined) {
  const normalized = Number(teamId);
  if (normalized !== 1 && normalized !== 2) return "neutral";
  const viewer = Number(props.viewerTeamId);
  if (viewer !== 1 && viewer !== 2) return "neutral";
  return normalized === viewer ? "friendly" : "enemy";
}

function getPerspectivePalette(tone: string) {
  if (tone === "friendly") {
    return {
      primary: "#37c8ff",
      deep: "#0b6fa3",
    };
  }
  if (tone === "enemy") {
    return {
      primary: "#ff5b6e",
      deep: "#a32032",
    };
  }
  return {
    primary: "#94a3b8",
    deep: "#334155",
  };
}

function getMarkerRadius() {
  return Math.max(14, 24 * props.scale);
}

function isDeadPlayer(player: any) {
  return player?.telemetry?.health !== null && player?.telemetry?.health <= 0;
}

function isVehiclePlayer(player: any) {
  return Boolean(player?.vehicle?.vehicleType && player.vehicle.vehicleType !== "None");
}

function getCanvasPoint(event: PointerEvent | MouseEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return null;

  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const ratioX = canvas.width / rect.width;
  const ratioY = canvas.height / rect.height;
  const canvasX = (event.clientX - rect.left) * ratioX;
  const canvasY = (event.clientY - rect.top) * ratioY;

  return {
    clientX: event.clientX,
    clientY: event.clientY,
    canvasX,
    canvasY,
    mapX: (canvasX / canvas.width) * 100,
    mapY: (canvasY / canvas.height) * 100,
  };
}

function findPlayerAtPoint(canvasX: number, canvasY: number) {
  const canvas = canvasRef.value;
  if (!canvas) return null;

  const radius = getMarkerRadius();
  const radiusSq = Math.pow(radius * 1.35, 2);
  const sortedPlayers = getSortedPlayers();

  let closest: { player: any; distanceSq: number } | null = null;
  for (const player of sortedPlayers) {
    const mapX = Number(player?.mapX);
    const mapY = Number(player?.mapY);
    if (!Number.isFinite(mapX) || !Number.isFinite(mapY)) continue;

    const px = (mapX / 100) * canvas.width;
    const py = (mapY / 100) * canvas.height;
    const dx = canvasX - px;
    const dy = canvasY - py;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq <= radiusSq && (!closest || distanceSq < closest.distanceSq)) {
      closest = { player, distanceSq };
    }
  }

  return closest?.player ?? null;
}

function getSortedPlayers() {
  const players = Array.isArray(props.players) ? [...props.players] : [];
  return players.sort((a, b) => {
    const isDeadA = isDeadPlayer(a);
    const isDeadB = isDeadPlayer(b);
    if (isDeadA !== isDeadB) return isDeadA ? -1 : 1;

    const isLeaderA = a?.match?.isLeader === true;
    const isLeaderB = b?.match?.isLeader === true;
    if (isLeaderA !== isLeaderB) return isLeaderA ? 1 : -1;

    const keyA = String(a?.identity?.key ?? "");
    const keyB = String(b?.identity?.key ?? "");
    const isFocusA = keyA === props.hoveredPlayerKey || keyA === props.selectedPlayerKey;
    const isFocusB = keyB === props.hoveredPlayerKey || keyB === props.selectedPlayerKey;
    if (isFocusA !== isFocusB) return isFocusA ? 1 : -1;

    return keyA.localeCompare(keyB);
  });
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const players = getSortedPlayers();
  for (const player of players) {
    const mapX = Number(player?.mapX);
    const mapY = Number(player?.mapY);
    if (!Number.isFinite(mapX) || !Number.isFinite(mapY)) continue;

    const cx = (mapX / 100) * canvas.width;
    const cy = (mapY / 100) * canvas.height;
    const isDead = isDeadPlayer(player);
    const isSquadLeader = player?.match?.isLeader === true;
    const squadId = player?.match?.squadId;
    const hasVehicle = isVehiclePlayer(player);
    const playerName = player?.identity?.name || "Unknown";
    const key = String(player?.identity?.key ?? "");
    const isSelected = key === props.selectedPlayerKey;
    const isHovered = key === props.hoveredPlayerKey;
    const tone = getPerspectiveTone(player?.teamId);
    const palette = getPerspectivePalette(tone);
    const r = getMarkerRadius();

    if (isSelected || isHovered) {
      ctx.beginPath();
      if (hasVehicle && !isDead) {
        const hr = r * 1.5;
        ctx.moveTo(cx, cy - hr);
        ctx.lineTo(cx + hr, cy);
        ctx.lineTo(cx, cy + hr);
        ctx.lineTo(cx - hr, cy);
        ctx.closePath();
      } else {
        ctx.arc(cx, cy, r * 1.5, 0, 2 * Math.PI);
      }
      ctx.fillStyle = isSelected ? "rgba(255, 204, 0, 0.25)" : "rgba(255, 255, 255, 0.18)";
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#ffcc00" : "#ffffff";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (player?.yaw !== null && player?.yaw !== undefined && !isDead) {
      const angleRad = (Number(player.yaw) + 90) * (Math.PI / 180);
      const pointerLen = r * 1.8;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angleRad) * pointerLen, cy + Math.sin(angleRad) * pointerLen);
      ctx.strokeStyle = palette.primary;
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    if (isSquadLeader && !isDead) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.35, 0, 2 * Math.PI);
      ctx.strokeStyle = palette.primary;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    ctx.beginPath();
    if (hasVehicle && !isDead) {
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
    } else {
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    }

    ctx.fillStyle = isDead ? "#475569" : palette.primary;
    ctx.fill();
    ctx.strokeStyle = isDead ? "#1e293b" : palette.deep;
    ctx.lineWidth = 3;
    ctx.stroke();

    if (isDead) {
      const crossSize = r * 0.55;
      ctx.beginPath();
      ctx.moveTo(cx - crossSize, cy - crossSize);
      ctx.lineTo(cx + crossSize, cy + crossSize);
      ctx.moveTo(cx + crossSize, cy - crossSize);
      ctx.lineTo(cx - crossSize, cy + crossSize);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${r * 0.95}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const insideText = squadId ? String(squadId) : (player?.roleInfo?.label ? player.roleInfo.label[0] : "?");
      ctx.fillText(insideText, cx, cy);
    }

    if (props.showPlayerNames) {
      ctx.fillStyle = isSelected ? "#ffcc00" : isDead ? "#94a3b8" : "#ffffff";
      ctx.font = `bold ${r * 0.85}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;

      const tagText = squadId ? `${playerName} [#${squadId}]` : playerName;
      ctx.fillText(tagText, cx + r * 1.3, cy);

      if (props.showPlayerCoords && player?.telemetry?.position) {
        const pos = player.telemetry.position;
        const coordText = `${Math.round(Number(pos.x) || 0)}, ${Math.round(Number(pos.y) || 0)}`;
        ctx.font = `${Math.max(10, r * 0.6)}px sans-serif`;
        ctx.fillStyle = "rgba(226, 232, 240, 0.85)";
        ctx.fillText(coordText, cx + r * 1.3, cy + r * 0.9);
      }

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  }
}

function scheduleDraw() {
  if (drawFrameId) return;
  drawFrameId = requestAnimationFrame(() => {
    drawFrameId = 0;
    draw();
  });
}

function emitHover(payload: CanvasInteractionPayload | null) {
  const nextKey = String(payload?.player?.identity?.key ?? "");
  if (nextKey === lastHoverKey) return;
  lastHoverKey = nextKey;
  emit("hover-change", payload);
}

function onPointerMove(event: PointerEvent) {
  if (props.interactionEnabled === false) return;
  const point = getCanvasPoint(event);
  if (!point) return;
  emitHover({ ...point, player: findPlayerAtPoint(point.canvasX, point.canvasY) });
}

function onPointerLeave() {
  lastHoverKey = "";
  emit("hover-change", null);
}

function onClick(event: MouseEvent) {
  if (props.interactionEnabled === false) return;
  const point = getCanvasPoint(event);
  if (!point) return;
  emit("click", { ...point, player: findPlayerAtPoint(point.canvasX, point.canvasY) });
}

function onContextMenu(event: MouseEvent) {
  if (props.interactionEnabled === false) return;
  const point = getCanvasPoint(event);
  if (!point) return;
  emit("contextmenu", { ...point, player: findPlayerAtPoint(point.canvasX, point.canvasY) });
}

onMounted(() => {
  draw();
});

onBeforeUnmount(() => {
  if (drawFrameId) {
    cancelAnimationFrame(drawFrameId);
    drawFrameId = 0;
  }
});

watch(
  () => [
    props.players,
    props.selectedPlayerKey,
    props.hoveredPlayerKey,
    props.scale,
    props.showPlayerNames,
    props.showPlayerCoords,
    props.zoom,
    props.viewerTeamId,
  ],
  () => {
    scheduleDraw();
  },
  { deep: false }
);
</script>

<style scoped>
.tactical-canvas-renderer {
  position: absolute;
  top: 0;
  left: 0;
  width: 1000px;
  height: 1000px;
  z-index: 20;
  pointer-events: auto;
  touch-action: none;
}

.tactical-canvas-renderer.is-interactive {
  cursor: crosshair;
}
</style>
