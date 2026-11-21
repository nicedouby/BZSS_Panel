const maxConcurrent = 2;
const retryDelay = 6_000;
const preloadMargin = 240;

function distanceToCell(bounds, position) {
  if (!bounds) return Infinity;
  const [minX, minZ, maxX, maxZ] = bounds;
  return Math.hypot(Math.max(minX - position.x, 0, position.x - maxX),
    Math.max(minZ - position.z, 0, position.z - maxZ));
}

export function createBuildingStream(catalog, { load, attach, signal, invalidate, status }) {
  if (!catalog || !Array.isArray(catalog.tiles) || !catalog.tiles.length || catalog.tiles.length > 512 ||
      typeof catalog.revision !== "string") return null;
  const names = new Set();
  const slots = catalog.tiles.map(tile => {
    if (!/^t[789]\d{3}\.glb$/.test(tile.file) || names.has(tile.file)) throw new Error("Invalid building tile");
    names.add(tile.file);
    const box = tile.bounds;
    if (box !== null && (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) ||
        box[0] >= box[2] || box[1] >= box[3])) throw new Error("Invalid building bounds");
    return { file: tile.file, box, loaded: false, loading: false, retryAt: 0 };
  });
  const vegetation = slots.filter(slot => slot.box === null);
  const buildings = slots.filter(slot => slot.box !== null);
  if (!buildings.length) return null;
  let active = 0;
  let visibleTrees = false;
  let nextCheck = 0;
  let wanted = [];
  let lastStatus = "";

  function report(now) {
    const target = wanted.filter(slot => slot.box !== null);
    const loaded = target.filter(slot => slot.loaded).length;
    const failed = wanted.filter(slot => slot.retryAt > now).length;
    const treesLoading = visibleTrees && vegetation.some(slot => !slot.loaded && slot.retryAt <= now);
    const key = [loaded, target.length, failed, treesLoading].join(":");
    if (key === lastStatus) return;
    lastStatus = key;
    status({ loaded, wanted: target.length, failed, treesLoading });
  }

  async function fetchSlot(slot) {
    slot.loading = true;
    active++;
    try {
      const model = await load("tiles/" + slot.file, catalog.revision);
      if (signal.aborted || !model) return;
      attach(model, slot.box === null);
      slot.loaded = true;
      slot.retryAt = 0;
    } catch {
      if (!signal.aborted) slot.retryAt = performance.now() + retryDelay;
    } finally {
      slot.loading = false;
      active--;
      nextCheck = 0;
      if (!signal.aborted) invalidate();
    }
  }

  return {
    hasVegetation: vegetation.length > 0,
    showVegetation(visible) {
      visibleTrees = visible;
      nextCheck = 0;
      invalidate();
    },
    update(camera, target, range) {
      const now = performance.now();
      if (signal.aborted || now < nextCheck) return;
      nextCheck = now + 120;
      wanted = buildings.map(slot => {
        const nearby = distanceToCell(slot.box, camera.position);
        const center = distanceToCell(slot.box, target);
        return { slot, nearest: Math.min(nearby, center), rank: center + nearby * 0.35 };
      }).filter(row => row.nearest <= range + preloadMargin)
        .sort((a, b) => a.rank - b.rank).map(row => row.slot);
      if (visibleTrees) wanted.push(...vegetation);
      for (const slot of wanted) {
        if (active >= maxConcurrent) break;
        if (!slot.loaded && !slot.loading && slot.retryAt <= now) void fetchSlot(slot);
      }
      report(now);
    },
  };
}
