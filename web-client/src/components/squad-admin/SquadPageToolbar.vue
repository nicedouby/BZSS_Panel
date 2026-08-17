<template>
  <div class="squad-page-toolbar">
    <div class="toolbar-row">

      <!-- Cyberpunk Interactive AdminWarn Control Bar -->
      <div class="admin-warn-control" :data-channel="selectedChannel" aria-label="AdminWarn Control Bar">
        <!-- Channel Selector Dropdown -->
        <div ref="channelMenuRoot" class="warn-channel-selector">
          <button
            type="button"
            class="channel-trigger-btn"
            :class="selectedChannel"
            :disabled="!canRefresh || isRefreshing"
            @click.stop="toggleChannelMenu"
            :title="`当前频道: ${currentChannelInfo.fullLabel} (${currentChannelInfo.badgeText})`"
          >
            <span class="channel-dot" />
            <span class="channel-icon">{{ currentChannelInfo.icon }}</span>
            <span class="channel-name">{{ currentChannelInfo.label }}</span>
            <span class="channel-caret">▾</span>
          </button>

          <transition name="menu-fade">
            <div v-if="channelMenuOpen" class="channel-dropdown-menu" role="menu">
              <div class="menu-header-label">选择警告目标频道</div>
              <button
                v-for="(ch, key) in CHANNELS"
                :key="key"
                type="button"
                class="channel-option-item"
                :class="[key, { active: selectedChannel === key }]"
                @click="selectChannel(key)"
              >
                <span class="opt-dot" />
                <span class="opt-icon">{{ ch.icon }}</span>
                <div class="opt-info">
                  <span class="opt-name">{{ ch.label }}</span>
                  <span class="opt-sub">{{ ch.badgeText }}</span>
                </div>
                <span v-if="selectedChannel === key" class="opt-check">✓</span>
              </button>
            </div>
          </transition>
        </div>

        <!-- Input Field with History/Preset button & Clear button -->
        <div class="warn-input-group" :class="{ 'has-focus': isInputFocused, 'has-content': warnInputText.trim().length > 0 }">
          <span class="input-channel-tag" :class="selectedChannel">
            {{ currentChannelInfo.label }}
          </span>

          <input
            ref="warnInputRef"
            v-model="warnInputText"
            type="text"
            class="warn-hero-input"
            :placeholder="`输入 AdminWarn 消息 (${currentChannelInfo.badgeText})...`"
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

          <!-- History / Presets Dropdown Toggle -->
          <div ref="historyMenuRoot" class="warn-history-wrapper">
            <button
              type="button"
              class="warn-history-trigger-btn"
              :class="{ active: historyMenuOpen, 'has-history': historyRecords.length > 0 }"
              title="警告历史与常用模版"
              @click.stop="toggleHistoryMenu"
            >
              <span class="history-icon">📜</span>
              <span class="history-label">记录</span>
              <span v-if="historyRecords.length > 0" class="history-count">{{ historyRecords.length }}</span>
            </button>

            <transition name="menu-fade">
              <div v-if="historyMenuOpen" class="history-dropdown-panel" role="menu">
                <!-- Presets Section -->
                <div class="panel-section">
                  <div class="section-title">
                    <span>⚡ 快捷模版 (点击填入)</span>
                  </div>
                  <div class="preset-chips">
                    <button
                      v-for="preset in PRESET_TEMPLATES"
                      :key="preset.text"
                      type="button"
                      class="preset-chip"
                      @click="applyPreset(preset)"
                    >
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
                    <span>📜 最近发送记录</span>
                    <button
                      v-if="historyRecords.length > 0"
                      type="button"
                      class="clear-history-btn"
                      @click="clearHistory"
                    >
                      清空记录
                    </button>
                  </div>

                  <div v-if="historyRecords.length === 0" class="empty-history">
                    暂无发送记录
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

        <!-- Send Action Button -->
        <button
          type="button"
          class="warn-send-btn"
          :class="selectedChannel"
          :disabled="!canRefresh || isRefreshing"
          @click="handleSendWarn"
          :title="warnInputText.trim() ? `发送警告至 ${currentChannelInfo.fullLabel}` : `打开 ${currentChannelInfo.fullLabel} 警告窗口`"
        >
          <span class="send-icon">⚡</span>
          <span class="send-text">发送</span>
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
    label: "All",
    fullLabel: "全体玩家",
    badgeText: "全服广播",
    color: "#f59e0b",
    icon: "📢",
  },
  team1: {
    label: "TEAM 1",
    fullLabel: "阵营 1",
    badgeText: "蓝方广播",
    color: "#38bdf8",
    icon: "🛡️",
  },
  team2: {
    label: "TEAM 2",
    fullLabel: "阵营 2",
    badgeText: "红方广播",
    color: "#f97316",
    icon: "⚔️",
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
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
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
  display: grid;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border-default);
  background:
    radial-gradient(circle at 0% 0%, rgba(56, 189, 248, 0.08), transparent 26%),
    radial-gradient(circle at 100% 0%, rgba(245, 158, 11, 0.08), transparent 24%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02)),
    var(--color-bg-card);
  backdrop-filter: blur(10px);
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}

/* Cyberpunk AdminWarn Control Bar */
.admin-warn-control {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 320px;
  max-width: 680px;
  background: rgba(15, 23, 42, 0.45);
  border: 1px solid var(--color-border-soft);
  border-radius: 999px;
  padding: 3px 4px 3px 6px;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.25), 0 2px 8px rgba(0, 0, 0, 0.15);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  backdrop-filter: blur(12px);
}

.admin-warn-control[data-channel="all"]:focus-within {
  border-color: rgba(245, 158, 11, 0.6);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.25), 0 0 14px rgba(245, 158, 11, 0.22);
}

.admin-warn-control[data-channel="team1"]:focus-within {
  border-color: rgba(56, 189, 248, 0.6);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.25), 0 0 14px rgba(56, 189, 248, 0.22);
}

.admin-warn-control[data-channel="team2"]:focus-within {
  border-color: rgba(249, 115, 22, 0.6);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.25), 0 0 14px rgba(249, 115, 22, 0.22);
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
  height: 32px;
  padding: 0 10px 0 8px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}

.channel-trigger-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: translateY(-1px);
}

.channel-trigger-btn.all {
  border-color: rgba(245, 158, 11, 0.5);
  color: #fcd34d;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.16), rgba(245, 158, 11, 0.06));
}

.channel-trigger-btn.team1 {
  border-color: rgba(56, 189, 248, 0.5);
  color: #7dd3fc;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.16), rgba(56, 189, 248, 0.06));
}

.channel-trigger-btn.team2 {
  border-color: rgba(249, 115, 22, 0.5);
  color: #fdba74;
  background: linear-gradient(135deg, rgba(249, 115, 22, 0.16), rgba(249, 115, 22, 0.06));
}

.channel-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  box-shadow: 0 0 6px currentColor;
}
.channel-trigger-btn.all .channel-dot { background: #f59e0b; }
.channel-trigger-btn.team1 .channel-dot { background: #38bdf8; }
.channel-trigger-btn.team2 .channel-dot { background: #f97316; }

.channel-icon {
  font-size: 13px;
  line-height: 1;
}

.channel-name {
  white-space: nowrap;
  letter-spacing: 0.5px;
}

.channel-caret {
  font-size: 10px;
  opacity: 0.7;
}

/* Channel Dropdown Menu */
.channel-dropdown-menu {
  position: absolute;
  left: 0;
  top: calc(100% + 8px);
  z-index: 30;
  width: 180px;
  padding: 6px;
  border-radius: 14px;
  border: 1px solid var(--color-border-default);
  background: rgba(10, 15, 24, 0.96);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.menu-header-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 8px 2px;
}

.channel-option-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.channel-option-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
}

.channel-option-item.all.active {
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.12);
  color: #fcd34d;
}

.channel-option-item.team1.active {
  border-color: rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.12);
  color: #7dd3fc;
}

.channel-option-item.team2.active {
  border-color: rgba(249, 115, 22, 0.4);
  background: rgba(249, 115, 22, 0.12);
  color: #fdba74;
}

.opt-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.channel-option-item.all .opt-dot { background: #f59e0b; }
.channel-option-item.team1 .opt-dot { background: #38bdf8; }
.channel-option-item.team2 .opt-dot { background: #f97316; }

.opt-info {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.opt-name {
  font-weight: 700;
}

.opt-sub {
  font-size: 10px;
  opacity: 0.65;
}

.opt-check {
  font-weight: 900;
  font-size: 11px;
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

.input-channel-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  user-select: none;
  flex-shrink: 0;
}

.input-channel-tag.all {
  background: rgba(245, 158, 11, 0.2);
  color: #fcd34d;
}

.input-channel-tag.team1 {
  background: rgba(56, 189, 248, 0.2);
  color: #7dd3fc;
}

.input-channel-tag.team2 {
  background: rgba(249, 115, 22, 0.2);
  color: #fdba74;
}

.warn-hero-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 32px;
  padding: 0 4px;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
}

.warn-hero-input::placeholder {
  color: rgba(148, 163, 184, 0.55);
}

.warn-clear-btn {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 50%;
  line-height: 1;
  transition: color 0.15s ease;
}

.warn-clear-btn:hover {
  color: #ef4444;
}

/* History Dropdown Wrapper & Trigger */
.warn-history-wrapper {
  position: relative;
  flex-shrink: 0;
}

.warn-history-trigger-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}

.warn-history-trigger-btn:hover,
.warn-history-trigger-btn.active {
  background: rgba(255, 255, 255, 0.12);
  color: var(--color-text-primary);
  border-color: rgba(255, 255, 255, 0.2);
}

.history-icon {
  font-size: 12px;
}

.history-label {
  white-space: nowrap;
}

.history-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(56, 189, 248, 0.25);
  color: #7dd3fc;
  font-size: 10px;
  font-weight: 800;
}

/* History Popover Panel */
.history-dropdown-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 35;
  width: 320px;
  max-height: 380px;
  overflow-y: auto;
  padding: 10px;
  border-radius: 16px;
  border: 1px solid var(--color-border-default);
  background: rgba(10, 15, 24, 0.97);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(20px);
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
}

.clear-history-btn {
  border: none;
  background: transparent;
  color: #ef4444;
  font-size: 10px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}

.clear-history-btn:hover {
  background: rgba(239, 68, 68, 0.15);
}

.preset-chips {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preset-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
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
  border-color: rgba(56, 189, 248, 0.3);
  color: var(--color-text-primary);
}

.chip-target {
  font-size: 9px;
  font-weight: 800;
  padding: 1px 4px;
  border-radius: 3px;
  text-transform: uppercase;
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
  font-size: 12px;
  color: var(--color-text-muted);
  text-align: center;
  padding: 12px 0;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
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
  color: var(--color-text-primary);
}

.history-target-badge {
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
}

.history-time {
  font-size: 10px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

/* Send Button */
.warn-send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid transparent;
  color: #ffffff;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  letter-spacing: 0.5px;
  transition: all 0.18s ease;
  flex-shrink: 0;
}

.warn-send-btn:hover {
  transform: translateY(-1px);
  filter: brightness(1.15);
}

.warn-send-btn.all {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  border-color: rgba(245, 158, 11, 0.6);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.35);
}

.warn-send-btn.team1 {
  background: linear-gradient(135deg, #0284c7, #2563eb);
  border-color: rgba(56, 189, 248, 0.6);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.35);
}

.warn-send-btn.team2 {
  background: linear-gradient(135deg, #ea580c, #dc2626);
  border-color: rgba(249, 115, 22, 0.6);
  box-shadow: 0 0 12px rgba(249, 115, 22, 0.35);
}

.warn-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.send-icon {
  font-size: 12px;
}

/* Standard Toolbar Refresh Controls */
.refresh-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.refresh-button,
.menu-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  font-size: 13px;
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
  min-height: 32px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.025);
  color: var(--color-text-muted);
  font-size: 12px;
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
  z-index: 20;
  min-width: 160px;
  display: grid;
  gap: 6px;
  padding: 8px;
  border-radius: 14px;
  border: 1px solid var(--color-border-default);
  background: rgba(8, 12, 18, 0.96);
  box-shadow: 0 18px 40px rgba(2, 6, 23, 0.28);
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
    right: -40px;
  }

  .refresh-controls {
    width: 100%;
    gap: 6px;
  }

  .refresh-button,
  .menu-item {
    min-height: 32px;
    padding: 0 10px;
    font-size: 12px;
  }
}
</style>
