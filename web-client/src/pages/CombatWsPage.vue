<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import AppStatusBadge from "../components/common/AppStatusBadge.vue";
import { fetchCombatWsState, type CombatWsState } from "../app/combatWsApi";

const state = ref<CombatWsState | null>(null);
const selectedWire = ref("");
const error = ref("");
let timer: ReturnType<typeof setInterval> | null = null;

const connected = computed(() => state.value?.clients.filter((item) => item.authenticated && item.connected).length ?? 0);
const events = computed(() => state.value?.events.items ?? []);
const totalBytes = computed(() => (state.value?.packets.items ?? []).reduce((sum, packet) => sum + packet.bytes, 0));

async function load() {
  try {
    state.value = await fetchCombatWsState();
    error.value = "";
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "状态读取失败";
  }
}

async function inspect(pid: string) {
  try {
    selectedWire.value = (await fetchCombatWsState(pid)).packetDetail?.wire ?? "";
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "数据包读取失败";
  }
}

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function formatTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(Number(value) || String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

onMounted(() => { void load(); timer = setInterval(load, 2000); });
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <AppPage>
    <AppPageHeader title="WS 战斗转发" subtitle="BZSS Combat WS Protocol v1 实时状态、客户端、ACK 与重试监控">
      <template #actions><button class="refresh" type="button" @click="load">立即刷新</button></template>
    </AppPageHeader>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="badges">
      <AppStatusBadge :tone="state?.enabled ? 'ok' : 'warn'">{{ state?.enabled ? "Bridge 已启用" : "Bridge 已停用" }}</AppStatusBadge>
      <AppStatusBadge :tone="state?.configured ? 'ok' : 'error'">{{ state?.configured ? "Token 已配置" : "Token 未配置" }}</AppStatusBadge>
      <AppStatusBadge :tone="connected ? 'ok' : 'idle'">已认证客户端 {{ connected }}</AppStatusBadge>
      <AppStatusBadge :tone="state?.pending.count ? 'warn' : 'ok'">Pending {{ state?.pending.count ?? 0 }}</AppStatusBadge>
    </div>

    <div class="metrics">
      <PageCard title="当前连接"><strong>{{ state?.path ?? "/ws/combat" }}</strong><span>{{ state?.serverId ?? "—" }}</span></PageCard>
      <PageCard title="当前对局"><strong class="mono">{{ state?.matchId ?? "等待分配" }}</strong><span>所有数据包使用此 Match ID</span></PageCard>
      <PageCard title="批处理缓冲"><strong>{{ state?.buffer.batchEvents ?? 0 }} / 64</strong><span>未分配事件 {{ state?.buffer.unassignedEvents ?? 0 }}</span></PageCard>
      <PageCard title="事件与数据"><strong>{{ state?.events.total ?? 0 }} / {{ totalBytes }} B</strong><span>数据包 {{ state?.packets.total ?? 0 }}</span></PageCard>
      <PageCard title="发送"><strong>{{ state?.stats.sent ?? 0 }}</strong><span>重试 {{ state?.stats.retried ?? 0 }} · 失败 {{ state?.stats.failed ?? 0 }}</span></PageCard>
      <PageCard title="ACK"><strong>{{ state?.stats.acked ?? 0 }}</strong><span>拒绝回放 {{ state?.stats.replayRejected ?? 0 }} · 溢出 {{ state?.stats.pendingOverflow ?? 0 }}</span></PageCard>
    </div>

    <PageCard title="客户端" description="仅已认证且连接中的客户端会接收实时战斗数据">
      <div class="table-wrap"><table><thead><tr><th>客户端 ID</th><th>认证</th><th>连接</th><th>最近 Pong</th></tr></thead><tbody>
        <tr v-for="client in state?.clients ?? []" :key="client.client ?? 'unknown'"><td class="mono">{{ client.client ?? "—" }}</td><td>{{ client.authenticated ? "是" : "否" }}</td><td>{{ client.connected ? "在线" : "已断开" }}</td><td>{{ formatTime(client.lastPongAt) }}</td></tr>
        <tr v-if="!state?.clients.length"><td colspan="4" class="empty">暂无客户端</td></tr>
      </tbody></table></div>
    </PageCard>

    <PageCard title="最近数据包" description="点击数据包查看原始 JSON wire 数据；单个 Batch 只对应一个 Match ID">
      <div class="table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th>PID</th><th>Match ID</th><th>事件</th><th>大小</th><th>状态</th></tr></thead><tbody>
        <tr v-for="packet in state?.packets.items ?? []" :key="packet.pid" @click="inspect(packet.pid)"><td>{{ formatTime(packet.time) }}</td><td>{{ packet.type }}</td><td class="mono">{{ packet.pid }}</td><td class="mono">{{ packet.mid }}</td><td>{{ packet.events }}</td><td>{{ packet.bytes }} B</td><td>{{ packet.deliveryState }}<template v-if="packet.retryCount"> ×{{ packet.retryCount }}</template></td></tr>
        <tr v-if="!state?.packets.items.length"><td colspan="7" class="empty">暂无数据包</td></tr>
      </tbody></table></div>
      <pre v-if="selectedWire" class="wire">{{ selectedWire }}</pre>
    </PageCard>

    <PageCard title="最近战斗事件" description="包含 damage、knockdown、kill、revive、TK 等实时事件">
      <div class="table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th>攻击者</th><th>受害者</th><th>伤害</th><th>武器</th><th>Match ID</th><th>PID</th></tr></thead><tbody>
        <tr v-for="event in events" :key="String(event.i)"><td>{{ formatTime(event.t ?? event.ts ?? event.time) }}</td><td>{{ event.k }}</td><td>{{ display(event.a) }}</td><td>{{ display(event.v) }}</td><td>{{ display(event.d) }}</td><td>{{ display(event.w) }}</td><td class="mono">{{ display(event.mid) }}</td><td class="mono">{{ event.pid }}</td></tr>
        <tr v-if="!events.length"><td colspan="8" class="empty">暂无事件</td></tr>
      </tbody></table></div>
    </PageCard>
  </AppPage>
</template>

<style scoped>
.badges{display:flex;flex-wrap:wrap;gap:8px}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.metrics :deep(.card-body){display:flex;flex-direction:column;gap:6px}.metrics strong{font-size:1.2rem}.metrics span{color:var(--color-text-muted)}.refresh{border:1px solid var(--color-border-default);border-radius:9px;padding:8px 13px;background:var(--color-bg-card);color:inherit;cursor:pointer}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{padding:10px;border-bottom:1px solid var(--color-border-default);text-align:left;white-space:nowrap}tbody tr{cursor:pointer}.mono,.wire{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.wire{margin-top:14px;padding:12px;border-radius:10px;background:rgba(0,0,0,.25);white-space:pre-wrap;word-break:break-all}.empty{text-align:center;color:var(--color-text-muted)}.error{color:var(--color-status-error)}@media(max-width:900px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.metrics{grid-template-columns:1fr}}
</style>
