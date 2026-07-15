export interface TacticalMapTileWarmupOptions {
  basePath: string;
  maxZoom: number;
  preferredZoom?: number;
  concurrency?: number;
  signal?: AbortSignal;
}

const warmedMaps = new Set<string>();
const warmingMaps = new Map<string, Promise<void>>();

export function isTacticalMapCacheWarm(basePath: string, maxZoom: number) {
  return warmedMaps.has(cacheKey(basePath, maxZoom));
}

export async function warmTacticalMapTileCache(options: TacticalMapTileWarmupOptions) {
  const basePath = String(options.basePath ?? "").replace(/\/$/, "");
  const maxZoom = Math.max(0, Math.floor(Number(options.maxZoom) || 0));
  if (!basePath) return;

  const key = cacheKey(basePath, maxZoom);
  if (warmedMaps.has(key)) return;

  const existing = warmingMaps.get(key);
  if (existing) return existing;

  const task = runWarmup({
    ...options,
    basePath,
    maxZoom,
  }).then(() => {
    if (!options.signal?.aborted) warmedMaps.add(key);
  }).finally(() => {
    warmingMaps.delete(key);
  });

  warmingMaps.set(key, task);
  return task;
}

async function runWarmup(options: TacticalMapTileWarmupOptions) {
  const urls = buildTileUrls(
    options.basePath,
    options.maxZoom,
    options.preferredZoom,
  );
  const concurrency = Math.max(1, Math.min(8, Math.floor(options.concurrency ?? 6)));
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      if (options.signal?.aborted) return;
      const url = urls[cursor];
      cursor += 1;
      try {
        const response = await fetch(url, {
          cache: "force-cache",
          credentials: "same-origin",
          signal: options.signal,
        });
        if (response.ok) {
          // Consume the body so the browser can commit the complete response to
          // its HTTP disk cache. The immutable server header keeps it reusable.
          await response.arrayBuffer();
        }
      } catch (error: any) {
        if (error?.name === "AbortError") return;
        // A missing tile must not stop the rest of the map from warming.
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

function buildTileUrls(basePath: string, maxZoom: number, preferredZoom?: number) {
  const levels = Array.from({ length: maxZoom + 1 }, (_, zoom) => zoom);
  const preferred = Number(preferredZoom);
  if (Number.isFinite(preferred) && levels.includes(preferred)) {
    levels.splice(levels.indexOf(preferred), 1);
    levels.unshift(preferred);
  }

  const urls: string[] = [];
  for (const zoom of levels) {
    const tilesPerAxis = 2 ** zoom;
    for (let y = 0; y < tilesPerAxis; y += 1) {
      for (let x = 0; x < tilesPerAxis; x += 1) {
        urls.push(`${basePath}/${zoom}/${x}_${y}.jpg`);
      }
    }
  }
  return urls;
}

function cacheKey(basePath: string, maxZoom: number) {
  return `${String(basePath ?? "").replace(/\/$/, "")}|${maxZoom}`;
}
