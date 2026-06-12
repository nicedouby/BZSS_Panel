<template>
  <div ref="rootEl" class="user-menu">
    <button type="button" class="user-trigger" @click.stop="toggleMenu">
      <img v-if="avatarUrl" class="user-avatar-image" :src="avatarUrl" alt="" referrerpolicy="no-referrer" />
      <span v-else class="user-avatar">{{ avatarLabel }}</span>
      <span class="user-copy">
        <strong>{{ usernameLabel }}</strong>
        <small>{{ roleLabel }}</small>
      </span>
      <span class="user-caret" aria-hidden="true">▾</span>
    </button>

    <transition name="menu-fade">
      <div v-if="menuOpen" class="user-dropdown" role="menu">
        <div class="user-meta">
          <strong>{{ usernameLabel }}</strong>
          <span>{{ roleLabel }}</span>
        </div>

        <button type="button" class="menu-item" role="menuitem" @click="openSettings">
          {{ t("user.settings") }}
        </button>
        <button v-if="canUseArbitraryRcon" type="button" class="menu-item" role="menuitem" @click="openRconModal">
          执行命令
        </button>
        <button type="button" class="menu-item" role="menuitem" @click="openPluginCenter">
          插件中心
        </button>
        <button type="button" class="menu-item" role="menuitem" @click="openRuntimeStatus">
          运行状态
        </button>
        <button v-if="canUseArbitraryRcon" type="button" class="menu-item" role="menuitem" :disabled="!canManageTankBattle" @click="openTankBattleDialog">
          开启坦克大战
        </button>
        <button type="button" class="menu-item danger" role="menuitem" @click="logout">
          {{ t("user.logout") }}
        </button>
      </div>
    </transition>
  </div>

  <teleport to="body">
    <transition name="menu-fade">
      <div v-if="tankBattleDialogOpen" class="tank-battle-overlay" @click.self="closeTankBattleDialog">
        <section class="tank-battle-dialog" role="dialog" aria-modal="true" aria-labelledby="tank-battle-title">
          <header class="tank-battle-header">
            <div>
              <p class="tank-battle-kicker">用户菜单</p>
              <h2 id="tank-battle-title">开启坦克大战</h2>
              <p class="tank-battle-subtitle">一键执行坦克大战相关命令</p>
            </div>
            <button type="button" class="tank-battle-close" @click="closeTankBattleDialog">×</button>
          </header>

          <section class="tank-battle-panel">
            <div class="tank-battle-actions">
              <button type="button" class="success-action" :disabled="tankBattleBusy || !canManageTankBattle" @click="runTankBattlePreset(true)">
                一键打开坦克大战
              </button>
              <button type="button" class="danger-action" :disabled="tankBattleBusy || !canManageTankBattle" @click="runTankBattlePreset(false)">
                一键关闭坦克大战
              </button>
            </div>

            <div class="tank-battle-toggle-row">
              <button type="button" class="ghost-action" :disabled="tankBattleBusy || !canManageTankBattle" @click="setDeployableAvailability(true)">
                开启无限工事
              </button>
              <button type="button" class="ghost-action" :disabled="tankBattleBusy || !canManageTankBattle" @click="setDeployableAvailability(false)">
                关闭无限工事
              </button>
            </div>

            <div class="tank-battle-custom">
              <div class="tank-battle-custom-header">
                <strong>自定义指令</strong>
                <span>下面 6 个选项可单独打开或者关闭</span>
              </div>

              <div class="tank-battle-option-list">
                <div v-for="option in tankBattleOptions" :key="option.label" class="tank-battle-option-row">
                  <div class="tank-battle-option-copy">
                    <strong>{{ option.label }}</strong>
                    <span>{{ option.description }}</span>
                  </div>

                  <div class="tank-battle-option-actions">
                    <button
                      type="button"
                      class="success-action"
                      :disabled="tankBattleBusy || !canManageTankBattle"
                      @click="runTankBattleCommand(`开启${option.label}`, option.openCommand, `已开启${option.label}。`)"
                    >
                      开启
                    </button>
                    <button
                      type="button"
                      class="danger-action"
                      :disabled="tankBattleBusy || !canManageTankBattle"
                      @click="runTankBattleCommand(`关闭${option.label}`, option.closeCommand, `已关闭${option.label}。`)"
                    >
                      关闭
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </section>
      </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore } from "../../stores/settings.store";
import { apiGet, apiPost } from "../../app/apiClient";
import { useUiStore } from "../../stores/ui.store";
import { t } from "../../i18n";
import { canSendRconCommand } from "../../shared/rcon-permissions.js";

const emit = defineEmits<{
  (event: "open-plugin-center"): void;
  (event: "open-rcon-modal"): void;
}>();

const auth = useAuthStore();
const settings = useSettingsStore();
const ui = useUiStore();
const router = useRouter();

const menuOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const tankBattleDialogOpen = ref(false);
const tankBattleBusy = ref(false);
const deployableAvailability = ref<boolean | null>(null);

const tankBattleOptions = [
  {
    label: "无重生计时",
    description: "AdminNoRespawnTimer",
    openCommand: "AdminNoRespawnTimer 1",
    closeCommand: "AdminNoRespawnTimer 0",
  },
  {
    label: "全部载具可用",
    description: "AdminForceAllVehicleAvailability",
    openCommand: "AdminForceAllVehicleAvailability 1",
    closeCommand: "AdminForceAllVehicleAvailability 0",
  },
  {
    label: "全部兵种可用",
    description: "AdminForceAllRoleAvailability",
    openCommand: "AdminForceAllRoleAvailability 1",
    closeCommand: "AdminForceAllRoleAvailability 0",
  },
  {
    label: "禁用载具套件要求",
    description: "AdminDisableVehicleKitRequirement",
    openCommand: "AdminDisableVehicleKitRequirement 1",
    closeCommand: "AdminDisableVehicleKitRequirement 0",
  },
  {
    label: "禁用载具占用",
    description: "AdminDisableVehicleClaiming",
    openCommand: "AdminDisableVehicleClaiming 1",
    closeCommand: "AdminDisableVehicleClaiming 0",
  },
  {
    label: "无限工事",
    description: "AdminForceAllDeployableAvailability",
    openCommand: "AdminForceAllDeployableAvailability 1",
    closeCommand: "AdminForceAllDeployableAvailability 0",
  },
] as const;

const usernameLabel = computed(() => String(auth.user?.username ?? t("user.user")));
const roleLabel = computed(() => String(auth.user?.role ?? t("common.unknown")));
const canUseArbitraryRcon = computed(() => auth.user?.isSuperAdmin === true);
const canManageTankBattle = computed(() => canSendRconCommand(auth.user, "AdminForceAllVehicleAvailability 1"));
const avatarUrl = computed(() => String(auth.user?.steamAvatar ?? "").trim() || null);
const avatarLabel = computed(() => {
  const name = usernameLabel.value.trim();
  if (!name) return "?";
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
});

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
  if (menuOpen.value) {
    window.addEventListener("pointerdown", onWindowPointerDown);
    window.addEventListener("keydown", onWindowKeyDown);
  } else {
    removeWindowListeners();
  }
}

function closeMenu() {
  menuOpen.value = false;
  removeWindowListeners();
}

function onWindowPointerDown(event: PointerEvent) {
  if (!rootEl.value) return;
  if (!rootEl.value.contains(event.target as Node)) {
    closeMenu();
  }
}

function onWindowKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    closeMenu();
  }
}

function removeWindowListeners() {
  window.removeEventListener("pointerdown", onWindowPointerDown);
  window.removeEventListener("keydown", onWindowKeyDown);
}

async function openSettings() {
  closeMenu();
  settings.openDrawer();
}

function openRconModal() {
  if (!canUseArbitraryRcon.value) return;
  closeMenu();
  emit("open-rcon-modal");
}

function openPluginCenter() {
  closeMenu();
  emit("open-plugin-center");
}

function openRuntimeStatus() {
  closeMenu();
  router.push("/system/status");
}

function openTankBattleDialog() {
  closeMenu();
  if (!canUseArbitraryRcon.value || !canManageTankBattle.value) {
    ui.pushToast({ title: t("common.error"), message: "只有具备坦克大战 RCON 权限的管理员可以使用快捷操作。", tone: "error" });
    return;
  }

  tankBattleDialogOpen.value = true;
  void refreshDeployableAvailability();
}

function closeTankBattleDialog() {
  tankBattleDialogOpen.value = false;
}

async function refreshDeployableAvailability() {
  try {
    const payload = await apiGet<{ enabled?: boolean; settings?: { mapSwitchCommands?: string[] } }>("/api/auto-tank-battle/status");
    const commands = Array.isArray(payload?.settings?.mapSwitchCommands) ? payload.settings.mapSwitchCommands : [];
    deployableAvailability.value = commands.some((command) => String(command || "").trim() === "AdminForceAllDeployableAvailability 1");
  } catch {
    deployableAvailability.value = null;
  }
}

async function runTankBattlePreset(open: boolean) {
  if (tankBattleBusy.value) return;

  const commands = open
    ? [
        "AdminNoRespawnTimer 1",
        "AdminForceAllVehicleAvailability 1",
        "AdminForceAllRoleAvailability 1",
        "AdminDisableVehicleKitRequirement 1",
        "AdminDisableVehicleClaiming 1",
      ]
    : [
        "AdminNoRespawnTimer 0",
        "AdminForceAllVehicleAvailability 0",
        "AdminForceAllRoleAvailability 0",
        "AdminDisableVehicleKitRequirement 0",
        "AdminDisableVehicleClaiming 0",
      ];

  const confirmed = window.confirm(
    `确认${open ? "打开" : "关闭"}坦克大战吗？\n\n将按顺序执行以下 ${commands.length} 条命令：\n${commands.map((command, index) => `${index + 1}. ${command}`).join("\n")}`,
  );
  if (!confirmed) return;

  tankBattleBusy.value = true;
  try {
    for (const command of commands) {
      await apiPost("/api/rcon-command", { command });
    }
    ui.pushToast({ title: "已执行", message: `坦克大战已${open ? "打开" : "关闭"}。`, tone: "ok" });
    closeTankBattleDialog();
  } catch (error: any) {
    ui.pushToast({ title: t("common.error"), message: error?.message || "坦克大战执行失败。", tone: "error" });
  } finally {
    tankBattleBusy.value = false;
  }
}

async function setDeployableAvailability(next: boolean) {
  if (tankBattleBusy.value) return;

  const command = next ? "AdminForceAllDeployableAvailability 1" : "AdminForceAllDeployableAvailability 0";
  const confirmed = window.confirm(`确认${next ? "开启" : "关闭"}无限工事吗？\n\n将执行命令：${command}`);
  if (!confirmed) return;

  tankBattleBusy.value = true;
  try {
    await apiPost("/api/rcon-command", { command });
    deployableAvailability.value = next;
    ui.pushToast({ title: "已执行", message: next ? "无限工事已开启。" : "无限工事已关闭。", tone: "ok" });
  } catch (error: any) {
    ui.pushToast({ title: t("common.error"), message: error?.message || "无限工事切换失败。", tone: "error" });
  } finally {
    tankBattleBusy.value = false;
  }
}

async function runTankBattleCommand(actionLabel: string, command: string, successMessage: string) {
  if (tankBattleBusy.value) return;

  const confirmed = window.confirm(`确认${actionLabel}吗？\n\n将执行命令：${command}`);
  if (!confirmed) return;

  tankBattleBusy.value = true;
  try {
    await apiPost("/api/rcon-command", { command });
    if (command === "AdminForceAllDeployableAvailability 1") {
      deployableAvailability.value = true;
    } else if (command === "AdminForceAllDeployableAvailability 0") {
      deployableAvailability.value = false;
    }
    ui.pushToast({ title: "已执行", message: successMessage, tone: "ok" });
  } catch (error: any) {
    ui.pushToast({ title: t("common.error"), message: error?.message || "指令执行失败。", tone: "error" });
  } finally {
    tankBattleBusy.value = false;
  }
}

async function logout() {
  closeMenu();
  await auth.logout();
}

onBeforeUnmount(() => {
  removeWindowListeners();
});
</script>

<style scoped>
.user-menu {
  position: relative;
  flex: 0 0 auto;
}

.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 180px;
  padding: 8px 12px 8px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.018)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-elevated);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}

.user-trigger:hover {
  border-color: var(--color-border-highlight);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.user-avatar {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(180deg, rgba(96, 165, 250, 0.22), rgba(55, 200, 255, 0.14));
  border: 1px solid rgba(96, 165, 250, 0.24);
  color: #d7ecff;
  font-size: 12px;
  letter-spacing: 0.03em;
  flex: 0 0 auto;
}

.user-avatar-image {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid rgba(96, 165, 250, 0.24);
  flex: 0 0 auto;
}

.user-copy {
  display: grid;
  text-align: left;
  min-width: 0;
  flex: 1 1 auto;
}

.user-copy strong {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-copy small {
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-caret {
  color: var(--color-text-muted);
  font-size: 12px;
}

.user-dropdown {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: 240px;
  border: 1px solid var(--color-border-default);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.018)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(12px);
  padding: 10px;
  z-index: var(--z-user-dropdown);
  display: grid;
  gap: 8px;
}

.user-meta {
  padding: 8px 10px 10px;
  border-bottom: 1px solid var(--color-border-soft);
  display: grid;
  gap: 4px;
}

.user-meta strong {
  font-size: 14px;
  line-height: 1.25;
}

.user-meta span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.menu-item {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-primary);
  border-radius: 12px;
  padding: 10px 12px;
  box-shadow: none;
}

.menu-item:hover {
  border-color: var(--color-border-default);
  background: rgba(255, 255, 255, 0.04);
  transform: none;
}

.menu-item.danger {
  color: #ffb1b1;
}

.menu-item.danger:hover {
  border-color: rgba(248, 113, 113, 0.3);
  background: rgba(248, 113, 113, 0.1);
}

.tank-battle-overlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-user-dropdown) + 20);
  display: grid;
  place-items: center;
  padding: 20px;
  background:
    radial-gradient(circle at top, rgba(96, 165, 250, 0.18), transparent 34%),
    rgba(6, 10, 14, 0.78);
  backdrop-filter: blur(14px) saturate(1.08);
}

.tank-battle-dialog {
  width: min(720px, calc(100vw - 32px));
  border-radius: 28px;
  border: 1px solid rgba(96, 165, 250, 0.24);
  background:
    radial-gradient(circle at top left, rgba(96, 165, 250, 0.18), transparent 30%),
    radial-gradient(circle at top right, rgba(244, 114, 182, 0.08), transparent 28%),
    linear-gradient(180deg, rgba(18, 24, 34, 0.98), rgba(9, 13, 19, 0.99));
  box-shadow: 0 36px 110px rgba(0, 0, 0, 0.58);
  overflow: hidden;
}

.tank-battle-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 22px 24px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.tank-battle-kicker {
  margin: 0 0 6px;
  color: #8fbaff;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.tank-battle-header h2 {
  margin: 0;
  font-size: 24px;
  line-height: 1.1;
}

.tank-battle-subtitle {
  margin: 8px 0 0;
  color: rgba(230, 240, 255, 0.74);
  font-size: 13px;
}

.tank-battle-close {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: #f2f7ff;
  font-size: 21px;
  line-height: 1;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.tank-battle-panel {
  display: grid;
  gap: 14px;
  padding: 20px 24px 24px;
}

.tank-battle-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.success-action,
.danger-action,
.secondary-action,
.ghost-action {
  min-height: 46px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0 14px;
  font-weight: 700;
  transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.success-action {
  background: linear-gradient(180deg, rgba(34, 197, 94, 0.28), rgba(22, 163, 74, 0.18));
  color: #effff3;
  border-color: rgba(34, 197, 94, 0.42);
  box-shadow: 0 12px 30px rgba(34, 197, 94, 0.12);
}

.ghost-action {
  background: rgba(255, 255, 255, 0.035);
  color: #edf4ff;
}

.danger-action {
  background: linear-gradient(180deg, rgba(239, 68, 68, 0.28), rgba(185, 28, 28, 0.18));
  color: #fff1f1;
  border-color: rgba(239, 68, 68, 0.42);
  box-shadow: 0 12px 30px rgba(239, 68, 68, 0.12);
}

.secondary-action {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03));
  color: #edf4ff;
}

.success-action:hover,
.danger-action:hover,
.secondary-action:hover,
.ghost-action:hover {
  transform: translateY(-1px);
  border-color: rgba(255, 255, 255, 0.16);
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.18);
}

.tank-battle-toggle-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: center;
  gap: 12px;
  padding: 15px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02));
}

.tank-battle-custom {
  display: grid;
  gap: 12px;
  padding: 15px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02));
}

.tank-battle-custom-header {
  display: grid;
  gap: 4px;
}

.tank-battle-custom-header strong {
  font-size: 14px;
  color: #f4f8ff;
}

.tank-battle-custom-header span {
  color: rgba(230, 240, 255, 0.72);
  font-size: 13px;
}

.tank-battle-option-list {
  display: grid;
  gap: 10px;
}

.tank-battle-option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 13px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.025)),
    rgba(255, 255, 255, 0.02);
}

.tank-battle-option-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.tank-battle-option-copy strong {
  font-size: 13px;
  color: #f4f8ff;
}

.tank-battle-option-copy span {
  color: rgba(230, 240, 255, 0.68);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tank-battle-option-actions {
  display: inline-flex;
  gap: 8px;
  flex: 0 0 auto;
}

@media (max-width: 720px) {
  .tank-battle-dialog {
    width: min(100vw - 24px, 720px);
  }

  .tank-battle-toggle-row {
    grid-template-columns: 1fr;
  }

  .tank-battle-option-row {
    flex-direction: column;
    align-items: stretch;
  }

  .tank-battle-option-actions {
    width: 100%;
  }

  .tank-battle-option-actions .ghost-action {
    flex: 1 1 0;
  }
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
  .user-trigger {
    min-width: 0;
  }

  .user-copy {
    display: none;
  }
}
</style>
