<template>
  <section class="page">
    <PageHeader title="Squad Manage" subtitle="Read-only runtime view with action APIs for squad operations.">
      <template #actions>
        <StatusBadge :tone="server.snapshot.webStatus?.rcon === 'connected' ? 'ok' : 'warn'">
          {{ server.snapshot.webStatus?.rcon || "unknown" }}
        </StatusBadge>
        <button type="button" :disabled="refreshing" @click="requestRefresh">
          {{ refreshing ? "Refreshing..." : "Queue RCON Refresh" }}
        </button>
      </template>
    </PageHeader>

    <DataState
      :empty="!match.teams.length"
      empty-title="No team snapshot"
      empty-text="runtimeSync has not produced any team data yet."
    >
      <div class="team-grid">
        <PageCard v-for="team in match.teams" :key="team.teamID" :title="team.teamName" :description="`${team.playerCount} players`">
          <div class="squad-list">
            <article v-for="squad in team.squads" :key="squad.key" class="squad-row">
              <div class="squad-row-head">
                <div>
                  <strong>{{ squad.squadName || `Squad ${squad.squadID}` }}</strong>
                  <p>{{ squad.members.length }} members · {{ squad.locked ? "locked" : "open" }}</p>
                </div>
                <button type="button" @click="disbandSquad(squad.teamID, squad.squadID)">Disband</button>
              </div>

              <div class="member-list">
                <div v-for="player in squad.members" :key="player.steamID || player.eosID || player.playerID || player.name" class="member-row">
                  <div class="member-copy">
                    <strong>{{ player.name }}</strong>
                    <span>{{ player.role || "Unknown role" }} · ID {{ player.playerID ?? "-" }}</span>
                  </div>
                  <div class="member-actions">
                    <button type="button" @click="warnPlayer(player)">Warn</button>
                    <button type="button" @click="forceTeamChange(player)">Force Team Change</button>
                    <button type="button" @click="kickFromSquad(player)">Kick From Squad</button>
                  </div>
                </div>
              </div>
            </article>

            <div v-if="!team.squads.length" class="empty-squad">No squad data for this team.</div>
          </div>
        </PageCard>
      </div>
    </DataState>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { apiPost } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import { useMatchStore } from "../stores/match.store";
import { usePlayerStore } from "../stores/player.store";
import { useServerStore } from "../stores/server.store";
import { useSquadStore } from "../stores/squad.store";
import { useUiStore } from "../stores/ui.store";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";
import StatusBadge from "../components/common/StatusBadge.vue";

const match = useMatchStore();
usePlayerStore();
useSquadStore();
const server = useServerStore();
const ui = useUiStore();
const refreshing = ref(false);

async function warnPlayer(player: any) {
  try {
    const result = await apiPost<any>("/api/actions/warn-player", {
      targetName: player.name,
      targetSteam64: player.steamID,
      targetEOS: player.eosID,
      message: "Please coordinate with your squad and follow the current order.",
    });
    ui.pushToast({
      title: "Warning sent",
      message: result.message || `Sent a warning to ${player.name}.`,
      tone: "ok",
    });
  } catch (error) {
    ui.pushToast({
      title: "Warning failed",
      message: renderApiError(error, "Failed to warn the player."),
      tone: "error",
    });
  }
}

async function disbandSquad(teamID: number | null, squadID: number | null) {
  if (teamID == null || squadID == null) return;
  const confirmed = await ui.openConfirm({
    title: "Disband squad",
    message: `Disband squad ${teamID}:${squadID}? The page will wait for runtimeSync to reflect the updated state.`,
    confirmText: "Disband",
    tone: "warn",
  });
  if (!confirmed) return;

  try {
    const result = await apiPost<any>("/api/actions/disband-squad", { teamID, squadID });
    ui.pushToast({
      title: "Disband command queued",
      message: result.message || `Requested disband for squad ${teamID}:${squadID}.`,
      tone: "ok",
    });
  } catch (error) {
    ui.pushToast({
      title: "Disband failed",
      message: renderApiError(error, "Failed to disband the squad."),
      tone: "error",
    });
  }
}

async function forceTeamChange(player: any) {
  const confirmed = await ui.openConfirm({
    title: "Force team change",
    message: `Force ${player.name} to switch teams?`,
    confirmText: "Force Change",
    tone: "warn",
  });
  if (!confirmed) return;

  try {
    const result = await apiPost<any>("/api/actions/force-team-change", {
      targetName: player.name,
      targetSteam64: player.steamID,
    });
    ui.pushToast({
      title: "Team change requested",
      message: result.message || `Requested a forced team change for ${player.name}.`,
      tone: "ok",
    });
  } catch (error) {
    ui.pushToast({
      title: "Team change failed",
      message: renderApiError(error, "Failed to force the team change."),
      tone: "error",
    });
  }
}

async function kickFromSquad(player: any) {
  const confirmed = await ui.openConfirm({
    title: "Kick from squad",
    message: `Remove ${player.name} from the current squad?`,
    confirmText: "Remove",
    tone: "warn",
  });
  if (!confirmed) return;

  try {
    const result = await apiPost<any>("/api/actions/kick-from-squad", {
      playerID: player.playerID,
      targetName: player.name,
      targetSteam64: player.steamID,
    });
    ui.pushToast({
      title: "Squad removal requested",
      message: result.message || `Requested removal of ${player.name} from the squad.`,
      tone: "ok",
    });
  } catch (error) {
    ui.pushToast({
      title: "Squad removal failed",
      message: renderApiError(error, "Failed to remove the player from the squad."),
      tone: "error",
    });
  }
}

async function requestRefresh() {
  refreshing.value = true;
  try {
    await apiPost("/api/jobs/rcon-refresh", { type: "all" });
    ui.pushToast({
      title: "Refresh queued",
      message: "runtimeSync will pick up the refreshed player and squad snapshots shortly.",
      tone: "ok",
    });
  } catch (error) {
    ui.pushToast({
      title: "Refresh failed",
      message: renderApiError(error, "Failed to queue an RCON refresh job."),
      tone: "error",
    });
  } finally {
    refreshing.value = false;
  }
}
</script>

<style scoped>
.team-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.squad-list {
  display: grid;
  gap: 12px;
}

.squad-row {
  border: 1px solid #26303a;
  border-radius: 8px;
  background: #11171d;
  padding: 12px;
  display: grid;
  gap: 12px;
}

.squad-row-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.squad-row-head strong {
  display: block;
}

.squad-row-head p,
.member-copy span,
.empty-squad {
  margin: 4px 0 0;
  color: #9aa7b2;
  font-size: 12px;
}

.member-list {
  display: grid;
  gap: 8px;
}

.member-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border-top: 1px solid #26303a;
  padding-top: 8px;
}

.member-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

@media (max-width: 1100px) {
  .team-grid {
    grid-template-columns: 1fr;
  }

  .member-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
