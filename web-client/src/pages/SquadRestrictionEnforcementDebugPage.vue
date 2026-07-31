<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppPage from "../components/common/AppPage.vue";

type EnforcementMode = "off" | "dry_run" | "warn_only" | "enforce";

type DiagnosticBlocker = {
  code?: string;
  severity?: "blocking" | "warning" | "info";
  message?: string;
  detail?: string;
};

type DiagnosticSquad = {
  slotKey?: string;
  identityKey?: string;
  identityComplete?: boolean;
  teamId?: number | null;
  squadId?: number | null;
  squadName?: string;
  creatorName?: string;
  creatorSteamId?: string;
  generation?: string | number;
  restrictionEvaluated?: boolean;
  isViolation?: boolean;
  violationCodes?: string[];
  restrictionReasons?: string[];
};

type EnforcementState = {
  enabled?: boolean;
  enforcementMode?: EnforcementMode;
  currentRoundKey?: string;
  serverId?: string;
  matchId?: string;
  clockTrusted?: boolean;
  clockGateSatisfied?: boolean;
  forceOpenWithoutTrustedClock?: boolean;
  enforcementWindowOpen?: boolean;
  logClockSeconds?: number;
  logClockHasAnchor?: boolean;
  logClockManual?: boolean;
  snapshotReceived?: boolean;
  lastMonitorAt?: string;
  lastTickAt?: string;
  lastError?: string;
  activeCaseCount?: number;
  historyCount?: number;
  recordCount?: number;
  activeCases?: any[];
  history?: any[];
  records?: any[];
  latestSquads?: DiagnosticSquad[];
  runtimeControl?: {
    enforcementMode?: EnforcementMode;
    forceOpenWithoutTrustedClock?: boolean | null;
    updatedAt?: string;
    reason?: string;
    actor?: Record<string, unknown> | null;
  };
  diagnostics?: {
    status?: string;
    caseCreationReady?: boolean;
    canSendWarnings?: boolean;
    canDisband?: boolean;
    clockOverrideActive?: boolean;
    protectionRemainingSeconds?: number;
    latestSquadCount?: number;
    evaluatedSquadCount?: number;
    classificationMissingCount?: number;
    violationCount?: number;
    eligibleViolationCount?: number;
    identityUnresolvedCount?: number;
    blockers?: DiagnosticBlocker[];
  };
  config?: Record<string, unknown>;
};

type MonitorState = {
  enabled?: boolean;
  updatedAt?: string;
  serverId?: string;
  matchId?: string;
  squadCount?: number;
  evaluatedCount?: number;
  violationCount?: number;
  squads?: any[];
  violations?: any[];
};

const enforcement = ref<EnforcementState | null>(null);
const monitor = ref<MonitorState | null>(null);
const loading = ref(true);
const error = ref("");
const autoRefresh = ref(true);
const showJson = ref(false);
const lastLoadedAt = ref("");
const selectedMode = ref<EnforcementMode>("enforce");
const forceOpenWithoutTrustedClock = ref(false);
const controlDirty = ref(false);
const controlSaving = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const modeLabel = computed(() => ({
  off: "关闭",
  dry_run: "演练",
  warn_only: "仅警告",
  enforce: "自动处罚",
}[enforcement.value?.enforcementMode ?? "off"]));

const statusTone = computed(() => {
  const status = enforcement.value?.diagnostics?.status;
  if (status === "enforcing") return "ok";
  if (status === "warn_only" || status === "dry_run") return "warn";
  return "error";
});

const blockers = computed(() => enforcement.value?.diagnostics?.blockers ?? []);
const activeCases = computed(() => enforcement.value?.activeCases ?? []);
const history = computed(() => enforcement.value?.history?.slice(0, 50) ?? []);
const records = computed(() => enforcement.value?.records?.slice(0, 80) ?? []);

const squadRows = computed(() => {
  const identities = new Map(
    (enforcement.value?.latestSquads ?? []).map((item) => [
      `${item.teamId ?? ""}:${item.squadId ?? ""}`,
      item,
    ]),
  );
  return (monitor.value?.squads ?? []).map((item) => {
    const identity = identities.get(`${item.teamId ?? ""}:${item.squadId ?? ""}`);
    return {
      ...item,
      identityComplete: identity?.identityComplete ?? false,
      identityKey: identity?.identityKey ?? "",
      generation: identity?.generation ?? item.generation,
      creatorName: identity?.creatorName || item.creatorName || "",
      restrictionReasons: identity?.restrictionReasons ?? item.restrictionReasons ?? [],
      violationCodes: identity?.violationCodes ?? item.violationCodes ?? [],
    };
  });
});

const fullJson = computed(() => JSON.stringify({
  enforcement: enforcement.value,
  monitor: monitor.value,
}, null, 2));

async function load() {
  if (!enforcement.value) loading.value = true;
  try {
    const [enforcementResponse, monitorResponse] = await Promise.all([
      fetch("/api/modules/squad-restriction-enforcement/state", { credentials: "include" }),
      fetch("/api/modules/squad-restriction-monitor/state", { credentials: "include" }),
    ]);
    if (!enforcementResponse.ok) {
      throw new Error(`执法状态接口返回 HTTP ${enforcementResponse.status}`);
    }
    if (!monitorResponse.ok) {
      throw new Error(`监控状态接口返回 HTTP ${monitorResponse.status}`);
    }
    const [enforcementPayload, monitorPayload] = await Promise.all([
      enforcementResponse.json(),
      monitorResponse.json(),
    ]);
    enforcement.value = enforcementPayload.data ?? null;
    monitor.value = monitorPayload.data ?? null;
    if (!controlDirty.value && enforcement.value) {
      selectedMode.value = enforcement.value.enforcementMode ?? "enforce";
      forceOpenWithoutTrustedClock.value = Boolean(enforcement.value.forceOpenWithoutTrustedClock);
    }
    lastLoadedAt.value = new Date().toISOString();
    error.value = "";
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "读取调试状态失败";
  } finally {
    loading.value = false;
  }
}

function markControlDirty() {
  controlDirty.value = true;
}

async function applyRuntimeControl() {
  const dangerous = selectedMode.value === "enforce" || forceOpenWithoutTrustedClock.value;
  if (
    dangerous
    && !window.confirm(
      forceOpenWithoutTrustedClock.value
        ? "强制开启会跳过日志锚点、手动时钟和开局五分钟保护。确认应用？"
        : "自动处罚模式会在两次警告后解散持续违规的小队。确认应用？",
    )
  ) {
    return;
  }

  controlSaving.value = true;
  try {
    const response = await fetch("/api/modules/squad-restriction-enforcement/control", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enforcementMode: selectedMode.value,
        forceOpenWithoutTrustedClock: forceOpenWithoutTrustedClock.value,
        reason: "debug_page_runtime_control",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.error || `控制接口返回 HTTP ${response.status}`);
    }
    controlDirty.value = false;
    await load();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "更新运行控制失败";
  } finally {
    controlSaving.value = false;
  }
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  if (autoRefresh.value) startTimer();
  else stopTimer();
}

function startTimer() {
  stopTimer();
  timer = setInterval(load, 2000);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function formatClock(seconds: unknown) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function formatDate(value: unknown) {
  const parsed = Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed)) return "--";
  return new Date(parsed).toLocaleString("zh-CN", { hour12: false });
}

function formatList(value: unknown) {
  return Array.isArray(value) && value.length ? value.join("；") : "--";
}

async function copyJson() {
  await navigator.clipboard?.writeText(fullJson.value);
}

onMounted(() => {
  void load();
  startTimer();
});

onUnmounted(stopTimer);
</script>

<template>
  <AppPage mode="workspace" class="enforcement-debug-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">SQUAD RESTRICTION / DEBUG</p>
        <h1>小队锁队处罚调试</h1>
        <p>检查“监控 → 分类 → 时钟 → 案件 → 警告 → 解散”整条执行链。</p>
      </div>
      <div class="header-actions">
        <button type="button" class="button" :class="{ active: autoRefresh }" @click="toggleAutoRefresh">
          {{ autoRefresh ? "自动刷新 2s" : "自动刷新已停" }}
        </button>
        <button type="button" class="button primary" :disabled="loading" @click="load">
          {{ loading ? "读取中…" : "立即刷新" }}
        </button>
      </div>
    </header>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div v-if="enforcement" class="page-scroll">
      <section class="mode-banner" :data-tone="statusTone">
        <div>
          <span>当前模式</span>
          <strong>{{ enforcement.enforcementMode }} · {{ modeLabel }}</strong>
        </div>
        <p v-if="enforcement.enforcementMode === 'dry_run'">
          演练模式会完整建立案件和推进倒计时，但不会向游戏发送 AdminWarn，也不会解散小队。
        </p>
        <p v-else-if="enforcement.enforcementMode === 'warn_only'">
          仅警告模式会发送两次 AdminWarn，但最终不会解散小队。
        </p>
        <p v-else-if="enforcement.enforcementMode === 'enforce'">
          自动处罚已启用：两次警告后仍违规会重新验证并解散小队。
        </p>
        <p v-else>模块当前不会建立或推进处罚案件。</p>
      </section>

      <section class="control-panel" :data-force-open="forceOpenWithoutTrustedClock">
        <div class="control-copy">
          <p class="eyebrow">RUNTIME CONTROL / SUPER ADMIN</p>
          <h2>实用版运行控制</h2>
          <p>设置会保存到处罚模块状态，重启后继续生效。切换处罚模式时，旧模式案件会取消并重新开始完整倒计时。</p>
        </div>
        <label class="control-field">
          <span>处罚模式</span>
          <select v-model="selectedMode" :disabled="controlSaving" @change="markControlDirty">
            <option value="off">off · 关闭</option>
            <option value="dry_run">dry_run · 演练</option>
            <option value="warn_only">warn_only · 仅警告</option>
            <option value="enforce">enforce · 自动警告并解散</option>
          </select>
        </label>
        <label class="force-toggle">
          <input
            v-model="forceOpenWithoutTrustedClock"
            type="checkbox"
            :disabled="controlSaving"
            @change="markControlDirty"
          >
          <span>
            <strong>强制开启，无视日志锚定时间</strong>
            <small>跳过锚点、手动时钟与开局五分钟保护；仍要求本局标识，并保留每次动作前的违规复核。</small>
          </span>
        </label>
        <button
          type="button"
          class="button danger-button"
          :disabled="controlSaving || !controlDirty"
          @click="applyRuntimeControl"
        >
          {{ controlSaving ? "应用中…" : controlDirty ? "应用运行设置" : "设置已生效" }}
        </button>
      </section>

      <section class="metric-grid">
        <article class="metric-card">
          <span>监控快照</span>
          <strong>{{ enforcement.snapshotReceived ? "已收到" : "未收到" }}</strong>
          <small>{{ formatDate(enforcement.lastMonitorAt) }}</small>
        </article>
        <article class="metric-card">
          <span>可信对局时钟</span>
          <strong>{{ formatClock(enforcement.logClockSeconds) }}</strong>
          <small>
            锚点 {{ enforcement.logClockHasAnchor ? "有" : "无" }} /
            手动 {{ enforcement.logClockManual ? "是" : "否" }}
          </small>
          <small v-if="enforcement.forceOpenWithoutTrustedClock" class="force-text">强制覆盖已启用</small>
        </article>
        <article class="metric-card">
          <span>案件创建窗口</span>
          <strong>{{ enforcement.enforcementWindowOpen ? "已开放" : "未开放" }}</strong>
          <small v-if="enforcement.diagnostics?.protectionRemainingSeconds">
            保护剩余 {{ enforcement.diagnostics.protectionRemainingSeconds }} 秒
          </small>
          <small v-else>{{ enforcement.currentRoundKey || "缺少本局标识" }}</small>
        </article>
        <article class="metric-card">
          <span>活动案件</span>
          <strong>{{ enforcement.activeCaseCount ?? 0 }}</strong>
          <small>历史 {{ enforcement.historyCount ?? 0 }} / 动作 {{ enforcement.recordCount ?? 0 }}</small>
        </article>
        <article class="metric-card">
          <span>监控小队</span>
          <strong>{{ monitor?.squadCount ?? 0 }}</strong>
          <small>已分类 {{ monitor?.evaluatedCount ?? 0 }}</small>
        </article>
        <article class="metric-card danger">
          <span>当前违规</span>
          <strong>{{ monitor?.violationCount ?? 0 }}</strong>
          <small>可建立案件 {{ enforcement.diagnostics?.eligibleViolationCount ?? 0 }}</small>
        </article>
      </section>

      <section class="two-column">
        <article class="panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">BLOCKERS</p>
              <h2>为什么没有执行</h2>
            </div>
            <span class="state-chip" :data-tone="statusTone">
              {{ enforcement.diagnostics?.status ?? "unknown" }}
            </span>
          </div>
          <div v-if="blockers.length" class="blocker-list">
            <div v-for="item in blockers" :key="item.code" class="blocker" :data-severity="item.severity">
              <span class="blocker-code">{{ item.code }}</span>
              <strong>{{ item.message }}</strong>
              <small v-if="item.detail">{{ item.detail }}</small>
            </div>
          </div>
          <div v-else class="healthy">没有发现执行阻断，系统正在等待违规。</div>
        </article>

        <article class="panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">PIPELINE</p>
              <h2>判定链计数</h2>
            </div>
          </div>
          <dl class="pipeline-grid">
            <div><dt>最新小队</dt><dd>{{ enforcement.diagnostics?.latestSquadCount ?? 0 }}</dd></div>
            <div><dt>规则已评估</dt><dd>{{ enforcement.diagnostics?.evaluatedSquadCount ?? 0 }}</dd></div>
            <div><dt>未分类</dt><dd>{{ enforcement.diagnostics?.classificationMissingCount ?? 0 }}</dd></div>
            <div><dt>检测违规</dt><dd>{{ enforcement.diagnostics?.violationCount ?? 0 }}</dd></div>
            <div><dt>身份完整</dt><dd>{{ enforcement.diagnostics?.eligibleViolationCount ?? 0 }}</dd></div>
            <div><dt>身份缺失</dt><dd>{{ enforcement.diagnostics?.identityUnresolvedCount ?? 0 }}</dd></div>
          </dl>
        </article>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">LIVE SQUADS</p>
            <h2>当前小队判定</h2>
          </div>
          <span>{{ formatDate(monitor?.updatedAt) }}</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>小队</th>
                <th>名称 / 创建者</th>
                <th>锁定 / 人数</th>
                <th>分类</th>
                <th>判定</th>
                <th>身份</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in squadRows" :key="item.key || `${item.teamId}:${item.squadId}`">
                <td>T{{ item.teamId ?? "--" }} / S{{ item.squadId ?? "--" }}</td>
                <td><strong>{{ item.squadName || "--" }}</strong><small>{{ item.creatorName || "创建者未知" }}</small></td>
                <td>{{ item.locked ? "已锁" : "未锁" }} / {{ item.playerCount ?? 0 }}</td>
                <td>{{ item.squadTypeLabel || item.squadTypeId || "未分类" }}</td>
                <td>
                  <span class="result-chip" :data-violation="Boolean(item.restriction?.isViolation)">
                    {{ item.restriction?.isViolation ? "违规" : item.restriction?.evaluated ? "合规" : "未评估" }}
                  </span>
                </td>
                <td>
                  {{ item.identityComplete ? "完整" : "缺失" }}
                  <small>generation {{ item.generation ?? "--" }}</small>
                </td>
                <td class="reason-cell">
                  {{ formatList(item.restrictionReasons) }}
                  <small>{{ formatList(item.violationCodes) }}</small>
                </td>
              </tr>
              <tr v-if="squadRows.length === 0">
                <td colspan="7" class="empty">监控模块尚未收到任何小队数据。</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">ACTIVE CASES</p>
            <h2>活动案件与倒计时</h2>
          </div>
        </div>
        <div class="case-grid">
          <article v-for="item in activeCases" :key="item.caseKey" class="case-card">
            <div class="case-title">
              <strong>T{{ item.teamId }} / S{{ item.squadId }} · {{ item.squadName }}</strong>
              <span>{{ item.status }}</span>
            </div>
            <p>{{ item.reason || "--" }}</p>
            <dl>
              <div><dt>下一阶段</dt><dd>{{ item.remainingSeconds ?? "--" }} 秒</dd></div>
              <div><dt>首次警告</dt><dd>{{ formatDate(item.firstWarningAt) }}</dd></div>
              <div><dt>第二警告</dt><dd>{{ formatDate(item.secondWarningAt) }}</dd></div>
              <div><dt>最终处理</dt><dd>{{ formatDate(item.disbandAt) }}</dd></div>
            </dl>
          </article>
          <div v-if="activeCases.length === 0" class="empty-card">当前没有活动案件。</div>
        </div>
      </section>

      <section class="two-column">
        <article class="panel">
          <div class="panel-heading"><h2>最近案件历史</h2></div>
          <div class="compact-list">
            <div v-for="item in history" :key="`${item.caseKey}:${item.resolvedAt}`">
              <strong>T{{ item.teamId }} / S{{ item.squadId }} · {{ item.status }}</strong>
              <span>{{ item.resolutionReason || "--" }}</span>
              <small>{{ formatDate(item.resolvedAt) }}</small>
            </div>
            <p v-if="history.length === 0" class="empty">暂无历史案件。</p>
          </div>
        </article>
        <article class="panel">
          <div class="panel-heading"><h2>最近动作记录</h2></div>
          <div class="compact-list">
            <div v-for="item in records" :key="item.id">
              <strong>{{ item.action }} · T{{ item.teamId }} / S{{ item.squadId }}</strong>
              <span>{{ item.simulated ? "模拟动作" : item.success === false ? "执行失败" : "执行成功" }}</span>
              <small>{{ formatDate(item.time) }}</small>
            </div>
            <p v-if="records.length === 0" class="empty">暂无动作记录。</p>
          </div>
        </article>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">RAW STATE</p>
            <h2>完整状态 JSON</h2>
          </div>
          <div class="inline-actions">
            <button type="button" class="button" @click="showJson = !showJson">
              {{ showJson ? "收起" : "展开" }}
            </button>
            <button v-if="showJson" type="button" class="button" @click="copyJson">复制 JSON</button>
          </div>
        </div>
        <pre v-if="showJson">{{ fullJson }}</pre>
      </section>

      <footer>
        最近页面刷新：{{ formatDate(lastLoadedAt) }} · 最近调度 Tick：{{ formatDate(enforcement.lastTickAt) }}
      </footer>
    </div>
  </AppPage>
</template>

<style scoped>
.enforcement-debug-page {
  color: var(--text-primary, #e5edf7);
  background:
    radial-gradient(circle at 15% 0%, rgba(245, 158, 11, 0.11), transparent 34%),
    var(--bg-primary, #08101c);
}

.page-header {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 24px 14px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
}

.page-header h1, .panel h2 { margin: 0; }
.page-header h1 { font-size: clamp(22px, 2vw, 30px); }
.page-header > div > p:last-child { margin: 8px 0 0; color: #94a3b8; }
.eyebrow { margin: 0 0 6px; color: #f59e0b; font-size: 11px; font-weight: 800; letter-spacing: 0.13em; }
.header-actions, .inline-actions { display: flex; gap: 8px; }

.button {
  padding: 9px 13px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.78);
  color: #dbeafe;
  cursor: pointer;
}
.button.active, .button.primary { border-color: rgba(56, 189, 248, 0.5); background: rgba(14, 116, 144, 0.3); }
.button:disabled { opacity: 0.55; cursor: wait; }

.page-scroll { min-height: 0; overflow: auto; padding: 16px 24px 28px; }
.error-banner { margin: 14px 24px 0; padding: 12px; border: 1px solid rgba(248, 113, 113, 0.45); border-radius: 8px; background: rgba(127, 29, 29, 0.55); }

.mode-banner {
  display: grid;
  grid-template-columns: minmax(180px, 0.3fr) 1fr;
  align-items: center;
  gap: 18px;
  padding: 16px 18px;
  border: 1px solid rgba(245, 158, 11, 0.34);
  border-radius: 12px;
  background: rgba(120, 53, 15, 0.18);
}
.mode-banner[data-tone="ok"] { border-color: rgba(52, 211, 153, 0.34); background: rgba(6, 78, 59, 0.2); }
.mode-banner[data-tone="error"] { border-color: rgba(248, 113, 113, 0.38); background: rgba(127, 29, 29, 0.2); }
.mode-banner span, .metric-card span { display: block; color: #94a3b8; font-size: 12px; }
.mode-banner strong { display: block; margin-top: 4px; font-size: 21px; }
.mode-banner p { margin: 0; color: #cbd5e1; }

.control-panel {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(210px, 0.55fr) minmax(330px, 1fr) auto;
  align-items: center;
  gap: 14px;
  margin-top: 12px;
  padding: 16px 18px;
  border: 1px solid rgba(56, 189, 248, 0.26);
  border-radius: 12px;
  background: rgba(8, 47, 73, 0.24);
}
.control-panel[data-force-open="true"] {
  border-color: rgba(248, 113, 113, 0.55);
  background: rgba(127, 29, 29, 0.25);
  box-shadow: inset 4px 0 #ef4444;
}
.control-copy h2 { margin: 0; font-size: 17px; }
.control-copy p:last-child { margin: 7px 0 0; color: #94a3b8; font-size: 12px; line-height: 1.5; }
.control-field { display: grid; gap: 7px; }
.control-field > span { color: #94a3b8; font-size: 12px; }
.control-field select {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 8px;
  outline: none;
  background: #0f172a;
  color: #e5edf7;
}
.force-toggle {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(248, 113, 113, 0.3);
  border-radius: 8px;
  background: rgba(69, 10, 10, 0.28);
  cursor: pointer;
}
.force-toggle input { margin-top: 3px; accent-color: #ef4444; }
.force-toggle strong, .force-toggle small { display: block; }
.force-toggle strong { color: #fecaca; font-size: 13px; }
.force-toggle small { margin-top: 4px; color: #fca5a5; font-size: 11px; line-height: 1.45; }
.danger-button { border-color: rgba(248, 113, 113, 0.5); background: rgba(153, 27, 27, 0.42); white-space: nowrap; }
.force-text { margin-top: 4px; color: #fda4af !important; font-weight: 700; }

.metric-grid { display: grid; grid-template-columns: repeat(6, minmax(145px, 1fr)); gap: 10px; margin: 12px 0; }
.metric-card, .panel {
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.78);
}
.metric-card { padding: 14px; }
.metric-card strong { display: block; margin: 7px 0 5px; font-size: 21px; }
.metric-card small, td small, .compact-list small { display: block; color: #7f91a8; }
.metric-card.danger strong { color: #fb7185; }

.two-column { display: grid; grid-template-columns: 1.25fr 0.75fr; gap: 12px; margin-bottom: 12px; }
.panel { min-width: 0; padding: 16px; margin-bottom: 12px; overflow: hidden; }
.two-column .panel { margin-bottom: 0; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 13px; }
.panel-heading > span { color: #94a3b8; font-size: 12px; }
.panel h2 { font-size: 16px; }

.state-chip, .result-chip {
  display: inline-flex;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  color: #cbd5e1;
  font-size: 11px;
}
.state-chip[data-tone="ok"], .result-chip[data-violation="false"] { border-color: rgba(52, 211, 153, 0.4); color: #6ee7b7; }
.state-chip[data-tone="warn"] { border-color: rgba(245, 158, 11, 0.45); color: #fbbf24; }
.state-chip[data-tone="error"], .result-chip[data-violation="true"] { border-color: rgba(248, 113, 113, 0.45); color: #fda4af; }

.blocker-list { display: grid; gap: 8px; }
.blocker { display: grid; grid-template-columns: 150px 1fr auto; gap: 10px; align-items: center; padding: 10px; border-radius: 7px; background: rgba(30, 41, 59, 0.62); }
.blocker[data-severity="blocking"] { box-shadow: inset 3px 0 #ef4444; }
.blocker[data-severity="warning"] { box-shadow: inset 3px 0 #f59e0b; }
.blocker[data-severity="info"] { box-shadow: inset 3px 0 #38bdf8; }
.blocker-code { color: #94a3b8; font-family: ui-monospace, Consolas, monospace; font-size: 11px; }
.blocker small { color: #fbbf24; }
.healthy { padding: 16px; border-radius: 8px; color: #6ee7b7; background: rgba(6, 78, 59, 0.28); }

.pipeline-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0; }
.pipeline-grid div { padding: 12px; border-radius: 8px; background: rgba(30, 41, 59, 0.62); }
.pipeline-grid dt { color: #94a3b8; font-size: 11px; }
.pipeline-grid dd { margin: 5px 0 0; font-size: 22px; font-weight: 800; }

.table-wrap { overflow: auto; }
table { width: 100%; min-width: 980px; border-collapse: collapse; }
th, td { padding: 9px 10px; border-bottom: 1px solid rgba(148, 163, 184, 0.13); text-align: left; vertical-align: top; }
th { color: #94a3b8; font-size: 11px; text-transform: uppercase; }
td { font-size: 13px; }
.reason-cell { min-width: 240px; max-width: 420px; }
.empty { padding: 20px; text-align: center; color: #94a3b8; }

.case-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 10px; }
.case-card { padding: 13px; border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 9px; background: rgba(30, 41, 59, 0.58); }
.case-title { display: flex; justify-content: space-between; gap: 10px; }
.case-title span { color: #fbbf24; font-family: ui-monospace, Consolas, monospace; }
.case-card p { color: #cbd5e1; }
.case-card dl { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px; margin: 0; }
.case-card dl div { padding: 8px; border-radius: 6px; background: rgba(15, 23, 42, 0.72); }
.case-card dt { color: #94a3b8; font-size: 11px; }
.case-card dd { margin: 4px 0 0; font-size: 12px; }
.empty-card { grid-column: 1 / -1; padding: 24px; text-align: center; color: #94a3b8; }

.compact-list { max-height: 360px; overflow: auto; }
.compact-list > div { display: grid; grid-template-columns: 1fr 1fr auto; gap: 10px; padding: 9px 4px; border-bottom: 1px solid rgba(148, 163, 184, 0.12); }
.compact-list span { color: #94a3b8; }
pre { max-height: 520px; margin: 0; overflow: auto; padding: 14px; border-radius: 8px; background: #050b14; color: #bfdbfe; font: 12px/1.55 ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
footer { padding: 5px 0 20px; color: #64748b; font-size: 12px; text-align: right; }

@media (max-width: 1320px) {
  .metric-grid { grid-template-columns: repeat(3, 1fr); }
  .control-panel { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 900px) {
  .page-header, .mode-banner { grid-template-columns: 1fr; }
  .page-header { flex-direction: column; }
  .control-panel { grid-template-columns: 1fr; }
  .two-column { grid-template-columns: 1fr; }
  .blocker { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .page-header, .page-scroll { padding-left: 12px; padding-right: 12px; }
  .metric-grid { grid-template-columns: repeat(2, 1fr); }
  .header-actions { width: 100%; }
  .header-actions .button { flex: 1; }
  .pipeline-grid { grid-template-columns: repeat(2, 1fr); }
  .compact-list > div { grid-template-columns: 1fr; }
}
</style>
