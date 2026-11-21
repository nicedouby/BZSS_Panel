export const scenePriority = { buildings: 0, soldier: 1, equipped: 2, equipment: 3, vehicle: 4 };

export function createFrameBudget(invalidate) {
  const target = 1000 / 60;
  const queue = [];
  let previousFrame = 0;
  let cpuMs = 0;
  let interval = target;
  let lastBackground = -Infinity;
  let pressure = 0;
  let overload = 0, recovery = 0;
  let buildingsPending = false;
  let disposed = false;

  function enqueue(priority, run, signal) {
    return new Promise((resolve, reject) => {
      if (disposed || signal?.aborted) {
        reject(new DOMException("Scene closed", "AbortError"));
        return;
      }
      queue.push({ priority, run, signal, resolve, reject });
      invalidate();
    });
  }

  function finish(now, workMs) {
    const gap = now - previousFrame;
    if (gap > 0 && gap < 40) interval = interval * .88 + gap * .12;
    else if (gap >= 40 && gap < 120 && cpuMs > 10) interval = interval * .9 + gap * .1;
    else if (!previousFrame || gap >= 120) interval = target;
    previousFrame = now;
    cpuMs = cpuMs * .85 + workMs * .15;
    if (cpuMs > 13 || interval > 19.5) {
      recovery = 0;
      if (++overload >= 12) { pressure = Math.min(3, pressure + 1); overload = 0; }
    } else if (cpuMs < 9 && interval <= 17.6) {
      overload = 0;
      if (++recovery >= 100) { pressure = Math.max(0, pressure - 1); recovery = 0; }
    } else {
      recovery = overload = 0;
    }
    if (!queue.length) return;
    queue.sort((a, b) => a.priority - b.priority);
    while (queue[0]?.signal?.aborted) queue.shift().reject(new DOMException("Scene closed", "AbortError"));
    const next = queue[0];
    if (!next) return;
    if (buildingsPending && next.priority >= scenePriority.equipment) return;
    const delay = next.priority < scenePriority.equipment ? 0 : [16, 45, 95, 160][pressure];
    const currentBudget = workMs < 11 || next.priority === scenePriority.buildings;
    if ((currentBudget && now - lastBackground >= delay) || now - lastBackground > 275) {
      queue.shift();
      lastBackground = now;
      // Let the just-submitted frame reach the compositor before GLB parsing begins.
      window.setTimeout(() => {
        if (disposed || next.signal?.aborted) next.reject(new DOMException("Scene closed", "AbortError"));
        else Promise.resolve().then(next.run).then(next.resolve, next.reject);
      }, 0);
    }
    if (queue.length) invalidate();
  }

  return { enqueue, finish,
    get pressure() { return pressure; },
    setBuildingsPending(pending) { buildingsPending = pending; invalidate(); },
    dispose() {
      disposed = true;
      for (const task of queue.splice(0)) task.reject(new DOMException("Scene closed", "AbortError"));
    },
  };
}
