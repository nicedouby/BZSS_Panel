import { apiGet } from "./apiClient";
import { useServerStore } from "../stores/server.store";
import { usePlayerStore } from "../stores/player.store";
import { useSquadStore } from "../stores/squad.store";
import { useEventStore } from "../stores/event.store";
import { useJobStore } from "../stores/job.store";

let started = false;
let inFlight = false;
let timer: number | null = null;

export function startRuntimeSync() {
  if (started) return;
  started = true;
  void syncOnce();
  scheduleNext();
  document.addEventListener("visibilitychange", scheduleNext);
}

async function syncOnce() {
  if (inFlight) return;
  inFlight = true;
  try {
    const snapshot = await apiGet<any>("/api/snapshot/all");
    useServerStore().applySnapshot(snapshot.server);
    usePlayerStore().applySnapshot(snapshot.players);
    useSquadStore().applySnapshot(snapshot.squads);
    useEventStore().applySnapshot(snapshot.events);
    useJobStore().applySnapshot(snapshot.jobs);
  } catch {
    useServerStore().markStale();
    usePlayerStore().markStale();
    useSquadStore().markStale();
  } finally {
    inFlight = false;
  }
}

function scheduleNext() {
  if (timer != null) window.clearInterval(timer);
  timer = window.setInterval(() => {
    void syncOnce();
  }, document.hidden ? 7_000 : 2_000);
}
