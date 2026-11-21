import { Box3, Vector3 } from "three";

export function installFixedLighting({ button, sun, sky, scene, renderer, invalidate, signal, foliageName }) {
  const direction = new Vector3(-0.78, 0.96, 0.52).normalize();
  const center = new Vector3();
  const extent = new Vector3();
  const lightBounds = new Box3();
  const ground = new Box3();
  const focus = new Vector3();
  const viewDirection = new Vector3();
  const shadow = sun.shadow;
  let enabled = false, ready = false, needsBake = false;
  let region = "", bakedAt = -Infinity, updateTimer = 0;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  scene.add(sun.target);
  shadow.autoUpdate = false;
  const resolution = Math.min(3072, renderer.capabilities.maxTextureSize);
  shadow.mapSize.set(resolution, resolution);
  shadow.intensity = 0.85;
  shadow.radius = 2;
  shadow.bias = -0.00008;
  button.title = "固定日光，近处使用更高精度的建筑阴影";
  button.setAttribute("aria-pressed", "false");
  button.disabled = true;
  // A lighter neutral bounce reduces the overly dark vertical faces away from the sun.
  sky.groundColor.setHex(0xa39e93);
  sky.intensity = 1.34;
  button.addEventListener("click", () => {
    enabled = !enabled;
    sun.castShadow = enabled && ready;
    sun.intensity = enabled ? 1.86 : 1.65;
    sky.intensity = enabled ? 1.38 : 1.34;
    button.setAttribute("aria-pressed", String(enabled));
    invalidate();
  }, { signal });
  signal.addEventListener("abort", () => {
    clearTimeout(updateTimer);
    shadow.dispose();
  }, { once: true });

  function markCasters(node) {
    if (foliageName.test(node.name)) return;
    if (node.isMesh && node.material?.isMaterial && !node.material.transparent) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
    for (const child of node.children) markCasters(child);
  }

  return {
    reset() {
      ready = needsBake = sun.castShadow = false;
      region = "";
      clearTimeout(updateTimer);
      updateTimer = 0;
      button.disabled = true;
    },
    setScenery(objects, bounds) {
      markCasters(objects);
      ground.copy(bounds);
      bounds.getCenter(center);
      bounds.getSize(extent);
      sun.position.copy(center).addScaledVector(direction, Math.max(100, extent.length()));
      sun.target.position.copy(center);
      sun.updateMatrixWorld(true);
      sun.target.updateMatrixWorld(true);
      shadow.updateMatrices(sun);
      const camera = shadow.camera;
      lightBounds.copy(bounds).applyMatrix4(camera.matrixWorldInverse).expandByScalar(32);
      camera.near = Math.max(0.5, -lightBounds.max.z);
      camera.far = Math.max(camera.near + 1, -lightBounds.min.z);
      camera.updateProjectionMatrix();
      ready = needsBake = true;
      sun.castShadow = enabled;
      button.disabled = false;
    },
    beforeRender(view, now) {
      if (!enabled || !ready) return null;
      view.getWorldDirection(viewDirection);
      const camera = shadow.camera;
      const close = ground.distanceToPoint(view.position) < (region === "full" ? 380 : 480);
      // Use a stable light-space window, with padding so small camera moves reuse the cached map.
      const lookAhead = viewDirection.y < -0.08
        ? Math.min(200, Math.max(0, (view.position.y - center.y) / -viewDirection.y)) : 130;
      focus.copy(view.position).addScaledVector(viewDirection, lookAhead);
      focus.clamp(ground.min, ground.max).applyMatrix4(camera.matrixWorldInverse);
      const step = 96, half = 250;
      const x = Math.round(focus.x / step) * step;
      const y = Math.round(focus.y / step) * step;
      const next = close ? `${x}:${y}` : "full";
      if (!needsBake && region === next) return null;
      if (!needsBake && now - bakedAt < 850) {
        if (!updateTimer) updateTimer = setTimeout(() => { updateTimer = 0; invalidate(); }, 860 - (now - bakedAt));
        return null;
      }
      region = next;
      bakedAt = now;
      camera.left = close ? x - half : lightBounds.min.x;
      camera.right = close ? x + half : lightBounds.max.x;
      camera.bottom = close ? y - half : lightBounds.min.y;
      camera.top = close ? y + half : lightBounds.max.y;
      shadow.normalBias = close ? 0.04 : 0.16;
      camera.updateProjectionMatrix();
      shadow.updateMatrices(sun);
      renderer.shadowMap.needsUpdate = true;
      shadow.needsUpdate = true;
      needsBake = false;
      // Restore the view camera's culling on the next frame after the single shadow pass.
      invalidate();
      return shadow.getFrustum();
    },
  };
}
