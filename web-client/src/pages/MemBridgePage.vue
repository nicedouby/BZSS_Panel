<template>
  <main class="mem-bridge-page">
    <header class="bridge-header">
      <div>
        <div class="bridge-kicker">BZSS-MEM-BRIDGE · MEMORY READ ONLY</div>
        <h1>Bridge 点位、玩家与载具</h1>
        <p>展示地图点位、玩家位置和载具状态；载具信息复用 Panel 战术状态流。</p>
      </div>
      <div class="bridge-toolbar">
        <label class="bridge-target">
          <span>目标服务器</span>
          <select v-model="target" @change="loadSnapshot">
            <option value="formal">BZSS 正式服</option>
            <option value="test">BZSS 测试服</option>
          </select>
        </label>
        <label class="bridge-target bridge-refresh-rate">
          <span>页面刷新</span>
          <select v-model.number="refreshIntervalMs">
            <option :value="50">0.05 秒（20 Hz）</option>
            <option :value="100">0.1 秒（10 Hz）</option>
            <option :value="200">0.2 秒（5 Hz）</option>
            <option :value="500">0.5 秒</option>
            <option :value="1000">1 秒</option>
            <option :value="1500">1.5 秒</option>
            <option :value="2000">2 秒</option>
            <option :value="3000">3 秒</option>
            <option :value="5000">5 秒</option>
            <option :value="10000">10 秒</option>
            <option :value="30000">30 秒</option>
            <option :value="60000">60 秒</option>
          </select>
        </label>
        <button class="bridge-refresh" type="button" :disabled="loading" @click="loadSnapshot">
          {{ loading ? "读取中…" : "立即刷新" }}
        </button>
        <button class="bridge-auto" type="button" :aria-pressed="autoRefresh" @click="autoRefresh = !autoRefresh">
          {{ autoRefresh ? "自动刷新：开" : "自动刷新：关" }}
        </button>
        <button v-if="canManageSettings" class="bridge-settings-toggle" type="button" :aria-expanded="settingsOpen" @click="toggleSettings">
          {{ settingsOpen ? "收起采样设置" : "采样设置" }}
        </button>
      </div>
    </header>

    <div class="bridge-status-row" aria-live="polite">
      <span class="bridge-status" :class="statusClass"><i></i>{{ statusLabel }}</span>
      <span v-if="snapshot?.map?.worldName">地图 {{ snapshot.map.worldName }}</span>
      <span v-if="snapshot">玩家 {{ snapshot.players.length }} · 有位置 {{ positionedPlayers.length }}</span>
      <span v-if="snapshot?.health?.playersWithVitals != null">有血量 {{ snapshot.health.playersWithVitals }} · 有战绩 {{ snapshot.health.playersWithCombatStats ?? 0 }}</span>
      <span v-if="snapshot">地图点位 {{ snapshot.mapPoints.length }}</span>
      <span>载具 {{ vehicleRows.length }}（战术状态流）</span>
      <span v-if="snapshot?.observedAt">采样 {{ formatTime(snapshot.observedAt) }}</span>
      <span v-if="snapshot?.health?.readDurationMs != null">本次读取 {{ Number(snapshot.health.readDurationMs).toFixed(1) }} ms</span>
      <span v-if="bridgeSettings">位置 {{ bridgeSettings.sampleIntervalSeconds }} 秒 · 战绩/血量 {{ bridgeSettings.playerStatsIntervalSeconds }} 秒 · 点位 {{ bridgeSettings.pointScanIntervalSeconds }} 秒</span>
      <span v-if="errorText" class="bridge-error">{{ errorText }}</span>
    </div>

    <section v-if="canManageSettings && settingsOpen" class="bridge-settings-card">
      <div class="bridge-settings-heading">
        <div><h2>采样参数</h2><span>仅调整 {{ target === "formal" ? "正式服" : "测试服" }} 的 Bridge 读取节奏。</span></div>
        <span class="bridge-settings-state">{{ settingsSaving ? "应用中…" : settingsLoading ? "读取中…" : "运行时即时生效" }}</span>
      </div>
      <form class="bridge-settings-form" @submit.prevent="saveSettings">
        <label>
          <span>内存采样间隔（秒）</span>
          <input v-model.number="settingsDraft.sampleIntervalSeconds" type="number" min="0.05" max="60" step="0.01" required>
          <small>范围 0.05–60 秒。0.05 秒约为每秒 20 次；数值越大，Bridge 读取越少。</small>
        </label>
        <label>
          <span>玩家战绩与血量间隔（秒）</span>
          <input v-model.number="settingsDraft.playerStatsIntervalSeconds" type="number" min="0.25" max="60" step="0.25" required>
          <small>范围 0.25–60 秒。位置仍按内存采样间隔更新；较慢的战绩采样可减轻内存读取负担。</small>
        </label>
        <label>
          <span>地图点位重新扫描（秒）</span>
          <input v-model.number="settingsDraft.pointScanIntervalSeconds" type="number" min="1" max="60" step="1" required>
          <small>范围 1–60 秒。控制据点和出生点列表多久重新发现一次。</small>
        </label>
        <div class="bridge-settings-actions">
          <button type="submit" class="bridge-settings-apply" :disabled="settingsSaving || settingsLoading">应用到当前服务器</button>
          <button type="button" class="bridge-settings-reload" :disabled="settingsSaving || settingsLoading" @click="loadSettings">重新读取</button>
          <span v-if="settingsMessage" :class="settingsError ? 'is-error' : 'is-ok'">{{ settingsMessage }}</span>
        </div>
      </form>
      <p class="bridge-settings-note">设置会持久保存并即时应用，不需要重启 Squad。降低间隔会增加内存读取频率；当前采样对象和范围保持不变。</p>
    </section>

    <section class="bridge-map-card">
      <div class="bridge-map-heading">
        <div>
          <h2>位置总览</h2>
          <span v-if="mapConfig">{{ mapConfig.name }} · 世界坐标按战术地图边界投影</span>
          <span v-else>当前地图没有已标定的战术底图，坐标明细仍可查看</span>
        </div>
        <div class="bridge-map-controls">
          <label><input v-model="showPlayers" type="checkbox"> 玩家</label>
          <label><input v-model="showPoints" type="checkbox"> 地图点位</label>
          <label><input v-model="showVehicles" type="checkbox"> 载具</label>
          <select v-model="pointKind" aria-label="地图点位类型">
            <option value="all">全部点位</option>
            <option value="capture_zone">据点</option>
            <option value="main_base">主基地</option>
            <option value="spawn_group">出生组</option>
            <option value="spawn_point">出生点</option>
            <option value="vehicle_spawner">载具刷新点</option>
            <option value="deployable_spawner">部署物刷新点</option>
          </select>
        </div>
      </div>

      <div v-if="mapConfig" class="bridge-map-stage">
        <img :src="mapConfig.image" :alt="`${mapConfig.name} 战术地图`" draggable="false">
        <template v-if="showPoints">
          <div
            v-for="point in visiblePointsOnMap"
            :key="`point-${point.id}`"
            class="bridge-tactical-point"
            :class="[`kind-${point.kind}`, `team-${pointTeam(point)}`, { 'is-capturing': isCapturing(point), 'is-locked': point.capture?.locked }]"
            :style="markerStyle(point.position)"
            :title="pointTooltip(point)"
            role="img"
            :aria-label="pointTooltip(point)"
          >
            <template v-if="point.kind === 'capture_zone' || point.kind === 'main_base'">
              <span class="bridge-zone-flag">
                <span class="bridge-zone-flag__visual">
                  <span class="bridge-zone-flag__glyph">{{ point.kind === "main_base" ? "⌂" : "⚑" }}</span>
                  <span v-if="point.capture?.locked" class="bridge-zone-flag__lock" aria-label="锁定"></span>
                </span>
                <span class="bridge-zone-flag__name">{{ point.name }}</span>
              </span>
            </template>
            <template v-else>
              <span class="bridge-spawn-symbol" :class="`team-${pointTeam(point)}`">{{ pointShortLabel(point) }}</span>
              <span class="bridge-spawn-name">{{ point.name }}</span>
            </template>
          </div>
        </template>
        <template v-if="showVehicles">
          <div
            v-for="vehicle in vehicleMarkersOnMap"
            :key="`vehicle-${vehicle.id}`"
            class="bridge-vehicle-marker"
            :class="`team-${vehicle.teamId ?? 0}`"
            :style="markerStyle(vehicle.position)"
            :title="vehicleTooltip(vehicle)"
            role="img"
            :aria-label="vehicleTooltip(vehicle)"
          >
            <img v-if="vehicle.iconPath" :src="vehicle.iconPath" :alt="vehicle.iconLabel" draggable="false">
            <span v-else aria-hidden="true">🚙</span>
            <small>{{ vehicle.shortLabel }}</small>
          </div>
        </template>
        <template v-if="showPlayers">
          <PlayerMarker
            v-for="player in positionedPlayersOnMap"
            :key="`player-${player.id}`"
            mode="tactical"
            :player-name="player.name || `玩家 ${player.playerId}`"
            :team-id="player.teamId"
            :map-x="player.mapX"
            :map-y="player.mapY"
            :squad-id="player.squadId"
            :role-icon="playerRoleInfo(player).icon"
            :role-label="playerRoleInfo(player).label"
            :is-squad-leader="playerRoleInfo(player).isLeader"
            :game-x="player.positionMeters?.x"
            :game-y="player.positionMeters?.y"
            :scale="0.78"
            :tone="player.teamId === 1 ? 'friendly' : player.teamId === 2 ? 'enemy' : 'neutral'"
            :show-name="true"
            :show-coords="false"
            :disable-interaction="true"
            :title="playerTooltip(player)"
          />
        </template>
        <div v-if="showPlayers && !positionedPlayersOnMap.length && !vehicleMarkersOnMap.length && !visiblePointsOnMap.length" class="bridge-map-empty">当前没有可投影的玩家位置</div>
        <div class="bridge-map-legend">
          <span><i class="legend-player team-1"></i>Team 1 玩家</span>
          <span><i class="legend-player team-2"></i>Team 2 玩家</span>
          <span><i class="legend-point"></i>据点／基地</span>
          <span><i class="legend-spawn"></i>出生点／出生组</span>
          <span><i class="legend-vehicle"></i>载具（战术状态）</span>
        </div>
      </div>
      <div v-else class="bridge-no-map">
        <strong>{{ snapshot?.map?.worldName || "等待地图数据" }}</strong>
        <span>该地图暂无匹配的底图和坐标边界。下面的 XYZ 坐标来自 Bridge 实际读取，不会用推测位置代替。</span>
      </div>
    </section>

    <section class="bridge-data-grid">
      <article class="bridge-data-card">
        <div class="bridge-card-heading">
          <div><h2>玩家位置、血量与战绩</h2><span>位置、Pawn、血量、火力组和战绩由 Memory Bridge 只读采样；未知字段不回填默认值</span></div>
          <b>{{ snapshot?.players.length ?? 0 }}</b>
        </div>
        <div class="bridge-table-scroll">
          <table>
            <thead><tr><th>玩家</th><th>阵营</th><th>小队</th><th>Pawn / 摄像机</th><th>载具乘坐</th><th>血量</th><th>击杀</th><th>死亡</th><th>救援</th><th>X / 米</th><th>Y / 米</th><th>Z / 米</th><th>Controller</th><th>位置状态</th></tr></thead>
            <tbody>
              <tr v-for="player in sortedPlayers" :key="player.id">
                <td class="bridge-name-cell">{{ player.name || `玩家 ${player.playerId}` }}<small>ID {{ player.playerId }}</small></td>
                <td>{{ teamLabel(player.teamId) }}</td>
                <td>{{ player.squadId == null ? "—" : player.squadId }}</td>
                <td class="bridge-name-cell">{{ pawnKindLabel(player) }}<small>{{ player.pawnClass || "无 Pawn 类" }}</small></td>
                <td><span class="bridge-row-status" :class="vehiclePresence(player).state === 'yes' ? 'is-ok' : 'is-muted'">{{ vehiclePresenceLabel(player) }}</span></td>
                <td>{{ player.vitals?.percent == null ? "未知" : `${Number(player.vitals.percent).toFixed(0)}%` }}</td>
                <td>{{ player.combat?.kills ?? "未知" }}</td>
                <td>{{ player.combat?.deaths ?? "未知" }}</td>
                <td>{{ player.combat?.revives ?? "未知" }}</td>
                <td>{{ coordinateMeters(player.positionMeters?.x) }}</td>
                <td>{{ coordinateMeters(player.positionMeters?.y) }}</td>
                <td>{{ coordinateMeters(player.positionMeters?.z) }}</td>
                <td>{{ connectionLabel(player.connectionKind) }}</td>
                <td><span class="bridge-row-status" :class="player.positionStatus === 'ok' ? 'is-ok' : 'is-muted'">{{ player.positionStatus === "ok" ? "有位置" : "未出生／无位置" }}</span></td>
              </tr>
              <tr v-if="!sortedPlayers.length"><td colspan="14" class="bridge-table-empty">暂无玩家采样</td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="bridge-data-card">
        <div class="bridge-card-heading">
          <div><h2>地图点位</h2><span>包括据点、主基地、出生点和出生组</span></div>
          <b>{{ filteredPoints.length }}</b>
        </div>
        <div class="bridge-table-scroll">
          <table>
            <thead><tr><th>点位</th><th>类型</th><th>阵营</th><th>X / 米</th><th>Y / 米</th><th>Z / 米</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="point in filteredPoints" :key="point.id">
                <td class="bridge-name-cell">{{ point.name }}<small>{{ point.class }}</small></td>
                <td>{{ pointKindLabel(point.kind) }}</td>
                <td>{{ teamLabel(point.teamId) }}</td>
                <td>{{ coordinateMeters(point.positionMeters?.x) }}</td>
                <td>{{ coordinateMeters(point.positionMeters?.y) }}</td>
                <td>{{ coordinateMeters(point.positionMeters?.z) }}</td>
                <td>{{ pointState(point) }}</td>
              </tr>
              <tr v-if="!filteredPoints.length"><td colspan="7" class="bridge-table-empty">没有符合筛选条件的地图点位</td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="bridge-data-card bridge-vehicle-card">
        <div class="bridge-card-heading">
          <div><h2>载具信息</h2><span>车辆状态来自 Panel 战术状态流{{ vehicleSourceName ? ` · ${vehicleSourceName}` : "" }}；位置按 UE 世界坐标投影</span></div>
          <b>{{ vehicleRows.length }}</b>
        </div>
        <div class="bridge-table-scroll">
          <table>
            <thead><tr><th>载具</th><th>阵营</th><th>X / 米</th><th>Y / 米</th><th>Z / 米</th><th>朝向</th><th>健康度</th><th>速度</th><th>乘员</th></tr></thead>
            <tbody>
              <tr v-for="vehicle in vehicleRows" :key="vehicle.id">
                <td class="bridge-name-cell"><span class="bridge-vehicle-table-icon"><img v-if="vehicle.iconPath" :src="vehicle.iconPath" :alt="vehicle.iconLabel"><span v-else>🚙</span></span>{{ vehicle.vehicleType }}<small>{{ vehicle.iconLabel }} · {{ vehicle.occupied ? "有人乘坐" : "无人乘坐" }}</small></td>
                <td>{{ teamLabel(vehicle.teamId) }}</td>
                <td>{{ coordinateMeters(vehicle.positionMeters?.x) }}</td>
                <td>{{ coordinateMeters(vehicle.positionMeters?.y) }}</td>
                <td>{{ coordinateMeters(vehicle.positionMeters?.z) }}</td>
                <td>{{ vehicle.yaw == null ? "—" : `${Number(vehicle.yaw).toFixed(0)}°` }}</td>
                <td>{{ vehicle.healthPercent == null ? "—" : `${Number(vehicle.healthPercent).toFixed(0)}%` }}</td>
                <td>{{ vehicle.speed == null ? "—" : Number(vehicle.speed).toFixed(1) }}</td>
                <td>{{ vehicle.occupantNames.length ? vehicle.occupantNames.join("、") : "—" }}</td>
              </tr>
              <tr v-if="!vehicleRows.length"><td colspan="9" class="bridge-table-empty">战术状态流当前没有载具数据</td></tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>
    <footer class="bridge-footnote">数据为只读快照；地图投影使用 UE 世界 XY，Z 单独显示。Bridge 快照是一致性校验后的近实时读取，并非暂停游戏后的原子快照。</footer>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { apiGet, apiPatch } from "../app/apiClient";
import { memBridgePanelTarget } from "../app/memBridgeApi";
import { useAuthStore } from "../stores/auth.store";
import { useTacticalStateStore } from "../stores/tactical-state.store";
import { canAccessPage } from "../shared/web-page-permissions.js";
import { resolveTacticalMapKey, TACTICAL_MAP_CONFIGS, type TacticalMapConfig } from "../shared/tactical-map-data";
import PlayerMarker from "../components/tactical-map/PlayerMarker.vue";
import { resolveRoleIcon } from "../utils/role-icons";
import { resolveVehicleIcon } from "../utils/vehicle-icons";

type Vec3 = { x: number; y: number; z: number };
type BridgePlayer = {
  id: string; playerId: number | null; name: string; teamId: number | null; squadId: number | null;
  connectionKind: string; hasPawn: boolean; position: Vec3 | null; positionMeters: Vec3 | null; positionStatus: string;
  pawnClass?: string | null; yaw?: number | null; role?: string | null; isLeader?: boolean;
  fireteamIndex?: number | null; fireteamPosition?: number | null;
  vitals?: { current: number | null; maximum: number | null; percent: number | null; source?: string | null; status: string };
  combat?: Record<string, number | null>; combatStatus?: string; combatSource?: string | null; combatObservedAt?: number | null;
  roleIcon?: string; roleLabel?: string;
};
type BridgeMapPlayer = BridgePlayer & { mapX: number; mapY: number };
type BridgePoint = {
  id: string; kind: string; name: string; class: string; position: Vec3 | null; positionMeters: Vec3 | null;
  positionStatus: string; teamId: number | null; capture?: Record<string, unknown> | null;
  spawn?: Record<string, unknown> | null;
};
type BridgeSnapshot = {
  target: "formal" | "test"; observedAt: number; map: { worldName: string; mapName: string; units: string };
  players: BridgePlayer[]; mapPoints: BridgePoint[];
  health?: { status?: string; readDurationMs?: number; playerStates?: number; playersWithPosition?: number; playersWithVitals?: number; playersWithCombatStats?: number };
};
type BridgeVehicle = {
  id: string; vehicleType: string; iconLabel: string; iconPath: string | null; shortLabel: string;
  teamId: number | null; position: Vec3 | null; positionMeters: Vec3 | null; yaw: number | null;
  healthPercent: number | null; speed: number | null; occupied: boolean;
  occupantIds: string[]; occupantNames: string[];
};
type BridgeSettings = { target: "formal" | "test"; sampleIntervalSeconds: number; playerStatsIntervalSeconds: number; pointScanIntervalSeconds: number; updatedAt: number | null };

const target = ref<"formal" | "test">(memBridgePanelTarget());
const authStore = useAuthStore();
const tacticalStateStore = useTacticalStateStore();
const vehicleSourceName = computed(() => String(tacticalStateStore.server?.name ?? tacticalStateStore.server?.serverId ?? "").trim());
const canManageSettings = computed(() => canAccessPage(authStore.user, "settings.manage"));
const snapshot = ref<BridgeSnapshot | null>(null);
const loading = ref(false);
const errorText = ref("");
const autoRefresh = ref(true);
const refreshIntervalMs = ref(100);
const showPlayers = ref(true);
const showPoints = ref(true);
const showVehicles = ref(true);
const pointKind = ref("all");
const settingsOpen = ref(true);
const settingsLoading = ref(false);
const settingsSaving = ref(false);
const settingsError = ref(false);
const settingsMessage = ref("");
const bridgeSettings = ref<BridgeSettings | null>(null);
const settingsDraft = ref({ sampleIntervalSeconds: 0.5, playerStatsIntervalSeconds: 1, pointScanIntervalSeconds: 5 });
let refreshTimer: number | null = null;
let requestGeneration = 0;

const mapConfig = computed<TacticalMapConfig | null>(() => {
  const key = resolveTacticalMapKey(snapshot.value?.map?.worldName ?? snapshot.value?.map?.mapName);
  return key ? TACTICAL_MAP_CONFIGS[key] ?? null : null;
});
const positionedPlayers = computed(() => (snapshot.value?.players ?? []).filter((player) => player.positionStatus === "ok" && player.position));
const sortedPlayers = computed(() => [...(snapshot.value?.players ?? [])].sort((a, b) => Number(a.playerId ?? -1) - Number(b.playerId ?? -1)));
const filteredPoints = computed(() => {
  const points = snapshot.value?.mapPoints ?? [];
  return pointKind.value === "all" ? points : points.filter((point) => point.kind === pointKind.value);
});
const visiblePointsOnMap = computed(() => filteredPoints.value.filter((point) => point.positionStatus === "ok" && point.position && inMapBounds(point.position)));
const vehicleRows = computed<BridgeVehicle[]>(() => {
  const rawVehicles = Array.isArray(tacticalStateStore.assets?.vehicles) ? tacticalStateStore.assets.vehicles : [];
  const playersById = new Map<string, string>();
  for (const player of tacticalStateStore.players) {
    const id = normalizeRuntimePlayerId(player?.identity?.playerID ?? player?.identity?.playerId ?? player?.playerId);
    if (id == null) continue;
    const name = String(player?.identity?.name ?? player?.raw?.rcon?.name ?? player?.name ?? "").trim();
    if (name) playersById.set(id, name);
  }
  return rawVehicles.map((vehicle: any, index: number) => {
    const vehicleType = String(vehicle?.vehicleType ?? "").trim() || "Unknown Vehicle";
    const icon = resolveVehicleIcon(vehicleType);
    const x = optionalFinite(vehicle?.position?.x);
    const y = optionalFinite(vehicle?.position?.y);
    const z = optionalFinite(vehicle?.position?.z);
    const position = x == null || y == null || z == null ? null : { x, y, z };
    const hasOccupantSnapshot = Array.isArray(vehicle?.occupantPlayerIds);
    const rawIds = hasOccupantSnapshot
      ? vehicle.occupantPlayerIds
      : [vehicle?.driverPlayerId, ...(Array.isArray(vehicle?.seatPlayerIds) ? vehicle.seatPlayerIds : [])];
    const occupantIds = [...new Set<string>(rawIds
      .map((value: unknown) => normalizeRuntimePlayerId(value))
      .filter((value: string | null): value is string => value != null))];
    const trackId = optionalFinite(vehicle?.trackId);
    const team = optionalFinite(vehicle?.teamId);
    const teamId = team === 1 || team === 2 ? team : null;
    const iconPath = icon.icon.startsWith("/") ? icon.icon : null;
    return {
      id: `runtime-vehicle:${trackId != null && trackId > 0 ? trackId : `${teamId ?? 0}:${vehicleType}:${index}`}`,
      vehicleType,
      iconLabel: icon.label,
      iconPath,
      shortLabel: icon.label.length > 8 ? icon.label.slice(0, 8) : icon.label,
      teamId,
      position,
      positionMeters: position ? { x: position.x / 100, y: position.y / 100, z: position.z / 100 } : null,
      yaw: optionalFinite(vehicle?.yaw),
      healthPercent: optionalFinite(vehicle?.healthPercent),
      speed: optionalFinite(vehicle?.speed),
      occupied: occupantIds.length > 0 || (!hasOccupantSnapshot && Boolean(vehicle?.occupied)),
      occupantIds,
      occupantNames: occupantIds.map((id) => playersById.get(id) ?? `Player ${id}`),
    };
  });
});
const vehicleMarkersOnMap = computed(() => vehicleRows.value.filter((vehicle) => vehicle.position && inMapBounds(vehicle.position)));
const tacticalPlayersById = computed(() => {
  const byId = new Map<string, any>();
  for (const player of tacticalStateStore.players) {
    const id = normalizeRuntimePlayerId(player?.identity?.playerID ?? player?.identity?.playerId ?? player?.playerId);
    if (id != null) byId.set(id, player);
  }
  return byId;
});
const vehiclesByOccupantId = computed(() => {
  const byPlayer = new Map<string, BridgeVehicle>();
  for (const vehicle of vehicleRows.value) {
    for (const id of vehicle.occupantIds) byPlayer.set(id, vehicle);
  }
  return byPlayer;
});
const positionedPlayersOnMap = computed<BridgeMapPlayer[]>(() => positionedPlayers.value
  .filter((player) => player.position && inMapBounds(player.position))
  .map((player) => ({ ...player, ...mapPercent(player.position!) })));
const statusClass = computed(() => errorText.value ? "is-error" : snapshot.value?.health?.status === "ok" ? "is-ready" : "is-waiting");
const statusLabel = computed(() => errorText.value ? "Bridge 不可用" : snapshot.value?.health?.status === "ok" ? "Bridge 在线 · 只读" : "等待 Bridge 数据");

function inMapBounds(position: Vec3) {
  const bounds = mapConfig.value?.bounds;
  if (!bounds) return false;
  const marginX = (bounds.maxX - bounds.minX) * 0.04;
  const marginY = (bounds.maxY - bounds.minY) * 0.04;
  return position.x >= bounds.minX - marginX && position.x <= bounds.maxX + marginX
    && position.y >= bounds.minY - marginY && position.y <= bounds.maxY + marginY;
}

function mapPercent(position: Vec3) {
  const bounds = mapConfig.value?.bounds;
  if (!bounds) return { mapX: 50, mapY: 50 };
  const x = Math.max(1, Math.min(99, ((position.x - bounds.minX) / (bounds.maxX - bounds.minX)) * 100));
  const y = Math.max(1, Math.min(99, ((position.y - bounds.minY) / (bounds.maxY - bounds.minY)) * 100));
  return { mapX: x, mapY: y };
}
function markerStyle(position: Vec3 | null) {
  if (!position) return {};
  const { mapX, mapY } = mapPercent(position);
  return { left: `${mapX}%`, top: `${mapY}%` };
}

function optionalFinite(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function normalizeRuntimePlayerId(value: unknown): string | null {
  const number = optionalFinite(value);
  return number != null && number >= 0 ? String(Math.trunc(number)) : null;
}

function formatTime(value: number) {
  return Number.isFinite(value) ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value * 1000)) : "—";
}
function coordinateMeters(value: number | undefined) { return Number.isFinite(value) ? Number(value).toFixed(1) : "—"; }
function teamLabel(value: number | null | undefined) { return value === 1 || value === 2 ? `Team ${value}` : value === 0 ? "中立" : "未知"; }
function connectionLabel(value: string) {
  return ({ network_player: "网络玩家", local_controller: "本地 Controller（类型待确认）", ai_controller: "AI Controller", unknown: "未识别" } as Record<string, string>)[value] ?? value ?? "—";
}
function pointKindLabel(value: string) {
  return ({ capture_zone: "据点", main_base: "主基地", spawn_point: "出生点", spawn_group: "出生组", vehicle_spawner: "载具刷新点", deployable_spawner: "部署物刷新点" } as Record<string, string>)[value] ?? value;
}
function pointShortLabel(point: BridgePoint) {
  if (point.kind === "main_base") return "基";
  if (point.kind === "capture_zone") return point.name.match(/^\d+/)?.[0] ?? "点";
  if (point.kind === "spawn_group") return "▦";
  if (point.kind === "vehicle_spawner") return "◆";
  if (point.kind === "deployable_spawner") return "⚒";
  return "✛";
}
function pointTeam(point: BridgePoint) {
  const value = Number(point.teamId ?? point.capture?.owningTeam);
  return value === 1 || value === 2 ? value : 0;
}
function isCapturing(point: BridgePoint) {
  if (!point.capture) return false;
  const owner = Number(point.capture.owningTeam);
  const capturer = Number(point.capture.capturingTeam);
  return (capturer === 1 || capturer === 2) && capturer !== owner;
}
function playerTooltip(player: BridgePlayer) {
  const position = player.positionMeters;
  return `${player.name || `玩家 ${player.playerId}`} · ${teamLabel(player.teamId)} · 小队 ${player.squadId ?? "—"} · ${pawnKindLabel(player)} · ${vehiclePresenceLabel(player)} · XYZ ${position ? `${coordinateMeters(position.x)}, ${coordinateMeters(position.y)}, ${coordinateMeters(position.z)} m` : "无位置"}`;
}
function pawnKindLabel(player: BridgePlayer) {
  if (!player.hasPawn || !player.pawnClass) return "无 Pawn";
  const pawnClass = player.pawnClass.toLowerCase();
  if (/admin.?cam|spectator.?cam/.test(pawnClass)) return "Admin Camera";
  if (/vehicle|tank|apc|ifv|helicopter|truck|logi|transport|armou?r/.test(pawnClass)) return "载具 Pawn";
  if (/soldier|infantry/.test(pawnClass)) return "士兵 Pawn";
  return "其他 Pawn";
}
function vehiclePresence(player: BridgePlayer): { state: "yes" | "no" | "unknown"; label: string } {
  const runtime = tacticalPlayersById.value.get(String(player.playerId));
  const runtimeVehicleType = String(runtime?.vehicle?.vehicleType ?? runtime?.vehicleInfo?.vehicleType ?? "").trim();
  const rawState = runtime?.telemetry?.vehicleState ?? runtime?.vehicle?.vehicleState
    ?? runtime?.bzss?.telemetry?.vehicleState ?? runtime?.bzss?.vehicle?.vehicleState;
  if (rawState != null && String(rawState).trim() !== "") {
    const state = String(rawState).trim().toLowerCase();
    if (["walking", "onfoot", "on_foot", "foot", "-1", "false"].includes(state)) return { state: "no", label: "否 · 步行" };
    const numeric = Number(state);
    if (Number.isFinite(numeric)) {
      if (numeric < 0) return { state: "no", label: "否 · 步行" };
      const vehicle = vehiclesByOccupantId.value.get(String(player.playerId));
      return { state: "yes", label: vehicle ? `是 · ${vehicle.vehicleType} · 座位 ${numeric}` : `是 · ${runtimeVehicleType || "载具"} · 座位 ${numeric}` };
    }
    return { state: "yes", label: "是 · 遥测确认" };
  }
  const seatIndex = optionalFinite(runtime?.telemetry?.vehicleSeatIndex ?? runtime?.vehicle?.vehicleSeatIndex
    ?? runtime?.bzss?.telemetry?.vehicleSeatIndex ?? runtime?.bzss?.vehicle?.vehicleSeatIndex);
  if (seatIndex != null) {
    if (seatIndex < 0) return { state: "no", label: "否 · 步行" };
    const vehicle = vehiclesByOccupantId.value.get(String(player.playerId));
    return { state: "yes", label: vehicle ? `是 · ${vehicle.vehicleType} · 座位 ${seatIndex}` : `是 · ${runtimeVehicleType || "载具"} · 座位 ${seatIndex}` };
  }
  const onVehicle = runtime?.telemetry?.onVehicle ?? runtime?.vehicle?.onVehicle
    ?? runtime?.bzss?.telemetry?.onVehicle ?? runtime?.bzss?.vehicle?.onVehicle;
  if (onVehicle === true || onVehicle === 1 || String(onVehicle).trim().toLowerCase() === "true") {
    const vehicle = vehiclesByOccupantId.value.get(String(player.playerId));
    return { state: "yes", label: vehicle ? `是 · ${vehicle.vehicleType}` : `是 · ${runtimeVehicleType || "遥测确认"}` };
  }
  if (onVehicle === false || onVehicle === 0 || String(onVehicle).trim().toLowerCase() === "false") return { state: "no", label: "否 · 步行" };
  const linkedVehicle = vehiclesByOccupantId.value.get(String(player.playerId));
  if (linkedVehicle) return { state: "yes", label: `是 · ${linkedVehicle.vehicleType} · 乘员表` };
  return { state: "unknown", label: "未知 · 无座位数据" };
}
function vehiclePresenceLabel(player: BridgePlayer) { return vehiclePresence(player).label; }
function vehicleTooltip(vehicle: BridgeVehicle) {
  const position = vehicle.positionMeters;
  const details = [
    teamLabel(vehicle.teamId),
    vehicle.healthPercent == null ? "健康度未知" : `健康度 ${vehicle.healthPercent.toFixed(0)}%`,
    vehicle.speed == null ? "速度未知" : `速度 ${vehicle.speed.toFixed(1)}`,
    vehicle.occupantNames.length ? `乘员：${vehicle.occupantNames.join("、")}` : "无人乘坐",
    position ? `XYZ ${coordinateMeters(position.x)}, ${coordinateMeters(position.y)}, ${coordinateMeters(position.z)} m` : "无位置",
  ];
  return `${vehicle.vehicleType} · ${details.join(" · ")}`;
}
function playerRoleInfo(player: BridgePlayer) {
  const normalizedName = String(player.name ?? "").trim().toLowerCase();
  if (!normalizedName) return { icon: "•", label: "兵种信息未采集", isLeader: false };
  const candidates = tacticalStateStore.players.filter((row: any) => (
    String(row?.identity?.name ?? row?.raw?.rcon?.name ?? "").trim().toLowerCase() === normalizedName
  ));
  const match = candidates.find((row: any) => Number(row?.match?.teamId) === player.teamId)
    ?? candidates[0];
  const role = String(match?.match?.role ?? "").trim();
  const resolved = role ? resolveRoleIcon(role) : null;
  return {
    icon: resolved?.icon || "•",
    label: resolved?.label || "兵种信息未采集",
    isLeader: Boolean(match?.match?.isLeader),
  };
}
function pointTooltip(point: BridgePoint) {
  const position = point.positionMeters;
  const state = point.capture ? ` · 占领方 ${teamLabel(Number(point.capture.owningTeam))}` : point.spawn ? ` · ${point.spawn.enabled ? "启用" : "未启用"}` : "";
  return `${point.name} · ${pointKindLabel(point.kind)} · ${teamLabel(point.teamId)}${state} · XYZ ${position ? `${coordinateMeters(position.x)}, ${coordinateMeters(position.y)}, ${coordinateMeters(position.z)} m` : "无位置"}`;
}
function pointState(point: BridgePoint) {
  if (point.capture) return `占领方 ${teamLabel(Number(point.capture.owningTeam))}${point.capture.locked ? " · 锁定" : ""}`;
  if (point.spawn) return `${point.spawn.enabled ? "已启用" : "未启用"}${point.spawn.sieged ? " · 被围困" : ""}`;
  return point.positionStatus === "ok" ? "已读取" : "无位置";
}

async function loadSettings() {
  if (!canManageSettings.value) return;
  settingsLoading.value = true;
  settingsError.value = false;
  settingsMessage.value = "";
  try {
    const result = await apiGet<BridgeSettings>(`/api/mem-bridge/settings?target=${target.value}`, {}, { timeoutMs: 4000 });
    if (result.target !== target.value) return;
    bridgeSettings.value = result;
    settingsDraft.value = {
      sampleIntervalSeconds: result.sampleIntervalSeconds,
      playerStatsIntervalSeconds: result.playerStatsIntervalSeconds,
      pointScanIntervalSeconds: result.pointScanIntervalSeconds,
    };
  } catch (error: any) {
    settingsError.value = true;
    settingsMessage.value = String(error?.message ?? "读取采样参数失败");
  } finally {
    settingsLoading.value = false;
  }
}

async function saveSettings() {
  if (!canManageSettings.value || settingsSaving.value) return;
  settingsSaving.value = true;
  settingsError.value = false;
  settingsMessage.value = "";
  try {
    const result = await apiPatch<BridgeSettings>("/api/mem-bridge/settings", {
      target: target.value,
      sampleIntervalSeconds: Number(settingsDraft.value.sampleIntervalSeconds),
      playerStatsIntervalSeconds: Number(settingsDraft.value.playerStatsIntervalSeconds),
      pointScanIntervalSeconds: Number(settingsDraft.value.pointScanIntervalSeconds),
    }, {}, { timeoutMs: 5000 });
    bridgeSettings.value = result;
    settingsDraft.value = {
      sampleIntervalSeconds: result.sampleIntervalSeconds,
      playerStatsIntervalSeconds: result.playerStatsIntervalSeconds,
      pointScanIntervalSeconds: result.pointScanIntervalSeconds,
    };
    settingsMessage.value = "参数已保存并即时生效";
    await loadSnapshot();
  } catch (error: any) {
    settingsError.value = true;
    settingsMessage.value = String(error?.message ?? "应用采样参数失败");
  } finally {
    settingsSaving.value = false;
  }
}

function toggleSettings() {
  settingsOpen.value = !settingsOpen.value;
  if (settingsOpen.value) void loadSettings();
}

async function loadSnapshot() {
  const generation = ++requestGeneration;
  loading.value = true;
  try {
    const result = await apiGet<BridgeSnapshot>(`/api/mem-bridge/snapshot?target=${target.value}`, {}, { timeoutMs: 5000 });
    if (generation !== requestGeneration) return;
    snapshot.value = result;
    errorText.value = "";
  } catch (error: any) {
    if (generation !== requestGeneration) return;
    errorText.value = String(error?.message ?? "读取 Bridge 数据失败");
  } finally {
    if (generation === requestGeneration) loading.value = false;
  }
}

function syncRefreshTimer() {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = autoRefresh.value ? window.setInterval(() => { if (!loading.value) void loadSnapshot(); }, refreshIntervalMs.value) : null;
}

watch([autoRefresh, refreshIntervalMs], syncRefreshTimer);
watch(target, () => {
  snapshot.value = null;
  bridgeSettings.value = null;
  if (settingsOpen.value) void loadSettings();
});
onMounted(() => {
  void loadSnapshot();
  if (canManageSettings.value) void loadSettings();
  void tacticalStateStore.fetchSnapshot();
  tacticalStateStore.startStream();
  syncRefreshTimer();
});
onBeforeUnmount(() => {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  tacticalStateStore.stopStream();
  requestGeneration += 1;
});
</script>

<style scoped>
.mem-bridge-page{height:100%;overflow:auto;padding:20px 22px 28px;background:radial-gradient(ellipse at 12% 0%,rgba(14,116,144,.16),transparent 34%),#080d17;color:#dbe7f4;font-family:Inter,"Segoe UI",sans-serif}
.bridge-header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin:0 auto 16px;max-width:1680px}
.bridge-kicker{color:#67e8f9;font-size:11px;font-weight:800;letter-spacing:.19em}
.bridge-header h1{margin:5px 0 4px;font-size:25px;letter-spacing:.02em}
.bridge-header p,.bridge-map-heading span,.bridge-card-heading span{margin:0;color:#8ea1b7;font-size:12px}
.bridge-toolbar,.bridge-map-controls{display:flex;align-items:end;gap:9px;flex-wrap:wrap}
.bridge-target{display:grid;gap:5px;color:#8ea1b7;font-size:11px}
.bridge-target select,.bridge-map-controls select,.bridge-toolbar button{height:35px;border:1px solid #29374a;border-radius:8px;background:#111a28;color:#e2e8f0;padding:0 11px;font:inherit}
.bridge-toolbar button{cursor:pointer;font-size:12px}.bridge-toolbar button:disabled{opacity:.55;cursor:wait}.bridge-refresh{border-color:#087e8b!important;background:#0e5360!important}
.bridge-settings-toggle{border-color:#0e7490!important;background:#0c3040!important;color:#a5f3fc!important}
.bridge-settings-card{max-width:1680px;margin:0 auto 14px;border:1px solid #0e749055;border-radius:12px;background:linear-gradient(145deg,#0d1c2b,#0b1420);box-shadow:0 10px 30px #0002}
.bridge-settings-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 15px;border-bottom:1px solid #1d3648}
.bridge-settings-heading h2{margin:0 0 3px;font-size:14px}.bridge-settings-heading span{color:#8ea1b7;font-size:11px}.bridge-settings-state{padding:4px 7px;border:1px solid #1e4356;border-radius:99px;color:#67e8f9!important;background:#092332;font-size:10px!important}
.bridge-settings-form{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:12px;padding:14px 15px 8px}
.bridge-settings-form>label{display:grid;gap:5px;color:#cbd5e1;font-size:11px}
.bridge-settings-form input{height:36px;max-width:240px;border:1px solid #304459;border-radius:7px;background:#0b1320;color:#f1f5f9;padding:0 10px;font:inherit;font-variant-numeric:tabular-nums}
.bridge-settings-form small{color:#7f93a9;font-size:10px}
.bridge-settings-actions{grid-column:1/-1;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bridge-settings-actions button{height:33px;border:1px solid #304459;border-radius:7px;background:#121d2b;color:#dbeafe;padding:0 10px;font:inherit;font-size:11px;cursor:pointer}
.bridge-settings-actions button:disabled{opacity:.55;cursor:wait}.bridge-settings-actions .bridge-settings-apply{border-color:#087e8b;background:#0e5360;color:#ecfeff}
.bridge-settings-actions .is-ok{color:#6ee7b7;font-size:11px}.bridge-settings-actions .is-error{color:#fda4af;font-size:11px}
.bridge-settings-note{margin:0;padding:0 15px 12px;color:#72869d;font-size:10px;line-height:1.6}
.bridge-status-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;max-width:1680px;margin:0 auto 14px;color:#91a3b8;font-size:11px}
.bridge-status{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid #263449;border-radius:99px;background:#101827;color:#cbd5e1}.bridge-status i{width:7px;height:7px;border-radius:50%;background:#94a3b8}.bridge-status.is-ready i{background:#34d399;box-shadow:0 0 8px #34d399}.bridge-status.is-error i{background:#fb7185}.bridge-error{color:#fda4af}
.bridge-map-card,.bridge-data-card{max-width:1680px;margin:0 auto 14px;border:1px solid #1d2a3a;border-radius:12px;background:linear-gradient(150deg,rgba(16,26,41,.97),rgba(10,17,28,.97));box-shadow:0 10px 30px #0002}
.bridge-map-heading,.bridge-card-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:13px 15px;border-bottom:1px solid #1c2939}.bridge-map-heading h2,.bridge-card-heading h2{margin:0 0 3px;font-size:14px}.bridge-map-controls{align-items:center;color:#b8c6d7;font-size:11px}.bridge-map-controls label{display:flex;align-items:center;gap:5px}.bridge-map-controls input{accent-color:#22d3ee}
.bridge-map-stage{position:relative;width:min(100%,780px);aspect-ratio:1;margin:14px auto;overflow:hidden;border:1px solid #334155;border-radius:8px;background:#070d16;isolation:isolate}
.bridge-map-stage>img{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;opacity:.87;user-select:none;pointer-events:none}
.bridge-tactical-point{position:absolute;z-index:3;display:grid;place-items:center;width:34px;height:22px;transform:translate(-50%,-50%);transition:left 120ms linear,top 120ms linear;filter:drop-shadow(0 2px 3px #000b)}
.bridge-zone-flag{position:absolute;left:0;top:0;display:grid;justify-items:center;width:34px;height:22px}
.bridge-zone-flag__visual{position:relative;display:grid;place-items:center;width:34px;height:22px;overflow:hidden;border:1px solid #f8fafc;border-radius:2px;background:#64748b;color:#fff;clip-path:polygon(0 0,100% 0,100% 78%,55% 78%,48% 100%,40% 78%,0 78%)}
.bridge-tactical-point.team-1 .bridge-zone-flag__visual{background:#2563eb}.bridge-tactical-point.team-2 .bridge-zone-flag__visual{background:#dc2626}.bridge-tactical-point.team-0 .bridge-zone-flag__visual{background:#64748b}
.bridge-zone-flag__glyph{font:900 14px/1 system-ui,sans-serif;text-shadow:0 1px 2px #000b}.kind-main_base .bridge-zone-flag__glyph{font-size:17px}
.bridge-zone-flag__name,.bridge-spawn-name{position:absolute;top:24px;left:50%;max-width:100px;overflow:hidden;transform:translateX(-50%);color:#f8fafc;font:700 8px/1.2 system-ui,sans-serif;text-align:center;text-overflow:ellipsis;text-shadow:0 1px 2px #000,0 0 4px #000;white-space:nowrap}
.bridge-zone-flag__lock{position:absolute;right:2px;top:2px;width:8px;height:7px;border:1px solid #0f172a;border-radius:2px;background:#f8fafc}.bridge-zone-flag__lock::before{position:absolute;left:1px;top:-5px;width:4px;height:4px;border:1px solid #0f172a;border-bottom:0;border-radius:4px 4px 0 0;content:""}
.bridge-tactical-point.is-capturing .bridge-zone-flag__visual{animation:bridge-capture-pulse 1.1s ease-in-out infinite}
@keyframes bridge-capture-pulse{50%{filter:brightness(1.5);box-shadow:0 0 12px #fff}}
.bridge-spawn-symbol{display:grid;place-items:center;width:17px;height:17px;border:1px solid #fff;border-radius:50%;background:#7c3aed;color:#fff;font:900 10px/1 system-ui,sans-serif;box-shadow:0 0 0 2px #111827aa,0 0 8px #a78bfa}
.bridge-spawn-symbol.team-1{background:#2563eb}.bridge-spawn-symbol.team-2{background:#dc2626}.bridge-spawn-symbol.team-0{background:#64748b}
.bridge-vehicle-marker{position:absolute;z-index:4;display:grid;place-items:center;width:31px;height:31px;transform:translate(-50%,-50%);border:1px solid #e2e8f0;border-radius:8px;background:#111827e8;box-shadow:0 2px 7px #000b;transition:left 100ms linear,top 100ms linear}
.bridge-vehicle-marker.team-1{outline:2px solid #3b82f6}.bridge-vehicle-marker.team-2{outline:2px solid #ef4444}.bridge-vehicle-marker.team-0{outline:2px solid #94a3b8}
.bridge-vehicle-marker img{width:24px;height:24px;object-fit:contain;filter:drop-shadow(0 1px 2px #000)}.bridge-vehicle-marker>span{font-size:18px}
.bridge-vehicle-marker small{position:absolute;top:31px;left:50%;max-width:90px;overflow:hidden;transform:translateX(-50%);padding:1px 3px;border-radius:3px;background:#07111de8;color:#f8fafc;font:700 8px/1.2 system-ui,sans-serif;text-overflow:ellipsis;text-shadow:0 1px 2px #000;white-space:nowrap}
:deep(.player-marker){transition:left 100ms linear,top 100ms linear}
.bridge-map-empty{position:absolute;z-index:5;inset:0;display:grid;place-items:center;color:#cbd5e1;font-size:13px;background:#08111a55;pointer-events:none}
.bridge-map-legend{position:absolute;z-index:6;left:8px;bottom:8px;display:flex;gap:9px;flex-wrap:wrap;padding:6px 8px;border:1px solid #ffffff20;border-radius:6px;background:#07111de8;color:#cbd5e1;font-size:9px}.bridge-map-legend span{display:flex;align-items:center;gap:4px}.legend-player,.legend-point,.legend-spawn{width:8px;height:8px;border-radius:50%;display:inline-block}.legend-player.team-1{background:#60a5fa}.legend-player.team-2{background:#fb7185}.legend-point{background:#facc15}.legend-spawn{background:#a78bfa}.legend-vehicle{width:9px;height:9px;display:inline-block;border:1px solid #e2e8f0;border-radius:3px;background:#475569;box-shadow:0 0 0 1px #64748b}
.bridge-no-map{min-height:190px;display:grid;align-content:center;justify-items:center;gap:8px;padding:24px;text-align:center;color:#94a3b8}.bridge-no-map strong{color:#dbeafe;font-size:15px}.bridge-no-map span{max-width:520px;font-size:12px;line-height:1.6}
.bridge-data-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;max-width:1680px;margin:auto}.bridge-vehicle-card{grid-column:1/-1}.bridge-card-heading b{min-width:30px;padding:4px 7px;border-radius:6px;background:#172438;color:#67e8f9;text-align:center;font:700 12px ui-monospace,monospace}.bridge-table-scroll{overflow:auto;max-height:380px}table{width:100%;border-collapse:collapse;font-size:11px;white-space:nowrap}th{position:sticky;top:0;z-index:1;background:#111a28;color:#8ea1b7;text-align:left;font-weight:600}th,td{padding:8px 10px;border-bottom:1px solid #1a2636}tbody tr:hover{background:#ffffff06}.bridge-name-cell{font-weight:650;color:#e5edf7}.bridge-name-cell small{display:block;margin-top:2px;color:#71839a;font-size:9px;font-weight:400}.bridge-vehicle-table-icon{display:inline-grid;place-items:center;width:26px;height:26px;margin-right:7px;vertical-align:middle;border:1px solid #475569;border-radius:6px;background:#172438}.bridge-vehicle-table-icon img{width:22px;height:22px;object-fit:contain}.bridge-row-status{display:inline-block;padding:3px 6px;border-radius:99px;font-size:9px}.bridge-row-status.is-ok{background:#064e3b66;color:#6ee7b7}.bridge-row-status.is-muted{background:#33415588;color:#a8b6c7}.bridge-table-empty{text-align:center;padding:22px;color:#8293a8}.bridge-footnote{max-width:1680px;margin:10px auto 0;color:#74859a;font-size:10px}
@media(min-width:1450px){.bridge-data-grid{grid-template-columns:1fr 1fr}.bridge-map-stage{width:min(68vh,780px)}}
@media(max-width:760px){.mem-bridge-page{padding:14px 10px 22px}.bridge-header{align-items:flex-start;flex-direction:column}.bridge-toolbar{width:100%}.bridge-map-heading{align-items:flex-start;flex-direction:column}.bridge-map-stage{width:100%}.bridge-map-controls{gap:7px}.bridge-map-controls select{max-width:160px}.bridge-settings-form{grid-template-columns:1fr}.bridge-settings-actions{grid-column:auto}}
</style>
