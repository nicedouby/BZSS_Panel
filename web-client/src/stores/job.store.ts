import { defineStore } from "pinia";

export const useJobStore = defineStore("jobs", {
  state: () => ({
    jobsById: {} as Record<string, any>,
    activeJobs: [] as string[],
    updatedAt: 0,
  }),
  actions: {
    applySnapshot(snapshot: any) {
      this.jobsById = snapshot?.byId ?? {};
      this.activeJobs = snapshot?.activeJobs ?? [];
      this.updatedAt = Number(snapshot?.updatedAt ?? Date.now());
    },
    upsert(job: any) {
      if (!job?.id) return;
      this.jobsById[job.id] = job;
      this.activeJobs = Object.values(this.jobsById)
        .filter((item: any) => item.status === "queued" || item.status === "running")
        .map((item: any) => item.id);
    },
  },
});
