<template>
  <div class="squad-page-toolbar">
    <div class="toolbar-row">

      <!-- Hardcore Cyberpunk Tactical AdminWarn Command Bar -->
      <div class="admin-warn-control" :data-channel="selectedChannel" aria-label="AdminWarn Command Bar">
        <!-- Live RCON Status Tag -->
        <div class="rcon-status-badge">
          <span class="pulse-led" :class="selectedChannel" />
          <span class="rcon-text">RCON</span>
        </div>

        <!-- Channel Selector Dropdown -->
        <div ref="channelMenuRoot" class="warn-channel-selector">
          <button
            type="button"
            class="channel-trigger-btn"
            :class="selectedChannel"
            :disabled="!canRefresh || isRefreshing"
            @click.stop="toggleChannelMenu"
            :title="`目标频道: ${currentChannelInfo.fullLabel} (${currentChannelInfo.badgeText})`"
          >
            <span class="channel-icon-wrap" v-html="currentChannelInfo.svgIcon" />
            <span class="channel-name">{{ currentChannelInfo.label }}</span>
            <svg class="caret-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <transition name="menu-fade">
            <div v-if="channelMenuOpen" class="channel-dropdown-menu" role="menu">
              <div class="menu-header-label">// TARGET CHANNEL SELECT</div>
              <button
                v-for="(ch, key) in CHANNELS"
                :key="key"
                type="button"
                class="channel-option-item"
                :class="[key, { active: selectedChannel === key }]"
                @click="selectChannel(key)"
              >
                <span class="opt-icon" v-html="ch.svgIcon" />
                <div class="opt-info">
                  <div class="opt-top">
                    <span class="opt-name">{{ ch.label }}</span>
                    <span class="opt-code">{{ ch.code }}</span>
                  </div>
                  <span class="opt-sub">{{ ch.badgeText }}</span>
                </div>
                <span v-if="selectedChannel === key" class="opt-check">✓</span>
              </button>
            </div>
          </transition>
        </div>

        <!-- Cyber Hero Input Field -->
        <div class="warn-input-group" :class="{ 'has-focus': isInputFocused, 'has-content': warnInputText.trim().length > 0 }">
          <span class="input-prompt-symbol">&gt;</span>

          <input
            ref="warnInputRef"
            v-model="warnInputText"
            type="text"
            class="warn-hero-input"
            :placeholder="`// 键入 ${currentChannelInfo.fullLabel} AdminWarn 消息...`"
            :disabled="!canRefresh || isRefreshing"
            @focus="isInputFocused = true"
            @blur="isInputFocused = false"
            @keydown.enter.prevent="handleSendWarn"
          />

          <button
            v-if="warnInputText"
            type="button"
            class="warn-clear-btn"
            title="清空输入"
            @click="warnInputText = ''"
          >
            ✕
          </button>

          <!-- Terminal Logs & Presets Dropdown Toggle -->
          <div ref="historyMenuRoot" class="warn-history-wrapper">
            <button
              type="button"
              class="warn-history-trigger-btn"
              :class="{ active: historyMenuOpen, 'has-history': historyRecords.length > 0 }"
              title="警告历史与常用模版"
              @click.stop="toggleHistoryMenu"
            >
              <svg class="history-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span class="history-label">LOGS</span>
              <span v-if="historyRecords.length > 0" class="history-count">{{ historyRecords.length }}</span>
            </button>

            <transition name="menu-fade">
              <div v-if="historyMenuOpen" class="history-dropdown-panel" role="menu">
                <!-- Presets Section -->
                <div class="panel-section">
                  <div class="section-title">
                    <span>// PRESET COMMAND TEMPLATES</span>
                  </div>
                  <div class="preset-chips">
                    <button
                      v-for="(preset, idx) in PRESET_TEMPLATES"
                      :key="preset.text"
                      type="button"
                      class="preset-chip"
                      @click="applyPreset(preset)"
                    >
                      <span class="chip-code">SYS-0{{ idx + 1 }}</span>
                      <span class="chip-target" :class="preset.target || selectedChannel">
                        {{ preset.target ? getChannelBadge(preset.target) : getChannelBadge(selectedChannel) }}
                      </span>
                      <span class="chip-text">{{ preset.text }}</span>
                    </button>
                  </div>
                </div>

                <!-- History Records Section -->
                <div class="panel-section history-section">
                  <div class="section-title">
                    <span>// RECENT DISPATCH STREAM</span>
                    <button
                      v-if="historyRecords.length > 0"
                      type="button"
                      class="clear-history-btn"
                      @click="clearHistory"
                    >
                      CLEAR LOGS
                    </button>
                  </div>

                  <div v-if="historyRecords.length === 0" class="empty-history">
                    NO RECENT RCON DISPATCH LOGS
                  </div>
                  <div v-else class="history-list">
                    <button
                      v-for="item in historyRecords"
                      :key="item.id"
                      type="button"
                      class="history-item"
                      @click="applyHistoryItem(item)"
                    >
                      <span class="history-target-badge" :class="item.target">
                        {{ getChannelBadge(item.target) }}
                      </span>
                      <span class="history-text" :title="item.text">{{ item.text }}</span>
                      <span class="history-time">{{ formatTimeAgo(item.timestamp) }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </transition>
          </div>
        </div>

        <!-- Cyber Dispatch Button -->
        <button
          type="button"
          class="warn-send-btn"
          :class="selectedChannel"
          :disabled="!canRefresh || isRefreshing"
          @click="handleSendWarn"
          :title="warnInputText.trim() ? `发送警告至 ${currentChannelInfo.fullLabel}` : `打开 ${currentChannelInfo.fullLabel} 警告窗口`"
        >
          <svg class="send-svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span class="send-text">DISPATCH</span>
          <span class="key-hint">↵</span>
        </button>
      </div>

      <div class="toolbar-spacer" />

      <div v-if="serverStatusUpdatedAt || playersUpdatedAt" class="toolbar-timestamps">
        <span v-if="playersUpdatedAt" class="ts-badge" :title="`玩家数据更新时间: ${formatTimestamp(playersUpdatedAt)}`">
          {{ formatTimestampShort(playersUpdatedAt) }}
        </span>
      </div>

      <div class="refresh-controls">
        <button
          type="button"
          class="refresh-button"
          :class="{ active: multiSelectMode, 'primary-select': multiSelectMode }"
          @click="$emit('toggle-multi-select')"
          :title="multiSelectMode ? '关闭批量操作' : '开启批量操作'"
        >
          <span class="select-icon">★</span>
          <span>{{ multiSelectMode ? '退出批量' : '批量操作' }}</span>
        </button>
        <div ref="refreshMenuRoot" class="refresh-dropdown">
          <button
            type="button"
            class="refresh-button refresh-menu-trigger"
            :disabled="!canRefresh || isRefreshing || refreshingPlaytime"
            :aria-expanded="refreshMenuOpen"
            aria-haspopup="menu"
            @click.stop="toggleRefreshMenu"
          >
            <span>{{ t("common.more", "More") }}</span>
            <span class="refresh-caret" aria-hidden="true">▾</span>
          </button>

          <transition name="menu-fade">
            <div v-if="refreshMenuOpen" class="refresh-menu" role="menu">
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                :disabled="!canRefresh || isRefreshing || refreshingPlaytime"
                @click="runPlaytimeRefresh(false)"
              >
                智能刷新时长
              </button>
              <button
                type="button"
                class="menu-item danger-item"
                role="menuitem"
                :disabled="!canRefresh || isRefreshing || refreshingPlaytime"
                @click="runPlaytimeRefresh(true)"
              >
                强制刷新时长
              </button>
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                :disabled="!canRefresh || isRefreshing"
                @click="runRefresh('players')"
              >
                {{ refreshingType === 'players' ? t('common.refreshing') : t('match.refreshPlayers') }}
              </button>
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                :disabled="!canRefresh || isRefreshing"
                @click="runRefresh('squads')"
              >
                {{ refreshingType === 'squads' ? t('common.refreshing') : t('match.refreshSquads') }}
              </button>
            </div>
          </transition>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { t } from "../../i18n";
import { isInputElement } from "../../utils/keyboard";

type RefreshType = "players" | "squads" | "all";

const CHANNELS = {
  all: {
    label: "ALL",
    fullLabel: "全体玩家",
    badgeText: "GLOBAL BROADCAST",
    code: "[BROADCAST]",
    color: "#f59e0b",
    svgIcon: `<svg class="tech-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/></svg>`,
  },
  team1: {
    label: "TEAM 1",
    fullLabel: "阵营 1",
    badgeText: "ALPHA TEAM 1",
    code: "[TEAM_01]",
    color: "#38bdf8",
    svgIcon: `<svg class="tech-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v8m-4-4h8"/></svg>`,
  },
  team2: {
    label: "TEAM 2",
    fullLabel: "阵营 2",
    badgeText: "BRAVO TEAM 2",
    code: "[TEAM_02]",
    color: "#f97316",
    svgIcon: `<svg class="tech-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3"/><circle cx="12" cy="12" r="3"/></svg>`,
  },
} as const;

type ChannelType = keyof typeof CHANNELS;

interface WarnHistoryItem {
  id: string;
  target: ChannelType;
  text: string;
  timestamp: number;
}

interface PresetTemplate {
  text: string;
  target?: ChannelType;
}

const STORAGE_KEY = "bzss_admin_warn_history";

const PRESET_TEMPLATES: PresetTemplate[] = [
  { text: "请遵守服务器规则，禁止恶意攻击队友与辱骂！", target: "all" },
  { text: "单兵限制：请注意小队建制，无队长小队将被解散！", target: "all" },
  { text: "请前往己方基地领取载具，禁止单人驾驶主战载具！", target: "all" },
  { text: "准备回防！违规队将被解散或移出小队！", target: "all" },
  { text: "禁止在对方基地/保护区内开火或跨界！", target: "all" },
];

const props = defineProps<{
  canRefresh: boolean;
  refreshingType: RefreshType | "";
  refreshingPlaytime?: boolean;
  serverStatusUpdatedAt?: number;
  playersUpdatedAt?: number;
  squadsUpdatedAt?: number;
  multiSelectMode?: boolean;
}>();

const emit = defineEmits<{
  (event: "warn-target", target: ChannelType, message?: string): void;
  (event: "refresh", type: RefreshType): void;
  (event: "refresh-playtime"): void;
  (event: "refresh-playtime-force"): void;
  (event: "warn-all"): void;
  (event: "toggle-multi-select"): void;
  (event: "view-mode-change", mode: "list" | "map"): void;
}>();

const isRefreshing = computed(() => Boolean(props.refreshingType));
const refreshingPlaytime = computed(() => Boolean(props.refreshingPlaytime));

const selectedChannel = ref<ChannelType>("all");
const currentChannelInfo = computed(() => CHANNELS[selectedChannel.value]);
const warnInputText = ref("");
const isInputFocused = ref(false);

const channelMenuOpen = ref(false);
const historyMenuOpen = ref(false);
const refreshMenuOpen = ref(false);

const channelMenuRoot = ref<HTMLElement | null>(null);
const historyMenuRoot = ref<HTMLElement | null>(null);
const refreshMenuRoot = ref<HTMLElement | null>(null);
const warnInputRef = ref<HTMLInputElement | null>(null);

const historyRecords = ref<WarnHistoryItem[]>([]);

let windowListenersActive = false;

onMounted(() => {
  loadHistory();
});

watch(
  () => [props.refreshingType, props.refreshingPlaytime],
  () => {
    if (isRefreshing.value || refreshingPlaytime.value) {
      closeAllMenus();
    }
  },
);

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        historyRecords.value = parsed.slice(0, 20);
      }
    }
  } catch (e) {
    console.warn("Failed to load warn history:", e);
  }
}

function pushHistoryItem(target: ChannelType, text: string) {
  const newItem: WarnHistoryItem = {
    id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    target,
    text,
    timestamp: Date.now(),
  };
  const filtered = historyRecords.value.filter(
    (item) => item.text.trim() !== text.trim()
  );
  historyRecords.value = [newItem, ...filtered].slice(0, 20);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(historyRecords.value));
  } catch (e) {
    console.warn("Failed to save warn history:", e);
  }
}

function clearHistory() {
  historyRecords.value = [];
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn("Failed to clear warn history:", e);
  }
}

function getChannelBadge(target: ChannelType) {
  return CHANNELS[target]?.label || target;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)}m前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h前`;
  return `${Math.floor(diff / 86400)}d前`;
}

function selectChannel(ch: ChannelType) {
  selectedChannel.value = ch;
  channelMenuOpen.value = false;
  checkWindowListeners();
}

function applyPreset(preset: PresetTemplate) {
  if (preset.target) {
    selectedChannel.value = preset.target;
  }
  warnInputText.value = preset.text;
  historyMenuOpen.value = false;
  checkWindowListeners();
  warnInputRef.value?.focus();
}

function applyHistoryItem(item: WarnHistoryItem) {
  selectedChannel.value = item.target;
  warnInputText.value = item.text;
  historyMenuOpen.value = false;
  checkWindowListeners();
  warnInputRef.value?.focus();
}

function handleSendWarn() {
  const msg = warnInputText.value.trim();
  if (msg) {
    pushHistoryItem(selectedChannel.value, msg);
    emit("warn-target", selectedChannel.value, msg);
    warnInputText.value = "";
  } else {
    emit("warn-target", selectedChannel.value);
  }
  closeAllMenus();
}

function toggleChannelMenu() {
  channelMenuOpen.value = !channelMenuOpen.value;
  if (channelMenuOpen.value) {
    historyMenuOpen.value = false;
    refreshMenuOpen.value = false;
    addWindowListeners();
  } else {
    checkWindowListeners();
  }
}

function toggleHistoryMenu() {
  historyMenuOpen.value = !historyMenuOpen.value;
  if (historyMenuOpen.value) {
    channelMenuOpen.value = false;
    refreshMenuOpen.value = false;
    addWindowListeners();
  } else {
    checkWindowListeners();
  }
}

function toggleRefreshMenu() {
  refreshMenuOpen.value = !refreshMenuOpen.value;
  if (refreshMenuOpen.value) {
    channelMenuOpen.value = false;
    historyMenuOpen.value = false;
    addWindowListeners();
  } else {
    checkWindowListeners();
  }
}

function closeAllMenus() {
  channelMenuOpen.value = false;
  historyMenuOpen.value = false;
  refreshMenuOpen.value = false;
  removeWindowListeners();
}

function addWindowListeners() {
  if (!windowListenersActive) {
    window.addEventListener("pointerdown", onWindowPointerDown);
    window.addEventListener("keydown", onWindowKeyDown);
    windowListenersActive = true;
  }
}

function checkWindowListeners() {
  if (!channelMenuOpen.value && !historyMenuOpen.value && !refreshMenuOpen.value) {
    removeWindowListeners();
  }
}

function removeWindowListeners() {
  if (windowListenersActive) {
    window.removeEventListener("pointerdown", onWindowPointerDown);
    window.removeEventListener("keydown", onWindowKeyDown);
    windowListenersActive = false;
  }
}

function onWindowPointerDown(event: PointerEvent) {
  const targetNode = event.target as Node;
  if (
    channelMenuOpen.value &&
    channelMenuRoot.value &&
    !channelMenuRoot.value.contains(targetNode)
  ) {
    channelMenuOpen.value = false;
  }
  if (
    historyMenuOpen.value &&
    historyMenuRoot.value &&
    !historyMenuRoot.value.contains(targetNode)
  ) {
    historyMenuOpen.value = false;
  }
  if (
    refreshMenuOpen.value &&
    refreshMenuRoot.value &&
    !refreshMenuRoot.value.contains(targetNode)
  ) {
    refreshMenuOpen.value = false;
  }
  checkWindowListeners();
}

function onWindowKeyDown(event: KeyboardEvent) {
  if (isInputElement(event.target) && event.key !== "Escape") return;
  if (event.key === "Escape") {
    closeAllMenus();
  }
}

function runRefresh(type: "players" | "squads") {
  emit("refresh", type);
  closeAllMenus();
}

function runPlaytimeRefresh(force: boolean) {
  if (force) {
    emit("refresh-playtime-force");
  } else {
    emit("refresh-playtime");
  }
  closeAllMenus();
}

function formatTimestamp(value: number) {
  if (!Number.isFinite(value)) return "--";
  return new Date(value).toLocaleString();
}

function formatTimestampShort(value: number) {
  if (!Number.isFinite(value)) return "--";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

onBeforeUnmount(removeWindowListeners);
</script>

<style scoped>
.squad-page-toolbar {
  position: relative;
  z-index: 1000;
  overflow: visible;
  display: grid;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(56, 189, 248, 0.2);
  background:
    radial-gradient(circle at 10% -20%, rgba(56, 189, 248, 0.12), transparent 40%),
    radial-gradient(circle at 90% -20%, rgba(245, 158, 11, 0.1), transparent 40%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(8, 12, 20, 0.98));
  backdrop-filter: blur(16px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
  position: relative;
  z-index: 1000;
}

/* Hardcore Cyberpunk Tactical AdminWarn Bar */
.admin-warn-control {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 340px;
  max-width: 720px;
  background: rgba(6, 10, 18, 0.78);
  border: 1px solid rgba(56, 189, 248, 0.25);
  border-radius: 8px;
  padding: 4px 6px;
  box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.6), 0 2px 10px rgba(0, 0, 0, 0.3);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  backdrop-filter: blur(12px);
  position: relative;
}

.admin-warn-control[data-channel="all"]:focus-within {
  border-color: rgba(245, 158, 11, 0.65);
  box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.6), 0 0 16px rgba(245, 158, 11, 0.25);
}

.admin-warn-control[data-channel="team1"]:focus-within {
  border-color: rgba(56, 189, 248, 0.65);
  box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.6), 0 0 16px rgba(56, 189, 248, 0.25);
}

.admin-warn-control[data-channel="team2"]:focus-within {
  border-color: rgba(249, 115, 22, 0.65);
  box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.6), 0 0 16px rgba(249, 115, 22, 0.25);
}

/* Live RCON Badge */
.rcon-status-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px 0 4px;
  height: 28px;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 11px;
  font-weight: 800;
  color: var(--color-text-muted);
  letter-spacing: 1px;
  user-select: none;
  flex-shrink: 0;
}

.pulse-led {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: ledPulse 2s infinite ease-in-out;
}

@keyframes ledPulse {
  0%, 100% { opacity: 0.4; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.25); }
}

.pulse-led.all { background: #f59e0b; box-shadow: 0 0 8px #f59e0b; }
.pulse-led.team1 { background: #38bdf8; box-shadow: 0 0 8px #38bdf8; }
.pulse-led.team2 { background: #f97316; box-shadow: 0 0 8px #f97316; }

/* SVG Icon Helper */
:deep(.tech-svg-icon) {
  width: 14px;
  height: 14px;
  display: block;
}

/* Channel Selector Trigger */
.warn-channel-selector {
  position: relative;
  flex-shrink: 0;
}

.channel-trigger-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}

.channel-trigger-btn:hover {
  background: rgba(255, 255, 255, 0.09);
}

.channel-trigger-btn.all {
  border-color: rgba(245, 158, 11, 0.45);
  color: #fcd34d;
  background: rgba(245, 158, 11, 0.1);
}

.channel-trigger-btn.team1 {
  border-color: rgba(56, 189, 248, 0.45);
  color: #7dd3fc;
  background: rgba(56, 189, 248, 0.1);
}

.channel-trigger-btn.team2 {
  border-color: rgba(249, 115, 22, 0.45);
  color: #fdba74;
  background: rgba(249, 115, 22, 0.1);
}

.channel-icon-wrap {
  display: flex;
  align-items: center;
}

.channel-name {
  white-space: nowrap;
  letter-spacing: 0.5px;
}

.caret-svg {
  width: 12px;
  height: 12px;
  opacity: 0.7;
}

/* Channel Dropdown Menu */
.channel-dropdown-menu {
  position: absolute;
  left: 0;
  top: calc(100% + 10px);
  z-index: 9999;
  width: 220px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid rgba(56, 189, 248, 0.35);
  background: rgba(6, 10, 18, 0.98);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.75), 0 0 20px rgba(56, 189, 248, 0.15);
  backdrop-filter: blur(24px);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.menu-header-label {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 10px;
  font-weight: 800;
  color: rgba(148, 163, 184, 0.7);
  letter-spacing: 1px;
  padding: 4px 6px 2px;
}

.channel-option-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.channel-option-item:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--color-text-primary);
}

.channel-option-item.all.active {
  border-color: rgba(245, 158, 11, 0.5);
  background: rgba(245, 158, 11, 0.15);
  color: #fcd34d;
}

.channel-option-item.team1.active {
  border-color: rgba(56, 189, 248, 0.5);
  background: rgba(56, 189, 248, 0.15);
  color: #7dd3fc;
}

.channel-option-item.team2.active {
  border-color: rgba(249, 115, 22, 0.5);
  background: rgba(249, 115, 22, 0.15);
  color: #fdba74;
}

.opt-icon {
  display: flex;
  align-items: center;
}

.opt-info {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.opt-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.opt-name {
  font-weight: 800;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
}

.opt-code {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 10px;
  opacity: 0.6;
}

.opt-sub {
  font-size: 10px;
  opacity: 0.65;
}

.opt-check {
  font-weight: 900;
  font-size: 12px;
}

/* Input Group */
.warn-input-group {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  gap: 4px;
}

.input-prompt-symbol {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 14px;
  font-weight: 900;
  color: rgba(56, 189, 248, 0.7);
  user-select: none;
  margin-right: 2px;
}

.warn-hero-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 30px;
  padding: 0 4px;
  border: none;
  background: transparent;
  color: #f8fafc;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  outline: none;
}

.warn-hero-input::placeholder {
  color: rgba(148, 163, 184, 0.45);
  font-size: 12px;
}

.warn-clear-btn {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 11px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  line-height: 1;
  transition: color 0.15s ease;
}

.warn-clear-btn:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.15);
}

/* History Dropdown Wrapper & Trigger */
.warn-history-wrapper {
  position: relative;
  flex-shrink: 0;
}

.warn-history-trigger-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-muted);
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}

.warn-history-trigger-btn:hover,
.warn-history-trigger-btn.active {
  background: rgba(56, 189, 248, 0.12);
  color: #7dd3fc;
  border-color: rgba(56, 189, 248, 0.4);
}

.history-svg {
  width: 12px;
  height: 12px;
}

.history-label {
  white-space: nowrap;
  letter-spacing: 0.5px;
}

.history-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 3px;
  background: rgba(56, 189, 248, 0.25);
  color: #7dd3fc;
  font-size: 10px;
  font-weight: 800;
}

/* History Popover Panel */
.history-dropdown-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  z-index: 9999;
  width: 360px;
  max-height: 420px;
  overflow-y: auto;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(56, 189, 248, 0.35);
  background: rgba(6, 10, 18, 0.98);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85), 0 0 24px rgba(56, 189, 248, 0.15);
  backdrop-filter: blur(24px);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 10px;
  font-weight: 800;
  color: rgba(148, 163, 184, 0.7);
  letter-spacing: 0.5px;
}

.clear-history-btn {
  border: none;
  background: transparent;
  color: #ef4444;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
}
.clear-history-btn:hover {
  background: rgba(239, 68, 68, 0.18);
}

.preset-chips {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preset-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.025);
  color: var(--color-text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.preset-chip:hover {
  background: rgba(56, 189, 248, 0.12);
  border-color: rgba(56, 189, 248, 0.35);
  color: #f8fafc;
}

.chip-code {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 10px;
  font-weight: 800;
  color: rgba(56, 189, 248, 0.8);
  flex-shrink: 0;
}

.chip-target {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 9px;
  font-weight: 800;
  padding: 1px 4px;
  border-radius: 3px;
  text-transform: uppercase;
  flex-shrink: 0;
}
.chip-target.all { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }
.chip-target.team1 { background: rgba(56, 189, 248, 0.2); color: #7dd3fc; }
.chip-target.team2 { background: rgba(249, 115, 22, 0.2); color: #fdba74; }

.chip-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-history {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 11px;
  color: var(--color-text-muted);
  text-align: center;
  padding: 14px 0;
  letter-spacing: 0.5px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.history-item:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #f8fafc;
}

.history-target-badge {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 9px;
  font-weight: 800;
  padding: 1px 4px;
  border-radius: 3px;
  text-transform: uppercase;
  flex-shrink: 0;
}
.history-target-badge.all { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }
.history-target-badge.team1 { background: rgba(56, 189, 248, 0.2); color: #7dd3fc; }
.history-target-badge.team2 { background: rgba(249, 115, 22, 0.2); color: #fdba74; }

.history-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
}

.history-time {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 10px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

/* Dispatch Button */
.warn-send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid transparent;
  color: #ffffff;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 11px;
  font-weight: 900;
  cursor: pointer;
  letter-spacing: 0.8px;
  transition: all 0.18s ease;
  flex-shrink: 0;
  text-transform: uppercase;
}

.warn-send-btn:hover {
  transform: translateY(-1px);
  filter: brightness(1.2);
}

.warn-send-btn.all {
  background: linear-gradient(135deg, #d97706, #b45309);
  border-color: rgba(245, 158, 11, 0.7);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.35);
}

.warn-send-btn.team1 {
  background: linear-gradient(135deg, #0284c7, #1d4ed8);
  border-color: rgba(56, 189, 248, 0.7);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.35);
}

.warn-send-btn.team2 {
  background: linear-gradient(135deg, #ea580c, #b91c1c);
  border-color: rgba(249, 115, 22, 0.7);
  box-shadow: 0 0 12px rgba(249, 115, 22, 0.35);
}

.warn-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.send-svg {
  width: 12px;
  height: 12px;
}

.key-hint {
  font-size: 10px;
  opacity: 0.7;
}

/* Standard Toolbar Refresh Controls */
.refresh-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  position: relative;
  z-index: 1000;
}

.refresh-button,
.menu-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.16s ease;
}

.refresh-button.active,
.refresh-button.primary-select {
  color: var(--color-text-primary);
  border-color: rgba(56, 189, 248, 0.4);
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.18), rgba(56, 189, 248, 0.08));
}

.danger-item {
  color: #fca5a5;
}

.refresh-button:hover,
.menu-item:hover {
  transform: translateY(-1px);
  color: var(--color-text-primary);
}

.refresh-button:disabled,
.menu-item:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
}

.ts-badge {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.025);
  color: var(--color-text-muted);
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 11px;
  white-space: nowrap;
}

.toolbar-spacer {
  flex: 1 1 auto;
}

.toolbar-timestamps {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-icon,
.refresh-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 6px;
}

.refresh-dropdown {
  position: relative;
}

.refresh-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 9999;
  min-width: 160px;
  display: grid;
  gap: 6px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  background: rgba(6, 10, 18, 0.98);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55);
}

.menu-item {
  width: 100%;
  justify-content: flex-start;
}

.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 1100px) {
  .toolbar-spacer {
    display: none;
  }

  .toolbar-row {
    align-items: flex-start;
  }
}

@media (max-width: 760px) {
  .squad-page-toolbar {
    padding: 8px 10px;
  }

  .admin-warn-control {
    min-width: 100%;
    max-width: 100%;
  }

  .history-dropdown-panel {
    width: 280px;
    right: -20px;
  }

  .refresh-controls {
    width: 100%;
    gap: 6px;
  }

  .refresh-button,
  .menu-item {
    min-height: 30px;
    padding: 0 10px;
    font-size: 11px;
  }
}
</style>
