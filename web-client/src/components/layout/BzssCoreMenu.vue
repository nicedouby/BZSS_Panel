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
        <button type="button" class="bzss-core-item" role="menuitem" @click="openDialog('time')">
          Time
        </button>
        <button type="button" class="bzss-core-item" role="menuitem" @click="openDialog('raw')">
          Raw Command
        </button>
      </div>
    </transition>

    <teleport to="body">
      <transition name="menu-fade">
        <div v-if="dialogOpen" class="bzss-core-overlay" @click.self="closeDialog">
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
                  <option v-for="option in weatherOptions" :key="option" :value="option">
                    {{ option }}
                  </option>
                </select>
              </label>

              <label class="bzss-core-field">
                <span>Transition value</span>
                <input
                  v-model.trim="weatherTransitionValue"
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

            <form v-else class="bzss-core-form" @submit.prevent="submitRawCommand">
              <label class="bzss-core-field">
                <span>Raw command</span>
                <textarea
                  v-model.trim="rawCommand"
                  class="bzss-core-textarea"
                  rows="4"
                  placeholder="CreateVehicle:Donald.DoubyBear,/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1_C"
                ></textarea>
              </label>

              <div class="bzss-core-example-list">
                <span>Examples</span>
                <code>CreateVehicle:PlayerName,/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1_C</code>
                <code>AdminTrack:AdminName,TrackObject</code>
                <code>RemoveAdminTrack:AdminName</code>
                <code>TransitionWeather:SnowHeavy,10</code>
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
import { executeBzssCoreCommand } from "../../app/bzssCoreApi";
import { t } from "../../i18n";
import { useAuthStore } from "../../stores/auth.store";
import { useUiStore } from "../../stores/ui.store";
import { hasPermission } from "../../shared/rcon-permissions.js";

type DialogMode = "weather" | "time" | "raw";

const weatherOptions = [
  "ClearSkies",
  "Cloudy",
  "Foggy",
  "Overcast",
  "PartlyCloudy",
  "Rain",
  "RainLight",
  "RainHeavy",
  "SandDust",
  "SandDustHeavy",
  "Snow",
  "SnowHeavy",
  "SnowLight",
] as const;

const auth = useAuthStore();
const ui = useUiStore();
const rootEl = ref<HTMLElement | null>(null);
const menuOpen = ref(false);
const dialogOpen = ref(false);
const dialogMode = ref<DialogMode>("weather");
const busy = ref(false);
const selectedWeather = ref<(typeof weatherOptions)[number]>("SnowHeavy");
const weatherTransitionValue = ref("10");
const timeParameter = ref("");
const rawCommand = ref("");

const userPermissions = computed(() => auth.user?.permissions ?? []);
const canUse = computed(() => Boolean(auth.user?.isSuperAdmin || hasPermission(userPermissions.value, "bzss_core.use")));
const dialogTitleId = computed(() => `bzss-core-${dialogMode.value}-title`);
const dialogTitle = computed(() => {
  if (dialogMode.value === "weather") return "Set Weather";
  if (dialogMode.value === "time") return "Set Time";
  return "Raw Command";
});
const dialogSubtitle = computed(() => {
  if (dialogMode.value === "weather") return "Pick a weather keyword and set the transition value.";
  if (dialogMode.value === "time") return "Final format: SetTime:XXXX";
  return "Everything except the paths is sent as raw text.";
});
const weatherPreview = computed(() => `TransitionWeather:${selectedWeather.value},${weatherTransitionValue.value || "10"}`);
const timePreview = computed(() => `SetTime:${timeParameter.value || "XXXX"}`);
const rawPreview = computed(() => rawCommand.value || "Enter a full raw command");

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
  if (menuOpen.value || dialogOpen.value) addWindowListeners();
  else removeWindowListeners();
}

function closeMenu() {
  menuOpen.value = false;
  if (!dialogOpen.value) removeWindowListeners();
}

function onWindowPointerDown(event: PointerEvent) {
  const target = event.target as Node | null;
  if (!target) return;
  if (!menuOpen.value) return;
  if (rootEl.value?.contains(target)) return;
  closeMenu();
}

function onWindowKeyDown(event: KeyboardEvent) {
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
    selectedWeather.value = "SnowHeavy";
    weatherTransitionValue.value = "10";
  } else if (mode === "time") {
    timeParameter.value = "";
  } else if (mode === "raw") {
    rawCommand.value = "";
  }
}

function closeDialog() {
  dialogOpen.value = false;
  if (!menuOpen.value) removeWindowListeners();
}

async function submitWeatherCommand() {
  await executeCommand({
    directive: "TransitionWeather",
    parameter: `${selectedWeather.value},${weatherTransitionValue.value.trim() || "10"}`,
  });
}

async function submitTimeCommand() {
  const parameter = timeParameter.value.trim();
  if (!parameter) return;
  await executeCommand({
    directive: "SetTime",
    parameter,
  });
}

async function submitRawCommand() {
  const command = rawCommand.value.trim();
  if (!command) return;
  await executeCommand({
    command,
    raw: true,
  });
}

async function executeCommand(payload: { directive?: string; parameter?: string; command?: string; raw?: boolean }) {
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

    if (result.ok) closeDialog();
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

@media (max-width: 780px) {
  .bzss-core-trigger {
    min-height: 34px;
  }
}
</style>
