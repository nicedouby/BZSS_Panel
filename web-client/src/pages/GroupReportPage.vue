<template>
  <section class="group-report-page">
    <header class="page-header">
      <div class="page-title-block">
        <p class="eyebrow">Plugin</p>
        <h1>抱团报备</h1>
        <p class="subtitle">只维护抱团数据，不处理打乱、换队或 RCON。</p>
      </div>

      <div class="header-actions">
        <button type="button" class="danger" @click="clearAllGroups" :disabled="!groups.length">
          一键全部删除
        </button>
        <button type="button" @click="reloadAll" :disabled="loadingGroups || loadingPlayers">
          {{ loadingGroups || loadingPlayers ? "刷新中..." : "刷新" }}
        </button>
      </div>
    </header>

    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="info" class="banner info">{{ info }}</div>

    <div class="workspace">
      <section class="left-pane">
        <div class="create-row">
          <input
            v-model="newGroupName"
            type="text"
            placeholder="新建抱团名称"
            @keydown.enter="createGroup"
          >
          <button type="button" @click="createGroup">+ 新建抱团</button>
        </div>

        <div class="group-list">
          <article
            v-for="group in groups"
            :key="group.id"
            class="group-card"
            :class="{ selected: group.id === selectedGroupId }"
            @click="selectedGroupId = group.id"
          >
            <div class="group-head">
              <div class="group-head-copy">
                <h2>{{ group.name }}</h2>
                <p>{{ group.members.length }} 人 · 更新 {{ formatTime(group.updatedAt) }}</p>
              </div>

              <div class="inline-actions">
                <button type="button" @click.stop="renameGroup(group)">改名</button>
                <button type="button" @click.stop="editGroupNote(group)">备注</button>
                <button type="button" @click.stop="clearMembers(group)">清空成员</button>
                <button type="button" class="danger" @click.stop="deleteGroup(group)">删除</button>
              </div>
            </div>

            <p v-if="group.note" class="note-box">{{ group.note }}</p>

            <div class="member-list">
              <div v-if="!group.members.length" class="empty-hint">暂无成员</div>

              <div v-for="member in group.members" :key="member.playerKey" class="member-row">
                <div class="member-copy">
                  <div class="member-line member-line-main">
                    <strong>{{ member.name }}</strong>
                    <span class="member-primary-id">{{ steamLabel(member) }}</span>
                  </div>

                  <div class="member-tags">
                    <span class="tag">Team {{ displayNumber(memberTeamId(member)) }}</span>
                    <span class="tag">Squad {{ displayNumber(memberSquadId(member)) }}</span>
                    <span class="tag">{{ playtimeLabel(memberPlaytimeHours(member)) }}</span>
                  </div>

                  <p v-if="member.note" class="note-box small">{{ member.note }}</p>
                </div>

                <div class="inline-actions">
                  <button type="button" @click.stop="editMemberNote(group, member)">备注</button>
                  <button type="button" class="danger" @click.stop="removeMember(group, member)">移除</button>
                </div>
              </div>
            </div>
          </article>

          <div v-if="!groups.length" class="empty-hint">暂无抱团容器。</div>
        </div>
      </section>

      <aside class="right-pane">
        <div class="search-head">
          <div>
            <h2>玩家列表</h2>
            <p>
              当前选中：
              <strong>{{ selectedGroup?.name || "未选择抱团" }}</strong>
            </p>
          </div>
        </div>

        <input
          v-model="playerKeyword"
          class="search-input"
          type="text"
          placeholder="搜索玩家名称 / Steam / EOS"
        >

        <div class="player-list">
          <div v-if="loadingPlayers" class="empty-hint">正在搜索玩家...</div>
          <div v-else-if="!players.length" class="empty-hint">没有找到玩家。</div>

          <div v-for="player in players" :key="playerKeyOf(player)" class="player-row">
            <div class="player-copy">
              <div class="member-line member-line-main">
                <strong>{{ player.name }}</strong>
                <span class="member-primary-id">{{ steamPlayerLabel(player) }}</span>
              </div>

              <div class="member-tags">
                <span class="tag">Team {{ displayNumber(playerTeamId(player)) }}</span>
                <span class="tag">Squad {{ displayNumber(playerSquadId(player)) }}</span>
                <span class="tag">{{ playtimeLabel(player.playtimeHours) }}</span>
              </div>
            </div>

            <button
              type="button"
              :disabled="!selectedGroup || isAlreadyInSelectedGroup(player)"
              @click="addPlayer(player)"
            >
              {{ isAlreadyInSelectedGroup(player) ? "已加入" : "加入当前抱团" }}
            </button>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { apiGet } from "../app/apiClient";
import { groupReportApi, type GroupReportGroup, type GroupReportMember, type GroupReportSnapshot } from "../features/group-report/groupReport.api";
import { searchPlayers, type SearchablePlayer } from "../features/group-report/playerSearch";

const groups = ref<GroupReportGroup[]>([]);
const players = ref<SearchablePlayer[]>([]);
const runtimePlayers = ref<any[]>([]);
const selectedGroupId = ref<string | null>(null);
const playerKeyword = ref("");
const newGroupName = ref("");
const loadingGroups = ref(false);
const loadingPlayers = ref(false);
const error = ref("");
const info = ref("");

let searchTimer: number | null = null;

const selectedGroup = computed(() => groups.value.find((group) => group.id === selectedGroupId.value) ?? null);

onMounted(() => {
  void reloadAll();
});

onBeforeUnmount(() => {
  if (searchTimer != null) {
    window.clearTimeout(searchTimer);
  }
});

watch(
  () => playerKeyword.value,
  () => {
    if (searchTimer != null) {
      window.clearTimeout(searchTimer);
    }

    searchTimer = window.setTimeout(() => {
      void loadPlayers();
    }, 220);
  },
);

async function reloadAll() {
  await Promise.all([loadGroups(), loadRuntimePlayers(), loadPlayers()]);
}

async function loadGroups() {
  loadingGroups.value = true;
  error.value = "";

  try {
    const snapshot: GroupReportSnapshot = await groupReportApi.getSnapshot();
    groups.value = snapshot.groups ?? [];

    if (!selectedGroupId.value || !groups.value.some((group) => group.id === selectedGroupId.value)) {
      selectedGroupId.value = groups.value[0]?.id ?? null;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loadingGroups.value = false;
  }
}

async function loadPlayers() {
  loadingPlayers.value = true;

  try {
    players.value = await searchPlayers(playerKeyword.value);
  } catch (err) {
    console.warn("[GroupReport] Player search failed", err);
    players.value = [];
    info.value = "玩家搜索失败。";
  } finally {
    loadingPlayers.value = false;
  }
}

async function loadRuntimePlayers() {
  try {
    const snapshot = await apiGet<any>("/api/snapshot/players");
    runtimePlayers.value = Array.isArray(snapshot?.active)
      ? snapshot.active
      : Array.isArray(snapshot?.players)
        ? snapshot.players
        : [];
  } catch {
    runtimePlayers.value = [];
  }
}

async function createGroup() {
  const name = newGroupName.value.trim() || "未命名抱团";

  try {
    const group = await groupReportApi.createGroup({ name });
    groups.value = [group, ...groups.value];
    selectedGroupId.value = group.id;
    newGroupName.value = "";
    info.value = `已创建抱团：${group.name}`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function renameGroup(group: GroupReportGroup) {
  const nextName = window.prompt("新的抱团名称：", group.name);
  if (nextName === null) return;

  try {
    const updated = await groupReportApi.updateGroup(group.id, {
      name: nextName,
      note: group.note,
    });
    replaceGroup(updated);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function editGroupNote(group: GroupReportGroup) {
  const nextNote = window.prompt("抱团备注：", group.note ?? "");
  if (nextNote === null) return;

  try {
    const updated = await groupReportApi.updateGroup(group.id, {
      name: group.name,
      note: nextNote,
    });
    replaceGroup(updated);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function deleteGroup(group: GroupReportGroup) {
  if (!window.confirm(`确定删除抱团「${group.name}」吗？`)) return;

  try {
    await groupReportApi.deleteGroup(group.id);
    groups.value = groups.value.filter((item) => item.id !== group.id);
    if (selectedGroupId.value === group.id) {
      selectedGroupId.value = groups.value[0]?.id ?? null;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function clearMembers(group: GroupReportGroup) {
  if (!window.confirm(`确定清空抱团「${group.name}」的全部成员吗？`)) return;

  try {
    const updated = await groupReportApi.clearGroupMembers(group.id);
    replaceGroup(updated);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function clearAllGroups() {
  if (!window.confirm("确定一键删除全部抱团容器吗？此操作无法撤销。")) return;

  try {
    await groupReportApi.deleteAllGroups();
    groups.value = [];
    selectedGroupId.value = null;
    info.value = "已删除全部抱团容器。";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function addPlayer(player: SearchablePlayer) {
  if (!selectedGroup.value) return;

  try {
    const updated = await groupReportApi.addMember(selectedGroup.value.id, {
      name: player.name,
      eosId: player.eosId,
      steamId: player.steamId,
      teamId: player.teamId,
      squadId: player.squadId,
      playtimeHours: player.playtimeHours ?? undefined,
    });
    replaceGroup(updated);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function editMemberNote(group: GroupReportGroup, member: GroupReportMember) {
  const nextNote = window.prompt("成员备注：", member.note ?? "");
  if (nextNote === null) return;

  try {
    const updated = await groupReportApi.updateMember(group.id, member.playerKey, {
      name: member.name,
      note: nextNote,
      eosId: member.eosId,
      steamId: member.steamId,
      teamId: member.teamId,
      squadId: member.squadId,
      playtimeHours: member.playtimeHours,
    });
    replaceGroup(updated);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function removeMember(group: GroupReportGroup, member: GroupReportMember) {
  try {
    const updated = await groupReportApi.removeMember(group.id, member.playerKey);
    replaceGroup(updated);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function replaceGroup(updated: GroupReportGroup) {
  groups.value = groups.value.map((group) => (group.id === updated.id ? updated : group));
}

function isAlreadyInSelectedGroup(player: SearchablePlayer) {
  if (!selectedGroup.value) return false;
  return selectedGroup.value.members.some((member) => {
    if (player.steamId && member.steamId === player.steamId) return true;
    if (player.eosId && member.eosId === player.eosId) return true;
    return false;
  });
}

function playerKeyOf(player: SearchablePlayer) {
  return `${player.steamId ?? ""}-${player.eosId ?? ""}-${player.name}`;
}

function steamLabel(member: GroupReportMember) {
  const runtime = findRuntimePlayer(member);
  if (member.steamId || runtime?.steamID) return `Steam ${member.steamId ?? runtime?.steamID}`;
  if (member.eosId || runtime?.eosID) return `EOS ${member.eosId ?? runtime?.eosID}`;
  return member.playerKey;
}

function steamPlayerLabel(player: SearchablePlayer) {
  if (player.steamId) return `Steam ${player.steamId}`;
  if (player.eosId) return `EOS ${player.eosId}`;
  return "--";
}

function displayNumber(value: number | null | undefined) {
  return value == null ? "--" : String(value);
}

function playtimeLabel(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "时长 --";
  return `时长 ${Number(value).toFixed(1)}h`;
}

function memberTeamId(member: GroupReportMember) {
  return member.teamId ?? numberValue(findRuntimePlayer(member)?.teamID);
}

function memberSquadId(member: GroupReportMember) {
  return member.squadId ?? numberValue(findRuntimePlayer(member)?.squadID);
}

function playerTeamId(player: SearchablePlayer) {
  return player.teamId ?? undefined;
}

function playerSquadId(player: SearchablePlayer) {
  return player.squadId ?? undefined;
}

function memberPlaytimeHours(member: GroupReportMember) {
  return member.playtimeHours ?? undefined;
}

function findRuntimePlayer(member: GroupReportMember) {
  const steam = String(member.steamId ?? "").trim();
  const eos = String(member.eosId ?? "").trim();
  return runtimePlayers.value.find((item) => {
    if (steam && String(item?.steamID ?? item?.steamId ?? item?.steam_id ?? "").trim() === steam) {
      return true;
    }
    if (eos && String(item?.eosID ?? item?.eosId ?? item?.eos_id ?? "").trim() === eos) {
      return true;
    }
    return false;
  }) ?? null;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatTime(value: number) {
  return value ? new Date(value).toLocaleString() : "-";
}
</script>

<style scoped>
.group-report-page {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 12px;
  padding: 16px;
  color: #e5eef7;
  background:
    radial-gradient(circle at top right, rgba(37, 99, 235, 0.18), transparent 34%),
    radial-gradient(circle at left center, rgba(16, 185, 129, 0.12), transparent 24%),
    #0b1220;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.page-title-block h1 {
  margin: 0;
  font-size: 24px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #7dd3fc;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.subtitle {
  margin: 8px 0 0;
  color: #93a4bf;
  font-size: 13px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.banner {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid transparent;
  font-size: 13px;
}

.banner.error {
  border-color: rgba(248, 113, 113, 0.35);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.32);
}

.banner.info {
  border-color: rgba(96, 165, 250, 0.35);
  color: #bfdbfe;
  background: rgba(30, 64, 175, 0.24);
}

.workspace {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 12px;
}

.left-pane,
.right-pane {
  min-width: 0;
  min-height: 0;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 14px;
  background: rgba(8, 15, 28, 0.8);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
}

.left-pane {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.create-row {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.create-row input,
.search-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(2, 6, 23, 0.72);
  color: #e5eef7;
  padding: 0 12px;
  outline: none;
}

.create-row input:focus,
.search-input:focus {
  border-color: rgba(96, 165, 250, 0.72);
}

.group-list {
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 12px;
  align-content: start;
}

.group-card {
  min-width: 0;
  max-width: 100%;
  max-height: 540px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(30, 41, 59, 0.65);
  border-radius: 14px;
  padding: 12px;
  cursor: pointer;
  overflow: hidden;
}

.group-card.selected {
  border-color: rgba(96, 165, 250, 0.7);
  background: rgba(30, 64, 175, 0.24);
}

.group-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.group-head-copy {
  min-width: 0;
}

.group-head-copy h2 {
  margin: 0;
  font-size: 16px;
}

.group-head-copy p {
  margin: 4px 0 0;
  color: #94a3b8;
  font-size: 12px;
}

.inline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.group-card .note-box,
.member-row .note-box {
  margin: 0;
}

.member-list {
  min-height: 0;
  overflow: auto;
  display: grid;
  gap: 8px;
  padding-right: 2px;
}

.member-row,
.player-row {
  min-width: 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.56);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.member-copy,
.player-copy {
  min-width: 0;
  flex: 1;
}

.member-line {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.member-line strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-primary-id {
  flex: 0 0 auto;
  color: #cbd5e1;
  font-size: 12px;
}

.member-tags {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(30, 41, 59, 0.92);
  border: 1px solid rgba(148, 163, 184, 0.14);
  color: #dbeafe;
  font-size: 12px;
  white-space: nowrap;
}

.note-box {
  padding: 8px 10px;
  border-radius: 10px;
  color: #cbd5e1;
  background: rgba(15, 23, 42, 0.52);
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.note-box.small {
  margin-top: 8px;
  font-size: 12px;
}

.right-pane {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  padding: 12px;
}

.search-head h2 {
  margin: 0;
  font-size: 18px;
}

.search-head p {
  margin: 5px 0 0;
  color: #94a3b8;
  font-size: 13px;
}

.search-input {
  width: 100%;
  margin-top: 10px;
}

.player-list {
  min-height: 0;
  overflow: auto;
  margin-top: 12px;
  display: grid;
  gap: 8px;
  align-content: start;
}

.player-row {
  align-items: center;
}

.empty-hint {
  padding: 16px;
  color: #94a3b8;
  text-align: center;
  font-size: 13px;
}

button {
  height: 32px;
  padding: 0 10px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 10px;
  color: #e5eef7;
  background: rgba(51, 65, 85, 0.9);
  cursor: pointer;
  white-space: nowrap;
}

button:hover:not(:disabled) {
  background: rgba(71, 85, 105, 0.95);
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

button.danger {
  border-color: rgba(248, 113, 113, 0.35);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.35);
}

button.danger:hover:not(:disabled) {
  background: rgba(153, 27, 27, 0.48);
}

@media (max-width: 1100px) {
  .workspace {
    grid-template-columns: 1fr;
  }

  .right-pane {
    min-height: 420px;
  }
}

@media (max-width: 760px) {
  .page-header,
  .group-head,
  .member-row,
  .player-row {
    flex-direction: column;
  }

  .header-actions,
  .inline-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .group-list {
    grid-template-columns: 1fr;
  }
}
</style>
