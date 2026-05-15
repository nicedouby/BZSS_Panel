<template>
  <section class="group-report-page">
    <header class="page-header">
      <div class="page-title-block">
        <p class="eyebrow">Plugin</p>
        <h1>抱团报备</h1>
        <p class="subtitle">只维护抱团数据，不处理打乱、换队或 RCON。</p>
      </div>

      <div class="header-actions">
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
                <button type="button" class="danger" @click.stop="deleteGroup(group)">删除</button>
              </div>
            </div>

            <p v-if="group.note" class="note-box">{{ group.note }}</p>

            <div class="member-list">
              <div v-if="!group.members.length" class="empty-hint">暂无成员</div>

              <div v-for="member in group.members" :key="member.playerKey" class="member-row">
                <div class="member-copy">
                  <strong>{{ member.name }}</strong>
                  <span>{{ memberLabel(member) }}</span>
                  <p v-if="member.note" class="note-box small">{{ member.note }}</p>
                </div>

                <div class="inline-actions">
                  <button type="button" @click.stop="editMemberNote(group, member)">备注</button>
                  <button type="button" class="danger" @click.stop="removeMember(group, member)">移除</button>
                </div>
              </div>
            </div>
          </article>

          <div v-if="!groups.length" class="empty-hint">暂未创建抱团容器。</div>
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
          placeholder="搜索玩家名称 / EOS / Steam"
        >

        <div class="player-list">
          <div v-if="loadingPlayers" class="empty-hint">正在搜索玩家...</div>
          <div v-else-if="!players.length" class="empty-hint">没有找到玩家。</div>

          <div v-for="player in players" :key="playerKeyOf(player)" class="player-row">
            <div class="player-copy">
              <strong>{{ player.name }}</strong>
              <span>{{ playerSubtitle(player) }}</span>
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
import { groupReportApi, type GroupReportGroup, type GroupReportMember, type GroupReportSnapshot } from "../features/group-report/groupReport.api";
import { searchPlayers, type SearchablePlayer } from "../features/group-report/playerSearch";

const groups = ref<GroupReportGroup[]>([]);
const players = ref<SearchablePlayer[]>([]);
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
  await Promise.all([loadGroups(), loadPlayers()]);
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

async function createGroup() {
  const name = newGroupName.value.trim() || "未命名抱团";

  try {
    const group = await groupReportApi.createGroup({ name });
    groups.value = [group, ...groups.value];
    selectedGroupId.value = group.id;
    newGroupName.value = "";
    info.value = `已创建抱团「${group.name}」。`;
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

async function addPlayer(player: SearchablePlayer) {
  if (!selectedGroup.value) return;

  try {
    const updated = await groupReportApi.addMember(selectedGroup.value.id, {
      name: player.name,
      eosId: player.eosId,
      steamId: player.steamId,
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
    if (player.eosId && member.eosId === player.eosId) return true;
    if (player.steamId && member.steamId === player.steamId) return true;
    return false;
  });
}

function playerKeyOf(player: SearchablePlayer) {
  return `${player.eosId ?? ""}-${player.steamId ?? ""}-${player.name}`;
}

function memberLabel(member: GroupReportMember) {
  if (member.eosId) return `EOS ${member.eosId}`;
  if (member.steamId) return `Steam ${member.steamId}`;
  return member.playerKey;
}

function playerSubtitle(player: SearchablePlayer) {
  const parts: string[] = [];
  if (player.eosId) parts.push(`EOS ${player.eosId}`);
  if (player.steamId) parts.push(`Steam ${player.steamId}`);
  if (player.teamId !== undefined) parts.push(`Team ${player.teamId}`);
  if (player.squadId !== undefined) parts.push(`Squad ${player.squadId}`);
  return parts.join(" · ");
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
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 12px;
}

.left-pane,
.right-pane {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 16px;
  background: rgba(8, 15, 28, 0.72);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24);
  overflow: hidden;
}

.left-pane {
  padding: 14px;
}

.right-pane {
  padding: 14px;
}

.create-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.create-row input,
.search-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  color: #ecf2f8;
  background: rgba(2, 6, 23, 0.75);
  outline: none;
}

.create-row input:focus,
.search-input:focus {
  border-color: rgba(96, 165, 250, 0.75);
}

.group-list,
.player-list {
  min-height: 0;
  overflow: auto;
  display: grid;
  gap: 10px;
}

.group-card,
.player-row {
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.62);
}

.group-card {
  padding: 12px;
  cursor: pointer;
}

.group-card.selected {
  border-color: rgba(96, 165, 250, 0.8);
  background: rgba(30, 64, 175, 0.2);
}

.group-head,
.member-row,
.player-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
}

.group-head {
  margin-bottom: 10px;
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
  gap: 6px;
  flex-wrap: wrap;
}

.member-list {
  display: grid;
  gap: 8px;
}

.member-row,
.player-row {
  padding: 10px;
  border-radius: 12px;
  background: rgba(2, 6, 23, 0.36);
}

.member-copy,
.player-copy {
  min-width: 0;
}

.member-copy strong,
.player-copy strong {
  display: block;
  font-size: 14px;
}

.member-copy span,
.player-copy span {
  display: block;
  margin-top: 4px;
  color: #94a3b8;
  font-size: 11px;
  word-break: break-all;
}

.note-box {
  margin: 10px 0 0;
  padding: 10px;
  border-radius: 10px;
  background: rgba(2, 6, 23, 0.48);
  color: #dbe5f0;
  font-size: 13px;
  white-space: pre-wrap;
}

.note-box.small {
  margin-top: 8px;
  padding: 8px;
}

.search-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.search-head h2 {
  margin: 0;
  font-size: 18px;
}

.search-head p {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 13px;
}

.empty-hint {
  padding: 16px;
  border-radius: 12px;
  color: #94a3b8;
  text-align: center;
  background: rgba(2, 6, 23, 0.28);
}

button {
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  color: #e5eef7;
  background: rgba(51, 65, 85, 0.9);
  cursor: pointer;
  white-space: nowrap;
}

button:hover:not(:disabled) {
  background: rgba(71, 85, 105, 0.96);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.danger {
  border-color: rgba(248, 113, 113, 0.35);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.36);
}

button.danger:hover:not(:disabled) {
  background: rgba(153, 27, 27, 0.5);
}

@media (max-width: 1120px) {
  .workspace {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 780px) {
  .page-header,
  .create-row,
  .group-head,
  .member-row,
  .player-row {
    flex-direction: column;
  }

  .inline-actions {
    width: 100%;
  }

  .inline-actions button,
  .header-actions button {
    width: 100%;
  }
}
</style>
