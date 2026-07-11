import { onBeforeUnmount, ref, watch, type Ref } from "vue";

const MAP_CACHE_PREFIX = "bzss-tactical-map-assets-";
const MAP_CACHE_VERSION = "v1";
const MAP_CACHE_NAME = `${MAP_CACHE_PREFIX}${MAP_CACHE_VERSION}`;

const pendingAssets = new Map<string, Promise<string>>();
let mapCachePromise: Promise<Cache | null> | null = null;

async function openMapCache() {
  if (mapCachePromise) return mapCachePromise;
  mapCachePromise = (async () => {
    if (typeof window === "undefined" || !("caches" in window)) return null;
    await Promise.all(
      (await window.caches.keys())
        .filter((name) => name.startsWith(MAP_CACHE_PREFIX) && name !== MAP_CACHE_NAME)
        .map((name) => window.caches.delete(name)),
    );
    return window.caches.open(MAP_CACHE_NAME);
  })();
  return mapCachePromise;
}

async function loadAsset(source: string): Promise<string> {
  if (!source) return source;
  const existing = pendingAssets.get(source);
  if (existing) return existing;

  const task = (async () => {
    try {
      const cache = await openMapCache();
      if (!cache) return source;

      let response = await cache.match(source);
      if (!response) {
        const fetched = await fetch(source, {
          credentials: "same-origin",
          cache: "no-cache",
        });
        if (!fetched.ok) return source;
        response = fetched;
        await cache.put(source, fetched.clone());
      }

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch {
      return source;
    } finally {
      pendingAssets.delete(source);
    }
  })();

  pendingAssets.set(source, task);
  return task;
}

export function usePersistentMapAssetCache(sources: Ref<string[]>) {
  const resolvedUrls = ref(new Map<string, string>());
  let generation = 0;

  watch(
    sources,
    async (nextSources) => {
      const currentGeneration = ++generation;
      const activeSources = [...new Set(nextSources.filter(Boolean))];
      const previous = resolvedUrls.value;
      const next = new Map<string, string>();

      for (const source of activeSources) {
        const existing = previous.get(source);
        if (existing) next.set(source, existing);
      }
      resolvedUrls.value = next;

      await Promise.all(activeSources.map(async (source) => {
        if (next.has(source)) return;
        const resolved = await loadAsset(source);
        if (currentGeneration !== generation) {
          revokeObjectUrl(resolved, source);
          return;
        }
        const updated = new Map(resolvedUrls.value);
        updated.set(source, resolved);
        resolvedUrls.value = updated;
      }));

      if (currentGeneration !== generation) return;
      for (const [source, resolved] of previous) {
        if (!activeSources.includes(source)) revokeObjectUrl(resolved, source);
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    generation += 1;
    for (const [source, resolved] of resolvedUrls.value) {
      revokeObjectUrl(resolved, source);
    }
    resolvedUrls.value = new Map();
  });

  function getAssetUrl(source: string) {
    return resolvedUrls.value.get(source) ?? null;
  }

  return {
    getAssetUrl,
  };
}

function revokeObjectUrl(resolved: string, source: string) {
  if (resolved && resolved !== source && resolved.startsWith("blob:")) {
    URL.revokeObjectURL(resolved);
  }
}