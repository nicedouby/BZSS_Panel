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
        <button type="button" class="menu-item" role="menuitem" @click="openPluginCenter">
          插件中心
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
import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore } from "../../stores/settings.store";
import { t } from "../../i18n";

const emit = defineEmits<{
  (event: "open-plugin-center"): void;
}>();

const auth = useAuthStore();
const settings = useSettingsStore();

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

function openPluginCenter() {
  closeMenu();
  emit("open-plugin-center");
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
  min-width: 172px;
  padding: 8px 12px 8px 10px;
  border-radius: 999px;
  border: 1px solid #34404b;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.01)), rgba(255, 255, 255, 0.005)),
    linear-gradient(180deg, #1b2229, #151b21);
  color: #edf2f4;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.15);
}

.user-trigger:hover {
  border-color: #6a7f8f;
}

.user-avatar {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(180deg, #2d3944, #1d252d);
  border: 1px solid #41505d;
  color: #b9d7e8;
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
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-copy small {
  margin-top: 2px;
  color: #9aa7b2;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-caret {
  color: #9aa7b2;
  font-size: 12px;
}

.user-dropdown {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: 240px;
  border: 1px solid #2b3540;
  border-radius: 14px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.012)), rgba(255, 255, 255, 0.005)),
    #151a20;
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.35);
  padding: 10px;
  z-index: var(--z-user-dropdown);
  display: grid;
  gap: 8px;
}

.user-meta {
  padding: 8px 10px 10px;
  border-bottom: 1px solid #24303a;
  display: grid;
  gap: 4px;
}

.user-meta strong {
  font-size: 14px;
}

.user-meta span {
  color: #9aa7b2;
  font-size: 12px;
}

.menu-item {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
  border: 1px solid #2e3944;
  background: #182028;
  color: #edf2f4;
  border-radius: 10px;
  padding: 10px 12px;
}

.menu-item:hover {
  border-color: #6a7f8f;
}

.menu-item.danger {
  color: #ffb1b1;
}

.menu-item.danger:hover {
  border-color: #7a3a3a;
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
