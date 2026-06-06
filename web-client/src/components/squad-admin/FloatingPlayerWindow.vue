<template>
  <PlayerDetailDrawer
    :open="open"
    :player="player"
    :server-id="serverId"
    mode="floating"
    :anchor-x="anchorX"
    :anchor-y="anchorY"
    :notice="notice"
    @close="$emit('close')"
    @playtime-updated="$emit('playtime-updated')"
  />
</template>

<script setup lang="ts">
import PlayerDetailDrawer from "./PlayerDetailDrawer.vue";
import type { PlayerDetailViewModel } from "../../types/squad-admin.types";

defineProps<{
  open: boolean;
  player: PlayerDetailViewModel | null;
  serverId?: string | null;
  anchorX?: number | null;
  anchorY?: number | null;
  notice?: string | null;
}>();

defineEmits<{
  (event: "close"): void;
  (event: "playtime-updated"): void;
}>();
</script>
