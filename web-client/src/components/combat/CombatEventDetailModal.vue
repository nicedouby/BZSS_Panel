<template>
  <div v-if="event" class="dialog-root" @click.self="$emit('close')">
    <section class="dialog-panel">
      <header class="dialog-head">
        <div>
          <h3>{{ event.type || event.eventName || "Combat Event" }}</h3>
          <p>{{ formatTime(event.time) }}</p>
        </div>
        <button type="button" @click="$emit('close')">Close</button>
      </header>

      <div class="detail-grid">
        <div><span>Attacker</span><strong>{{ event.attacker?.name || event.attackerName || "-" }}</strong></div>
        <div><span>Victim</span><strong>{{ event.victim?.name || event.victimName || "-" }}</strong></div>
        <div><span>Damage</span><strong>{{ event.damage ?? "-" }}</strong></div>
        <div><span>Source</span><strong>{{ event.weapon?.displayName || event.weapon || event.causedBy || "-" }}</strong></div>
        <div><span>Friendly Fire</span><strong>{{ event.relation?.isFriendlyFire || event.isFriendlyFire ? "Yes" : "No" }}</strong></div>
        <div><span>Parse Status</span><strong>{{ event.parse?.status || event.parseStatus || "-" }}</strong></div>
      </div>

      <pre class="raw-block">{{ prettyEvent }}</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  event: any | null;
}>();

defineEmits<{
  (event: "close"): void;
}>();

const prettyEvent = computed(() => JSON.stringify(props.event, null, 2));

function formatTime(value: unknown) {
  const text = String(value ?? "");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
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
