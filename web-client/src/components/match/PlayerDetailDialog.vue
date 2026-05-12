<template>
  <div class="dialog-root" @click.self="$emit('close')">
    <section class="dialog-panel">
      <header class="dialog-head">
        <div>
          <h3>{{ player.name || "Unknown" }}</h3>
          <p>
            {{ player.online ? "Online" : "Offline" }} / {{ player.role || "Unknown role" }}
            <span class="header-meta">Steam {{ player.steamID || "--" }}</span>
            <span class="header-meta">EOS {{ player.eosID || "--" }}</span>
            <span class="header-meta">Team {{ player.teamID ?? "--" }}</span>
            <span class="header-meta">Squad {{ player.squadID ?? "--" }}</span>
          </p>
        </div>
        <div class="head-actions">
          <button type="button" class="search-button" @click="searchPlayerDatabase">Player Database</button>
          <button type="button" class="close-button" @click="$emit('close')">Close</button>
        </div>
      </header>

      <div class="detail-grid">
        <div>
          <span>Steam ID</span>
          <strong>{{ player.steamID || "-" }}</strong>
          <button v-if="player.steamID" type="button" class="copy-link" @click="copyValue(player.steamID, 'Steam ID')">Copy</button>
        </div>
        <div>
          <span>EOS ID</span>
          <strong>{{ player.eosID || "-" }}</strong>
          <button v-if="player.eosID" type="button" class="copy-link" @click="copyValue(player.eosID, 'EOS ID')">Copy</button>
        </div>
        <div class="detail-card detail-card-ip detail-span-2">
          <span>Current IP</span>
          <template v-if="currentIp">
            <div class="detail-row">
              <button
                type="button"
                class="detail-ip-link"
                @click="openIpSearch(currentIp)"
              >
                <strong>{{ currentIp }}</strong>
              </button>
              <button type="button" class="copy-link" @click="copyValue(currentIp, 'IP')">Copy</button>
            </div>
            <small>{{ currentIpSummary || "Unknown" }}</small>
            <small class="detail-meta">{{ currentIpSource }}</small>
          </template>
          <template v-else>
            <strong>{{ ipEmptyText }}</strong>
          </template>
        </div>
        <div><span>Steam Playtime</span><strong>{{ playtimeText }}</strong></div>
      </div>

      <div v-if="databaseLookupNotice" class="database-note">{{ databaseLookupNotice }}</div>

      <div class="ip-panels">
        <section class="ip-card">
          <h4>Recent Logins</h4>
          <ul v-if="recentLogins.length" class="ip-list">
            <li v-for="item in recentLogins" :key="`${item.ip}-${item.joined_at}`" class="ip-item">
              <div class="ip-item-head">
                <div>
                  <button
                    type="button"
                    v-if="item.ip"
                    class="detail-ip-link"
                    @click="openIpSearch(item.ip)"
                  >
                    <strong>{{ item.ip }}</strong>
                  </button>
                  <strong v-else>--</strong>
                  <small>{{ formatTime(item.joined_at) }}</small>
                </div>
                <button v-if="item.ip" type="button" class="copy-link" @click="copyValue(item.ip, 'IP')">Copy</button>
              </div>
              <small v-if="item.controller_path">Controller {{ item.controller_path }}</small>
              <small>{{ ipSummary(item.ip) }}</small>
              <small class="detail-meta">{{ ipSourceLabel(item.ip) }}</small>
            </li>
          </ul>
          <div v-else class="ip-empty">{{ ipLoginEmptyText }}</div>
        </section>
      </div>

      <pre v-if="player.raw" class="raw-block">{{ player.raw }}</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { RuntimePlayer } from "../../stores/player.store";
import { useUiStore } from "../../stores/ui.store";
import { apiGet } from "../../app/apiClient";
import { useIpLookup } from "../../composables/useIpLookup";
import { copyTextWithToast } from "../../utils/clipboard";
import { collectIps, formatIpSummary, isPrivateIp, isValidIp, normalizeIp } from "../../utils/ip";
import { goToPlayerDatabaseSearch } from "../../utils/player-database";

const props = defineProps<{
  player: RuntimePlayer;
  playtime?: any;
}>();

defineEmits<{
  (event: "close"): void;
}>();

const router = useRouter();
const ui = useUiStore();
const databaseDetail = ref<any | null>(null);
const databaseLookupNotice = ref("");
const loadToken = ref(0);

const playerDatabaseSearchKey = computed(() => {
  return String(props.player?.steamID ?? "").trim() || String(props.player?.eosID ?? "").trim() || String(props.player?.name ?? "").trim();
});

const detailPlayer = computed(() => databaseDetail.value?.player ?? null);
const detailIps = computed(() => Array.isArray(databaseDetail.value?.ips) ? databaseDetail.value.ips : []);
const detailLogins = computed(() => Array.isArray(databaseDetail.value?.logins) ? databaseDetail.value.logins : []);

const currentIp = computed(() => {
  return String(
    props.player?.current_ip
      ?? props.player?.ip
      ?? detailPlayer.value?.current_ip
      ?? detailIps.value?.[0]?.ip
      ?? detailLogins.value?.[0]?.ip
      ?? "",
  ).trim();
});

const lookupIps = computed(() => collectIps([
  props.player?.current_ip,
  props.player?.ip,
  detailPlayer.value?.current_ip,
  ...detailIps.value.map((item: any) => item?.ip),
  ...detailLogins.value.map((item: any) => item?.ip),
]));

const ipLookup = useIpLookup(lookupIps);
const recentLogins = computed(() => detailLogins.value.slice(0, 5));
const currentIpSummary = computed(() => ipSummary(currentIp.value));
const currentIpSource = computed(() => ipSourceLabel(currentIp.value));
const ipEmptyText = "No IP data found in player database.";
const ipLoginEmptyText = "No IP data found in player database.";

watch(
  () => playerDatabaseSearchKey.value,
  () => {
    void loadDatabaseDetail();
  },
  { immediate: true },
);

const playtimeText = computed(() => {
  const seconds = Number(props.playtime?.gameSeconds ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "Steam --";
  return `Steam ${(seconds / 3600).toFixed(1)}h`;
});

function resolveLookupItem(ip: unknown) {
  const key = normalizeIp(ip);
  if (!key) return null;
  return ipLookup.items.value?.[key] ?? null;
}

function ipSummary(ip: unknown) {
  const normalized = normalizeIp(ip);
  if (!normalized) return "Unknown";
  if (!isValidIp(normalized)) return "Invalid IP";
  if (isPrivateIp(normalized)) return "LAN / Private";

  const item = resolveLookupItem(normalized);
  if (!item) return "Lookup disabled";
  const provider = String((item as any).provider ?? "");
  if (item.source === "invalid") return "Invalid IP";
  if (item.isPrivate) return "LAN / Private";
  if (provider === "none") return "Lookup disabled";
  if (item.source === "unknown") return "Unknown";

  const summary = formatIpSummary(item, true);
  if (summary) return summary;
  return provider === "none" ? "Lookup disabled" : "Unknown";
}

function ipSourceLabel(ip: unknown) {
  const normalized = normalizeIp(ip);
  if (!normalized) return "Source unknown";
  if (!isValidIp(normalized)) return "Source invalid";
  if (isPrivateIp(normalized)) return "Source private / none";

  const item = resolveLookupItem(normalized);
  if (!item) return "Source unknown";
  return `Source ${item.source} / ${item.provider}`;
}

async function loadDatabaseDetail() {
  const token = ++loadToken.value;
  databaseDetail.value = null;
  databaseLookupNotice.value = "";

  const searchKey = playerDatabaseSearchKey.value;
  if (!searchKey) {
    databaseLookupNotice.value = "IP not found in database.";
    return;
  }

  try {
    const listResponse = await apiGet<any>(`/api/query/player-database?q=${encodeURIComponent(searchKey)}&limit=1`, {}, { timeoutMs: 5_000 });
    const match = firstDatabasePlayer(listResponse);
    if (!match?.id) {
      if (token === loadToken.value) databaseLookupNotice.value = "IP not found in database.";
      return;
    }

    const detail = await apiGet<any>(`/api/player-database/detail?id=${encodeURIComponent(String(match.id))}`, {}, { timeoutMs: 5_000 });
    if (token !== loadToken.value) return;

    databaseDetail.value = detail;
  } catch {
    if (token !== loadToken.value) return;
    databaseLookupNotice.value = "IP not found in database.";
  }
}

function firstDatabasePlayer(response: any) {
  return response?.items?.[0] ?? response?.players?.[0] ?? response?.rows?.[0] ?? null;
}

async function copyValue(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) return;
  await copyTextWithToast(text, ui, {
    label: `${label} copied`,
    successMessage: text,
  });
}

function searchPlayerDatabase() {
  goToPlayerDatabaseSearch(router, playerDatabaseSearchKey.value);
}

function formatTime(value: unknown) {
  const time = Number(value ?? 0);
  if (!time) return "--";
  return new Date(time).toLocaleString("en-US");
}

function buildIpSearchUrl(value: unknown) {
  const ip = normalizeIp(value);
  if (!ip || ip === "--") return "";

  return `https://www.baidu.com/s?wd=${encodeURIComponent(`IP查询 ${ip}`)}`;
}

function openIpSearch(value: unknown) {
  const ip = normalizeIp(value);
  if (!ip || ip === "--") return;

  const url = buildIpSearchUrl(ip);
  if (url && typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  void copyValue(ip, "IP");
}
</script>

<style scoped>
.dialog-root {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(8, 12, 16, 0.72);
}

.dialog-panel {
  width: min(760px, 100%);
  display: grid;
  gap: 16px;
  border: 1px solid #2b3540;
  border-radius: 8px;
  background: #171d23;
  padding: 18px;
}

.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dialog-head h3 {
  margin: 0;
  font-size: 22px;
}

.dialog-head p {
  margin: 6px 0 0;
  color: #9aa7b2;
  font-size: 13px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.header-meta {
  color: #cdd6dc;
  font-size: 12px;
}

.close-button {
  white-space: nowrap;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.detail-grid div {
  border: 1px solid #2b3540;
  border-radius: 8px;
  background: #11171d;
  padding: 10px 12px;
}

.detail-card-ip {
  grid-column: span 2;
}

.detail-grid span,
.detail-grid strong {
  display: block;
}

.detail-grid span {
  color: #9aa7b2;
  font-size: 12px;
}

.detail-grid strong {
  margin-top: 5px;
}

.detail-grid button {
  margin-top: 4px;
}

.detail-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.detail-ip-link {
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  text-decoration: none;
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.detail-ip-link:hover {
  text-decoration: underline;
}

.detail-meta,
.database-note,
.ip-item small,
.ip-empty {
  color: #9aa7b2;
  font-size: 12px;
}

.detail-card-ip small {
  margin-top: 4px;
}

.database-note {
  margin: -2px 0 0;
  padding-left: 2px;
}

.ip-panels {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}

.ip-card {
  border: 1px solid #2b3540;
  border-radius: 8px;
  background: #11171d;
  padding: 12px;
  display: grid;
  gap: 10px;
}

.ip-card h4 {
  margin: 0;
  font-size: 14px;
}

.ip-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.ip-item {
  border: 1px solid #2b3540;
  border-radius: 8px;
  padding: 10px 12px;
  display: grid;
  gap: 4px;
}

.ip-item-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.ip-item-head strong,
.ip-item-head small {
  display: block;
}

.ip-empty {
  padding: 2px 0;
}

.copy-link,
.search-button {
  border: 0;
  background: transparent;
  padding: 0;
  color: #8bb6ff;
  font-size: 12px;
}

.copy-link:hover,
.search-button:hover {
  text-decoration: underline;
}

.raw-block {
  margin: 0;
  overflow: auto;
  border: 1px solid #2b3540;
  border-radius: 8px;
  background: #11171d;
  padding: 12px;
  color: #cdd6dc;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
}

@media (max-width: 700px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }

  .detail-card-ip,
  .ip-panels {
    grid-column: auto;
    grid-template-columns: 1fr;
  }
}
</style>
