import { Box3, BufferGeometry, Vector3 } from "three";

const families = new WeakMap();

export function collectLodDisposables(geometry, disposable) {
  disposable.add(geometry);
  const family = families.get(geometry);
  if (family) for (const item of family) disposable.add(item.geometry);
}

export async function prepareObjectLod(root, parser, signal) {
  const geometries = new Set();
  root.traverse(node => {
    if (node.isMesh && !node.isInstancedMesh && node.geometry.userData.bzssLod?.length) {
      geometries.add(node.geometry);
    }
  });
  await Promise.all([...geometries].map(async original => {
    const indexes = await Promise.all(original.userData.bzssLod.map(async ({ accessor, error }) => ({
      index: await parser.getDependency("accessor", accessor), error,
    })));
    if (signal.aborted) return;
    const family = [{ geometry: original, error: 0 }];
    for (const { index, error } of indexes) {
      const geometry = new BufferGeometry();
      for (const [name, attribute] of Object.entries(original.attributes)) geometry.setAttribute(name, attribute);
      geometry.setIndex(index);
      geometry.boundingBox = original.boundingBox;
      geometry.boundingSphere = original.boundingSphere;
      family.push({ geometry, error });
    }
    for (const { geometry } of family) families.set(geometry, family);
  }));
}

export function objectLodController(root, foliageName) {
  const records = [];
  const cameraPosition = new Vector3();
  function collect(node, foliage) {
    if (foliageName.test(node.name)) foliage = node;
    const family = node.isMesh && families.get(node.geometry);
    // Large preexisting vegetation batches already span their export tiles.
    if (family && (!node.isInstancedMesh || node.userData.bzssInstanceScale)) {
      const box = new Box3();
      if (node.isInstancedMesh) box.copy(node.boundingBox);
      else {
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        box.copy(node.geometry.boundingBox);
      }
      const scale = node.matrixWorld.getMaxScaleOnAxis() * (node.userData.bzssInstanceScale ?? 1);
      records.push({ node, family, box: box.applyMatrix4(node.matrixWorld), scale, foliage, level: 0 });
    }
    for (const child of node.children) collect(child, foliage);
  }
  collect(root, null);
  let lastUpdate = -Infinity;
  let previousMode = "";
  return function updateObjectLod(camera, height, now, mode = "auto") {
    if (previousMode === mode && now - lastUpdate < 90) return;
    lastUpdate = now;
    previousMode = mode;
    const full = mode === "original";
    cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    const focalPixels = height / (2 * Math.tan(camera.getEffectiveFOV() * Math.PI / 360));
    for (const item of records) {
      const { node, family, box, scale, foliage } = item;
      if (!full && (!node.visible || (foliage && !foliage.visible))) continue;
      const projectedScale = focalPixels * scale / Math.max(1, box.distanceToPoint(cameraPosition));
      let level = 0;
      if (!full) {
        const errorBudget = mode === "performance" && !foliage ? 4 : 2.1;
        for (let i = 1; i < family.length; i++) {
          // Hysteresis prevents toggling back and forth around a screen-size boundary.
          const limit = item.level >= i ? errorBudget * 1.28 : errorBudget;
          if (family[i].error * projectedScale <= limit) level = i;
        }
      }
      if (item.level !== level) {
        item.level = level;
        node.geometry = family[level].geometry;
      }
    }
  };
}
