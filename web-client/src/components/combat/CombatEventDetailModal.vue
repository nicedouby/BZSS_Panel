<template>
  <div v-if="event" class="dialog-root" @click.self="$emit('close')">
    <section class="dialog-panel">
      <header class="dialog-head">
        <div>
          <h3>{{ displayType }}</h3>
          <p>{{ formatTime(event.time) }}</p>
        </div>
        <button type="button" @click="$emit('close')">{{ t("common.close") }}</button>
      </header>

      <div class="detail-grid">
        <div class="identity-card" :class="{ 'is-highlighted': isHighlighted(attackerHighlightKey) }">
          <span>{{ t("combat.attacker") }}</span>
          <strong>{{ attackerDisplayName }}</strong>
          <div v-if="attackerMetaTexts.length" class="identity-meta">
            <span v-for="item in attackerMetaTexts" :key="item">{{ item }}</span>
          </div>
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
        <div class="identity-card" :class="{ 'is-highlighted': isHighlighted(victimHighlightKey) }">
          <span>{{ t("combat.victim") }}</span>
          <strong>{{ victimDisplayName }}</strong>
          <div v-if="victimMetaTexts.length" class="identity-meta">
            <span v-for="item in victimMetaTexts" :key="item">{{ item }}</span>
          </div>
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
        <div class="weapon-source-row">
          <span>{{ t("common.source") }}</span>
          <strong>
            <span>{{ weaponName }}</span>
            <span v-if="weaponTypeLabel" class="weapon-type-badge" :class="weaponTypeClass">{{ weaponTypeLabel }}</span>
          </strong>
        </div>
        <div><span>{{ t("combat.friendly") }}</span><strong>{{ event.relation?.isFriendlyFire || event.isFriendlyFire ? t("common.yes") : t("common.no") }}</strong></div>
        <div><span>{{ t("common.status") }}</span><strong>{{ event.parse?.status || event.parseStatus || "-" }}</strong></div>
        <div class="flag-card">
          <span>事件标记</span>
          <div class="flag-row">
            <span v-for="label in eventFlagLabels" :key="label" class="flag-chip">
              {{ label }}
            </span>
            <span v-if="!eventFlagLabels.length" class="flag-empty">-</span>
          </div>
        </div>
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
  highlightKey?: string;
}>();

defineEmits<{
  (event: "close"): void;
}>();

const router = useRouter();
const ui = useUiStore();

const prettyEvent = computed(() => JSON.stringify(props.event, null, 2));
const attackerDisplayName = computed(() => String(props.event?.attacker?.displayName ?? props.event?.attacker?.name ?? props.event?.attackerName ?? "-"));
const victimDisplayName = computed(() => String(props.event?.victim?.displayName ?? props.event?.victim?.name ?? props.event?.victimName ?? "-"));
const attackerSteamID = computed(() => props.event?.attacker?.isBot ? "" : String(props.event?.attacker?.steamID ?? props.event?.attackerSteamID ?? props.event?.attacker?.steamId ?? "").trim());
const attackerEOSID = computed(() => props.event?.attacker?.isBot ? "" : String(props.event?.attacker?.eosID ?? props.event?.attackerEOSID ?? "").trim());
const attackerIp = computed(() => props.event?.attacker?.isBot ? "" : String(props.event?.attacker?.current_ip ?? props.event?.attacker?.ip ?? props.event?.attackerIp ?? "").trim());
const attackerHighlightKey = computed(() => props.event?.attacker?.isBot ? "" : playerHighlightKey(props.event?.attacker, props.event?.attackerName, props.event?.attackerSteamID, props.event?.attackerEOSID, props.event?.attackerControllerID));
const attackerMetaTexts = computed(() => [
  formatTeamText(props.event?.attacker?.teamID ?? props.event?.attacker?.teamId ?? props.event?.attackerTeamID),
  formatSquadText(props.event?.attacker?.squadID ?? props.event?.attacker?.squadId ?? props.event?.attackerSquadID),
].filter(Boolean));
const attackerSearchKey = computed(() => {
  if (props.event?.attacker?.isBot) return "";
  const identity = String(props.event?.attacker?.name ?? props.event?.attackerName ?? "").trim();
  return identity || attackerSteamID.value || attackerEOSID.value || attackerIp.value;
});
const victimSteamID = computed(() => String(props.event?.victim?.steamID ?? props.event?.victimSteamID ?? props.event?.victim?.steamId ?? "").trim());
const victimEOSID = computed(() => String(props.event?.victim?.eosID ?? props.event?.victimEOSID ?? "").trim());
const victimIp = computed(() => String(props.event?.victim?.current_ip ?? props.event?.victim?.ip ?? props.event?.victimIp ?? "").trim());
const victimHighlightKey = computed(() => playerHighlightKey(props.event?.victim, props.event?.victimName, props.event?.victimSteamID, props.event?.victimEOSID, props.event?.victimControllerID));
const victimMetaTexts = computed(() => [
  formatTeamText(props.event?.victim?.teamID ?? props.event?.victim?.teamId ?? props.event?.victimTeamID),
  formatSquadText(props.event?.victim?.squadID ?? props.event?.victim?.squadId ?? props.event?.victimSquadID),
].filter(Boolean));
const victimSearchKey = computed(() => {
  const identity = String(props.event?.victim?.name ?? props.event?.victimName ?? "").trim();
  return identity || victimSteamID.value || victimEOSID.value || victimIp.value;
});
const weaponName = computed(() => String(props.event?.weapon?.displayName ?? props.event?.weapon?.cleaned ?? props.event?.weapon ?? props.event?.causedBy ?? "-"));
const weaponTypeLabel = computed(() => String(props.event?.weapon?.typeLabel ?? "").trim());
const weaponTypeClass = computed(() => {
  const key = String(props.event?.weapon?.typeKey ?? "").trim().toLowerCase();
  return key ? key.replace(/[^a-z0-9]+/g, "-") : "other";
});
const eventFlagLabels = computed(() => {
  const direct = Array.isArray(props.event?.eventFlagLabels) ? props.event.eventFlagLabels : [];
  if (direct.length) return direct.map((label: unknown) => String(label)).filter(Boolean);
  const structured = Array.isArray(props.event?.eventFlags) ? props.event.eventFlags : [];
  return structured.map((flag: any) => String(flag?.label ?? "")).filter(Boolean);
});
const displayType = computed(() => {
  const type = String(props.event?.type ?? props.event?.eventName ?? "").trim();
  if (type === "revive") return t("combat.revive", "revive");
  if (type === "tk") return t("combat.teamKill");
  if (type === "friendly") return t("combat.friendly");
  if (type === "teamdamage") return t("combat.teamDamage");
  if (type === "teamwound") return t("combat.teamWound");
  if (type === "teamkill") return t("combat.teamKill");
  return type || t("combat.eventType");
});

function formatTime(value: unknown) {
  const text = String(value ?? "");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}

function formatTeamText(teamId: unknown) {
  const normalized = teamId == null || teamId === "" ? "" : String(teamId);
  return normalized ? `Team ID ${normalized}` : "";
}

function formatSquadText(squadId: unknown) {
  const normalized = squadId == null || squadId === "" ? "" : String(squadId);
  return normalized ? `Squad ID ${normalized}` : "";
}

function playerHighlightKey(entity: any, fallbackName = "", fallbackSteam = "", fallbackEos = "", fallbackController = "") {
  const identity = entity?.steamID
    ?? entity?.steamId
    ?? fallbackSteam
    ?? entity?.eosID
    ?? entity?.eosId
    ?? fallbackEos
    ?? entity?.controllerID
    ?? entity?.controllerId
    ?? fallbackController
    ?? entity?.name
    ?? fallbackName;
  return String(identity ?? "").trim().toLowerCase();
}

function isHighlighted(key: string) {
  return Boolean(key && String(props.highlightKey ?? "").trim().toLowerCase() === key);
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

.identity-card.is-highlighted {
  outline: 2px solid rgba(139, 182, 255, 0.58);
  box-shadow: 0 0 0 1px rgba(139, 182, 255, 0.2), 0 0 18px rgba(139, 182, 255, 0.12);
}

.identity-card small {
  color: #98a5af;
  font-size: 12px;
}

.identity-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.identity-meta span {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid #3c4a57;
  background: rgba(10, 14, 18, 0.36);
  color: #b8c3cb;
  font-size: 11px;
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

.weapon-source-row strong {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.flag-card {
  grid-column: 1 / -1;
}

.flag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.flag-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid #3a4651;
  background: rgba(255, 255, 255, 0.03);
  color: #d7e0e5;
  font-size: 12px;
  white-space: nowrap;
}

.flag-empty {
  color: #7f8c96;
  font-size: 12px;
}

.weapon-type-badge {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  background: rgba(148, 163, 184, 0.12);
  color: #dbe4ea;
  font-size: 11px;
  white-space: nowrap;
}

.weapon-type-badge.light {
  border-color: rgba(96, 165, 250, 0.42);
  background: rgba(96, 165, 250, 0.16);
  color: #dbeafe;
}

.weapon-type-badge.anti-tank {
  border-color: rgba(244, 114, 182, 0.38);
  background: rgba(244, 114, 182, 0.14);
  color: #fbcfe8;
}

.weapon-type-badge.explosive {
  border-color: rgba(245, 158, 11, 0.42);
  background: rgba(245, 158, 11, 0.16);
  color: #fde68a;
}

.weapon-type-badge.melee {
  border-color: rgba(52, 211, 153, 0.4);
  background: rgba(52, 211, 153, 0.14);
  color: #bbf7d0;
}

.weapon-type-badge.other {
  border-color: rgba(148, 163, 184, 0.24);
  background: rgba(148, 163, 184, 0.1);
  color: #cbd5e1;
}

.weapon-type-badge.bot-weapon {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.14);
  color: #fecaca;
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
