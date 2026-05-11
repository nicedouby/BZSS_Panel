import { defineStore } from "pinia";

export const useServerStore = defineStore("server", {
  state: () => ({
    snapshot: {} as Record<string, any>,
    stale: false,
    updatedAt: 0,
  }),
  actions: {
    applySnapshot(snapshot: any) {
      this.snapshot = snapshot ?? {};
      this.stale = Boolean(snapshot?.stale);
      this.updatedAt = Number(snapshot?.updatedAt ?? Date.now());
    },
    markStale() {
      this.stale = true;
    },
  },
});
