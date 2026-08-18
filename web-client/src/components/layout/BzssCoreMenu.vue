<template>
  <div v-if="canUse" ref="rootEl" class="bzss-core">
    <button type="button" class="bzss-core-trigger" @click.stop="toggleMenu">
      <span class="bzss-core-dot" aria-hidden="true"></span>
      <span>BZSS-Core</span>
      <span class="bzss-core-caret" aria-hidden="true">v</span>
    </button>

    <transition name="menu-fade">
      <div v-if="menuOpen" class="bzss-core-menu" role="menu">
        <button type="button" class="bzss-core-item" role="menuitem" @click="openDialog('weather')">
          Weather
        </button>
        <button type="button" class="bzss-core-item" role="menuitem" @click="openSuperWeather">
          Super Weather
        </button>
        <button type="button" class="bzss-core-item" role="menuitem" @click="openDialog('forb-ress')">
          FOB Resource Regeneration
        </button>
        <button type="button" class="bzss-core-item" role="menuitem" @click="openDialog('automatic-heal')">
          Automatic Heal
        </button>
        <div class="core-variable-controls" aria-label="BZSS-Core SaveGame variables">
          <div v-for="item in managedCoreVariables" :key="item.key" class="core-variable-row">
            <span>{{ item.label }} · {{ coreVariableLabel(item.key) }}</span>
            <span class="core-variable-actions">
              <button type="button" :disabled="busy || coreVariableBusy" @click="setCoreVariable(item.key, true)">启用</button>
              <button type="button" :disabled="busy || coreVariableBusy" @click="setCoreVariable(item.key, false)">关闭</button>
            </span>
          </div>
        </div>
        <button type="button" class="bzss-core-item" role="menuitem" @click="openDialog('time')">
          Time
        </button>
        <button type="button" class="bzss-core-item" role="menuitem" @click="openDialog('vehicle')">
          Spawn Vehicle
        </button>
        <button type="button" class="bzss-core-item" role="menuitem" @click="openDialog('raw')">
          Raw Command
        </button>
      </div>
    </transition>

    <teleport to="body">
      <transition name="menu-fade">
        <div v-if="dialogOpen" class="bzss-core-overlay" v-backdrop-close="closeDialog">
          <section class="bzss-core-dialog" role="dialog" aria-modal="true" :aria-labelledby="dialogTitleId">
            <header class="bzss-core-dialog-head">
              <div>
                <p class="bzss-core-kicker">BZSS-Core</p>
                <h2 :id="dialogTitleId">{{ dialogTitle }}</h2>
                <p class="bzss-core-subtitle">{{ dialogSubtitle }}</p>
              </div>
              <button type="button" class="bzss-core-close" @click="closeDialog">x</button>
            </header>

            <form v-if="dialogMode === 'weather'" class="bzss-core-form" @submit.prevent="submitWeatherCommand">
              <label class="bzss-core-field">
                <span>Weather keyword</span>
                <select v-model="selectedWeather" class="bzss-core-select">
                  <option v-for="option in weatherOptions" :key="option.index" :value="option.index">
                    {{ option.index }} · {{ option.name }}
                  </option>
                </select>
              </label>

              <label class="bzss-core-field">
                <span>Parameter value</span>
                <input
                  v-model.trim="weatherParameter"
                  type="text"
                  placeholder="10"
                  autocomplete="off"
                />
              </label>

              <div class="bzss-core-preview">
                <span>Command</span>
                <code>{{ weatherPreview }}</code>
              </div>

              <footer class="bzss-core-actions">
                <button type="button" class="bzss-core-secondary" @click="closeDialog">Cancel</button>
                <button type="submit" class="bzss-core-primary" :disabled="busy">Run</button>
              </footer>
            </form>

            <form v-else-if="dialogMode === 'forb-ress'" class="bzss-core-form" @submit.prevent="submitForbRessCommand">
              <label class="bzss-core-field">
                <span>Team ID</span>
                <select v-model="forbRessTeamId" class="bzss-core-select">
                  <option value="1">Team 1</option>
                  <option value="2">Team 2</option>
                  <option value="both">Both Teams</option>
                </select>
              </label>
              <label class="bzss-core-field">
                <span>Enable regeneration</span>
                <select v-model="forbRessEnabled" class="bzss-core-select">
                  <option value="1">Open (1)</option>
                  <option value="0">Close (0)</option>
                </select>
              </label>
              <label class="bzss-core-field">
                <span>Ammo quantity</span>
                <input v-model="forbRessAmmo" type="number" min="0" placeholder="0" />
              </label>
              <label class="bzss-core-field">
                <span>Construction quantity</span>
                <input v-model="forbRessConstruction" type="number" min="0" placeholder="0" />
              </label>
              <label class="bzss-core-field">
                <span>Total rate</span>
                <input v-model="forbRessRate" type="number" min="0" placeholder="0" />
              </label>
              <div class="bzss-core-preview">
                <span>Command</span>
                <code>{{ forbRessPreview }}</code>
              </div>
              <footer class="bzss-core-actions">
                <button type="button" class="bzss-core-secondary" @click="closeDialog">Cancel</button>
                <button type="submit" class="bzss-core-primary" :disabled="busy">Run</button>
              </footer>
            </form>

            <form v-else-if="dialogMode === 'automatic-heal'" class="bzss-core-form" @submit.prevent="submitAutomaticHealCommands">
              <label class="bzss-core-field">
                <span>Automatic heal</span>
                <select v-model="automaticHealEnabled" class="bzss-core-select">
                  <option value="1">Enabled</option>
                  <option value="0">Disabled</option>
                </select>
              </label>

              <label class="bzss-core-field">
                <span>Automatic heal value</span>
                <input v-model="automaticHealValue" type="number" min="0" placeholder="0" />
              </label>

              <div class="bzss-core-preview">
                <span>Commands</span>
                <code>{{ automaticHealPreview }}</code>
              </div>

              <footer class="bzss-core-actions">
                <button type="button" class="bzss-core-secondary" @click="closeDialog">Cancel</button>
                <button type="submit" class="bzss-core-primary" :disabled="busy">Run</button>
              </footer>
            </form>

            <form v-else-if="dialogMode === 'time'" class="bzss-core-form" @submit.prevent="submitTimeCommand">
              <label class="bzss-core-field">
                <span>Time value</span>
                <input
                  v-model.trim="timeParameter"
                  type="text"
                  placeholder="XXXX"
                  autocomplete="off"
                />
              </label>

              <div class="bzss-core-preview">
                <span>Command</span>
                <code>{{ timePreview }}</code>
              </div>

              <footer class="bzss-core-actions">
                <button type="button" class="bzss-core-secondary" @click="closeDialog">Cancel</button>
                <button type="submit" class="bzss-core-primary" :disabled="busy || !timeParameter">Run</button>
              </footer>
            </form>

            <form v-else-if="dialogMode === 'vehicle'" class="bzss-core-form" @submit.prevent="submitVehicleCommand">
              <!-- Target Player Selection -->
              <label class="bzss-core-field">
                <span>Target Player</span>
                <div class="bzss-core-player-input-group">
                  <select v-if="!isCustomPlayer" v-model="targetPlayer" class="bzss-core-select" :disabled="isBatchSpawning">
                    <option value="" disabled>-- Select Online Player --</option>
                    <option v-for="player in onlinePlayersList" :key="player.name" :value="player.name">
                      {{ player.label }}
                    </option>
                  </select>
                  <input
                    v-else
                    v-model.trim="targetPlayer"
                    type="text"
                    placeholder="Enter Player Name"
                    autocomplete="off"
                    :disabled="isBatchSpawning"
                  />
                  <button
                    type="button"
                    class="bzss-core-toggle-player-btn"
                    :disabled="isBatchSpawning"
                    @click="toggleCustomPlayer"
                  >
                    {{ isCustomPlayer ? "Select Online" : "Manual Input" }}
                  </button>
                </div>
              </label>

              <!-- Vehicle Asset Path -->
              <label class="bzss-core-field">
                <span>Vehicle Asset Path</span>
                <div class="bzss-core-input-with-action">
                  <input
                    v-model.trim="vehicleAssetPath"
                    type="text"
                    placeholder="/Game/Vehicles/..."
                    autocomplete="off"
                    :disabled="isBatchSpawning"
                  />
                  <button
                    type="button"
                    class="bzss-core-favorite-btn"
                    :class="{ 'is-active': isCurrentPathFavorite }"
                    title="Add to Favorites"
                    :disabled="!vehicleAssetPath || isBatchSpawning"
                    @click="toggleFavorite"
                  >
                    {{ isCurrentPathFavorite ? "★ Saved" : "☆ Save" }}
                  </button>
                </div>
              </label>

              <label class="bzss-core-field">
                <span>Team</span>
                <select v-model="vehicleTeamId" class="bzss-core-select" :disabled="isBatchSpawning">
                  <option value="0">Neutral (0)</option>
                  <option value="1">Team 1</option>
                  <option value="2">Team 2</option>
                </select>
              </label>

              <!-- Vehicle Asset Shortcuts Bar -->
              <div class="bzss-core-shortcuts-section">
                <div class="bzss-core-tabs">
                  <button
                    v-for="(cat, key) in vehicleCategories"
                    :key="key"
                    type="button"
                    class="bzss-core-tab-btn"
                    :class="{ 'is-active': activeTab === key }"
                    @click="activeTab = key"
                  >
                    {{ cat.label }}
                  </button>
                  <button
                    type="button"
                    class="bzss-core-tab-btn"
                    :class="{ 'is-active': activeTab === 'favorites' }"
                    @click="activeTab = 'favorites'"
                  >
                    Favorites ({{ favoriteVehicles.length }})
                  </button>
                </div>

                <div class="bzss-core-shortcuts-grid">
                  <template v-if="activeTab !== 'favorites'">
                    <button
                      v-for="item in vehicleCategories[activeTab].items"
                      :key="item.path"
                      type="button"
                      class="bzss-core-shortcut-item"
                      :disabled="isBatchSpawning"
                      @click="vehicleAssetPath = item.path"
                    >
                      <span class="bzss-core-shortcut-name">{{ item.name }}</span>
                      <span class="bzss-core-shortcut-path">{{ item.path }}</span>
                    </button>
                  </template>
                  <template v-else>
                    <div v-if="favoriteVehicles.length === 0" class="bzss-core-no-favorites">
                      No saved paths. Use 'Save' button.
                    </div>
                    <button
                      v-for="item in favoriteVehicles"
                      :key="item.path"
                      type="button"
                      class="bzss-core-shortcut-item"
                      :disabled="isBatchSpawning"
                      @click="vehicleAssetPath = item.path"
                    >
                      <span class="bzss-core-shortcut-name">{{ item.name }}</span>
                      <span class="bzss-core-shortcut-path">{{ item.path }}</span>
                    </button>
                  </template>
                </div>
              </div>

              <!-- Batch Spawn Count -->
              <label class="bzss-core-field">
                <span>Batch Spawn Count (1-10, with 0.1s delay)</span>
                <input
                  v-model.number="batchSpawnCount"
                  type="number"
                  min="1"
                  max="10"
                  placeholder="1"
                  :disabled="isBatchSpawning"
                />
              </label>

              <!-- Command Preview -->
              <div class="bzss-core-preview">
                <span>Command Preview</span>
                <code>{{ vehiclePreview }}</code>
              </div>

              <!-- Batch Spawning Progress -->
              <div v-if="isBatchSpawning" class="bzss-core-progress-container">
                <div class="bzss-core-progress-header">
                  <span>Batch Spawning Sequence</span>
                  <span>{{ batchSpawningProgress }} / {{ batchSpawningTotal }}</span>
                </div>
                <div class="bzss-core-progress-bar-bg">
                  <div
                    class="bzss-core-progress-bar-fill"
                    :style="{ width: `${(batchSpawningProgress / batchSpawningTotal) * 100}%` }"
                  ></div>
                </div>
                <div class="bzss-core-progress-logs">
                  <div v-for="(log, idx) in batchSpawningLogs" :key="idx" class="bzss-core-log-line">
                    {{ log }}
                  </div>
                </div>
              </div>

              <footer class="bzss-core-actions">
                <button type="button" class="bzss-core-secondary" :disabled="isBatchSpawning" @click="closeDialog">Cancel</button>
                <button type="submit" class="bzss-core-primary" :disabled="busy || !targetPlayer || !vehicleAssetPath">
                  {{ isBatchSpawning ? "Spawning..." : "Run" }}
                </button>
              </footer>
            </form>

            <form v-else class="bzss-core-form" @submit.prevent="submitRawCommand">
              <label class="bzss-core-field">
                <span>Raw command</span>
                <textarea
                  v-model.trim="rawCommand"
                  class="bzss-core-textarea"
                  rows="4"
                  placeholder="CreateVehicle:Donald.DoubyBear,/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1_C,1"
                ></textarea>
              </label>

              <div class="bzss-core-example-list">
                <span>Examples</span>
                <code>CreateVehicle:PlayerName,/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1_C,1</code>
                <code>AdminTrack:AdminName,TrackObject</code>
                <code>RemoveAdminTrack:AdminName</code>
                <code>SetWeather:11,10</code>
                  <code>SetFobResourceRegeneration:1,1,100,500,10</code>
                  <code>SetAutomaticHeal:1</code>
                  <code>SetAutomaticHealValue:100</code>
              </div>

              <div class="bzss-core-preview">
                <span>Command</span>
                <code>{{ rawPreview }}</code>
              </div>

              <footer class="bzss-core-actions">
                <button type="button" class="bzss-core-secondary" @click="closeDialog">Cancel</button>
                <button type="submit" class="bzss-core-primary" :disabled="busy || !rawCommand">Run</button>
              </footer>
            </form>
          </section>
        </div>
      </transition>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { executeBzssCoreCommand, type BzssCoreBoolKey } from "../../app/bzssCoreApi";
import { t } from "../../i18n";
import { useAuthStore } from "../../stores/auth.store";
import { useUiStore } from "../../stores/ui.store";
import { hasPermission } from "../../shared/rcon-permissions.js";
import { usePlayerStore } from "../../stores/player.store";
import { useBzssCoreStore } from "../../stores/bzss-core.store";
import { isInputElement } from "../../utils/keyboard";

type DialogMode = "weather" | "time" | "raw" | "vehicle" | "forb-ress" | "automatic-heal";

interface VehiclePreset {
  name: string;
  path: string;
}

const weatherOptions = [
  { index: 0, name: "Clear_Skies" },
  { index: 1, name: "Cloudy" },
  { index: 2, name: "Foggy" },
  { index: 3, name: "Overcast" },
  { index: 4, name: "Partly_Cloudy" },
  { index: 5, name: "Rain" },
  { index: 6, name: "Rain_Light" },
  { index: 7, name: "Rain_Thunders" },
  { index: 8, name: "Sand_Dust_Calm" },
  { index: 9, name: "Sand_Dust_Storm" },
  { index: 10, name: "Snow" },
  { index: 11, name: "Snow_Blizzard" },
  { index: 12, name: "Snow_Light" },
] as const;

const vehicleCategories = {
  tanks: {
    label: "Tanks",
    items: [
      { name: "M1A2 (US)", path: "/Game/Vehicles/M1A2/BP_M1A2.BP_M1A2_C" },
      { name: "T-72B3 (RU)", path: "/Game/Vehicles/T72/BP_T72.BP_T72_C" },
      { name: "Challenger 2 (UK)", path: "/Game/Vehicles/Challenger2/BP_Challenger2.BP_Challenger2_C" },
      { name: "Leopard 2A6 (GER)", path: "/Game/Vehicles/Leopard2A6/BP_Leopard2A6.BP_Leopard2A6_C" },
      { name: "M1A1 SA (AUS)", path: "/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1_C" },
      { name: "ZTZ-99A (CN)", path: "/Game/Vehicles/ZTZ99A/BP_ZTZ99A.BP_ZTZ99A_C" },
    ],
  },
  ifvs: {
    label: "IFVs",
    items: [
      { name: "M2A3 Bradley (US)", path: "/Game/Vehicles/M2A3Bradley/BP_M2A3Bradley.BP_M2A3Bradley_C" },
      { name: "BMP-3 (RU)", path: "/Game/Vehicles/BMP3/BP_BMP3.BP_BMP3_C" },
      { name: "FV510 Warrior (UK)", path: "/Game/Vehicles/FV510/BP_FV510_UA.BP_FV510_UA_C" },
      { name: "ZBD-04A (CN)", path: "/Game/Vehicles/ZBD04A/BP_ZBD04A.BP_ZBD04A_C" },
    ],
  },
  apcs: {
    label: "APCs",
    items: [
      { name: "BTR-82A (RU)", path: "/Game/Vehicles/BTR82/BP_BTR82A.BP_BTR82A_C" },
      { name: "Stryker (US)", path: "/Game/Vehicles/Stryker/BP_Stryker.BP_Stryker_C" },
      { name: "Coyote (CAN)", path: "/Game/Vehicles/Coyote/BP_Coyote.BP_Coyote_C" },
      { name: "ZBL-08 (CN)", path: "/Game/Vehicles/ZBL08/BP_ZBL08.BP_ZBL08_C" },
    ],
  },
  helis: {
    label: "Helis",
    items: [
      { name: "UH-60M Blackhawk (US)", path: "/Game/Vehicles/UH60/BP_UH60.BP_UH60_C" },
      { name: "Mi-8 Hip (RU)", path: "/Game/Vehicles/Mi8/BP_Mi8.BP_Mi8_C" },
      { name: "Z-9G (CN)", path: "/Game/Vehicles/Z9/BP_Z9_China.BP_Z9_China_C" },
    ],
  },
  trucks: {
    label: "Trucks",
    items: [
      { name: "M939 Transport (US)", path: "/Game/Vehicles/M939/BP_M939_Transport.BP_M939_Transport_C" },
      { name: "Kamaz Transport (RU)", path: "/Game/Vehicles/Kamaz/BP_Kamaz_Transport.BP_Kamaz_Transport_C" },
      { name: "SX2190 Transport (CN)", path: "/Game/Vehicles/SX2190/BP_SX2190_Transport.BP_SX2190_Transport_C" },
    ],
  },
} as const;

const auth = useAuthStore();
const ui = useUiStore();
const playerStore = usePlayerStore();
const bzssCore = useBzssCoreStore();
const rootEl = ref<HTMLElement | null>(null);
const menuOpen = ref(false);
const dialogOpen = ref(false);
const dialogMode = ref<DialogMode>("weather");
const busy = ref(false);
const coreVariableBusy = ref(false);
const managedCoreVariables: Array<{ key: BzssCoreBoolKey; label: string }> = [
  { key: "LocalVOIPEnable", label: "Local VOIP" },
  { key: "OutputBZSSObj", label: "OutputBZSSObj" },
  { key: "CheckingNoob", label: "CheckingNoob" },
];
const selectedWeather = ref(10);
const weatherParameter = ref("10");
const forbRessTeamId = ref<"1" | "2" | "both">("1");
const forbRessEnabled = ref<"0" | "1">("1");
const forbRessAmmo = ref("0");
const forbRessConstruction = ref("0");
const forbRessRate = ref("0");
const automaticHealEnabled = ref<"0" | "1">("1");
const automaticHealValue = ref("0");
const timeParameter = ref("");
const rawCommand = ref("");

// Vehicle spawning states
const targetPlayer = ref("");
const isCustomPlayer = ref(false);
const vehicleAssetPath = ref("");
const vehicleTeamId = ref<"0" | "1" | "2">("0");
const batchSpawnCount = ref(1);
const activeTab = ref<keyof typeof vehicleCategories | "favorites">("tanks");
const favoriteVehicles = ref<VehiclePreset[]>([]);

// Progress tracking states
const isBatchSpawning = ref(false);
const batchSpawningProgress = ref(0);
const batchSpawningTotal = ref(0);
const batchSpawningLogs = ref<string[]>([]);

const userPermissions = computed(() => auth.user?.permissions ?? []);
const canUse = computed(() => Boolean(auth.user?.isSuperAdmin || hasPermission(userPermissions.value, "bzss_core.use")));
const dialogTitleId = computed(() => `bzss-core-${dialogMode.value}-title`);
const dialogTitle = computed(() => {
  if (dialogMode.value === "weather") return "Set Weather";
  if (dialogMode.value === "forb-ress") return "FOB Resource Regeneration";
  if (dialogMode.value === "automatic-heal") return "Automatic Heal";
  if (dialogMode.value === "time") return "Set Time";
  if (dialogMode.value === "vehicle") return "Spawn Vehicle";
  return "Raw Command";
});
const dialogSubtitle = computed(() => {
  if (dialogMode.value === "weather") return "Pick a weather keyword and set the transition value.";
  if (dialogMode.value === "forb-ress") return "Set FOB resource regeneration: Team ID, enabled, ammo, construction, total rate.";
  if (dialogMode.value === "automatic-heal") return "Enable automatic healing and set its value.";
  if (dialogMode.value === "time") return "Final format: SetTime:XXXX";
  if (dialogMode.value === "vehicle") return "Select target player, input asset path or choose from shortcuts.";
  return "Everything except the paths is sent as raw text.";
});
const weatherPreview = computed(() => `SetWeather:${selectedWeather.value},${weatherParameter.value || "10"}`);
const forbRessPreview = computed(() => {
  const build = (teamId: string) => `SetFobResourceRegeneration:${teamId},${forbRessEnabled.value},${forbRessAmmo.value || "0"},${forbRessConstruction.value || "0"},${forbRessRate.value || "0"}`;
  return forbRessTeamId.value === "both" ? `${build("1")}\\n${build("2")}` : build(forbRessTeamId.value);
});
const automaticHealPreview = computed(() => `SetAutomaticHeal:${automaticHealEnabled.value}\nSetAutomaticHealValue:${automaticHealValue.value || "0"}`);
const timePreview = computed(() => `SetTime:${timeParameter.value || "XXXX"}`);
const rawPreview = computed(() => rawCommand.value || "Enter a full raw command");
const vehiclePreview = computed(() => {
  const p = targetPlayer.value || "Player";
  const path = vehicleAssetPath.value || "AssetPath";
  return `CreateVehicle:${p},${path},${vehicleTeamId.value}`;
});

const onlinePlayersList = computed(() => {
  const list = playerStore.active.map((p) => {
    const cleanName = stripPlayerNamePrefix(p.name);
    const isMe = normalizeSteam64(p.steamID ?? p.steamId ?? p.steam64) === normalizeSteam64(auth.user?.steam64);
    return {
      name: cleanName,
      label: isMe ? `${cleanName} (You)` : cleanName,
    };
  });
  return list.sort((a, b) => a.name.localeCompare(b.name));
});

const isCurrentPathFavorite = computed(() => {
  const path = vehicleAssetPath.value.trim();
  if (!path) return false;
  return favoriteVehicles.value.some((item) => item.path === path);
});

function normalizeSteam64(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{17}$/.test(text) ? text : "";
}

function stripPlayerNamePrefix(value: unknown) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  const parts = text.split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? text;
}

function loadFavorites() {
  try {
    const raw = localStorage.getItem("bzss_core_favorite_vehicles");
    favoriteVehicles.value = raw ? JSON.parse(raw) : [];
  } catch {
    favoriteVehicles.value = [];
  }
}

function saveFavorites() {
  localStorage.setItem("bzss_core_favorite_vehicles", JSON.stringify(favoriteVehicles.value));
}

function toggleFavorite() {
  const path = vehicleAssetPath.value.trim();
  if (!path) return;
  const index = favoriteVehicles.value.findIndex((item) => item.path === path);
  if (index >= 0) {
    favoriteVehicles.value.splice(index, 1);
  } else {
    const parts = path.split("/");
    let last = parts[parts.length - 1] || "Vehicle";
    if (last.includes(".")) {
      last = last.split(".")[0];
    }
    if (last.startsWith("BP_")) {
      last = last.slice(3);
    }
    favoriteVehicles.value.push({ name: last, path });
  }
  saveFavorites();
}

function toggleCustomPlayer() {
  isCustomPlayer.value = !isCustomPlayer.value;
  if (!isCustomPlayer.value) {
    const steam64 = normalizeSteam64(auth.user?.steam64);
    const matched = steam64 ? playerStore.active.find((item) => normalizeSteam64(item?.steamID ?? item?.steamId ?? item?.steam64) === steam64) : null;
    if (matched) {
      targetPlayer.value = stripPlayerNamePrefix(matched.name);
    } else if (playerStore.active.length > 0) {
      targetPlayer.value = stripPlayerNamePrefix(playerStore.active[0].name);
    } else {
      targetPlayer.value = "";
    }
  } else {
    targetPlayer.value = "";
  }
}

// Initial Favorites Load
loadFavorites();

function addWindowListeners() {
  window.addEventListener("pointerdown", onWindowPointerDown);
  window.addEventListener("keydown", onWindowKeyDown);
}

function removeWindowListeners() {
  window.removeEventListener("pointerdown", onWindowPointerDown);
  window.removeEventListener("keydown", onWindowKeyDown);
}

function toggleMenu() {
  if (!canUse.value) {
    ui.pushToast({
      title: t("common.error"),
      message: "BZSS-Core permission is required.",
      tone: "error",
    });
    return;
  }

  menuOpen.value = !menuOpen.value;
  if (menuOpen.value) void bzssCore.refreshVariables();
  if (menuOpen.value || dialogOpen.value) addWindowListeners();
  else removeWindowListeners();
}

function closeMenu() {
  menuOpen.value = false;
  if (!dialogOpen.value) removeWindowListeners();
}

function openSuperWeather() {
  closeMenu();
  window.dispatchEvent(new CustomEvent("bzss:super-weather-open"));
}

function onWindowPointerDown(event: PointerEvent) {
  const target = event.target as Node | null;
  if (!target) return;
  if (!menuOpen.value) return;
  if (rootEl.value?.contains(target)) return;
  closeMenu();
}

function onWindowKeyDown(event: KeyboardEvent) {
  if (isInputElement(event.target)) return;
  if (event.key !== "Escape") return;
  if (dialogOpen.value) closeDialog();
  else closeMenu();
}

function openDialog(mode: DialogMode) {
  closeMenu();
  dialogMode.value = mode;
  dialogOpen.value = true;
  addWindowListeners();

  if (mode === "weather") {
    selectedWeather.value = 10;
    weatherParameter.value = "10";
  } else if (mode === "forb-ress") {
    forbRessTeamId.value = "1";
    forbRessEnabled.value = "1";
    forbRessAmmo.value = "0";
    forbRessConstruction.value = "0";
    forbRessRate.value = "0";
  } else if (mode === "automatic-heal") {
    automaticHealEnabled.value = "1";
    automaticHealValue.value = "0";
  } else if (mode === "time") {
    timeParameter.value = "";
  } else if (mode === "raw") {
    rawCommand.value = "";
  } else if (mode === "vehicle") {
    vehicleAssetPath.value = "";
    vehicleTeamId.value = "0";
    batchSpawnCount.value = 1;
    isBatchSpawning.value = false;
    batchSpawningProgress.value = 0;
    batchSpawningTotal.value = 0;
    batchSpawningLogs.value = [];
    
    const steam64 = normalizeSteam64(auth.user?.steam64);
    const matched = steam64 ? playerStore.active.find((item) => normalizeSteam64(item?.steamID ?? item?.steamId ?? item?.steam64) === steam64) : null;
    
    if (matched) {
      targetPlayer.value = stripPlayerNamePrefix(matched.name);
      isCustomPlayer.value = false;
    } else {
      targetPlayer.value = "";
      isCustomPlayer.value = playerStore.active.length === 0;
    }
  }
}

function closeDialog() {
  dialogOpen.value = false;
  if (!menuOpen.value) removeWindowListeners();
}

async function submitWeatherCommand() {
  await executeCommand({
    directive: "SetWeather",
    parameter: `${selectedWeather.value},${weatherParameter.value.trim() || "10"}`,
  });
}

async function submitForbRessCommand() {
  if (busy.value) return;

  const teams = forbRessTeamId.value === "both"
    ? ["1", "2"]
    : [forbRessTeamId.value];

  const suffix = [
    forbRessEnabled.value,
    String(forbRessAmmo.value ?? "").trim() || "0",
    String(forbRessConstruction.value ?? "").trim() || "0",
    String(forbRessRate.value ?? "").trim() || "0",
  ];

  busy.value = true;
  try {
    const results = await Promise.all(
      teams.map((teamId) =>
        executeBzssCoreCommand({
          directive: "SetFobResourceRegeneration",
          parameter: [teamId, ...suffix].join(","),
        }),
      ),
    );

    const failed = results.find((result) => !result.ok);
    if (failed) {
      const details = [failed.message, failed.stdout, failed.stderr]
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
        .join(" / ");
      throw new Error(details || "SetFobResourceRegeneration failed.");
    }

    ui.pushToast({
      title: "FOB resource regeneration updated",
      message: teams.length === 2 ? "Applied to Team 1 and Team 2." : "Applied to Team " + teams[0] + ".",
      tone: "ok",
    });
    closeDialog();
  } catch (error: any) {
    ui.pushToast({
      title: t("common.error"),
      message: error?.message || "FOB resource regeneration failed.",
      tone: "error",
      durationMs: 7000,
    });
  } finally {
    busy.value = false;
  }
}

function coreVariableLabel(key: BzssCoreBoolKey) {
  const state = bzssCore.variableStates[key];
  if (state.pending) return state.desired ? "尝试启用" : "尝试关闭";
  if (state.error) return "错误";
  if (state.actual === true) return "已启用";
  if (state.actual === false) return "未启用";
  return "未知";
}

async function setCoreVariable(key: BzssCoreBoolKey, value: boolean) {
  if (coreVariableBusy.value) return;
  coreVariableBusy.value = true;
  try {
    await bzssCore.setVariable(key, value);
    ui.pushToast({
      title: key,
      message: value ? "启用值已写入，等待 Core 回读确认。" : "关闭值已写入，等待 Core 回读确认。",
      tone: "ok",
      durationMs: 4200,
    });
    closeMenu();
  } catch (error: any) {
    ui.pushToast({
      title: t("common.error"),
      message: error?.message || `${key} 写入失败。`,
      tone: "error",
      durationMs: 7000,
    });
  } finally {
    coreVariableBusy.value = false;
  }
}

async function submitAutomaticHealCommands() {
  if (busy.value) return;
  busy.value = true;
  try {
    const enabledResult = await executeBzssCoreCommand({
      directive: "SetAutomaticHeal",
      parameter: automaticHealEnabled.value,
    });
    if (!enabledResult.ok) throw new Error(enabledResult.message || "SetAutomaticHeal failed.");

    const valueResult = await executeBzssCoreCommand({
      directive: "SetAutomaticHealValue",
      parameter: String(automaticHealValue.value ?? "").trim() || "0",
    });
    if (!valueResult.ok) throw new Error(valueResult.message || "SetAutomaticHealValue failed.");

    ui.pushToast({
      title: "Automatic Heal updated",
      message: automaticHealPreview.value,
      tone: "ok",
    });
    closeDialog();
  } catch (error: any) {
    ui.pushToast({
      title: t("common.error"),
      message: error?.message || "Automatic Heal update failed.",
      tone: "error",
    });
  } finally {
    busy.value = false;
  }
}

async function submitTimeCommand() {
  const parameter = timeParameter.value.trim();
  if (!parameter) return;
  await executeCommand({
    directive: "SetTime",
    parameter,
  });
}

async function submitVehicleCommand() {
  const path = vehicleAssetPath.value.trim();
  const player = targetPlayer.value.trim();
  if (!path || !player) return;
  const parameter = `${player},${path},${vehicleTeamId.value}`;

  const count = Math.max(1, Math.min(10, Number(batchSpawnCount.value) || 1));
  
  if (count === 1) {
    await executeCommand({
      directive: "CreateVehicle",
      parameter,
      keepOpen: true,
    });
    return;
  }

  if (busy.value || isBatchSpawning.value) return;
  busy.value = true;
  isBatchSpawning.value = true;
  batchSpawningProgress.value = 0;
  batchSpawningTotal.value = count;
  batchSpawningLogs.value = [];

  try {
    for (let i = 0; i < count; i++) {
      batchSpawningProgress.value = i + 1;
      
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const result = await executeBzssCoreCommand({
        directive: "CreateVehicle",
        parameter,
      });

      if (result.ok) {
        batchSpawningLogs.value.push(`[Success] Vehicle #${i + 1} spawned.`);
      } else {
        batchSpawningLogs.value.push(`[Failed] Vehicle #${i + 1}: ${result.message || "Unknown error"}`);
      }
    }

    ui.pushToast({
      title: "Batch Spawning Finished",
      message: `Completed sequential spawning of ${count} vehicles.`,
      tone: "ok",
    });
  } catch (error: any) {
    ui.pushToast({
      title: "Batch Spawning Error",
      message: error?.message || "Sequential spawning failed.",
      tone: "error",
    });
  } finally {
    busy.value = false;
    isBatchSpawning.value = false;
  }
}

async function submitRawCommand() {
  const command = rawCommand.value.trim();
  if (!command) return;
  await executeCommand({
    command,
    raw: true,
  });
}

async function executeCommand(payload: { directive?: string; parameter?: string; command?: string; raw?: boolean; keepOpen?: boolean }) {
  if (busy.value) return;
  busy.value = true;
  try {
    const result = await executeBzssCoreCommand(payload);
    const output = [result.stdout, result.stderr]
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .join(" / ");

    ui.pushToast({
      title: result.ok ? "Executed" : t("common.error"),
      message: result.ok
        ? `${result.command} completed.${output ? ` ${output}` : ""}`
        : result.message || "BZSS-Core command failed.",
      tone: result.ok ? "ok" : "error",
      durationMs: 4200,
    });

    if (result.ok && !payload.keepOpen) closeDialog();
  } catch (error: any) {
    ui.pushToast({
      title: t("common.error"),
      message: error?.message || "BZSS-Core command failed.",
      tone: "error",
    });
  } finally {
    busy.value = false;
  }
}

onBeforeUnmount(() => {
  removeWindowListeners();
});
</script>

<style scoped>
.bzss-core {
  position: relative;
  flex: 0 0 auto;
}

.bzss-core-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(122, 162, 184, 0.28);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.018)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 700;
  box-shadow: var(--shadow-sm);
}

.bzss-core-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #38bdf8;
  box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.12);
}

.bzss-core-caret {
  color: var(--color-text-muted);
  font-size: 10px;
}

.bzss-core-menu {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: var(--z-user-dropdown);
  width: 180px;
  display: grid;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--color-border-default);
  border-radius: 14px;
  background: var(--color-bg-card);
  box-shadow: var(--shadow-lg);
}

.core-variable-controls {
  margin: 4px 8px;
  padding: 6px 0;
  border-top: 1px solid var(--color-border-default);
}
.core-variable-row {
  display: grid;
  gap: 4px;
  padding: 5px 0;
  color: var(--color-text-secondary);
  font-size: 11px;
}
.core-variable-actions {
  display: flex;
  gap: 4px;
}
.core-variable-actions button {
  flex: 1;
  min-height: 24px;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  cursor: pointer;
}
.core-variable-actions button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.bzss-core-item {
  width: 100%;
  min-height: 38px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-primary);
  text-align: left;
}

.bzss-core-item:hover {
  border-color: var(--color-border-default);
  background: var(--color-bg-hover);
}

.bzss-core-overlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-user-dropdown) + 30);
  display: grid;
  place-items: center;
  padding: 20px;
  background: var(--theme-overlay-scrim);
  backdrop-filter: blur(8px);
}

.bzss-core-dialog {
  width: min(560px, calc(100vw - 28px));
  overflow: hidden;
  border: 1px solid var(--color-border-default);
  border-radius: 18px;
  background:
    var(--theme-panel-highlight),
    var(--color-bg-card);
  box-shadow: var(--shadow-lg), var(--theme-panel-glow);
}

.bzss-core-dialog-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--color-border-soft);
}

.bzss-core-kicker {
  margin: 0 0 6px;
  color: #8fd3ff;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.bzss-core-dialog h2 {
  margin: 0;
  font-size: 20px;
  line-height: 1.2;
}

.bzss-core-subtitle {
  margin: 8px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.45;
}

.bzss-core-close {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  padding: 0;
}

.bzss-core-form {
  display: grid;
  gap: 14px;
  padding: 18px 22px 22px;
}

.bzss-core-field {
  display: grid;
  gap: 8px;
}

.bzss-core-field span {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.bzss-core-field input,
.bzss-core-select,
.bzss-core-textarea {
  width: 100%;
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  padding: 10px 12px;
  font: inherit;
}

.bzss-core-field input,
.bzss-core-select {
  min-height: 42px;
}

.bzss-core-textarea {
  min-height: 96px;
  resize: vertical;
}

.bzss-core-preview,
.bzss-core-example-list {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
}

.bzss-core-preview span,
.bzss-core-example-list span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.bzss-core-preview code,
.bzss-core-example-list code {
  color: #d7f3ff;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
}

.bzss-core-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 2px;
}

.bzss-core-secondary,
.bzss-core-primary {
  min-width: 86px;
}

.bzss-core-primary {
  border-color: rgba(56, 189, 248, 0.35);
  background: rgba(56, 189, 248, 0.14);
  color: #d7f3ff;
}

.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.bzss-core-player-input-group,
.bzss-core-input-with-action {
  display: flex;
  gap: 8px;
  align-items: center;
}

.bzss-core-player-input-group input,
.bzss-core-player-input-group select,
.bzss-core-input-with-action input {
  flex: 1;
}

.bzss-core-toggle-player-btn,
.bzss-core-favorite-btn {
  min-height: 42px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.2s ease;
}

.bzss-core-toggle-player-btn:hover,
.bzss-core-favorite-btn:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-hover);
  color: var(--color-text-primary);
}

.bzss-core-favorite-btn.is-active {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.1);
}

.bzss-core-shortcuts-section {
  display: grid;
  gap: 10px;
  margin-top: 4px;
}

.bzss-core-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--color-border-soft);
  padding-bottom: 6px;
  overflow-x: auto;
}

.bzss-core-tab-btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.bzss-core-tab-btn:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.bzss-core-tab-btn.is-active {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.1);
}

.bzss-core-shortcuts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
  max-height: 140px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.15);
}

.bzss-core-shortcut-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.bzss-core-shortcut-item:hover {
  border-color: rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.08);
}

.bzss-core-shortcut-name {
  font-size: 11px;
  font-weight: 700;
}

.bzss-core-shortcut-path {
  font-size: 9px;
  color: var(--color-text-muted);
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

.bzss-core-no-favorites {
  grid-column: 1 / -1;
  text-align: center;
  padding: 24px 12px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.bzss-core-progress-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 10px;
  background: rgba(56, 189, 248, 0.05);
  border: 1px solid rgba(56, 189, 248, 0.15);
}

.bzss-core-progress-header {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
  color: #38bdf8;
}

.bzss-core-progress-bar-bg {
  height: 6px;
  width: 100%;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 99px;
  overflow: hidden;
}

.bzss-core-progress-bar-fill {
  height: 100%;
  background: #38bdf8;
  border-radius: 99px;
  transition: width 0.2s ease;
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.5);
}

.bzss-core-progress-logs {
  font-family: Consolas, Monaco, monospace;
  font-size: 10px;
  color: var(--color-text-secondary);
  max-height: 80px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

@media (max-width: 780px) {
  .bzss-core-trigger {
    min-height: 34px;
  }
}



/* BZSS-Core control surface refresh */
.bzss-core {
  position: relative;
  z-index: 20;
}

.bzss-core-trigger {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid rgba(72, 198, 255, 0.28);
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(16, 31, 43, 0.96), rgba(10, 17, 25, 0.96));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2), inset 0 1px rgba(255, 255, 255, 0.08);
  color: #e8f7ff;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.bzss-core-menu {
  min-width: 250px;
  padding: 8px;
  border: 1px solid rgba(92, 188, 235, 0.26);
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(18, 29, 39, 0.98), rgba(8, 14, 20, 0.98));
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42), inset 0 1px rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(18px);
}

.bzss-core-item {
  min-height: 42px;
  padding: 0 13px;
  border-radius: 10px;
  color: #c8d8e3;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
}

.bzss-core-item:hover {
  background: rgba(44, 170, 221, 0.14);
  color: #f2fbff;
  transform: translateX(2px);
}

.bzss-core-dialog {
  width: min(620px, calc(100vw - 28px));
  max-height: min(860px, calc(100vh - 28px));
  overflow: auto;
  border: 1px solid rgba(89, 192, 239, 0.3);
  border-radius: 22px;
  background:
    radial-gradient(circle at 100% 0%, rgba(22, 160, 214, 0.13), transparent 36%),
    linear-gradient(145deg, rgba(20, 31, 41, 0.98), rgba(8, 14, 20, 0.99));
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.58), inset 0 1px rgba(255, 255, 255, 0.09);
  backdrop-filter: blur(22px);
}

.bzss-core-dialog-head {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 22px 24px 18px;
  border-bottom: 1px solid rgba(157, 207, 229, 0.12);
  background: rgba(12, 21, 29, 0.86);
  backdrop-filter: blur(18px);
}

.bzss-core-kicker {
  margin-bottom: 7px;
  color: #54d4ff;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.bzss-core-dialog-head h2 {
  margin: 0;
  color: #f3fbff;
  font-size: clamp(20px, 3vw, 28px);
  letter-spacing: -0.025em;
}

.bzss-core-subtitle {
  max-width: 520px;
  margin-top: 8px;
  color: #94a9b7;
  line-height: 1.5;
}

.bzss-core-form {
  gap: 16px;
  padding: 22px 24px 24px;
}

.bzss-core-field input,
.bzss-core-select,
.bzss-core-textarea {
  min-height: 44px;
  border-color: rgba(137, 190, 213, 0.18);
  border-radius: 11px;
  background: rgba(4, 10, 15, 0.72);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.bzss-core-field input:focus,
.bzss-core-select:focus,
.bzss-core-textarea:focus {
  border-color: rgba(74, 204, 255, 0.72);
  box-shadow: 0 0 0 3px rgba(42, 176, 226, 0.14);
  outline: none;
}

.bzss-core-preview {
  gap: 9px;
  border-color: rgba(74, 204, 255, 0.2);
  background: linear-gradient(135deg, rgba(42, 159, 207, 0.1), rgba(4, 11, 16, 0.5));
}

.bzss-core-preview code {
  display: block;
  padding: 9px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.24);
  color: #7fe2ff;
}

.bzss-core-actions {
  padding-top: 4px;
}

.bzss-core-primary,
.bzss-core-secondary {
  min-height: 40px;
  border-radius: 10px;
  padding: 0 18px;
  font-weight: 700;
}

@media (max-width: 620px) {
  .bzss-core-dialog-head,
  .bzss-core-form {
    padding-left: 16px;
    padding-right: 16px;
  }

  .bzss-core-dialog {
    border-radius: 16px;
  }
}
</style>
