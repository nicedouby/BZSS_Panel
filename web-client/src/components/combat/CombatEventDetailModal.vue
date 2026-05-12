<template>
  <div v-if="event" class="dialog-root" @click.self="$emit('close')">
    <section class="dialog-panel">
      <header class="dialog-head">
        <div>
          <h3>{{ event.type || event.eventName || t("combat.eventType") }}</h3>
          <p>{{ formatTime(event.time) }}</p>
        </div>
        <button type="button" @click="$emit('close')">{{ t("common.close") }}</button>
      </header>

      <div class="detail-grid">
        <div class="identity-card">
          <span>{{ t("combat.attacker") }}</span>
          <strong>{{ attackerName }}</strong>
          <small v-if="attackerIp">IP {{ attackerIp }}</small>
          <small v-if="attackerSteamID">SteamID {{ attackerSteamID }}</small>
          <small v-if="attackerEOSID">EOSID {{ attackerEOSID }}</small>
          <div class="action-row">
            <button v-if="attackerSearchKey" type="button" class="mini-action" @click="searchPlayer(attackerSearchKey)">{{ t("common.search") }}</button>
            <button v-if="attackerSteamID" type="button" class="mini-action" @click="copyValue(attackerSteamID, 'SteamID')">{{ t("common.copy") }} SteamID</button>
            <button v-if="attackerEOSID" type="button" class="mini-action" @click="copyValue(attackerEOSID, 'EOSID')">{{ t("common.copy") }} EOSID</button>
            <button v-if="attackerIp" type="button" class="mini-action" @click="copyValue(attackerIp, 'IP')">{{ t("common.copy") }} IP</button>
          </div>
        </div>
        <div class="identity-card">
          <span>{{ t("combat.victim") }}</span>
          <strong>{{ victimName }}</strong>
          <small v-if="victimIp">IP {{ victimIp }}</small>
          <small v-if="victimSteamID">SteamID {{ victimSteamID }}</small>
          <small v-if="victimEOSID">EOSID {{ victimEOSID }}</small>
          <div class="action-row">
            <button v-if="victimSearchKey" type="button" class="mini-action" @click="searchPlayer(victimSearchKey)">{{ t("common.search") }}</button>
            <button v-if="victimSteamID" type="button" class="mini-action" @click="copyValue(victimSteamID, 'SteamID')">{{ t("common.copy") }} SteamID</button>
            <button v-if="victimEOSID" type="button" class="mini-action" @click="copyValue(victimEOSID, 'EOSID')">{{ t("common.copy") }} EOSID</button>
            <button v-if="victimIp" type="button" class="mini-action" @click="copyValue(victimIp, 'IP')">{{ t("common.copy") }} IP</button>
          </div>
        </div>
        <div><span>{{ t("combat.damage") }}</span><strong>{{ event.damage ?? "-" }}</strong></div>
        <div><span>{{ t("common.source") }}</span><strong>{{ event.weapon?.displayName || event.weapon || event.causedBy || "-" }}</strong></div>
        <div><span>{{ t("combat.friendly") }}</span><strong>{{ event.relation?.isFriendlyFire || event.isFriendlyFire ? t("common.yes") : t("common.no") }}</strong></div>
        <div><span>{{ t("common.status") }}</span><strong>{{ event.parse?.status || event.parseStatus || "-" }}</strong></div>
      </div>

      <pre class="raw-block">{{ prettyEvent }}</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useUiStore } from "../../stores/ui.store";
import { copyTextWithToast } from "../../utils/clipboard";
import { goToPlayerDatabaseSearch } from "../../utils/player-database";
import { t } from "../../i18n";

const props = defineProps<{
  event: any | null;
}>();

defineEmits<{
  (event: "close"): void;
}>();

const router = useRouter();
const ui = useUiStore();

const prettyEvent = computed(() => JSON.stringify(props.event, null, 2));
const attackerName = computed(() => String(props.event?.attacker?.name ?? props.event?.attackerName ?? "-") );
const victimName = computed(() => String(props.event?.victim?.name ?? props.event?.victimName ?? "-") );
const attackerSteamID = computed(() => String(props.event?.attacker?.steamID ?? props.event?.attackerSteamID ?? props.event?.attacker?.steamId ?? "").trim());
const attackerEOSID = computed(() => String(props.event?.attacker?.eosID ?? props.event?.attackerEOSID ?? "").trim());
const attackerIp = computed(() => String(props.event?.attacker?.current_ip ?? props.event?.attacker?.ip ?? props.event?.attackerIp ?? "").trim());
const attackerSearchKey = computed(() => attackerName.value !== "-" ? attackerName.value : (attackerSteamID.value || attackerEOSID.value || attackerIp.value));
const victimSteamID = computed(() => String(props.event?.victim?.steamID ?? props.event?.victimSteamID ?? props.event?.victim?.steamId ?? "").trim());
const victimEOSID = computed(() => String(props.event?.victim?.eosID ?? props.event?.victimEOSID ?? "").trim());
const victimIp = computed(() => String(props.event?.victim?.current_ip ?? props.event?.victim?.ip ?? props.event?.victimIp ?? "").trim());
const victimSearchKey = computed(() => victimName.value !== "-" ? victimName.value : (victimSteamID.value || victimEOSID.value || victimIp.value));

function formatTime(value: unknown) {
  const text = String(value ?? "");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}

async function copyValue(value: string, label: string) {
  if (!value) return;
  await copyTextWithToast(value, ui, {
    label: `${label} ${t("common.copied")}`,
    successMessage: value,
  });
}

function searchPlayer(value: string) {
  goToPlayerDatabaseSearch(router, value);
}
</script>

<style scoped>
.dialog-root {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(8, 12, 16, 0.72);
}

.dialog-panel {
  width: min(900px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
  display: grid;
  gap: 16px;
  border: 1px solid #2b3540;
  border-radius: 8px;
  background: #171d23;
  padding: 18px;
}

.dialog-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.dialog-head h3 {
  margin: 0;
}

.dialog-head p {
  margin: 6px 0 0;
  color: #9aa7b2;
  font-size: 12px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.detail-grid > div {
  border: 1px solid #2b3540;
  background: #11171d;
  border-radius: 8px;
  padding: 10px 12px;
}

.identity-card {
  display: grid;
  gap: 6px;
}

.identity-card small {
  color: #98a5af;
  font-size: 12px;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mini-action {
  border: 0;
  padding: 0;
  background: transparent;
  color: #8bb6ff;
  font-size: 12px;
}

.mini-action:hover {
  text-decoration: underline;
}

.detail-grid span,
.detail-grid strong {
  display: block;
}

.detail-grid span {
  color: #98a5af;
  font-size: 12px;
}

.detail-grid strong {
  margin-top: 4px;
}

.raw-block {
  margin: 0;
  overflow: auto;
  border: 1px solid #2b3540;
  border-radius: 8px;
  background: #11171d;
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 720px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
