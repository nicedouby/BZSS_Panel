export type RefreshPolicy = "realtime" | "polling" | "manual";

export type RefreshSurface = "primary" | "auxiliary" | "page" | "pageSlow";

const POLICY_BASE_INTERVALS: Record<RefreshPolicy, Record<RefreshSurface, number>> = {
  realtime: {
    primary: 2_000,
    auxiliary: 12_000,
    page: 4_000,
    pageSlow: 8_000,
  },
  polling: {
    primary: 5_000,
    auxiliary: 20_000,
    page: 8_000,
    pageSlow: 12_000,
  },
  manual: {
    primary: 30_000,
    auxiliary: 120_000,
    page: 20_000,
    pageSlow: 30_000,
  },
};

const PLAYER_LOAD_FACTORS = [
  { min: 160, factor: 2.5 },
  { min: 120, factor: 2.0 },
  { min: 80, factor: 1.5 },
  { min: 40, factor: 1.25 },
] as const;

const SURFACE_LIMITS: Record<RefreshSurface, { min: number; max: number }> = {
  primary: { min: 1_500, max: 15_000 },
  auxiliary: { min: 8_000, max: 180_000 },
  page: { min: 2_500, max: 60_000 },
  pageSlow: { min: 4_000, max: 90_000 },
};

export function normalizeRefreshPolicy(value: unknown): RefreshPolicy {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "realtime" || normalized === "polling" || normalized === "manual") {
    return normalized;
  }
  return "polling";
}

export function resolveRefreshDelay(options: {
  policy?: unknown;
  playerCount?: number | null;
  hidden?: boolean;
  surface?: RefreshSurface;
}): number {
  const policy = normalizeRefreshPolicy(options.policy);
  const surface = options.surface ?? "primary";
  const base = POLICY_BASE_INTERVALS[policy][surface];
  const playerCount = Math.max(0, Number(options.playerCount ?? 0));
  const loadFactor = resolveLoadFactor(playerCount);
  const hiddenFactor = options.hidden ? 3 : 1;
  return clampDelay(Math.round(base * loadFactor * hiddenFactor), surface);
}

function resolveLoadFactor(playerCount: number): number {
  for (const bucket of PLAYER_LOAD_FACTORS) {
    if (playerCount >= bucket.min) return bucket.factor;
  }
  return 1;
}

function clampDelay(delay: number, surface: RefreshSurface): number {
  const limits = SURFACE_LIMITS[surface];
  return Math.max(limits.min, Math.min(limits.max, delay));
}
