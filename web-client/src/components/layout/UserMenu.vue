<template>
  <div ref="rootEl" class="user-menu">
    <button type="button" class="user-trigger" @click.stop="toggleMenu">
      <span class="user-avatar">{{ avatarLabel }}</span>
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
        <button type="button" class="menu-item" role="menuitem" @click="openRconModal">
          执行命令
        </button>
        <button type="button" class="menu-item" role="menuitem" @click="openPluginCenter">
          插件中心
        </button>
        <button type="button" class="menu-item" role="menuitem" @click="openRuntimeStatus">
          运行状态
        </button>
        <button type="button" class="menu-item danger" role="menuitem" @click="logout">
          {{ t("user.logout") }}
        </button>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore } from "../../stores/settings.store";
import { t } from "../../i18n";

const emit = defineEmits<{
  (event: "open-plugin-center"): void;
  (event: "open-rcon-modal"): void;
}>();

const auth = useAuthStore();
const settings = useSettingsStore();
const router = useRouter();

const menuOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const usernameLabel = computed(() => String(auth.user?.username ?? t("user.user")));
const roleLabel = computed(() => String(auth.user?.role ?? t("common.unknown")));
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
