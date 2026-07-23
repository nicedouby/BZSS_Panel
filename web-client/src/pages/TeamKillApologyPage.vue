<template>
  <section class="page tk-apology-page">
    <h1 class="sr-only">TK 道歉处理</h1>

    <WorkspaceToolbar>
      <span class="status-chip" :data-tone="status?.active ? 'ok' : 'danger'">
        {{ status?.active ? '运行中' : '已关闭' }}
      </span>
      <template #actions>
        <button class="ghost-btn" type="button" :disabled="loading" @click="load">{{ loading ? '刷新中..' : '刷新' }}</button>
        <button class="switch-button" :class="{ on: status?.enabled }" type="button" :disabled="busy || !canManage" @click="toggleEnabled">
          {{ status?.enabled ? '关闭插件' : '开启插件' }}
        </button>
      </template>
    </WorkspaceToolbar>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <section class="summary-grid">
      <article class="summary-card" data-tone="warning"><span>等待道歉</span><strong>{{ status?.summary.pending ?? 0 }}</strong><em>当前处理单</em></article>
      <article class="summary-card" data-tone="danger"><span>本局 TK</span><strong>{{ status?.summary.totalTeamKills ?? 0 }}</strong><em>仅远端 TK 事件</em></article>
      <article class="summary-card" data-tone="ok"><span>已道歉</span><strong>{{ status?.summary.totalApologies ?? 0 }}</strong><em>收到聊天道歉</em></article>
      <article class="summary-card" data-tone="danger"><span>超时已处理</span><strong>{{ status?.summary.totalHandled ?? 0 }}</strong><em>本局累计</em></article>
      <article class="summary-card" data-tone="info"><span>聊天记录</span><strong>{{ status?.chats?.length ?? 0 }}</strong><em>最近 300 条</em></article>
    </section>

    <section class="content-grid">
      <PageCard title="当前待道歉名单" description="每分钟提醒一次；倒计时结束后执行后台配置的处理方式。" class="pending-card">
        <template #actions><span class="status-chip subtle">{{ status?.config.deadlineSeconds ?? 600 }} 秒时限</span></template>
        <div v-if="!status?.pending.length" class="empty-state">当前没有待道歉玩家。</div>
        <div v-else class="pending-list">
          <article v-for="item in status.pending" :key="item.id" class="pending-row">
            <div class="identity"><strong>{{ item.attacker.name }}</strong><span>TK {{ item.victim.name || '未知队友' }} · 本局第 {{ item.tkCount }} 次</span></div>
            <div class="countdown"><strong>{{ formatSeconds(item.remainingSeconds) }}</strong><span>已提醒 {{ item.reminderCount }} 次</span></div>
          </article>
        </div>
      </PageCard>

      <PageCard title="本局 TK 统计" description="切图和服务器重启都会自动清空。" class="players-card">
        <div v-if="!status?.players.length" class="empty-state">尚未发生远端 TK。</div>
        <div v-else class="player-list">
          <article v-for="player in status.players" :key="player.key" class="player-row"><strong>{{ player.attacker.name }}</strong><span>{{ player.count }} 次 TK</span></article>
        </div>
      </PageCard>
    </section>

    <PageCard title="玩家聊天情况" description="这里显示聊天模块实际收到的玩家消息，并标记是否识别为道歉、是否成功匹配到 TK 处理单。">
      <div v-if="!status?.chats?.length" class="empty-state">暂时没有收到聊天消息。</div>
      <div v-else class="chat-list">
        <article v-for="chat in status.chats" :key="chat.id" class="chat-row" :data-matched="chat.matched">
          <div class="chat-meta">
            <strong>{{ chat.playerName || "未知玩家" }}</strong>
            <span>{{ formatTime(chat.at) }} · {{ chat.channel || "unknown" }}</span>
          </div>
          <div class="chat-message">{{ chat.message || "（空消息）" }}</div>
          <div class="chat-result">
            <span v-if="chat.matched" class="result-tag ok">已匹配道歉</span>
            <span v-else-if="chat.apology" class="result-tag warning">识别为道歉但未匹配</span>
            <span v-else class="result-tag muted">普通聊天</span>
          </div>
        </article>
      </div>
    </PageCard>

    <PageCard title="处理记录" description="包括 TK、道歉、提醒、未匹配道歉和超时处理，便于定位玩家反馈的问题。">
      <div v-if="!status?.history?.length" class="empty-state">暂时没有处理记录。</div>
      <div v-else class="history-list">
        <article v-for="item in status.history" :key="String(item.id || item.at)" class="history-row">
          <span class="history-time">{{ formatTime(String(item.at || "")) }}</span>
          <strong>{{ historyLabel(item.kind) }}</strong>
          <span>{{ historyPlayer(item) }}</span>
          <span class="history-detail">{{ historyDetail(item) }}</span>
        </article>
      </div>
    </PageCard>

    <PageCard title="处理设置" description="玩家只会收到“将被处理”的提示，不会知道具体措施。">
      <template #actions><button class="ghost-btn" type="button" :disabled="busy || !canManage" @click="resetMatch">重置本局数据</button></template>
      <div class="settings-grid">
        <label>道歉时限（秒）<input v-model.number="form.deadlineSeconds" type="number" min="30" max="3600" :disabled="!canManage" /></label>
        <label>提醒间隔（秒）<input v-model.number="form.reminderSeconds" type="number" min="10" :max="form.deadlineSeconds" :disabled="!canManage" /></label>
        <label>超时处理<select v-model="form.timeoutAction" :disabled="!canManage"><option value="remove_from_squad">移出小队</option><option value="kill_player">击杀玩家</option><option value="kick_player">踢出服务器</option></select></label>
        <div class="settings-action"><button class="primary-btn" type="button" :disabled="busy || !canManage" @click="saveConfig">保存设置</button></div>
      </div>
      <p class="word-note">可识别道歉：{{ status?.config.apologyWords.join('、') || '-' }}</p>
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import PageCard from "../components/common/PageCard.vue";
import { useAuthStore } from "../stores/auth.store";
import { hasPermission } from "../shared/rcon-permissions.js";
import {
  fetchTeamKillApologyState, resetTeamKillApologyMatch, setTeamKillApologyEnabled, updateTeamKillApologyConfig,
  type TeamKillApologyState, type TkTimeoutAction,
} from "../app/teamKillApologyApi";

const auth = useAuthStore();
const status = ref<TeamKillApologyState | null>(null);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
let timer: number | null = null;
const form = reactive<{ deadlineSeconds: number; reminderSeconds: number; timeoutAction: TkTimeoutAction }>({ deadlineSeconds: 600, reminderSeconds: 60, timeoutAction: "remove_from_squad" });
const canManage = computed(() => Boolean(auth.user?.isSuperAdmin || hasPermission(auth.user?.permissions, "settings.manage")));

function apply(next: TeamKillApologyState) {
  status.value = next;
  form.deadlineSeconds = next.config.deadlineSeconds;
  form.reminderSeconds = next.config.reminderSeconds;
  form.timeoutAction = next.config.timeoutAction;
}

async function load() {
  loading.value = true; error.value = "";
  try { apply(await fetchTeamKillApologyState()); }
  catch (err) { error.value = err instanceof Error ? err.message : "无法加载 TK 道歉处理状态。"; }
  finally { loading.value = false; }
}
async function toggleEnabled() { if (!status.value) return; busy.value = true; try { apply(await setTeamKillApologyEnabled(!status.value.enabled)); } catch (err) { error.value = err instanceof Error ? err.message : "更新失败。"; } finally { busy.value = false; } }
async function saveConfig() { busy.value = true; try { apply(await updateTeamKillApologyConfig({ ...form })); } catch (err) { error.value = err instanceof Error ? err.message : "保存失败。"; } finally { busy.value = false; } }
async function resetMatch() { busy.value = true; try { apply(await resetTeamKillApologyMatch()); } catch (err) { error.value = err instanceof Error ? err.message : "重置失败。"; } finally { busy.value = false; } }
function formatSeconds(value: number) { const seconds = Math.max(0, Math.ceil(Number(value) || 0)); return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0"); }
function formatTime(value: string) { const time = new Date(value); return Number.isNaN(time.getTime()) ? value : time.toLocaleTimeString(); }
function historyLabel(kind: unknown) {
  const labels: Record<string, string> = { team_kill: "TK", apology: "道歉", chat_unmatched: "未匹配道歉", reminder: "提醒", timeout_handled: "超时处理", match_reset: "重置" };
  return labels[String(kind)] || String(kind || "事件");
}
function historyPlayer(item: Record<string, unknown>) {
  const attacker = item.attacker as { name?: string } | undefined;
  const player = item.player as { name?: string } | undefined;
  return attacker?.name || player?.name || "系统";
}
function historyDetail(item: Record<string, unknown>) {
  if (item.message) return String(item.message);
  if (item.reason) return String(item.reason);
  if (item.action) return String(item.action);
  if (item.remaining) return "剩余 " + String(item.remaining) + " 秒";
  return "";
}
onMounted(() => { void load(); timer = window.setInterval(() => void load(), 15_000); });
onBeforeUnmount(() => { if (timer) window.clearInterval(timer); });
</script>

<style scoped>
.tk-apology-page { display: grid; gap: 14px; }
.content-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(260px, 1fr); gap: 14px; }
.pending-list, .player-list { display: grid; gap: 9px; }
.pending-row, .player-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid var(--color-border-soft); border-radius: 12px; background: color-mix(in srgb, var(--color-bg-card) 84%, transparent); }
.chat-list, .history-list { display: grid; gap: 8px; }
.chat-row, .history-row { display: grid; grid-template-columns: minmax(130px, .8fr) minmax(180px, 2fr) auto; gap: 10px; align-items: center; padding: 10px 12px; border: 1px solid var(--color-border-soft); border-radius: 10px; background: color-mix(in srgb, var(--color-bg-card) 84%, transparent); }
.chat-meta, .chat-result { display: grid; gap: 3px; min-width: 0; }
.chat-meta span, .history-time, .history-detail { color: var(--color-text-muted); font-size: 12px; }
.chat-message, .history-detail { min-width: 0; overflow-wrap: anywhere; }
.result-tag { justify-self: end; border-radius: 999px; padding: 3px 8px; font-size: 11px; }
.result-tag.ok { color: var(--color-status-success); background: color-mix(in srgb, var(--color-status-success) 15%, transparent); }
.result-tag.warning { color: var(--color-status-warning); background: color-mix(in srgb, var(--color-status-warning) 15%, transparent); }
.result-tag.muted { color: var(--color-text-muted); background: color-mix(in srgb, var(--color-text-muted) 10%, transparent); }
.history-row { grid-template-columns: 90px 100px 140px minmax(0, 1fr); }
.identity, .countdown { display: grid; gap: 3px; min-width: 0; }
.identity span, .countdown span, .word-note { color: var(--color-text-muted); font-size: 12px; }
.countdown { text-align: right; color: var(--color-status-warning); white-space: nowrap; }
.settings-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; align-items: end; }
.settings-grid label { display: grid; gap: 7px; color: var(--color-text-muted); font-size: 12px; }
.settings-grid input, .settings-grid select { min-width: 0; border: 1px solid var(--color-border-default); border-radius: 8px; background: var(--color-bg-input, var(--color-bg-card)); color: var(--color-text-primary); padding: 9px; }
.settings-action { display: flex; align-items: end; }
.word-note { margin: 14px 0 0; line-height: 1.7; }
@media (max-width: 850px) { .content-grid, .settings-grid, .chat-row, .history-row { grid-template-columns: 1fr; } .result-tag { justify-self: start; } }
</style>
