<template>
  <AppPage full-bleed>
    <AppPageHeader
      title="公平跳边实验室"
      subtitle="先生成两边玩家列表，再点开任意玩家配置额度、小队和锁队状态，并直接模拟 tb、sqtb、认领xxxxx。"
      eyebrow="Balance Debug"
      :status-items="headerStatusItems"
    >
      <template #actions>
        <button type="button" class="action-btn ghost" @click="resetLab">
          重置实验室
        </button>
      </template>
    </AppPageHeader>

    <AppPageToolbar>
      <div class="toolbar-grid">
        <div class="toolbar-fields">
          <label class="field compact-field">
            <span>暖服阶段</span>
            <input v-model="lab.isWarmup" type="checkbox">
          </label>
          <label class="field compact-field">
            <span>日志时钟</span>
            <input v-model.number="lab.logClockSeconds" type="number" min="0" max="300" class="input">
          </label>
          <label class="field compact-field">
            <span>公共 TB</span>
            <input v-model.number="lab.publicTbRemaining" type="number" min="0" max="99" class="input">
          </label>
          <label class="field compact-field">
            <span>周期 TB 限额</span>
            <input v-model.number="lab.periodTbLimit" type="number" min="0" max="9" class="input">
          </label>
          <label class="field compact-field">
            <span>周期 SQTB 限额</span>
            <input v-model.number="lab.periodSqtbClaimLimit" type="number" min="0" max="9" class="input">
          </label>
        </div>

        <div class="generator-bar">
          <label class="field compact-field">
            <span>1 队人数</span>
            <input v-model.number="teamSeeds.team1" type="number" min="0" max="50" class="input">
          </label>
          <label class="field compact-field">
            <span>2 队人数</span>
            <input v-model.number="teamSeeds.team2" type="number" min="0" max="50" class="input">
          </label>
          <button type="button" class="action-btn primary" @click="generatePlayers">
            生成玩家列表
          </button>
        </div>
      </div>
    </AppPageToolbar>

    <div class="lab-grid">
      <div class="players-column">
        <AppCard compact title="玩家列表" description="点击名字打开玩家窗口，在窗口里配置状态并发起动作。">
          <div class="teams-grid">
            <section class="team-panel" data-team="1">
              <header class="team-panel__head">
                <div>
                  <h3>1 队</h3>
                  <p>{{ team1Players.length }} 名玩家</p>
                </div>
                <span class="team-chip">{{ team1Players.length }}</span>
              </header>

              <div class="player-list">
                <button
                  v-for="player in team1Players"
                  :key="player.id"
                  type="button"
                  class="player-card"
                  @click="openPlayerDialog(player.id)"
                >
                  <div class="player-card__head">
                    <strong>{{ player.name }}</strong>
                    <span>#{{ player.slot }}</span>
                  </div>
                  <div class="player-card__meta">
                    <span>{{ player.inSquad ? `在队 ${player.squadId}` : "无队" }}</span>
                    <span>{{ player.lockedSquad ? "锁队" : "未锁队" }}</span>
                  </div>
                  <div class="player-card__meta">
                    <span>TB {{ player.tbUsed }}/{{ normalizedLab.periodTbLimit }}</span>
                    <span>SQTB {{ player.sqtbClaimUsed }}/{{ normalizedLab.periodSqtbClaimLimit }}</span>
                  </div>
                </button>
              </div>
            </section>

            <section class="team-panel" data-team="2">
              <header class="team-panel__head">
                <div>
                  <h3>2 队</h3>
                  <p>{{ team2Players.length }} 名玩家</p>
                </div>
                <span class="team-chip">{{ team2Players.length }}</span>
              </header>

              <div class="player-list">
                <button
                  v-for="player in team2Players"
                  :key="player.id"
                  type="button"
                  class="player-card"
                  @click="openPlayerDialog(player.id)"
                >
                  <div class="player-card__head">
                    <strong>{{ player.name }}</strong>
                    <span>#{{ player.slot }}</span>
                  </div>
                  <div class="player-card__meta">
                    <span>{{ player.inSquad ? `在队 ${player.squadId}` : "无队" }}</span>
                    <span>{{ player.lockedSquad ? "锁队" : "未锁队" }}</span>
                  </div>
                  <div class="player-card__meta">
                    <span>TB {{ player.tbUsed }}/{{ normalizedLab.periodTbLimit }}</span>
                    <span>SQTB {{ player.sqtbClaimUsed }}/{{ normalizedLab.periodSqtbClaimLimit }}</span>
                  </div>
                </button>
              </div>
            </section>
          </div>
        </AppCard>
      </div>

      <div class="inspector-column">
        <AppCard compact title="规则概览" description="当前实验室状态会实时影响所有玩家的操作结果。">
          <div class="summary-grid">
            <article class="summary-card">
              <span>模式</span>
              <strong>{{ normalizedLab.isWarmup ? "暖服" : "正式" }}</strong>
              <em>{{ normalizedLab.isWarmup ? "TB 放行，SQTB 禁用" : "按常规规则判定" }}</em>
            </article>
            <article class="summary-card">
              <span>TB 时间窗</span>
              <strong>{{ isClockWindowOpen(normalizedLab.logClockSeconds) ? "打开" : "关闭" }}</strong>
              <em>{{ normalizedLab.logClockSeconds }}s</em>
            </article>
            <article class="summary-card">
              <span>公共 TB 剩余</span>
              <strong>{{ normalizedLab.publicTbRemaining }}</strong>
              <em>成功 TB 时才会消耗</em>
            </article>
            <article class="summary-card">
              <span>待处理 SQTB</span>
              <strong>{{ pendingRequests.length }}</strong>
              <em>待认领或待审批的申请</em>
            </article>
          </div>
        </AppCard>

        <AppCard compact title="SQTB 请求" description="这里会显示你发起出来的申请码，玩家可在详情窗里输入认领xxxxx。">
          <div v-if="requests.length === 0" class="empty-state">
            还没有 SQTB 申请。先点一个玩家，在窗口中发起 `sqtb`。
          </div>
          <div v-else class="request-list">
            <article
              v-for="request in requests"
              :key="request.id"
              class="request-card"
              :data-status="request.status"
            >
              <div class="request-card__head">
                <div>
                  <strong>{{ request.code }}</strong>
                  <span>{{ request.applicantName }} / {{ request.applicantTeamId }} 队</span>
                </div>
                <span class="request-status">{{ requestStatusLabel(request.status) }}</span>
              </div>
              <p>
                {{ request.claimantName ? `认领者: ${request.claimantName}` : "尚未认领" }}
              </p>
              <small>创建于 {{ request.createdAt }}</small>
            </article>
          </div>
        </AppCard>

        <AppCard compact title="最近结果" description="每次在玩家窗里执行动作，都会在这里留下结论。">
          <div class="result-shell" :data-tone="lastResult.tone">
            <div class="result-shell__head">
              <div>
                <p class="eyebrow-text">{{ lastResult.actionLabel }}</p>
                <h3>{{ lastResult.title }}</h3>
              </div>
              <span class="result-badge">{{ lastResult.modeLabel }}</span>
            </div>
            <p class="result-message">{{ lastResult.message }}</p>
            <div class="result-grid">
              <div>
                <span>错误码</span>
                <strong>{{ lastResult.errorCode || "-" }}</strong>
              </div>
              <div>
                <span>影响玩家</span>
                <strong>{{ lastResult.actorName || "-" }}</strong>
              </div>
            </div>
          </div>
        </AppCard>

        <AppCard compact title="操作时间线" description="方便连续调试多个玩家、多条申请码。">
          <div v-if="simulationLog.length === 0" class="empty-state">
            还没有执行记录。
          </div>
          <div v-else class="timeline">
            <article
              v-for="entry in simulationLog"
              :key="entry.id"
              class="timeline-item"
              :data-tone="entry.tone"
            >
              <div class="timeline-item__head">
                <strong>{{ entry.actionLabel }}</strong>
                <span>{{ entry.at }}</span>
              </div>
              <p>{{ entry.title }}</p>
              <small>{{ entry.actorName }} · {{ entry.message }}</small>
            </article>
          </div>
        </AppCard>
      </div>
    </div>

    <div v-if="activePlayer" class="dialog-root" v-backdrop-close="closePlayerDialog">
      <section class="dialog-panel" role="dialog" aria-modal="true">
        <header class="dialog-head">
          <div>
            <h3>{{ activePlayer.name }}</h3>
            <p>{{ activePlayer.teamId }} 队 / {{ activePlayer.inSquad ? `在小队 ${activePlayer.squadId}` : "无队" }}</p>
          </div>
          <button type="button" class="action-btn ghost" @click="closePlayerDialog">
            关闭
          </button>
        </header>

        <div class="dialog-body">
          <div class="dialog-form-grid">
            <label class="field">
              <span>玩家名称</span>
              <input v-model.trim="activePlayer.name" type="text" class="input">
            </label>
            <label class="field">
              <span>所属队伍</span>
              <select v-model.number="activePlayer.teamId" class="input">
                <option :value="1">1 队</option>
                <option :value="2">2 队</option>
              </select>
            </label>
            <label class="field checkbox-field">
              <input v-model="activePlayer.inSquad" type="checkbox" @change="handleSquadToggle(activePlayer)">
              <span>处于小队中</span>
            </label>
            <label class="field" :class="{ 'field--disabled': !activePlayer.inSquad }">
              <span>小队 ID</span>
              <input
                v-model.number="activePlayer.squadId"
                type="number"
                min="0"
                max="99"
                class="input"
                :disabled="!activePlayer.inSquad"
              >
            </label>
            <label class="field checkbox-field">
              <input v-model="activePlayer.lockedSquad" type="checkbox" :disabled="!activePlayer.inSquad">
              <span>当前小队锁队</span>
            </label>
            <label class="field checkbox-field">
              <input v-model="activePlayer.usedThisRound" type="checkbox">
              <span>本局已使用过资格</span>
            </label>
            <label class="field">
              <span>已用 TB</span>
              <input v-model.number="activePlayer.tbUsed" type="number" min="0" max="9" class="input">
            </label>
            <label class="field">
              <span>已用 SQTB</span>
              <input v-model.number="activePlayer.sqtbClaimUsed" type="number" min="0" max="9" class="input">
            </label>
          </div>

          <div class="dialog-actions-panel">
            <button type="button" class="action-btn primary" @click="triggerTb(activePlayer)">
              发起 tb
            </button>
            <button type="button" class="action-btn" @click="triggerSqtb(activePlayer)">
              发起 sqtb
            </button>
          </div>

          <div class="claim-box">
            <label class="field">
              <span>输入聊天内容</span>
              <input
                v-model.trim="playerCommandInput"
                type="text"
                class="input"
                placeholder="例如：认领12345"
                @keydown.enter.prevent="runPlayerCommand(activePlayer)"
              >
            </label>
            <button type="button" class="action-btn" @click="runPlayerCommand(activePlayer)">
              执行输入
            </button>
          </div>

          <div class="player-checks">
            <article
              v-for="item in buildPlayerDiagnostic(activePlayer)"
              :key="item.label"
              class="player-check"
              :data-tone="item.tone"
            >
              <strong>{{ item.label }}</strong>
              <span>{{ item.value }}</span>
            </article>
          </div>
        </div>
      </section>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
import AppPageToolbar from "../components/common/AppPageToolbar.vue";
import AppCard from "../components/common/AppCard.vue";

type ResultTone = "ok" | "warn" | "error" | "idle";
type SimulationAction = "tb" | "sqtb" | "claim";
type RequestStatus = "pending_claim" | "pending_approval";

interface LabPlayer {
  id: string;
  slot: number;
  name: string;
  teamId: number;
  inSquad: boolean;
  squadId: number;
  lockedSquad: boolean;
  usedThisRound: boolean;
  tbUsed: number;
  sqtbClaimUsed: number;
}

interface LabRequest {
  id: string;
  code: string;
  applicantId: string;
  applicantName: string;
  applicantTeamId: number;
  status: RequestStatus;
  claimantId: string;
  claimantName: string;
  createdAt: string;
}

interface LabResult {
  id: number;
  at: string;
  tone: ResultTone;
  action: SimulationAction;
  actionLabel: string;
  actorName: string;
  title: string;
  message: string;
  modeLabel: string;
  errorCode: string;
}

const lab = reactive({
  isWarmup: false,
  logClockSeconds: 32,
  publicTbRemaining: 4,
  periodTbLimit: 1,
  periodSqtbClaimLimit: 1,
});

const teamSeeds = reactive({
  team1: 26,
  team2: 23,
});

const players = ref<LabPlayer[]>([]);
const requests = ref<LabRequest[]>([]);
const activePlayerId = ref("");
const playerCommandInput = ref("");
const simulationLog = ref<LabResult[]>([]);
const lastResult = ref<LabResult>(buildIdleResult());
let requestCounter = 0;
let resultCounter = 0;

generatePlayers();

const normalizedLab = computed(() => ({
  isWarmup: Boolean(lab.isWarmup),
  logClockSeconds: clamp(lab.logClockSeconds, 0, 300),
  publicTbRemaining: clamp(lab.publicTbRemaining, 0, 99),
  periodTbLimit: clamp(lab.periodTbLimit, 0, 9),
  periodSqtbClaimLimit: clamp(lab.periodSqtbClaimLimit, 0, 9),
}));

const team1Players = computed(() => players.value.filter((player) => player.teamId === 1));
const team2Players = computed(() => players.value.filter((player) => player.teamId === 2));
const pendingRequests = computed(() => requests.value.filter((request) => request.status === "pending_claim" || request.status === "pending_approval"));
const activePlayer = computed(() => players.value.find((player) => player.id === activePlayerId.value) ?? null);

const headerStatusItems = computed(() => [
  { label: normalizedLab.value.isWarmup ? "暖服阶段" : "正式阶段", tone: (normalizedLab.value.isWarmup ? "warn" : "ok") as ResultTone },
  { label: `时钟 ${normalizedLab.value.logClockSeconds}s`, tone: (isClockWindowOpen(normalizedLab.value.logClockSeconds) ? "ok" : "warn") as ResultTone },
  { label: `公共 TB ${normalizedLab.value.publicTbRemaining}`, tone: (normalizedLab.value.publicTbRemaining > 0 ? "ok" : "error") as ResultTone },
  { label: `申请 ${pendingRequests.value.length}`, tone: "idle" as ResultTone },
]);

function resetLab() {
  lab.isWarmup = false;
  lab.logClockSeconds = 32;
  lab.publicTbRemaining = 4;
  lab.periodTbLimit = 1;
  lab.periodSqtbClaimLimit = 1;
  teamSeeds.team1 = 26;
  teamSeeds.team2 = 23;
  activePlayerId.value = "";
  playerCommandInput.value = "";
  requests.value = [];
  simulationLog.value = [];
  lastResult.value = buildIdleResult();
  requestCounter = 0;
  resultCounter = 0;
  generatePlayers();
}

function generatePlayers() {
  const nextPlayers: LabPlayer[] = [];
  const team1Count = clamp(teamSeeds.team1, 0, 50);
  const team2Count = clamp(teamSeeds.team2, 0, 50);

  for (let index = 0; index < team1Count; index += 1) {
    nextPlayers.push(createPlayer(1, index + 1));
  }

  for (let index = 0; index < team2Count; index += 1) {
    nextPlayers.push(createPlayer(2, index + 1));
  }

  players.value = nextPlayers;
  requests.value = [];
  activePlayerId.value = "";
  playerCommandInput.value = "";
  simulationLog.value = [];
  lastResult.value = buildIdleResult();
  requestCounter = 0;
}

function createPlayer(teamId: number, slot: number): LabPlayer {
  return {
    id: `team-${teamId}-${slot}`,
    slot,
    name: `T${teamId}-${String(slot).padStart(2, "0")}`,
    teamId,
    inSquad: false,
    squadId: 0,
    lockedSquad: false,
    usedThisRound: false,
    tbUsed: 0,
    sqtbClaimUsed: 0,
  };
}

function openPlayerDialog(playerId: string) {
  activePlayerId.value = playerId;
  playerCommandInput.value = "";
}

function closePlayerDialog() {
  activePlayerId.value = "";
  playerCommandInput.value = "";
}

function handleSquadToggle(player: LabPlayer) {
  if (!player.inSquad) {
    player.squadId = 0;
    player.lockedSquad = false;
    return;
  }
  if (player.squadId <= 0) {
    player.squadId = 1;
  }
}

function triggerTb(player: LabPlayer) {
  const result = executeTb(player);
  commitResult(result);
}

function triggerSqtb(player: LabPlayer) {
  const result = executeSqtb(player);
  commitResult(result);
}

function runPlayerCommand(player: LabPlayer) {
  const command = String(playerCommandInput.value || "").trim();
  if (!command) {
    commitResult(rejectResult("claim", player.name, "EmptyCommand", "请输入认领xxxxx 后再执行。"));
    return;
  }

  const code = parseClaimCode(command);
  if (!code) {
    commitResult(rejectResult("claim", player.name, "UnsupportedCommand", "目前只支持输入认领xxxxx。"));
    return;
  }

  const result = executeClaim(player, code);
  commitResult(result);
  if (result.tone !== "error") {
    playerCommandInput.value = "";
  }
}

function executeTb(player: LabPlayer): LabResult {
  const validation = validateTb(player);
  if (!validation.ok) {
    return rejectResult("tb", player.name, validation.errorCode ?? "ValidationFailed", validation.message ?? "规则校验失败。");
  }

  const nextTeamId = player.teamId === 1 ? 2 : 1;
  player.teamId = nextTeamId;

  if (validation.mode === "normal" || validation.mode === "delta_relief") {
    lab.publicTbRemaining = Math.max(0, normalizedLab.value.publicTbRemaining - 1);
    player.tbUsed += 1;
    player.usedThisRound = true;
  }

  return buildResult("tb", player.name, {
    tone: validation.mode === "warmup" || validation.mode === "delta_relief" ? "warn" : "ok",
    title: "TB 执行成功",
    message: validation.mode === "warmup"
      ? "暖服阶段直接通过 TB，不消耗周期 TB 和当局资格。"
      : validation.mode === "delta_relief"
        ? "执行后虽然人数差仍然偏大，但相比执行前已经缩小，因此按你的规则允许放行。"
        : "满足常规条件，TB 已成功执行并消耗名额。",
    modeLabel: validation.mode === "warmup" ? "Warmup TB" : validation.mode === "delta_relief" ? "Delta Relief" : "Normal TB",
  });
}

function executeSqtb(player: LabPlayer): LabResult {
  const validation = validateSqtbCreate(player);
  if (!validation.ok) {
    return rejectResult("sqtb", player.name, validation.errorCode ?? "ValidationFailed", validation.message ?? "规则校验失败。");
  }

  if (requests.value.some((request) => request.applicantId === player.id)) {
    return rejectResult("sqtb", player.name, "RequestAlreadyExists", "该玩家已经存在一条未处理的 SQTB 申请。");
  }

  const code = generateRequestCode();
  requests.value = [
    {
      id: `req-${Date.now()}-${requestCounter}`,
      code,
      applicantId: player.id,
      applicantName: player.name,
      applicantTeamId: player.teamId,
      status: "pending_claim",
      claimantId: "",
      claimantName: "",
      createdAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    },
    ...requests.value,
  ];

  return buildResult("sqtb", player.name, {
    tone: "ok",
    title: "SQTB 已创建",
    message: `申请码 ${code} 已生成。现在可以让其他玩家在窗口里输入 认领${code}。`,
    modeLabel: "Pending Claim",
  });
}

function executeClaim(player: LabPlayer, code: string): LabResult {
  const request = requests.value.find((item) => item.code === code);
  if (!request) {
    return rejectResult("claim", player.name, "RequestNotFound", "未找到对应的 SQTB 申请码。");
  }
  if (request.status !== "pending_claim") {
    return rejectResult("claim", player.name, "RequestNotClaimable", "该申请已经被认领，不能重复认领。");
  }

  const applicant = players.value.find((item) => item.id === request.applicantId);
  if (!applicant) {
    return rejectResult("claim", player.name, "ApplicantUnavailable", "申请人已经不在当前玩家列表中。");
  }

  const validation = validateClaim(player, applicant);
  if (!validation.ok) {
    return rejectResult("claim", player.name, validation.errorCode ?? "ValidationFailed", validation.message ?? "规则校验失败。");
  }

  request.status = "pending_approval";
  request.claimantId = player.id;
  request.claimantName = player.name;

  return buildResult("claim", player.name, {
    tone: "ok",
    title: "认领成功",
    message: `${player.name} 已认领 ${code}，请求进入待审批状态。`,
    modeLabel: "Pending Approval",
  });
}

function validateTb(player: LabPlayer) {
  if (normalizedLab.value.isWarmup) {
    return { ok: true, mode: "warmup" as const };
  }
  if (player.usedThisRound) {
    return { ok: false, errorCode: "RoundPlayerQuotaExhausted", message: "该玩家本局已经使用过资格。" };
  }
  if (normalizedLab.value.publicTbRemaining <= 0) {
    return { ok: false, errorCode: "RoundTbQuotaExhausted", message: "当前公共 TB 已经耗尽。" };
  }
  if (player.inSquad) {
    return { ok: false, errorCode: "PlayerInSquad", message: "玩家仍处于小队中，不能直接 TB。" };
  }
  const teamCheck = getTeamCheck(player);
  if (!teamCheck.ok) {
    return { ok: false, errorCode: "TeamDeltaExceeded", message: teamCheck.message };
  }
  if (!isClockWindowOpen(normalizedLab.value.logClockSeconds)) {
    return { ok: false, errorCode: "WindowClosed", message: "TB 仅允许在开局 20-60 秒内使用。" };
  }
  if (player.tbUsed >= normalizedLab.value.periodTbLimit) {
    return { ok: false, errorCode: "PlayerTbQuotaExhausted", message: "该玩家本周期 TB 额度已耗尽。" };
  }
  return { ok: true, mode: teamCheck.deltaRelief ? "delta_relief" as const : "normal" as const };
}

function validateSqtbCreate(player: LabPlayer) {
  if (normalizedLab.value.isWarmup) {
    return { ok: false, errorCode: "WarmupSqtbDisabled", message: "暖服阶段禁止 SQTB，请改用 tb。" };
  }
  if (player.inSquad) {
    return { ok: false, errorCode: "PlayerInSquad", message: "玩家仍处于小队中，不能发起 SQTB。" };
  }
  if (player.sqtbClaimUsed >= normalizedLab.value.periodSqtbClaimLimit) {
    return { ok: false, errorCode: "PlayerSqtbQuotaExhausted", message: "该玩家本周期 SQTB 额度已耗尽。" };
  }
  if (player.usedThisRound) {
    return { ok: false, errorCode: "RoundPlayerQuotaExhausted", message: "该玩家本局已经使用过资格。" };
  }
  return { ok: true };
}

function validateClaim(claimant: LabPlayer, applicant: LabPlayer) {
  if (claimant.id === applicant.id) {
    return { ok: false, errorCode: "SelfClaimForbidden", message: "不能认领自己的 SQTB 申请。" };
  }
  if (claimant.sqtbClaimUsed >= normalizedLab.value.periodSqtbClaimLimit) {
    return { ok: false, errorCode: "PlayerSqtbQuotaExhausted", message: "认领者本周期 SQTB 额度已耗尽。" };
  }
  if (claimant.usedThisRound) {
    return { ok: false, errorCode: "RoundPlayerQuotaExhausted", message: "认领者本局已经使用过资格。" };
  }
  if (claimant.lockedSquad) {
    return { ok: false, errorCode: "LockedSquadForbidden", message: "认领者当前处于锁队状态，禁止认领。" };
  }
  const teamCheck = getTeamCheck(applicant);
  if (!teamCheck.ok) {
    return { ok: false, errorCode: "TeamDeltaExceeded", message: teamCheck.message };
  }
  return { ok: true };
}

function getTeamCheck(player: LabPlayer) {
  const team1Count = team1Players.value.length;
  const team2Count = team2Players.value.length;
  const ownCount = player.teamId === 1 ? team1Count : team2Count;
  const otherCount = player.teamId === 1 ? team2Count : team1Count;
  const beforeDelta = Math.abs(ownCount - otherCount);
  const afterOwn = Math.max(0, ownCount - 1);
  const afterOther = otherCount + 1;
  const afterDelta = Math.abs(afterOwn - afterOther);
  const improvesBalance = afterDelta < beforeDelta;
  const withinDeltaLimit = afterDelta < 3;
  const deltaRelief = beforeDelta >= 3 && improvesBalance;
  const ok = withinDeltaLimit || deltaRelief;
  return {
    ok,
    beforeDelta,
    afterDelta,
    deltaRelief,
    message: ok
      ? (deltaRelief
        ? "执行后人数差虽然仍可能较大，但相比执行前已经缩小，允许放行。"
        : "人数变化满足跳边条件。")
      : `当前 1 队 ${team1Count} 人，2 队 ${team2Count} 人。按规则，执行后双方人数差达到 3 或更大时应阻止。`,
  };
}

function buildPlayerDiagnostic(player: LabPlayer) {
  const teamCheck = getTeamCheck(player);
  return [
    {
      label: "TB 时间窗",
      value: isClockWindowOpen(normalizedLab.value.logClockSeconds) ? "允许" : "关闭",
      tone: isClockWindowOpen(normalizedLab.value.logClockSeconds) ? "ok" : "error",
    },
    {
      label: "公共 TB",
      value: String(normalizedLab.value.publicTbRemaining),
      tone: normalizedLab.value.publicTbRemaining > 0 ? "ok" : "error",
    },
    {
      label: "本局资格",
      value: player.usedThisRound ? "已消耗" : "可用",
      tone: player.usedThisRound ? "error" : "ok",
    },
    {
      label: "小队状态",
      value: player.inSquad ? `在队 ${player.squadId}` : "无队",
      tone: player.inSquad ? "warn" : "ok",
    },
    {
      label: "锁队状态",
      value: player.lockedSquad ? "锁队" : "未锁队",
      tone: player.lockedSquad ? "warn" : "ok",
    },
    {
      label: "人数差判定",
      value: teamCheck.ok ? "允许" : "拒绝",
      tone: teamCheck.ok ? "ok" : "error",
    },
  ];
}

function parseClaimCode(command: string) {
  const normalized = command.replace(/\s+/g, "");
  const match = normalized.match(/^认领(\d{5})$/);
  return match?.[1] ?? "";
}

function requestStatusLabel(status: RequestStatus) {
  return status === "pending_claim" ? "待认领" : "待审批";
}

function generateRequestCode() {
  requestCounter += 1;
  return String(10000 + (requestCounter % 90000)).padStart(5, "0");
}

function commitResult(result: LabResult) {
  lastResult.value = result;
  simulationLog.value = [result, ...simulationLog.value].slice(0, 16);
}

function rejectResult(action: SimulationAction, actorName: string, errorCode: string, message: string) {
  return buildResult(action, actorName, {
    tone: "error",
    title: `${actionLabel(action)} 被拒绝`,
    message,
    modeLabel: "Rejected",
    errorCode,
  });
}

function buildResult(action: SimulationAction, actorName: string, overrides: Partial<Omit<LabResult, "id" | "at" | "action" | "actionLabel" | "actorName">>) {
  return {
    id: ++resultCounter,
    at: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    action,
    actionLabel: actionLabel(action),
    actorName,
    tone: overrides.tone ?? "idle",
    title: overrides.title ?? "已完成",
    message: overrides.message ?? "",
    modeLabel: overrides.modeLabel ?? "Normal",
    errorCode: overrides.errorCode ?? "",
  };
}

function buildIdleResult(): LabResult {
  return {
    id: 0,
    at: "",
    tone: "idle",
    action: "tb",
    actionLabel: "等待操作",
    actorName: "",
    title: "尚未执行动作",
    message: "先生成玩家列表，再点开一个玩家开始测试。",
    modeLabel: "Idle",
    errorCode: "",
  };
}

function actionLabel(action: SimulationAction) {
  if (action === "tb") return "发起 tb";
  if (action === "sqtb") return "发起 sqtb";
  return "输入认领";
}

function isClockWindowOpen(seconds: number) {
  return seconds >= 20 && seconds <= 60;
}

function clamp(value: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}
</script>

<style scoped>
.toolbar-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.85fr);
  gap: 12px;
  width: 100%;
}

.toolbar-fields,
.generator-bar {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

.generator-bar {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.lab-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(360px, 0.9fr);
  gap: 16px;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.players-column,
.inspector-column {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding-right: 10px;
  scrollbar-gutter: stable;
}

.teams-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(280px, 1fr));
  gap: 14px;
  align-items: start;
}

.team-panel {
  display: grid;
  gap: 12px;
  min-height: 0;
  min-width: 0;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.2);
  overflow: hidden;
}

.team-panel[data-team="1"] {
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.12), transparent 38%),
    rgba(15, 23, 42, 0.2);
}

.team-panel[data-team="2"] {
  background:
    radial-gradient(circle at top right, rgba(249, 115, 22, 0.12), transparent 38%),
    rgba(15, 23, 42, 0.2);
}

.team-panel__head,
.player-card__head,
.request-card__head,
.timeline-item__head,
.result-shell__head,
.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.team-panel__head h3,
.dialog-head h3,
.result-shell__head h3 {
  margin: 0;
}

.team-panel__head > div,
.player-card__head > strong {
  min-width: 0;
}

.team-panel__head p,
.dialog-head p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.team-chip,
.request-status,
.result-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(255, 255, 255, 0.05);
  font-size: 12px;
  font-weight: 700;
}

.player-list,
.request-list,
.timeline {
  display: grid;
  gap: 10px;
}

.player-card,
.request-card,
.summary-card,
.timeline-item,
.player-check {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(255, 255, 255, 0.03);
}

.player-card {
  text-align: left;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: transform 0.14s ease, border-color 0.14s ease;
}

.player-card strong,
.player-card span {
  min-width: 0;
}

.player-card:hover {
  transform: translateY(-1px);
  border-color: rgba(96, 165, 250, 0.28);
}

.player-card__meta,
.request-card p,
.request-card small,
.timeline-item small,
.summary-card em,
.result-message {
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.player-card__meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 10px;
}

.player-card__head strong,
.player-card__meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-card__meta span:last-child {
  text-align: right;
}

.summary-grid,
.dialog-form-grid,
.result-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.summary-card span,
.field span,
.result-grid span,
.eyebrow-text {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.summary-card strong {
  font-size: 24px;
  line-height: 1.05;
}

.empty-state {
  padding: 12px 0;
  color: var(--color-text-muted);
}

.result-shell {
  display: grid;
  gap: 14px;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(15, 23, 42, 0.24);
}

.result-shell[data-tone="ok"] {
  border-color: rgba(34, 197, 94, 0.24);
}

.result-shell[data-tone="warn"] {
  border-color: rgba(245, 158, 11, 0.24);
}

.result-shell[data-tone="error"] {
  border-color: rgba(239, 68, 68, 0.24);
}

.result-grid div {
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(255, 255, 255, 0.025);
}

.result-grid strong {
  display: block;
  margin-top: 6px;
}

.dialog-root {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(8, 12, 16, 0.72);
}

.dialog-panel {
  width: min(760px, 100%);
  max-height: calc(100vh - 48px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: #171d23;
  padding: 18px;
}

.dialog-body {
  display: grid;
  gap: 14px;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.field {
  display: grid;
  gap: 6px;
}

.compact-field {
  align-content: start;
}

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(255, 255, 255, 0.03);
}

.checkbox-field span {
  text-transform: none;
  letter-spacing: normal;
  font-size: 13px;
  color: var(--color-text-primary);
}

.field--disabled {
  opacity: 0.55;
}

.input {
  width: 100%;
  min-height: 40px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  padding: 10px 12px;
  outline: none;
}

.dialog-actions-panel,
.claim-box {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.claim-box {
  align-items: end;
}

.action-btn {
  min-height: 40px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  font-weight: 700;
  cursor: pointer;
}

.action-btn.primary {
  border-color: rgba(59, 130, 246, 0.36);
  background: rgba(59, 130, 246, 0.16);
}

.action-btn.ghost {
  background: rgba(255, 255, 255, 0.02);
}

.player-checks {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.player-check strong {
  font-size: 13px;
}

.player-check span {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.player-check[data-tone="ok"] {
  border-color: rgba(34, 197, 94, 0.2);
}

.player-check[data-tone="warn"] {
  border-color: rgba(245, 158, 11, 0.2);
}

.player-check[data-tone="error"] {
  border-color: rgba(239, 68, 68, 0.2);
}

.request-card[data-status="pending_claim"] .request-status {
  color: #cfe2ff;
  border-color: rgba(59, 130, 246, 0.28);
  background: rgba(59, 130, 246, 0.12);
}

.request-card[data-status="pending_approval"] .request-status {
  color: #fde68a;
  border-color: rgba(245, 158, 11, 0.28);
  background: rgba(245, 158, 11, 0.12);
}

.timeline-item[data-tone="ok"] {
  border-color: rgba(34, 197, 94, 0.2);
}

.timeline-item[data-tone="warn"] {
  border-color: rgba(245, 158, 11, 0.2);
}

.timeline-item[data-tone="error"] {
  border-color: rgba(239, 68, 68, 0.2);
}

@media (max-width: 1280px) {
  .toolbar-grid,
  .lab-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .toolbar-fields,
  .generator-bar,
  .teams-grid,
  .summary-grid,
  .dialog-form-grid,
  .player-checks,
  .result-grid,
  .dialog-actions-panel,
  .claim-box {
    grid-template-columns: 1fr;
  }

  .players-column,
  .inspector-column {
    overflow: visible;
    padding-right: 0;
  }

  .lab-grid {
    overflow: visible;
  }
}
</style>
