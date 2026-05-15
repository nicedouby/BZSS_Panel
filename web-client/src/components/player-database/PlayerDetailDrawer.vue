<template>
  <div v-if="open" class="drawer-root" @click.self="$emit('close')">
    <aside class="drawer-panel">
      <header class="drawer-head">
        <div>
          <h2>{{ detail?.player?.current_name || detail?.player?.name || "Player" }}</h2>
          <p>{{ detail?.player?.steam_id || detail?.player?.eos_id || "-" }}</p>
        </div>
        <button type="button" @click="$emit('close')">Close</button>
      </header>

      <DataState
        :loading="loading"
        :error="error"
        :empty="!loading && !error && !detail"
        empty-title="No player detail"
        empty-text="Select a player to inspect the profile."
      >
        <div class="detail-grid">
          <div><span>Permission</span><strong>{{ detail?.player?.permission_group || "default" }}</strong></div>
          <div>
            <span>Current IP</span>
            <strong v-if="currentIp">
              <button
                type="button"
                class="detail-ip-link"
                @click="openIpSearch(currentIp)"
              >
                {{ currentIp }}
              </button>
            </strong>
            <strong v-else>-</strong>
          </div>
          <div><span>Game Seconds</span><strong>{{ detail?.player?.game_seconds ?? 0 }}</strong></div>
          <div><span>Squad Created</span><strong>{{ detail?.player?.total_squad_created ?? 0 }}</strong></div>
          <div><span>Total Deaths</span><strong>{{ detail?.killStats?.deaths ?? detail?.combatStats?.deaths ?? detail?.summary?.totalDeaths ?? 0 }}</strong></div>
          <div><span>Total Team Kills</span><strong>{{ totalTeamKills }}</strong></div>
        </div>

        <PageCard compact title="Permission Group">
          <div class="permission-row">
            <input v-model="permissionGroup" placeholder="Permission group">
            <button type="button" :disabled="saving || !permissionGroup.trim()" @click="save">
              {{ saving ? "Saving..." : "Save" }}
            </button>
          </div>
        </PageCard>

        <PageCard compact title="Recent Aliases">
          <ul class="plain-list">
            <li v-for="alias in detail?.aliases?.slice(0, 12) ?? []" :key="`${alias.alias_name}-${alias.seen_at}`">
              {{ alias.alias_name }} · {{ formatTime(alias.seen_at) }}
            </li>
          </ul>
        </PageCard>
      </DataState>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import DataState from "../common/DataState.vue";
import PageCard from "../common/PageCard.vue";
import { copyTextWithToast } from "../../utils/clipboard";
import { normalizeIp } from "../../utils/ip";
import { useUiStore } from "../../stores/ui.store";

const props = defineProps<{
  open: boolean;
  detail: any;
  loading: boolean;
  error: string;
  saving: boolean;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "save-permission", value: string): void;
}>();

const ui = useUiStore();
const permissionGroup = ref("");
const currentIp = computed(() => String(props.detail?.player?.current_ip ?? props.detail?.player?.ip ?? "").trim());

watch(
  () => props.detail?.player?.permission_group,
  (value) => {
    permissionGroup.value = String(value ?? "default");
  },
  { immediate: true },
);

const totalTeamKills = computed(() => {
  const player = props.detail?.player;
  return Number(player?.tk_downs ?? player?.total_tk_down ?? 0) + Number(player?.tk_kills ?? player?.total_tk_kill ?? 0);
});

function formatTime(value: unknown) {
  const time = Number(value ?? 0);
  if (!time) return "-";
  return new Date(time).toLocaleString();
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

  void copyTextWithToast(ip, ui, {
    label: "IP",
    successMessage: `已复制 IP：${ip}`,
    errorMessage: "无法复制 IP。",
  });
}

function save() {
  emit("save-permission", permissionGroup.value.trim());
}
</script>

<style scoped>
.drawer-root {
  position: fixed;
  inset: 0;
  z-index: 75;
  background: rgba(8, 12, 16, 0.62);
}

.drawer-panel {
  margin-left: auto;
  width: min(560px, 100vw);
  height: 100vh;
  overflow: auto;
  background: #10161c;
  border-left: 1px solid #26303a;
  padding: 18px;
  display: grid;
  gap: 14px;
}

.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.drawer-head h2 {
  margin: 0;
  font-size: 18px;
}

.drawer-head p {
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
  background: #171d23;
  border-radius: 8px;
  padding: 10px 12px;
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

.permission-row {
  display: flex;
  gap: 10px;
}

.permission-row input {
  flex: 1 1 auto;
  border: 1px solid #38414c;
  background: #11171d;
  color: #edf2f4;
  border-radius: 6px;
  padding: 8px 10px;
}

.plain-list {
  margin: 0;
  padding-left: 18px;
  color: #d8e1e7;
}

@media (max-width: 700px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>

