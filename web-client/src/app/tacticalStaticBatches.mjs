import { Frustum, Group, InstancedMesh, Matrix4, Vector3 } from "three";

export const foliageName = /^(instancedfoliageactor|foliageinstancedstaticmeshcomponent)/i;

// Three.js can share an instance draw only when the mesh and material are identical.
// Keep those draws local so offscreen batches can be rejected together.
export function batchStaticObjects(root) {
  root.updateMatrixWorld(true);
  const rootInverse = new Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();

  function collect(node, isFoliage, hasCustomOrder) {
    if (!node.visible) return;
    isFoliage ||= foliageName.test(node.name);
    hasCustomOrder ||= node.renderOrder !== 0;
    for (const child of node.children) collect(child, isFoliage, hasCustomOrder);

    const material = node.material;
    if (node === root || !node.isMesh || node.children.length || node.isInstancedMesh ||
        node.isSkinnedMesh || node.morphTargetInfluences || hasCustomOrder || !node.frustumCulled ||
        node.layers.mask !== 1 || !material?.isMaterial || material.transparent ||
        !material.depthTest || !material.depthWrite) return;

    const geometry = node.geometry;
    // Preserve custom attributes used by existing glTF instance draws.
    if (Object.values(geometry.attributes).some(attribute => attribute.isInstancedBufferAttribute)) return;
    const matrix = new Matrix4().multiplyMatrices(rootInverse, node.matrixWorld);
    if (!supportsInstanceTransform(matrix)) return;

    const triangles = (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    const cellSize = triangles > 1500 ? 120 : 240;
    const { elements } = matrix;
    const x = Math.floor(elements[12] / cellSize);
    const z = Math.floor(elements[14] / cellSize);
    const key = `${isFoliage}:${geometry.id}:${material.id}:${node.castShadow}:${node.receiveShadow}:${x}:${z}`;
    let group = groups.get(key);
    if (!group) groups.set(key, group = { isFoliage, items: [] });
    group.items.push({ node, matrix });
  }

  collect(root, false, false);
  const buildings = new Group();
  buildings.name = "StaticObjectBatches";
  const foliage = new Group();
  foliage.name = "InstancedFoliageActorBatches";
  const batches = [];

  // Build batches before replacing nodes so an allocation failure leaves the original intact.
  const replacements = [];
  for (const { isFoliage, items } of groups.values()) {
    if (items.length < 2) continue;
    const { node } = items[0];
    const mesh = new InstancedMesh(node.geometry, node.material, items.length);
    mesh.castShadow = node.castShadow;
    mesh.receiveShadow = node.receiveShadow;
    let instanceScale = 0;
    for (const [index, item] of items.entries()) {
      mesh.setMatrixAt(index, item.matrix);
      instanceScale = Math.max(instanceScale, item.matrix.getMaxScaleOnAxis());
    }
    mesh.userData.bzssInstanceScale = instanceScale;
    mesh.computeBoundingBox();
    // The scene culls these with their tighter boxes instead of bounding spheres.
    mesh.frustumCulled = false;
    batches.push(mesh);
    (isFoliage ? foliage : buildings).add(mesh);
    replacements.push(items);
  }

  const maybeEmpty = new Set();
  for (const items of replacements) {
    for (const { node } of items) {
      maybeEmpty.add(node.parent);
      node.removeFromParent();
    }
  }
  for (let parent of maybeEmpty) {
    while (parent !== root && parent?.isGroup && parent.children.length === 0) {
      const next = parent.parent;
      parent.removeFromParent();
      parent = next;
    }
  }
  if (buildings.children.length) root.add(buildings);
  if (foliage.children.length) root.add(foliage);

  // This GLB only contains static scenery. Keep its matrices ready across frames.
  root.updateMatrixWorld(true);
  root.traverse(node => {
    node.matrixAutoUpdate = false;
    node.matrixWorldAutoUpdate = false;
  });
  const bounds = batches.map(mesh => mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  const staticMeshes = new Set();
  const singleStaticMeshes = [];
  function collectStaticMeshes(node) {
    if (!node.visible) return;
    if (node.isMesh && !node.children.length) {
      staticMeshes.add(node);
      if (node.frustumCulled) {
        const owner = node.isInstancedMesh ? node : node.geometry;
        if (!owner.boundingBox) owner.computeBoundingBox();
        if (!owner.boundingBox.isEmpty()) {
          singleStaticMeshes.push({ node, box: owner.boundingBox.clone().applyMatrix4(node.matrixWorld), inRange: true });
        }
      }
    }
    for (const child of node.children) collectStaticMeshes(child);
  }
  collectStaticMeshes(root);
  const distanceBatches = batches.map(mesh => staticMeshes.has(mesh) ? { inRange: true } : null);
  const frustum = new Frustum();
  const viewProjection = new Matrix4();
  const position = new Vector3();
  const previousPosition = new Vector3(Infinity, Infinity, Infinity);
  let previousView;
  let previousRange = Infinity;
  function withinDistance(record, box, range) {
    // Enter slightly inside the limit to prevent flicker when flying along its edge.
    record.inRange = !Number.isFinite(range) || box.distanceToPoint(position) <= (record.inRange ? range : range * 0.92);
    return record.inRange;
  }
  return function cullStaticBatches(camera, shadowFrustum, range = Infinity) {
    camera.updateMatrixWorld();
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!shadowFrustum && previousRange === range && previousView?.equals(viewProjection)) return;
    position.setFromMatrixPosition(camera.matrixWorld);
    const updateSingles = shadowFrustum || previousRange !== range || !previousView ||
      (Number.isFinite(range) && !previousPosition.equals(position));
    if (shadowFrustum) previousView = undefined;
    else (previousView ??= new Matrix4()).copy(viewProjection);
    previousRange = range;
    previousPosition.copy(position);
    frustum.setFromProjectionMatrix(viewProjection);
    for (let i = 0; i < batches.length; i++) {
      const distance = distanceBatches[i];
      const inRange = !distance || withinDistance(distance, bounds[i], range);
      batches[i].visible = (inRange && frustum.intersectsBox(bounds[i])) ||
        Boolean(shadowFrustum && batches[i].castShadow && shadowFrustum.intersectsBox(bounds[i]));
    }
    if (updateSingles) {
      for (const entry of singleStaticMeshes) {
        entry.node.visible = withinDistance(entry, entry.box, range) ||
          Boolean(shadowFrustum && entry.node.castShadow && shadowFrustum.intersectsBox(entry.box));
      }
    }
  };
}

function supportsInstanceTransform(matrix) {
  // InstancedMesh does not support mirrored instances or the normal transform for shear.
  if (!(matrix.determinant() > 0)) return false;
  const a = matrix.elements;
  const x = Math.hypot(a[0], a[1], a[2]);
  const y = Math.hypot(a[4], a[5], a[6]);
  const z = Math.hypot(a[8], a[9], a[10]);
  const xy = a[0] * a[4] + a[1] * a[5] + a[2] * a[6];
  const xz = a[0] * a[8] + a[1] * a[9] + a[2] * a[10];
  const yz = a[4] * a[8] + a[5] * a[9] + a[6] * a[10];
  return Math.abs(xy) <= 1e-5 * x * y && Math.abs(xz) <= 1e-5 * x * z &&
    Math.abs(yz) <= 1e-5 * y * z;
}
