import { defineStore } from "pinia";

const MAX_EVENTS = 500;

export const useEventStore = defineStore("events", {
  state: () => ({
    console: [] as any[],
    raw: [] as any[],
    rcon: [] as any[],
    combat: [] as any[],
    updatedAt: 0,
  }),
  actions: {
    applySnapshot(snapshot: any) {
      this.console = limit(snapshot?.console ?? []);
      this.raw = limit(snapshot?.raw ?? []);
      this.rcon = limit(snapshot?.rcon ?? []);
      this.combat = limit(snapshot?.combat ?? []);
      this.updatedAt = Number(snapshot?.updatedAt ?? Date.now());
    },
  },
});

function limit<T>(items: T[]) {
  return Array.isArray(items) ? items.slice(-MAX_EVENTS) : [];
}
