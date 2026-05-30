<template>
  <aside class="match-chat-panel">
    <header class="match-chat-header">
      <div class="match-chat-title-block">
        <div class="match-chat-eyebrow">Live feed</div>
        <h2 class="match-chat-title">聊天记录</h2>
        <p class="match-chat-subtitle">
          实时接收聊天监控模块推送的标准化事件
        </p>
      </div>

      <div class="match-chat-status-group">
        <StatusBadge :tone="statusTone">{{ statusText }}</StatusBadge>
        <button
          type="button"
          class="match-chat-action"
          :class="{ active: autoScroll }"
          @click="autoScroll = !autoScroll"
        >
          {{ autoScroll ? "自动滚动" : "暂停滚动" }}
        </button>
        <button
          type="button"
          class="match-chat-action"
          @click="clearLocalMessages"
        >
          清空
        </button>
      </div>
    </header>

    <div class="match-chat-toolbar">
      <button
        v-for="channel in channels"
        :key="channel.id"
        type="button"
        class="match-chat-filter"
        :class="{ active: enabledChannels[channel.id] }"
        :data-channel="channel.id"
        @click="toggleChannel(channel.id)"
      >
        <span class="match-chat-filter-label">{{ channel.label }}</span>
        <span class="match-chat-filter-count">{{ channelCounts[channel.id] }}</span>
      </button>
    </div>

    <div ref="listRef" class="match-chat-list">
      <div v-if="visibleMessages.length === 0" class="match-chat-empty">
        暂无聊天记录
      </div>

      <article
        v-for="message in visibleMessages"
        :key="message.id"
        class="match-chat-row"
        :class="[`channel-${message.channel}`]"
      >
        <div class="match-chat-row-head">
          <span class="match-chat-time">{{ formatTime(message) }}</span>
          <span class="match-chat-channel">[{{ channelLabels[message.channel] }}]</span>
          <span class="match-chat-player" :title="playerTooltip(message)">
            {{ displayPlayer(message) }}
          </span>
        </div>

        <div class="match-chat-message">
          {{ message.message }}
        </div>

        <div v-if="message.teamId != null || message.squadId != null" class="match-chat-meta">
          <span v-if="message.teamId != null">Team {{ message.teamId }}</span>
          <span v-if="message.squadId != null">Squad {{ message.squadId }}</span>
          <span v-if="message.serverId">Server {{ message.serverId }}</span>
        </div>
      </article>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useAuthStore } from "../../stores/auth.store";
import StatusBadge from "../common/StatusBadge.vue";

defineOptions({
  name: "MatchChatPanel",
});

type ChatChannel = "all" | "team" | "squad" | "admin" | "system" | "unknown";

interface ChatMessageEvent {
  id: string;
  serverId: string;
  timestamp: number;
  logTime?: string | null;
  channel: ChatChannel;
  playerName?: string | null;
  eosId?: string | null;
  steamId?: string | null;
  teamId?: number | null;
  squadId?: number | null;
  message: string;
}

interface SocketEnvelope {
  event?: string;
  items?: unknown;
  item?: unknown;
}

const MAX_MESSAGES = 300;

const auth = useAuthStore();
const listRef = ref<HTMLElement | null>(null);
const socketRef = ref<WebSocket | null>(null);
const autoScroll = ref(true);
const messages = ref<ChatMessageEvent[]>([]);
const reconnectDelay = ref(1000);
const transportState = ref<"idle" | "connecting" | "live" | "reconnecting" | "offline" | "unsupported">("idle");

const enabledChannels = reactive<Record<ChatChannel, boolean>>({
  all: true,
  team: true,
  squad: true,
  admin: true,
  system: true,
  unknown: true,
});

const channels = [
  { id: "all", label: "All" },
  { id: "team", label: "Team" },
  { id: "squad", label: "Squad" },
  { id: "admin", label: "Admin" },
  { id: "system", label: "System" },
  { id: "unknown", label: "Unknown" },
] as const;

const channelLabels: Record<ChatChannel, string> = {
  all: "ALL",
  team: "TEAM",
  squad: "SQUAD",
  admin: "ADMIN",
  system: "SYSTEM",
  unknown: "UNKNOWN",
};

const channelCounts = computed<Record<ChatChannel, number>>(() => {
  const counts: Record<ChatChannel, number> = {
    all: 0,
    team: 0,
    squad: 0,
    admin: 0,
    system: 0,
    unknown: 0,
  };

  for (const message of messages.value) {
    counts[message.channel] += 1;
  }

  return counts;
});

const visibleMessages = computed(() => {
  return messages.value.filter((message) => enabledChannels[message.channel] !== false);
});

const statusText = computed(() => {
  switch (transportState.value) {
    case "live":
      return "在线";
    case "connecting":
      return "连接中";
    case "reconnecting":
      return "重连中";
    case "offline":
      return "已断开";
    case "unsupported":
      return "不可用";
    default:
      return "待连接";
  }
});

const statusTone = computed(() => {
  switch (transportState.value) {
    case "live":
      return "ok";
    case "connecting":
      return "idle";
    case "reconnecting":
      return "warn";
    case "offline":
    case "unsupported":
      return "error";
    default:
      return "idle";
  }
});

let reconnectTimer: number | null = null;
let shouldReconnect = false;

onMounted(() => {
  watchAuthState();
});

onBeforeUnmount(() => {
  shouldReconnect = false;
  disconnectSocket();
  clearReconnectTimer();
});

watch(
  () => [auth.checked, auth.authenticated] as const,
  () => {
    watchAuthState();
  },
  { immediate: true },
);

watch(
  () => messages.value.length,
  async () => {
    if (!autoScroll.value) return;
    await nextTick();
    scrollToBottom();
  },
);

function watchAuthState() {
  if (!auth.checked || !auth.authenticated) {
    shouldReconnect = false;
    disconnectSocket();
    transportState.value = auth.checked ? "offline" : "idle";
    return;
  }

  shouldReconnect = true;

  if (socketRef.value) {
    return;
  }

  connectSocket();
}

function connectSocket() {
  if (typeof window.WebSocket === "undefined") {
    transportState.value = "unsupported";
    return;
  }

  clearReconnectTimer();
  transportState.value = socketRef.value ? "reconnecting" : "connecting";

  const socket = new WebSocket(buildWebSocketUrl("/ws/chat"));
  socketRef.value = socket;

  socket.addEventListener("open", handleSocketOpen);
  socket.addEventListener("message", handleSocketMessage);
  socket.addEventListener("close", handleSocketClose);
  socket.addEventListener("error", handleSocketError);
}

function handleSocketOpen() {
  reconnectDelay.value = 1000;
  transportState.value = "live";
}

function handleSocketMessage(event: MessageEvent<string>) {
  let payload: SocketEnvelope | ChatMessageEvent[] | ChatMessageEvent | null = null;

  try {
    payload = JSON.parse(String(event.data ?? "null"));
  } catch {
    return;
  }

  if (Array.isArray(payload)) {
    replaceMessages(payload);
    return;
  }

  if (!payload || typeof payload !== "object") {
    return;
  }

  const envelope = payload as SocketEnvelope;

  if (envelope.event === "server:chat:recent") {
    replaceMessages(Array.isArray(envelope.items) ? envelope.items : []);
    return;
  }

  if (envelope.event === "server:chat:message") {
    appendMessage(envelope.item);
  }
}

function handleSocketClose() {
  socketRef.value = null;

  if (!shouldReconnect) {
    transportState.value = "offline";
    return;
  }

  transportState.value = "reconnecting";
  scheduleReconnect();
}

function handleSocketError() {
  if (!shouldReconnect) {
    return;
  }
  transportState.value = "reconnecting";
}

function scheduleReconnect() {
  clearReconnectTimer();

  const delay = reconnectDelay.value;
  reconnectDelay.value = Math.min(Math.floor(delay * 1.6), 10_000);

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (!shouldReconnect || !auth.checked || !auth.authenticated || socketRef.value) {
      return;
    }
    connectSocket();
  }, delay);
}

function clearReconnectTimer() {
  if (reconnectTimer != null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function disconnectSocket() {
  clearReconnectTimer();

  const socket = socketRef.value;
  socketRef.value = null;

  if (!socket) {
    return;
  }

  socket.removeEventListener("open", handleSocketOpen);
  socket.removeEventListener("message", handleSocketMessage);
  socket.removeEventListener("close", handleSocketClose);
  socket.removeEventListener("error", handleSocketError);

  try {
    socket.close();
  } catch {}
}

function replaceMessages(items: unknown[]) {
  const next = items
    .map((item) => normalizeIncomingMessage(item))
    .filter((item): item is ChatMessageEvent => Boolean(item));

  messages.value = dedupeAndLimit(next);
}

function appendMessage(item: unknown) {
  const normalized = normalizeIncomingMessage(item);
  if (!normalized) return;

  const next = [...messages.value, normalized];
  messages.value = dedupeAndLimit(next);
}

function dedupeAndLimit(items: ChatMessageEvent[]) {
  const seen = new Set<string>();
  const result: ChatMessageEvent[] = [];

  for (const item of items) {
    const id = String(item.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }

  return result.slice(-MAX_MESSAGES);
}

function normalizeIncomingMessage(raw: unknown): ChatMessageEvent | null {
  if (!raw || typeof raw !== "object") return null;

  const source = raw as Record<string, any>;
  const timestamp = normalizeTimestamp(source.timestamp ?? source.time ?? source.at);
  const message = String(source.message ?? "").trim();
  if (!message) return null;

  return {
    id: normalizeId(source.id ?? source.seq ?? `${timestamp}-${source.channel ?? ""}-${source.playerName ?? source.name ?? ""}-${message}`),
    serverId: String(source.serverId ?? source.server_id ?? ""),
    timestamp,
    logTime: normalizeNullableText(source.logTime ?? source.log_time),
    channel: normalizeChannel(source.chatChannel ?? source.channel),
    playerName: normalizeNullableText(source.playerName ?? source.name),
    eosId: normalizeNullableText(source.eosId ?? source.eosID ?? source.eosid),
    steamId: normalizeNullableText(source.steamId ?? source.steamID ?? source.steamid),
    teamId: normalizeNullableNumber(source.teamId ?? source.teamID),
    squadId: normalizeNullableNumber(source.squadId ?? source.squadID),
    message,
  };
}

function normalizeChannel(value: unknown): ChatChannel {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "unknown";

  if (text === "chatall" || text === "all") return "all";
  if (text === "chatteam" || text === "team") return "team";
  if (text === "chatsquad" || text === "squad") return "squad";
  if (text === "chatadmin" || text === "admin") return "admin";
  if (text === "chatsystem" || text === "system") return "system";
  return "unknown";
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const text = String(value ?? "").trim();
  if (!text) return Date.now();

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;

  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;

  return Date.now();
}

function normalizeNullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeId(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function displayPlayer(message: ChatMessageEvent): string {
  if (message.playerName) return message.playerName;
  if (message.channel === "system") return "System";
  if (message.channel === "admin") return "Admin";
  return "Unknown";
}

function playerTooltip(message: ChatMessageEvent): string {
  return [message.steamId, message.eosId].filter(Boolean).join(" / ");
}

function formatTime(message: ChatMessageEvent): string {
  if (message.logTime) return message.logTime;
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(message.timestamp));
}

function scrollToBottom() {
  const el = listRef.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

function clearLocalMessages() {
  messages.value = [];
}

function toggleChannel(channel: ChatChannel) {
  enabledChannels[channel] = !enabledChannels[channel];
}

function buildWebSocketUrl(path: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}
</script>

<style scoped>
.match-chat-panel {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(130, 154, 180, 0.22);
  border-radius: 16px;
  background:
    radial-gradient(circle at 0% 0%, rgba(96, 165, 250, 0.1), transparent 28%),
    radial-gradient(circle at 100% 0%, rgba(34, 197, 94, 0.06), transparent 24%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.014)),
    rgba(13, 20, 28, 0.96);
  box-shadow: var(--shadow-md);
}

.match-chat-header {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  padding: 10px 12px 8px;
  border-bottom: 1px solid rgba(130, 154, 180, 0.16);
  background: rgba(8, 12, 18, 0.62);
}

.match-chat-title-block {
  min-width: 0;
}

.match-chat-eyebrow {
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.match-chat-title {
  margin: 2px 0 0;
  font-size: 16px;
  line-height: 1.2;
  color: var(--color-text-primary);
}

.match-chat-subtitle {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--color-text-muted);
}

.match-chat-status-group {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.match-chat-action {
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(130, 154, 180, 0.22);
  background: rgba(20, 28, 39, 0.85);
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.match-chat-action.active {
  color: #dbeafe;
  border-color: rgba(96, 165, 250, 0.38);
  background: rgba(37, 99, 235, 0.18);
}

.match-chat-toolbar {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(130, 154, 180, 0.12);
}

.match-chat-filter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(130, 154, 180, 0.22);
  background: rgba(19, 26, 37, 0.88);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12px;
}

.match-chat-filter.active {
  background: rgba(31, 41, 55, 0.95);
  color: var(--color-text-primary);
  border-color: rgba(148, 163, 184, 0.4);
}

.match-chat-filter[data-channel="all"].active {
  border-color: rgba(96, 165, 250, 0.5);
  color: #dbeafe;
}

.match-chat-filter[data-channel="team"].active {
  border-color: rgba(52, 211, 153, 0.45);
  color: #bbf7d0;
}

.match-chat-filter[data-channel="squad"].active {
  border-color: rgba(250, 204, 21, 0.45);
  color: #fef08a;
}

.match-chat-filter[data-channel="admin"].active {
  border-color: rgba(248, 113, 113, 0.45);
  color: #fecaca;
}

.match-chat-filter[data-channel="system"].active {
  border-color: rgba(192, 132, 252, 0.45);
  color: #e9d5ff;
}

.match-chat-filter[data-channel="unknown"].active {
  border-color: rgba(148, 163, 184, 0.45);
  color: #e2e8f0;
}

.match-chat-filter-label {
  font-weight: 600;
}

.match-chat-filter-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  text-align: center;
  font-size: 11px;
  color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.05);
}

.match-chat-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px 10px;
  display: grid;
  gap: 8px;
  align-content: start;
  align-items: start;
}

.match-chat-empty {
  padding: 24px 12px;
  border-radius: 12px;
  border: 1px dashed rgba(130, 154, 180, 0.22);
  color: var(--color-text-muted);
  text-align: center;
  font-size: 13px;
}

.match-chat-row {
  display: grid;
  gap: 5px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid rgba(130, 154, 180, 0.14);
  background: rgba(255, 255, 255, 0.03);
  align-self: start;
}

.match-chat-row-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
}

.match-chat-time {
  color: var(--color-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.match-chat-channel {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.match-chat-player {
  min-width: 0;
  color: var(--color-text-primary);
  font-weight: 600;
  font-size: 13px;
}

.match-chat-message {
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.45;
  word-break: break-word;
  white-space: pre-wrap;
}

.match-chat-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.match-chat-row.channel-all {
  border-color: rgba(96, 165, 250, 0.18);
}

.match-chat-row.channel-team {
  border-color: rgba(52, 211, 153, 0.18);
}

.match-chat-row.channel-squad {
  border-color: rgba(250, 204, 21, 0.18);
}

.match-chat-row.channel-admin {
  border-color: rgba(248, 113, 113, 0.18);
}

.match-chat-row.channel-system {
  border-color: rgba(192, 132, 252, 0.18);
}

.match-chat-row.channel-unknown {
  border-color: rgba(148, 163, 184, 0.16);
}

.match-chat-row.channel-all .match-chat-channel {
  color: #93c5fd;
}

.match-chat-row.channel-team .match-chat-channel {
  color: #86efac;
}

.match-chat-row.channel-squad .match-chat-channel {
  color: #fde047;
}

.match-chat-row.channel-admin .match-chat-channel {
  color: #fca5a5;
}

.match-chat-row.channel-system .match-chat-channel {
  color: #d8b4fe;
}

.match-chat-row.channel-unknown .match-chat-channel {
  color: #cbd5e1;
}

@media (max-width: 1180px) {
  .match-chat-panel {
    min-height: 320px;
  }

  .match-chat-header {
    flex-direction: column;
  }

  .match-chat-status-group {
    justify-content: flex-start;
  }
}
</style>
