export interface BridgeSampling {
  intervalSeconds?: number;
  sequence?: number;
}

export function bridgePollMs(sampling?: BridgeSampling): number {
  const interval = sampling?.intervalSeconds;
  return typeof interval === "number" && Number.isFinite(interval) && interval > 0
    ? Math.min(1000, Math.max(50, Math.round(interval * 1000)))
    : 100;
}
