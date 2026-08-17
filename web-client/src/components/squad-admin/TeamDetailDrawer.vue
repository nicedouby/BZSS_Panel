<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open && props.team" class="drawer-root" @click="close">
        <aside class="team-detail-drawer" :style="panelStyle" @click.stop>
          <!-- HUD Ambient Top Glow Bar -->
          <div class="hud-accent-bar" :class="teamColorClass"></div>

          <!-- HEADER: Gamer HUD Header -->
          <header class="drawer-header-hud" :class="teamColorClass">
            <!-- Radial background glow -->
            <div class="hud-header-glow"></div>

            <!-- Slanted flag background -->
            <div
              v-if="factionFlagUrl"
              class="hud-header-flag-bg"
              :style="{ backgroundImage: `url(${factionFlagUrl})` }"
            ></div>

            <div class="hud-profile-row">
              <!-- Faction Flag Emblem -->
              <div class="hud-emblem-frame" :class="teamColorClass">
                <img v-if="factionFlagUrl" class="hud-flag-img" :src="factionFlagUrl" alt="" />
                <span v-else class="hud-flag-fallback">T{{ props.team.teamId }}</span>
                <img v-if="unitIconUrl" class="hud-unit-icon" :src="unitIconUrl" alt="" title="Unit Icon" />
              </div>

              <!-- Faction Title & Badges -->
              <div class="hud-title-block">
                <div class="hud-name-row">
                  <span class="team-id-chip" :class="teamColorClass">TEAM {{ props.team.teamId }}</span>
                  <h2 class="drawer-team-name" :title="props.team.teamName">{{ props.team.teamName }}</h2>
                </div>

                <div class="hud-meta-row">
                  <span class="meta-chip">
                    <span class="chip-dot" :class="{ ok: props.team.playerCount > 0 }"></span>
                    在线 {{ props.team.playerCount }} / {{ props.team.maxPlayers }}
                  </span>

                  <span class="meta-chip" :class="{ warn: props.team.ticketCount !== null && props.team.ticketCount < 50 }">
                    🎟️ 剩余票数: <strong>{{ props.team.ticketCount ?? '--' }}</strong>
                  </span>

                  <span class="meta-chip">
                    🛡️ 小队: {{ props.team.squads.length }}
                  </span>
                </div>
              </div>

              <button type="button" class="drawer-close-btn" @click="close" title="关闭 (Esc)">
                ×
              </button>
            </div>

            <!-- Tab Navigation Bar -->
            <nav class="drawer-tabs-nav">
              <button
                type="button"
                class="tab-nav-btn"
                :class="{ active: activeTab === 'overview' }"
                @click="activeTab = 'overview'"
              >
                📊 阵营概览
              </button>
              <button
                type="button"
                class="tab-nav-btn"
                :class="{ active: activeTab === 'commands' }"
                @click="activeTab = 'commands'"
              >
                ⚡ 阵营指令 & 警告
              </button>
              <button
                type="button"
                class="tab-nav-btn"
                :class="{ active: activeTab === 'squads' }"
                @click="activeTab = 'squads'"
              >
                🛡️ 小队列表 ({{ props.team.squads.length }})
              </button>
            </nav>
          </header>

          <!-- BODY CONTAINER -->
          <div class="drawer-body">
            <!-- TAB 1: OVERVIEW -->
            <div v-if="activeTab === 'overview'" class="tab-pane">
              <!-- Metric Summary Cards Grid -->
              <section class="detail-card">
                <div class="card-title">阵营核心统计 / METRICS</div>
                <div class="metrics-grid">
                  <div class="metric-box">
                    <span class="metric-label">剩余票数</span>
                    <strong class="metric-value" :class="{ danger: props.team.ticketCount !== null && props.team.ticketCount <= 0 }">
                      {{ props.team.ticketCount ?? '--' }}
                    </strong>
                    <span class="metric-sub">
                      {{ canEditTickets ? '可快捷编辑' : '只读状态' }}
                    </span>
                  </div>

                  <div class="metric-box">
                    <span class="metric-label">在线人数 / 上限</span>
                    <strong class="metric-value">{{ props.team.playerCount }} / {{ props.team.maxPlayers }}</strong>
                    <div class="capacity-track">
                      <div class="capacity-fill" :style="{ width: `${occupancyPercent}%` }"></div>
                    </div>
                  </div>

                  <div class="metric-box">
                    <span class="metric-label">全队平均游戏时长</span>
                    <strong class="metric-value">{{ teamAveragePlaytimeText }}</strong>
                    <span class="metric-sub">包含在线公开时长玩家</span>
                  </div>

                  <div class="metric-box">
                    <span class="metric-label">队长平均游戏时长</span>
                    <strong class="metric-value">{{ teamLeaderAveragePlaytimeText }}</strong>
                    <span class="metric-sub">核心小队指挥官经验</span>
                  </div>
                </div>
              </section>

              <!-- Steam Privacy Ratio Card -->
              <section class="detail-card">
                <div class="card-title">Steam 隐私概览 / STEAM PRIVACY</div>
                <div class="privacy-summary-row">
                  <div class="privacy-stat">
                    <span class="p-dot public"></span>
                    <span>公开时长: <strong>{{ props.team.publicPlaytimePlayers }} 人</strong></span>
                  </div>
                  <div class="privacy-stat">
                    <span class="p-dot private"></span>
                    <span>私密/隐藏: <strong>{{ props.team.privatePlaytimePlayers }} 人</strong></span>
                  </div>
                </div>
                <div class="privacy-progress-bar">
                  <div class="privacy-fill public" :style="{ width: `${publicRatioPercent}%` }" title="公开时长玩家"></div>
                  <div class="privacy-fill private" :style="{ width: `${privateRatioPercent}%` }" title="私密时长玩家"></div>
                </div>
              </section>

              <!-- Squads Quick List -->
              <section class="detail-card">
                <div class="card-title-row">
                  <span class="card-title">阵营小队概览 / SQUADS OVERVIEW</span>
                  <button type="button" class="link-btn" @click="activeTab = 'squads'">查看全部 →</button>
                </div>

                <div v-if="props.team.squads.length === 0" class="empty-tip">
                  当前阵营暂无小队
                </div>

                <div v-else class="squads-compact-list">
                  <div
                    v-for="squad in props.team.squads.slice(0, 6)"
                    :key="squad.squadId ?? squad.squadName"
                    class="squad-mini-item"
                    @click="handleSelectSquad(squad)"
                  >
                    <div class="mini-squad-left">
                      <span class="nature-pill" :data-nature="squad.squadNature">
                        {{ squad.squadNatureLabel || '小队' }}
                      </span>
                      <span class="squad-name-txt">{{ squad.squadName }}</span>
                      <span v-if="squad.isLocked" class="lock-tag">🔒 已锁</span>
                    </div>

                    <div class="mini-squad-right">
                      <span class="leader-txt">队长: {{ squad.leader?.name || '无队长' }}</span>
                      <span class="count-badge">{{ squad.memberCount }}/{{ squad.maxMembers }}人</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <!-- TAB 2: COMMANDS & WARNS -->
            <div v-else-if="activeTab === 'commands'" class="tab-pane">
              <!-- Warn Team Section -->
              <section class="detail-card warn-card">
                <div class="card-title warning-title">
                  <span>⚠️ 发送阵营广播/警告 (WARN TEAM {{ props.team.teamId }})</span>
                </div>
                <p class="section-desc">警告消息将通过 RCON / 广播系统实时下发给当前阵营的所有在线玩家。</p>

                <!-- Preset Pills -->
                <div class="preset-pills-label">快捷快捷预设消息：</div>
                <div class="preset-pills-grid">
                  <button
                    v-for="preset in presetWarnMessages"
                    :key="preset"
                    type="button"
                    class="preset-pill-btn"
                    :class="{ selected: warnMessageInput === preset }"
                    @click="warnMessageInput = preset"
                  >
                    {{ preset }}
                  </button>
                </div>

                <!-- Input area -->
                <div class="warn-input-wrapper">
                  <input
                    v-model="warnMessageInput"
                    type="text"
                    class="warn-text-input"
                    placeholder="输入警告内容，例如：请遵守服务器规则..."
                    @keydown.enter.prevent="handleWarnTeamSubmit"
                  />
                  <button
                    type="button"
                    class="action-btn warn-submit-btn"
                    :disabled="actionBusy || !warnMessageInput.trim()"
                    @click="handleWarnTeamSubmit"
                  >
                    {{ actionBusy ? '发送中...' : '📢 发送警告' }}
                  </button>
                </div>
              </section>

              <!-- Ticket Adjustment Section (If permitted) -->
              <section v-if="canEditTickets" class="detail-card">
                <div class="card-title">🎟️ 阵营票数调整 / TICKET CONTROL</div>

                <div class="ticket-control-row">
                  <div class="current-ticket-display">
                    <span class="ct-label">当前票数</span>
                    <strong class="ct-val">{{ props.team.ticketCount ?? '--' }}</strong>
                  </div>

                  <div class="quick-adjust-btns">
                    <button type="button" class="adjust-chip" :disabled="actionBusy" @click="handleQuickAdjustTicket(50)">+50</button>
                    <button type="button" class="adjust-chip" :disabled="actionBusy" @click="handleQuickAdjustTicket(100)">+100</button>
                    <button type="button" class="adjust-chip" :disabled="actionBusy" @click="handleQuickAdjustTicket(-50)">-50</button>
                    <button type="button" class="adjust-chip" :disabled="actionBusy" @click="handleQuickAdjustTicket(-100)">-100</button>
                  </div>
                </div>

                <button type="button" class="action-btn ticket-edit-modal-btn" @click="handleEditTickets">
                  打开高级票数修改器...
                </button>
              </section>
            </div>

            <!-- TAB 3: SQUADS LIST -->
            <div v-else-if="activeTab === 'squads'" class="tab-pane">
              <section class="detail-card">
                <div class="card-title">全阵营小队管理列表 ({{ props.team.squads.length }})</div>

                <div v-if="props.team.squads.length === 0" class="empty-tip">
                  当前阵营暂无小队
                </div>

                <div v-else class="squads-full-grid">
                  <div
                    v-for="squad in props.team.squads"
                    :key="squad.squadId ?? squad.squadName"
                    class="squad-full-card"
                    @click="handleSelectSquad(squad)"
                  >
                    <div class="sfc-head">
                      <span class="nature-pill" :data-nature="squad.squadNature">
                        {{ squad.squadNatureLabel || '小队' }}
                      </span>
                      <h4 class="sfc-name">{{ squad.squadName }}</h4>
                      <StatusBadge :tone="squad.isLocked ? 'warn' : 'ok'">
                        {{ squad.isLocked ? '🔒 已锁' : '🔓 未锁' }}
                      </StatusBadge>
                    </div>

                    <div class="sfc-body">
                      <div class="sfc-row">
                        <span class="lbl">队长:</span>
                        <strong class="val" :class="{ 'no-leader': !squad.leader }">
                          {{ squad.leader ? squad.leader.name : '无队长' }}
                        </strong>
                      </div>

                      <div class="sfc-row">
                        <span class="lbl">创建者:</span>
                        <span class="val">{{ squad.creatorName || 'Unknown' }}</span>
                      </div>

                      <div class="sfc-row">
                        <span class="lbl">成员数量:</span>
                        <span class="val">{{ squad.memberCount }} / {{ squad.maxMembers }} 人</span>
                      </div>

                      <div v-if="squad.averagePlaytimeHours !== null" class="sfc-row">
                        <span class="lbl">平均时长:</span>
                        <span class="val">{{ squad.averagePlaytimeHours }} 小时</span>
                      </div>
                    </div>

                    <div class="sfc-foot">
                      <span class="sfc-click-tip">点击查看小队详情与指令 →</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import type { TeamViewModel, SquadViewModel } from "../../types/squad-admin.types";
import { useUiStore } from "../../stores/ui.store";
import { warnTarget, adjustTickets } from "../../app/squadManagementApi";
import StatusBadge from "../common/StatusBadge.vue";
import { getFlagUrl, 获取战斗群旗帜, getUnitIconUrlByTeamName } from "../../shared/faction-assets/faction-data";

const props = defineProps<{
  team: TeamViewModel | null;
  open: boolean;
  canEditTickets?: boolean;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "warn-team", teamId: number): void;
  (event: "edit-tickets", team: TeamViewModel): void;
  (event: "select-squad", squad: SquadViewModel): void;
}>();

const ui = useUiStore();
const actionBusy = ref(false);
const activeTab = ref<"overview" | "commands" | "squads">("overview");
const warnMessageInput = ref("请遵守服务器规则，文明游戏");

const presetWarnMessages = [
  "请遵守服务器规则，文明游戏",
  "禁止单人锁队 / 违反锁队人数限制",
  "禁止越界压家，请退回合法区域",
  "请队长建立 FOB 兵营并加强队内沟通",
  "请合理分配载具资源，禁止浪费",
];

const viewport = ref({
  width: typeof window !== "undefined" ? window.innerWidth : 1280,
  height: typeof window !== "undefined" ? window.innerHeight : 800,
});

const updateViewport = () => {
  viewport.value = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
};

const panelStyle = computed(() => {
  const compactViewport = viewport.value.width < 920 || viewport.value.height < 760;
  if (compactViewport) {
    return {
      width: "calc(100vw - 24px)",
      maxHeight: "calc(var(--app-viewport-height) - 24px)",
    };
  }

  const panelWidth = Math.min(540, Math.max(420, Math.round(viewport.value.width * 0.38)));

  return {
    width: `${panelWidth}px`,
    maxHeight: `${Math.max(360, viewport.value.height - 48)}px`,
  };
});

const teamColorClass = computed(() => {
  if (!props.team) return "";
  return props.team.teamColorType === "team1" ? "team1-theme" : "team2-theme";
});

const factionFlagUrl = computed(() => {
  if (!props.team) return null;
  return getFlagUrl(props.team.factionCode ?? "") ?? 获取战斗群旗帜(props.team.teamName);
});

const unitIconUrl = computed(() => {
  if (!props.team) return null;
  return getUnitIconUrlByTeamName(props.team.teamName);
});

const teamAveragePlaytimeText = computed(() => {
  if (!props.team || props.team.averagePlaytimeHours === null) return "--";
  return `${props.team.averagePlaytimeHours}h`;
});

const teamLeaderAveragePlaytimeText = computed(() => {
  if (!props.team || props.team.leaderAveragePlaytimeHours === null) return "--";
  return `${props.team.leaderAveragePlaytimeHours}h`;
});

const occupancyPercent = computed(() => {
  if (!props.team || !props.team.maxPlayers) return 0;
  return Math.min(100, Math.round((props.team.playerCount / props.team.maxPlayers) * 100));
});

const publicRatioPercent = computed(() => {
  if (!props.team) return 0;
  const total = props.team.publicPlaytimePlayers + props.team.privatePlaytimePlayers;
  if (!total) return 0;
  return Math.round((props.team.publicPlaytimePlayers / total) * 100);
});

const privateRatioPercent = computed(() => {
  if (!props.team) return 0;
  const total = props.team.publicPlaytimePlayers + props.team.privatePlaytimePlayers;
  if (!total) return 0;
  return 100 - publicRatioPercent.value;
});

function close() {
  emit("close");
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === "Escape" && props.open) {
    close();
  }
}

async function handleWarnTeamSubmit() {
  const team = props.team;
  const msg = warnMessageInput.value.trim();
  if (!team || !msg || actionBusy.value) return;

  const targetScope = team.teamId === 2 ? "team2" : "team1";
  const label = `TEAM ${team.teamId} (${team.teamName})`;

  actionBusy.value = true;
  try {
    const result = await warnTarget({
      targetScope,
      message: msg,
      reason: "manual_team_warn",
      sourceModule: "web.teamDetailDrawer",
    });

    if (!result?.success) {
      throw new Error(result?.errorMessage || "RCON 指令发送失败");
    }

    ui.pushToast({ title: "警告已发送", message: `已向 ${label} 发送警告："${msg}"`, tone: "ok" });
    emit("warn-team", team.teamId);
  } catch (error: any) {
    ui.pushToast({ title: "警告发送失败", message: error?.message || String(error), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

async function handleQuickAdjustTicket(delta: number) {
  const team = props.team;
  if (!team || actionBusy.value) return;

  actionBusy.value = true;
  try {
    const res = await adjustTickets({
      teamId: team.teamId,
      deltaText: String(delta),
      reason: "quick_team_drawer_adjust",
      source: "web.teamDetailDrawer",
    });

    if (!res?.ok) throw new Error(res?.message || "票数调整失败");
    ui.pushToast({ title: "票数已修改", message: `TEAM ${team.teamId} 票数 ${delta > 0 ? '+' : ''}${delta}`, tone: "ok" });
  } catch (e: any) {
    ui.pushToast({ title: "票数修改失败", message: String(e?.message || e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

function handleEditTickets() {
  if (props.team) {
    emit("edit-tickets", props.team);
  }
}

function handleSelectSquad(squad: SquadViewModel) {
  emit("select-squad", squad);
}

onMounted(() => {
  window.addEventListener("resize", updateViewport);
  document.addEventListener("keydown", handleEscape);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateViewport);
  document.removeEventListener("keydown", handleEscape);
});
</script>

<style scoped>
.drawer-root {
  position: fixed;
  inset: 0;
  z-index: var(--z-player-drawer);
  background:
    radial-gradient(circle at 20% 18%, rgba(96, 165, 250, 0.14), transparent 28%),
    radial-gradient(circle at 80% 10%, rgba(34, 197, 94, 0.08), transparent 26%),
    rgba(8, 12, 16, 0.48);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.team-detail-drawer {
  position: relative;
  width: min(540px, calc(100vw - 24px));
  max-height: calc(var(--app-viewport-height) - 24px);
  overflow: hidden;
  border-radius: 22px;
  background:
    linear-gradient(145deg, rgba(55, 200, 255, 0.06), rgba(168, 85, 247, 0.04)),
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.025)), rgba(255, 255, 255, 0.008)),
    var(--color-bg-panel);
  border: 1px solid rgba(140, 160, 200, 0.28);
  display: grid;
  grid-template-rows: auto 1fr;
  box-shadow:
    0 32px 80px rgba(0, 0, 0, 0.62),
    0 8px 24px rgba(0, 0, 0, 0.36),
    0 0 0 1px rgba(255, 255, 255, 0.03) inset;
  backdrop-filter: blur(28px) saturate(1.4);
}

.hud-accent-bar {
  height: 3px;
  width: 100%;
  background: linear-gradient(90deg, #3b82f6, #60a5fa);
}

.hud-accent-bar.team2-theme {
  background: linear-gradient(90deg, #f97316, #fb923c);
}

.drawer-header-hud {
  position: relative;
  padding: 16px 20px 0;
  border-bottom: 1px solid rgba(140, 160, 200, 0.18);
  background: rgba(15, 23, 42, 0.65);
  overflow: hidden;
}

.hud-header-glow {
  position: absolute;
  top: -40px;
  left: 20%;
  width: 260px;
  height: 120px;
  background: radial-gradient(ellipse at center, rgba(59, 130, 246, 0.25), transparent 70%);
  pointer-events: none;
}

.drawer-header-hud.team2-theme .hud-header-glow {
  background: radial-gradient(ellipse at center, rgba(249, 115, 22, 0.25), transparent 70%);
}

.hud-header-flag-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 220px;
  height: 100%;
  background-size: cover;
  background-position: center;
  opacity: 0.12;
  filter: blur(4px);
  mask-image: linear-gradient(to right, rgba(0, 0, 0, 1), transparent);
  pointer-events: none;
}

.hud-profile-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  z-index: 1;
}

.hud-emblem-frame {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.hud-flag-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hud-flag-fallback {
  font-size: 16px;
  font-weight: 800;
  color: #cbd5e1;
}

.hud-unit-icon {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  object-fit: contain;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));
}

.hud-title-block {
  flex: 1;
  min-width: 0;
}

.hud-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.team-id-chip {
  font-size: 11px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 5px;
  background: rgba(59, 130, 246, 0.25);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.4);
}

.team-id-chip.team2-theme {
  background: rgba(249, 115, 22, 0.25);
  color: #fdba74;
  border-color: rgba(249, 115, 22, 0.4);
}

.drawer-team-name {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #f8fafc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hud-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.meta-chip {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
  display: flex;
  align-items: center;
  gap: 4px;
}

.meta-chip.warn {
  color: #fde047;
}

.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #94a3b8;
}

.chip-dot.ok {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
}

.drawer-close-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.drawer-close-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

/* Tab Navigation Bar */
.drawer-tabs-nav {
  display: flex;
  gap: 6px;
  margin-top: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.tab-nav-btn {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.55);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-nav-btn:hover {
  color: #f1f5f9;
}

.tab-nav-btn.active {
  color: #60a5fa;
  border-bottom-color: #60a5fa;
}

.drawer-header-hud.team2-theme .tab-nav-btn.active {
  color: #fb923c;
  border-bottom-color: #fb923c;
}

/* BODY */
.drawer-body {
  padding: 16px 20px;
  overflow-y: auto;
}

.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-card {
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid rgba(140, 160, 200, 0.14);
  border-radius: 14px;
  padding: 14px 16px;
}

.card-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 12px;
  text-transform: uppercase;
}

.card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.link-btn {
  background: transparent;
  border: none;
  color: #60a5fa;
  font-size: 11px;
  cursor: pointer;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.metric-box {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.metric-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.metric-value {
  font-size: 16px;
  font-weight: 700;
  color: #f1f5f9;
}

.metric-value.danger {
  color: #ef4444;
}

.metric-sub {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
}

.capacity-track {
  height: 4px;
  width: 100%;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  margin-top: 4px;
  overflow: hidden;
}

.capacity-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #22c55e);
  border-radius: 2px;
}

.privacy-summary-row {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #cbd5e1;
}

.privacy-stat {
  display: flex;
  align-items: center;
  gap: 6px;
}

.p-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.p-dot.public { background: #22c55e; }
.p-dot.private { background: #64748b; }

.privacy-progress-bar {
  height: 6px;
  width: 100%;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  display: flex;
  overflow: hidden;
}

.privacy-fill.public { background: #22c55e; }
.privacy-fill.private { background: #64748b; }

.squads-compact-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.squad-mini-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: all 0.15s ease;
}

.squad-mini-item:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(140, 160, 200, 0.3);
}

.mini-squad-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nature-pill {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: #94a3b8;
}

.nature-pill[data-nature="vehicle"] {
  background: rgba(245, 158, 11, 0.2);
  color: #fef08a;
}

.squad-name-txt {
  font-size: 13px;
  font-weight: 600;
  color: #f8fafc;
}

.lock-tag {
  font-size: 10px;
  color: #fde047;
}

.mini-squad-right {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.count-badge {
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 6px;
  border-radius: 4px;
  color: #e2e8f0;
}

/* WARN TAB STYLES */
.warn-card {
  border-color: rgba(245, 158, 11, 0.3);
  background: linear-gradient(180deg, rgba(234, 88, 12, 0.08), rgba(15, 23, 42, 0.5));
}

.warning-title {
  color: #fde047;
}

.section-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 12px;
}

.preset-pills-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 6px;
}

.preset-pills-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.preset-pill-btn {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #cbd5e1;
  cursor: pointer;
  transition: all 0.15s ease;
}

.preset-pill-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.preset-pill-btn.selected {
  background: rgba(245, 158, 11, 0.25);
  border-color: rgba(245, 158, 11, 0.6);
  color: #fef08a;
}

.warn-input-wrapper {
  display: flex;
  gap: 8px;
}

.warn-text-input {
  flex: 1;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: #fff;
}

.warn-text-input:focus {
  outline: none;
  border-color: #f59e0b;
}

.action-btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}

.warn-submit-btn {
  background: linear-gradient(135deg, #ea580c, #d97706);
  color: #fff;
  white-space: nowrap;
}

.warn-submit-btn:hover:not(:disabled) {
  box-shadow: 0 0 12px rgba(234, 88, 12, 0.4);
}

.warn-submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* TICKET SECTION */
.ticket-control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.current-ticket-display {
  display: flex;
  flex-direction: column;
}

.ct-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

.ct-val {
  font-size: 20px;
  font-weight: 800;
  color: #60a5fa;
}

.quick-adjust-btns {
  display: flex;
  gap: 6px;
}

.adjust-chip {
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #e2e8f0;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.adjust-chip:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.16);
}

.ticket-edit-modal-btn {
  width: 100%;
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.12);
  color: #cbd5e1;
}

.ticket-edit-modal-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

/* SQUADS FULL GRID */
.squads-full-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 10px;
}

.squad-full-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.squad-full-card:hover {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(140, 160, 200, 0.3);
  transform: translateY(-1px);
}

.sfc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.sfc-name {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #f8fafc;
  flex: 1;
}

.sfc-body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.sfc-row {
  display: flex;
  gap: 4px;
}

.sfc-row .val {
  color: #e2e8f0;
}

.sfc-row .val.no-leader {
  color: #ef4444;
}

.sfc-foot {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
  font-size: 11px;
  color: #60a5fa;
  text-align: right;
}

.empty-tip {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
  padding: 20px 0;
}

/* Drawer transitions */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease;
}

.drawer-enter-active .team-detail-drawer,
.drawer-leave-active .team-detail-drawer {
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from .team-detail-drawer {
  transform: scale(0.96) translateY(8px);
  opacity: 0;
}

.drawer-leave-to .team-detail-drawer {
  transform: scale(0.96) translateY(8px);
  opacity: 0;
}
</style>
