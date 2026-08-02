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

        <section class="menu-section" aria-label="theme switcher">
          <div class="menu-section-head">
            <strong>主题</strong>
            <span>当前 {{ activeThemeLabel }}</span>
          </div>
          <div class="theme-switch-grid">
            <button
              v-for="option in themeOptions"
              :key="option.id"
              type="button"
              class="theme-switch-item"
              :class="{ active: ui.theme === option.id }"
              @click="selectTheme(option.id, option.label)"
            >
              {{ option.label }}
            </button>
          </div>
        </section>

        <button type="button" class="menu-item" role="menuitem" @click="openSettings">设置</button>
        <button type="button" class="menu-item" role="menuitem" @click="openChangePasswordDialog">
          修改密码
        </button>
        <button v-if="canUseArbitraryRcon" type="button" class="menu-item" role="menuitem" @click="openRconModal">
          执行命令
        </button>
        <button v-if="canManageSettingsTools" type="button" class="menu-item" role="menuitem" @click="openPluginCenter">
          插件中心
        </button>
        <button v-if="canManageSettingsTools" type="button" class="menu-item" role="menuitem" @click="openRuntimeStatus">
          运行状态
        </button>
        <button v-if="canManageTankBattle" type="button" class="menu-item" role="menuitem" @click="openTankBattleDialog">
          开启坦克大战
        </button>
        <button v-if="canUseDeveloperTools" type="button" class="menu-item" role="menuitem" @click="openDeveloperTools">
          开发者窗口
        </button>
        <button type="button" class="menu-item danger" role="menuitem" @click="logout">
          {{ t("user.logout") }}
        </button>
      </div>
    </transition>
  </div>

  <teleport to="body">
    <transition name="menu-fade">
      <div v-if="tankBattleDialogOpen" class="tank-battle-overlay" v-backdrop-close="closeTankBattleDialog">
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
                <span>下面 7 个选项可单独打开或者关闭</span>
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

  <teleport to="body">
    <transition name="menu-fade">
      <div v-if="changePasswordDialogOpen" class="change-password-overlay" v-backdrop-close="closeChangePasswordDialog">
        <section class="change-password-dialog" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
          <header class="change-password-header">
            <div>
              <p class="change-password-kicker">安全设置</p>
              <h2 id="change-password-title">修改密码</h2>
              <p class="change-password-subtitle">请定期修改密码以保障账号安全</p>
            </div>
            <button type="button" class="change-password-close" @click="closeChangePasswordDialog">×</button>
          </header>

          <form @submit.prevent="submitChangePassword" class="change-password-form">
            <div class="form-field">
              <label for="old-password" class="field-label">当前密码</label>
              <div class="password-wrapper">
                <input
                  id="old-password"
                  v-model="changePasswordForm.oldPassword"
                  :type="showOldPassword ? 'text' : 'password'"
                  required
                  class="form-input"
                  placeholder="请输入当前密码"
                />
                <button
                  type="button"
                  class="password-toggle"
                  @click="showOldPassword = !showOldPassword"
                  aria-label="Toggle password visibility"
                >
                  <svg v-if="showOldPassword" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="toggle-icon"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                  <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="toggle-icon"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                </button>
              </div>
            </div>

            <div class="form-field">
              <label for="new-password" class="field-label">新密码</label>
              <div class="password-wrapper">
                <input
                  id="new-password"
                  v-model="changePasswordForm.newPassword"
                  :type="showNewPassword ? 'text' : 'password'"
                  required
                  minlength="8"
                  class="form-input"
                  placeholder="请输入新密码（至少 8 位）"
                />
                <button
                  type="button"
                  class="password-toggle"
                  @click="showNewPassword = !showNewPassword"
                  aria-label="Toggle password visibility"
                >
                  <svg v-if="showNewPassword" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="toggle-icon"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                  <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="toggle-icon"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                </button>
              </div>
            </div>

            <div class="form-field">
              <label for="confirm-password" class="field-label">确认新密码</label>
              <div class="password-wrapper">
                <input
                  id="confirm-password"
                  v-model="changePasswordForm.confirmPassword"
                  :type="showConfirmPassword ? 'text' : 'password'"
                  required
                  minlength="8"
                  class="form-input"
                  placeholder="请再次输入新密码"
                />
                <button
                  type="button"
                  class="password-toggle"
                  @click="showConfirmPassword = !showConfirmPassword"
                  aria-label="Toggle password visibility"
                >
                  <svg v-if="showConfirmPassword" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="toggle-icon"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                  <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="toggle-icon"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                </button>
              </div>
            </div>

            <div v-if="changePasswordError" class="dialog-error">
              {{ changePasswordError }}
            </div>

            <footer class="change-password-footer">
              <button type="button" class="bz-btn bz-btn-ghost" @click="closeChangePasswordDialog">取消</button>
              <button type="submit" class="bz-btn bz-btn-primary" :disabled="changePasswordBusy">
                {{ changePasswordBusy ? '保存中...' : '确认修改' }}
              </button>
            </footer>
          </form>
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
import { useUiStore, type UiTheme } from "../../stores/ui.store";
import { UI_THEME_OPTIONS } from "../../theme/uiThemes";
import { t } from "../../i18n";
import { canSendRconCommand, hasPermission as hasSharedPermission } from "../../shared/rcon-permissions.js";

const emit = defineEmits<{
  (event: "open-plugin-center"): void;
  (event: "open-rcon-modal"): void;
}>();

const auth = useAuthStore();
const settings = useSettingsStore();
const ui = useUiStore();
const router = useRouter();
const themeOptions = UI_THEME_OPTIONS;

const menuOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const tankBattleDialogOpen = ref(false);
const tankBattleBusy = ref(false);
const deployableAvailability = ref<boolean | null>(null);

const changePasswordDialogOpen = ref(false);
const changePasswordBusy = ref(false);
const changePasswordError = ref("");
const showOldPassword = ref(false);
const showNewPassword = ref(false);
const showConfirmPassword = ref(false);

const changePasswordForm = ref({
  oldPassword: "",
  newPassword: "",
  confirmPassword: "",
});

function openChangePasswordDialog() {
  changePasswordForm.value = {
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  };
  changePasswordError.value = "";
  showOldPassword.value = false;
  showNewPassword.value = false;
  showConfirmPassword.value = false;
  changePasswordDialogOpen.value = true;
  menuOpen.value = false;
}

function closeChangePasswordDialog() {
  changePasswordDialogOpen.value = false;
}

async function submitChangePassword() {
  const { oldPassword, newPassword, confirmPassword } = changePasswordForm.value;
  if (!oldPassword || !newPassword || !confirmPassword) {
    changePasswordError.value = "请填写所有密码字段。";
    return;
  }
  if (newPassword.length < 8) {
    changePasswordError.value = "新密码长度至少为 8 位。";
    return;
  }
  if (newPassword !== confirmPassword) {
    changePasswordError.value = "新密码与确认新密码不一致。";
    return;
  }

  changePasswordBusy.value = true;
  changePasswordError.value = "";

  try {
    const response = await apiPost<{ ok: boolean; message?: string }>("/api/auth/change-password", {
      oldPassword,
      newPassword,
    });
    if (response.ok) {
      ui.pushToast({ title: "修改成功", message: "您的密码已成功修改。", tone: "ok" });
      closeChangePasswordDialog();
    } else {
      changePasswordError.value = response.message || "修改密码失败。";
    }
  } catch (error: any) {
    changePasswordError.value = error?.message || "服务器发生错误。";
  } finally {
    changePasswordBusy.value = false;
  }
}

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
    label: "禁用载具队伍要求",
    description: "AdminDisableVehicleTeamRequirement",
    openCommand: "AdminDisableVehicleTeamRequirement 1",
    closeCommand: "AdminDisableVehicleTeamRequirement 0",
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
const canUseDeveloperTools = computed(() => auth.user?.isSuperAdmin === true);
const canManageSettingsTools = computed(() => hasSharedPermission(auth.user?.permissions, "settings.manage"));
const canOpenSettings = computed(() => auth.user?.isSuperAdmin === true || canManageSettingsTools.value);
const canManageTankBattle = computed(() => (
  auth.user?.isSuperAdmin === true
  || (canManageSettingsTools.value && canSendRconCommand(auth.user, "AdminForceAllVehicleAvailability 1"))
));
const activeThemeLabel = computed(() => themeOptions.find((option) => option.id === ui.theme)?.label ?? ui.theme);
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
  if (!canOpenSettings.value) {
    ui.pushToast({ title: t("common.error"), message: "You do not have access to settings.", tone: "error" });
    return;
  }
  closeMenu();
  settings.openDrawer();
}

function selectTheme(themeId: UiTheme, label: string) {
  if (ui.theme === themeId) return;
  ui.setTheme(themeId);
  ui.pushToast({
    title: "Theme updated",
    message: `Switched to ${label}.`,
    tone: "ok",
    durationMs: 1800,
  });
}

function openRconModal() {
  if (!canUseArbitraryRcon.value) return;
  closeMenu();
  emit("open-rcon-modal");
}

function openDeveloperTools() {
  if (!canUseDeveloperTools.value) return;
  closeMenu();
  window.dispatchEvent(new CustomEvent("bzss:developer-tools-open"));
}

function openPluginCenter() {
  if (!canManageSettingsTools.value) return;
  closeMenu();
  emit("open-plugin-center");
}

function openRuntimeStatus() {
  if (!canManageSettingsTools.value) return;
  closeMenu();
  router.push("/system/status");
}

function openTankBattleDialog() {
  closeMenu();
  if (!canManageTankBattle.value) {
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
        "AdminDisableVehicleTeamRequirement 1",
      ]
    : [
        "AdminNoRespawnTimer 0",
        "AdminForceAllVehicleAvailability 0",
        "AdminForceAllRoleAvailability 0",
        "AdminDisableVehicleKitRequirement 0",
        "AdminDisableVehicleClaiming 0",
        "AdminDisableVehicleTeamRequirement 0",
      ];

  const confirmed = window.confirm(
    `确认${open ? "打开" : "关闭"}坦克大战吗？\n\n将按顺序执行以下 ${commands.length} 条命令：\n${commands.map((command, index) => `${index + 1}. ${command}`).join("\n")}`,
  );
  if (!confirmed) return;

  tankBattleBusy.value = true;
  try {
    await apiPost("/api/tank-battle/execute", {
      preset: open ? "open" : "close",
      commands,
      sourcePage: "tank_battle_dialog",
    });
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
    await apiPost("/api/tank-battle/execute", {
      preset: next ? "deployable_on" : "deployable_off",
      commands: [command],
      sourcePage: "tank_battle_dialog",
    });
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
    await apiPost("/api/tank-battle/execute", {
      preset: actionLabel,
      commands: [command],
      sourcePage: "tank_battle_dialog",
    });
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

.menu-section {
  padding: 8px 10px 10px;
  border-radius: 14px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.02);
  display: grid;
  gap: 10px;
}

.menu-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.menu-section-head strong {
  font-size: 13px;
  color: var(--color-text-primary);
}

.menu-section-head span {
  color: var(--color-text-muted);
  font-size: 11px;
}

.theme-switch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.theme-switch-item {
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
  color: var(--color-text-secondary);
  min-height: 34px;
  padding: 0 10px;
  text-align: center;
}

.theme-switch-item.active {
  border-color: var(--color-border-highlight);
  background: color-mix(in srgb, var(--color-brand-primary) 12%, transparent);
  color: var(--color-text-primary);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-brand-primary) 14%, transparent);
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
  background: var(--color-bg-hover);
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
    radial-gradient(circle at top, color-mix(in srgb, var(--color-brand-primary) 22%, transparent), transparent 34%),
    color-mix(in srgb, var(--color-bg-page) 82%, transparent);
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

  .theme-switch-grid {
    grid-template-columns: 1fr;
  }
}

.change-password-overlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-user-dropdown) + 20);
  display: grid;
  place-items: center;
  padding: 20px;
  background:
    radial-gradient(circle at top, color-mix(in srgb, var(--color-brand-primary) 22%, transparent), transparent 34%),
    color-mix(in srgb, var(--color-bg-page) 82%, transparent);
  backdrop-filter: blur(14px) saturate(1.08);
}

.change-password-dialog {
  width: min(440px, calc(100vw - 32px));
  border-radius: 28px;
  border: 1px solid rgba(96, 165, 250, 0.24);
  background:
    radial-gradient(circle at top left, rgba(96, 165, 250, 0.18), transparent 30%),
    radial-gradient(circle at top right, rgba(244, 114, 182, 0.08), transparent 28%),
    linear-gradient(180deg, rgba(18, 24, 34, 0.98), rgba(9, 13, 19, 0.99));
  box-shadow: 0 36px 110px rgba(0, 0, 0, 0.58);
  overflow: hidden;
}

.change-password-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 22px 24px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.change-password-kicker {
  margin: 0 0 6px;
  color: #8fbaff;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.change-password-header h2 {
  margin: 0;
  font-size: 20px;
  line-height: 1.1;
}

.change-password-subtitle {
  margin: 8px 0 0;
  color: rgba(230, 240, 255, 0.74);
  font-size: 12px;
}

.change-password-close {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: #f2f7ff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.change-password-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 24px 24px;
}

.change-password-form .form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.change-password-form .field-label {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.change-password-form .form-input {
  width: 100%;
  height: 38px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(3, 7, 18, 0.6);
  color: var(--color-text-primary);
  padding: 0 12px;
  font-size: 16px;
}

.change-password-form .form-input:focus {
  border-color: var(--color-brand-primary, #37c8ff);
  background: rgba(3, 7, 18, 0.8);
  outline: none;
}

.change-password-form .password-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.change-password-form .password-toggle {
  position: absolute;
  right: 10px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  box-shadow: none;
  width: 24px;
  height: 24px;
}

.change-password-form .password-toggle:hover:not(:disabled) {
  color: var(--color-text-primary);
  transform: none;
  box-shadow: none;
}

.change-password-form .toggle-icon {
  width: 16px;
  height: 16px;
}

.change-password-form .dialog-error {
  color: #ff8080;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(255, 0, 0, 0.1);
  border: 1px solid rgba(255, 0, 0, 0.2);
}

.change-password-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
}
</style>
