<template>
  <div class="player-select" ref="rootRef">
    <div class="player-select-input-wrapper">
      <input
        type="text"
        class="player-select-input"
        :value="searchQuery"
        @input="onInput"
        @focus="onFocus"
        @keydown.down.prevent="onKeyDownDown"
        @keydown.up.prevent="onKeyDownUp"
        @keydown.enter.prevent="onKeyDownEnter"
        @keydown.esc.prevent="closeDropdown"
        :placeholder="placeholder || '输入玩家名称 / SteamID / EOS ID...'"
        :disabled="disabled"
        autocomplete="off"
      />
      <AppButton
        v-if="searchQuery"
        variant="ghost"
        size="sm"
        icon-only
        class="player-select-clear"
        @click="clearSelection"
        title="清除选择"
      >
        ×
      </AppButton>
      <AppButton variant="ghost" size="sm" icon-only class="player-select-indicator" aria-label="展开玩家列表" @click="toggleDropdown">▾</AppButton>
    </div>

    <!-- Dropdown Panel -->
    <div v-if="isOpen && !disabled" class="player-select-dropdown">
      <!-- Tabs -->
      <div class="player-select-tabs">
        <AppButton
          variant="ghost"
          size="sm"
          class="player-select-tab"
          :class="{ active: activeTab === 'online' }"
          @click="activeTab = 'online'"
        >
          在线玩家 ({{ playerStore.active.length }})
        </AppButton>
        <AppButton
          variant="ghost"
          size="sm"
          class="player-select-tab"
          :class="{ active: activeTab === 'database' }"
          @click="activeTab = 'database'"
        >
          玩家数据库
        </AppButton>
      </div>

      <!-- Content Area -->
      <div class="player-select-results" ref="resultsRef" role="listbox">
        <!-- Online Tab -->
        <template v-if="activeTab === 'online'">
          <div v-if="!playerStore.active.length" class="player-select-empty">
            暂无在线玩家数据
          </div>
          <div v-else-if="!activeFiltered.length" class="player-select-empty">
            没有匹配的在线玩家
          </div>
          <div v-else>
            <AppButton
              v-for="(player, idx) in activeFiltered"
              :key="`online-${player.playerID || idx}`"
              variant="ghost"
              class="player-select-option"
              :class="{ highlighted: idx === highlightedIndex }"
              role="option"
              @click="selectPlayer(player)"
            >
              <div class="option-main">
                <span class="option-name">{{ player.name }}</span>
                <span v-if="player.teamID !== null && player.teamID !== undefined" class="option-team-badge" :class="`team-${player.teamID}`">
                  T{{ player.teamID }}
                </span>
                <span v-if="player.squadID" class="option-squad-badge">
                  #{{ player.squadID }}
                </span>
              </div>
              <div class="option-sub">
                <span class="option-steam">Steam: {{ player.steamID || player.steamId || '--' }}</span>
              </div>
            </AppButton>
          </div>
        </template>

        <!-- Database Tab -->
        <template v-else-if="activeTab === 'database'">
          <div v-if="dbLoading" class="player-select-status">
            <span class="spinner"></span> 正在搜索数据库...
          </div>
          <div v-else-if="dbError" class="player-select-status error">
            {{ dbError }}
          </div>
          <div v-else-if="!searchQuery.trim()" class="player-select-empty">
            请输入关键字搜索全球数据库玩家
          </div>
          <div v-else-if="!dbResults.length" class="player-select-empty">
            未在数据库中找到匹配的玩家
          </div>
          <div v-else>
            <AppButton
              v-for="(player, idx) in dbResults"
              :key="`db-${player.id || idx}`"
              variant="ghost"
              class="player-select-option"
              :class="{ highlighted: idx === highlightedIndex }"
              role="option"
              @click="selectPlayer(player)"
            >
              <div class="option-main">
                <span class="option-name">{{ player.current_name || player.name || '未知玩家' }}</span>
                <span v-if="isOnline(player)" class="option-online-badge">在线</span>
              </div>
              <div class="option-sub">
                <span class="option-steam">Steam: {{ getSteamId(player) }}</span>
              </div>
            </AppButton>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import AppButton from "../ui/AppButton.vue";
import { usePlayerStore } from "../../stores/player.store";
import { apiGet } from "../../app/apiClient";

const props = defineProps<{
  modelValue?: string;
  steamId?: string;
  playerName?: string;
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", val: string): void;
  (e: "update:steamId", val: string): void;
  (e: "update:playerName", val: string): void;
  (e: "select", player: any): void;
}>();

const playerStore = usePlayerStore();

const rootRef = ref<HTMLElement | null>(null);
const resultsRef = ref<HTMLElement | null>(null);
const searchQuery = ref("");
const isOpen = ref(false);
const activeTab = ref<"online" | "database">("online");

// Sync props with searchQuery
watch(
  () => [props.modelValue, props.steamId, props.playerName],
  () => {
    const targetVal = props.playerName || props.modelValue || "";
    if (targetVal !== searchQuery.value) {
      searchQuery.value = targetVal;
    }
  },
  { immediate: true }
);

const activeFiltered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const list = Array.isArray(playerStore.active) ? playerStore.active : [];
  if (!q) return list.slice(0, 40);
  return list
    .filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.steamID && p.steamID.includes(q)) ||
        (p.eosID && p.eosID.toLowerCase().includes(q))
    )
    .slice(0, 40);
});

// Database Search Logic
let debounceTimeout: number | null = null;
const dbLoading = ref(false);
const dbResults = ref<any[]>([]);
const dbError = ref("");

watch(
  () => [searchQuery.value, activeTab.value],
  () => {
    if (activeTab.value !== "database") return;
    if (debounceTimeout) window.clearTimeout(debounceTimeout);

    const q = searchQuery.value.trim();
    if (!q) {
      dbResults.value = [];
      return;
    }

    dbLoading.value = true;
    debounceTimeout = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q,
          sort: "updated_desc",
          limit: "40",
          offset: "0",
        });
        const res = await apiGet<any>(`/api/db/players?${params.toString()}`);
        const items = res?.items ?? res?.players ?? [];
        dbResults.value = items;
        dbError.value = "";
      } catch (err: any) {
        dbError.value = err?.message || "搜索数据库失败";
      } finally {
        dbLoading.value = false;
      }
    }, 300);
  }
);

// Helpers
function isOnline(player: any) {
  const steamId = player.steam_id || player.steamID || player.steamId || "";
  const eosId = player.eos_id || player.eosID || player.eosId || "";
  if (steamId && playerStore.bySteamID[steamId]) return true;
  if (eosId && playerStore.byEOSID[eosId]) return true;
  return false;
}

function getSteamId(player: any): string {
  return String(player.steam_id || player.steamID || player.steamId || "--").trim();
}

function onInput(event: Event) {
  const val = (event.target as HTMLInputElement).value;
  searchQuery.value = val;
  emit("update:modelValue", val);
  highlightedIndex.value = -1;
  if (!isOpen.value) {
    isOpen.value = true;
  }
}

function onFocus() {
  isOpen.value = true;
  highlightedIndex.value = -1;
}

function toggleDropdown() {
  if (props.disabled) return;
  isOpen.value = !isOpen.value;
}

function closeDropdown() {
  isOpen.value = false;
  highlightedIndex.value = -1;
}

function clearSelection() {
  searchQuery.value = "";
  emit("update:modelValue", "");
  emit("update:steamId", "");
  emit("update:playerName", "");
}

function selectPlayer(player: any) {
  const name = player.current_name || player.name || "";
  const steam = player.steam_id || player.steamID || player.steamId || "";
  const eos = player.eos_id || player.eosID || player.eosId || "";

  searchQuery.value = name;

  // Emit primary modelValue as steam ID if present, else EOS ID, else name
  const modelValue = steam || eos || name;
  emit("update:modelValue", modelValue);
  emit("update:steamId", steam);
  emit("update:playerName", name);
  emit("select", player);

  closeDropdown();
}

// Click outside handler
function onClickOutside(event: MouseEvent) {
  const target = event.target as Node;
  if (rootRef.value && !rootRef.value.contains(target)) {
    closeDropdown();
  }
}

onMounted(() => {
  document.addEventListener("mousedown", onClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onClickOutside);
  if (debounceTimeout) window.clearTimeout(debounceTimeout);
});

// Keyboard Navigation
const highlightedIndex = ref(-1);
const currentList = computed(() => {
  if (activeTab.value === "online") {
    return activeFiltered.value;
  } else {
    return dbResults.value;
  }
});

function onKeyDownDown() {
  if (!isOpen.value) {
    isOpen.value = true;
    return;
  }
  if (highlightedIndex.value < currentList.value.length - 1) {
    highlightedIndex.value++;
    scrollToHighlighted();
  }
}

function onKeyDownUp() {
  if (highlightedIndex.value > 0) {
    highlightedIndex.value--;
    scrollToHighlighted();
  }
}

function onKeyDownEnter() {
  if (highlightedIndex.value >= 0 && highlightedIndex.value < currentList.value.length) {
    selectPlayer(currentList.value[highlightedIndex.value]);
  }
}

function scrollToHighlighted() {
  if (!resultsRef.value) return;
  const container = resultsRef.value;
  const options = container.querySelectorAll(".player-select-option");
  const activeEl = options[highlightedIndex.value] as HTMLElement;
  if (!activeEl) return;

  const containerTop = container.scrollTop;
  const containerBottom = containerTop + container.clientHeight;
  const elemTop = activeEl.offsetTop;
  const elemBottom = elemTop + activeEl.clientHeight;

  if (elemTop < containerTop) {
    container.scrollTop = elemTop;
  } else if (elemBottom > containerBottom) {
    container.scrollTop = elemBottom - container.clientHeight;
  }
}
</script>

<style scoped>
.player-select {
  position: relative;
  width: 100%;
}

.player-select-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.player-select-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
  color: var(--color-text-primary, #f8fafc);
  padding: 10px 36px 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  outline: none;
  transition: all 0.15s ease;
}

.player-select-input:focus {
  border-color: var(--color-border-highlight, #3b82f6);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14);
  background: rgba(255, 255, 255, 0.07);
}

.player-select-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.player-select-clear {
  position: absolute;
  right: 26px;
  background: none;
  border: none;
  color: var(--color-text-muted, #94a3b8);
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.player-select-clear:hover {
  color: var(--color-text-primary, #f8fafc);
}

.player-select-indicator {
  position: absolute;
  right: 12px;
  color: var(--color-text-muted, #94a3b8);
  font-size: 10px;
  cursor: pointer;
  user-select: none;
}

.player-select-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: var(--color-bg-card, #0f172a);
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.15));
  border-radius: 16px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), var(--shadow-md);
  z-index: 1000;
  overflow: hidden;
  backdrop-filter: blur(12px);
}

.player-select-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
  background: rgba(255, 255, 255, 0.02);
}

.player-select-tab {
  flex: 1;
  padding: 10px;
  background: none;
  border: none;
  color: var(--color-text-muted, #94a3b8);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;
}

.player-select-tab:hover {
  color: var(--color-text-primary, #f8fafc);
  background: rgba(255, 255, 255, 0.02);
}

.player-select-tab.active {
  color: var(--color-border-highlight, #3b82f6);
  border-bottom: 2px solid var(--color-border-highlight, #3b82f6);
  background: rgba(59, 130, 246, 0.05);
}

.player-select-results {
  max-height: 280px;
  overflow-y: auto;
  padding: 6px;
}

.player-select-empty, .player-select-status {
  padding: 24px;
  text-align: center;
  color: var(--color-text-muted, #94a3b8);
  font-size: 13px;
}

.player-select-status.error {
  color: #ef4444;
}

.player-select-option {
  width: 100%;
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  background: none;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.1s ease;
  text-align: left;
}

.player-select-option:hover, .player-select-option.highlighted {
  background: rgba(255, 255, 255, 0.06);
}

.option-main {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.option-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-primary, #f8fafc);
}

.option-team-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
}

.option-team-badge.team-1 {
  background: rgba(55, 200, 255, 0.15);
  color: #37c8ff;
  border: 1px solid rgba(55, 200, 255, 0.3);
}

.option-team-badge.team-2 {
  background: rgba(255, 155, 69, 0.15);
  color: #ff9b45;
  border: 1px solid rgba(255, 155, 69, 0.3);
}

.option-squad-badge {
  font-size: 11px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-muted, #94a3b8);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.option-online-badge {
  font-size: 11px;
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.option-sub {
  font-size: 12px;
  color: var(--color-text-muted, #94a3b8);
  font-family: Consolas, monospace;
}

.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: var(--color-border-highlight, #3b82f6);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-right: 6px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
