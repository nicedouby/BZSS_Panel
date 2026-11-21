import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DynamicDrawUsage, Group, InstancedBufferAttribute, Line, LineBasicMaterial,
  Mesh, MeshBasicMaterial, Points, PointsMaterial, Quaternion, SphereGeometry, Sprite, SpriteMaterial, Vector3,
} from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { interpolateMotion, motionWindow, pushMotionSample } from "./tacticalSnapshotMotion.mjs";

const traceLifetimeMs = 3000;
const flashLifetimeMs = 60;
const trailLimit = 65;
const shotLimit = 256;
const projectileLimit = 48;
const smokeLimit = 14;
const demoProjectileMeshes = ["M18_projectile", "Type86P_frag_proj", "SK_AT4_Rocket_Projectile"];

function vector(value, scale = 1) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return new Vector3(value.x * scale, value.z * scale, value.y * scale);
}

function trailAlpha(ageMs) {
  return Math.max(0, Math.min(1, (traceLifetimeMs - ageMs) / 1900));
}

function cloudTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 96;
  const ctx = canvas.getContext("2d");
  const layers = [[48, 48, 44], [36, 49, 32], [58, 36, 30], [55, 56, 33], [36, 29, 25]];
  for (const [x, y, size] of layers) {
    const layer = ctx.createRadialGradient(x, y, 0, x, y, size);
    layer.addColorStop(0, "rgba(240,244,248,.60)");
    layer.addColorStop(.46, "rgba(225,233,239,.32)");
    layer.addColorStop(1, "rgba(232,235,242,0)");
    ctx.fillStyle = layer;
    ctx.fillRect(0, 0, 96, 96);
  }
  return new CanvasTexture(canvas);
}

function createRayMesh() {
  // WebGL's native line width is capped at one pixel on many GPUs.
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(new Float32Array(shotLimit * 6));
  const { instanceStart: start, instanceEnd: end } = geometry.attributes;
  start.data.setUsage(DynamicDrawUsage);
  const opacity = new InstancedBufferAttribute(new Float32Array(shotLimit * 2), 2).setUsage(DynamicDrawUsage);
  geometry.setAttribute("traceOpacity", opacity);
  geometry.instanceCount = 0;
  const material = new LineMaterial({ color: 0xffa447, linewidth: 3.2, transparent: true, depthWrite: false });
  material.vertexShader = material.vertexShader.replace("void main() {",
    "attribute vec2 traceOpacity;\nvarying float vTraceOpacity;\nvoid main() {\n" +
    "vTraceOpacity = mix(traceOpacity.x, traceOpacity.y, clamp(position.y, 0.0, 1.0));");
  material.fragmentShader = material.fragmentShader.replace("void main() {",
    "varying float vTraceOpacity;\nvoid main() {").replace(
    "vec4( diffuseColor.rgb, alpha )", "vec4( diffuseColor.rgb, alpha * vTraceOpacity )");
  const mesh = new LineSegments2(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, geometry, material, start, end, opacity };
}

export function createCombatEffects(scene, models, invalidate) {
  const group = new Group();
  const projectileMesh = new SphereGeometry(.12, 8, 5);
  const projectileMaterial = new MeshBasicMaterial({ color: 0xe8e3b6 });
  const trailMaterial = new LineBasicMaterial({ color: 0xf8c482, vertexColors: true, transparent: true, opacity: .65, depthWrite: false });
  const ray = createRayMesh();
  const flashGeometry = new BufferGeometry();
  const flashPositions = new BufferAttribute(new Float32Array(shotLimit * 3), 3);
  flashGeometry.setAttribute("position", flashPositions);
  const flashMaterial = new PointsMaterial({ color: 0xffc17c, size: .34, depthWrite: false, transparent: true, opacity: .94 });
  const flashes = new Points(flashGeometry, flashMaterial);
  flashes.frustumCulled = false;
  group.add(ray.mesh, flashes);
  scene.add(group);
  const smokeTexture = cloudTexture();
  const shots = [], lastShot = new Map();
  const projectiles = new Map();
  let previousFeed, enabled = true;
  const projectedEnd = new Vector3();
  const motion = {};

  function remove(trace) {
    models.release(trace);
    trace.anchor.removeFromParent();
    trace.line.removeFromParent();
    trace.line.geometry.dispose();
    trace.cloud?.removeFromParent();
    trace.smokeMaterial?.dispose();
  }

  function clear() {
    shots.length = 0;
    lastShot.clear();
    for (const trace of projectiles.values()) remove(trace);
    projectiles.clear();
  }

  function makeProjectile(point) {
    const anchor = new Group();
    anchor.position.copy(point);
    const marker = new Mesh(projectileMesh, projectileMaterial);
    anchor.add(marker);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(trailLimit * 3), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(trailLimit * 4), 4));
    const line = new Line(geometry, trailMaterial);
    line.frustumCulled = false;
    group.add(anchor, line);
    return { anchor, marker, line, history: [], trail: [], to: point.clone() };
  }

  function ingest(feed) {
    if (previousFeed === feed) return;
    if (previousFeed?.epoch !== feed?.epoch) clear();
    previousFeed = feed;
    const now = performance.now();
    const time = feed?.observedAt;
    const players = new Set();
    for (const player of feed?.players ?? []) {
      players.add(player.id);
      const token = `${player.weaponId ?? ""}:${player.shotCounter ?? ""}:${player.shotTime ?? ""}`;
      const previous = lastShot.get(player.id);
      lastShot.set(player.id, { token, weaponId: player.weaponId });
      if (!previous || previous.weaponId !== player.weaponId || previous.token === token ||
          !Number.isFinite(player.shotTime) || player.shotTime <= 0) continue;
      const origin = vector(player.shotOrigin, .01), direction = vector(player.shotDirection);
      if (!origin || !direction || direction.lengthSq() < .25) continue;
      if (shots.length >= shotLimit) shots.shift();
      shots.push({ origin, direction: direction.normalize(), time, started: null });
    }
    for (const id of lastShot.keys()) if (!players.has(id)) lastShot.delete(id);
    const seen = new Set();
    for (const value of feed?.projectiles ?? []) {
      if (!value?.id || seen.size >= projectileLimit) continue;
      const point = vector(value.position, .01);
      if (!point) continue;
      seen.add(value.id);
      let trace = projectiles.get(value.id);
      if (!trace) {
        if (projectiles.size >= projectileLimit * 2) {
          const expired = [...projectiles].find(([, item]) => item.missingSince != null);
          if (!expired) continue;
          remove(expired[1]);
          projectiles.delete(expired[0]);
        }
        trace = makeProjectile(point);
        projectiles.set(value.id, trace);
      }
      trace.missingSince = null;
      trace.to.copy(point);
      trace.mesh = value.mesh;
      trace.kind = value.kind;
      trace.smoke = value.activeSmoke === true;
      const q = value.quaternion;
      const orientation = q?.length === 4 && q.every(Number.isFinite) ?
        new Quaternion(-q[0], -q[2], -q[1], q[3]).normalize() : new Quaternion();
      pushMotionSample(trace.history, { time, position: point, orientation });
      if (trace.smoke && !trace.cloud) {
        trace.cloud = new Group();
        trace.smokeStarted = now;
        const color = value.color?.length === 3 ? new Color().setRGB(...value.color) : new Color(0xdadfdf);
        trace.smokeMaterial = new SpriteMaterial({
          color, map: smokeTexture, transparent: true, opacity: .7, depthWrite: false,
        });
        for (let i = 0; i < 5; i++) trace.cloud.add(new Sprite(trace.smokeMaterial));
        group.add(trace.cloud);
      }
      if (!trace.smoke) {
        const last = trace.trail.at(-1);
        if (!last || last.position.distanceToSquared(point) > .025) {
          if (trace.trail.length === trailLimit) trace.trail.shift();
          trace.trail.push({ position: point, at: now, time });
        }
      }
    }
    for (const [id, trace] of projectiles) {
      if (seen.has(id)) continue;
      trace.missingSince ??= now;
    }
    invalidate();
  }

  function render(now, time, camera, pressure) {
    if (!enabled) return;
    if (previousFeed?.demo) for (const mesh of demoProjectileMeshes) models.preload(mesh, "projectile");
    while (shots[0]?.started != null && now - shots[0].started >= traceLifetimeMs) shots.shift();
    let rayCount = 0, flashCount = 0, smokeCount = 0, animate = false;
    for (const shot of shots) {
      if (shot.started == null) {
        if (time != null && shot.time > time) { animate = true; continue; }
        shot.started = now;
      }
      if (camera.position.distanceToSquared(shot.origin) > 850 ** 2) continue;
      const age = Math.max(0, now - shot.started);
      const opacity = Math.min(1, (traceLifetimeMs - age) / 2200);
      if (age < flashLifetimeMs) flashPositions.setXYZ(flashCount++, shot.origin.x, shot.origin.y, shot.origin.z);
      projectedEnd.copy(shot.origin).addScaledVector(shot.direction, 75);
      ray.start.setXYZ(rayCount, shot.origin.x, shot.origin.y, shot.origin.z);
      ray.end.setXYZ(rayCount, projectedEnd.x, projectedEnd.y, projectedEnd.z);
      ray.opacity.setXY(rayCount, opacity * .89, opacity * .25);
      rayCount++;
    }
    ray.geometry.instanceCount = rayCount;
    flashGeometry.setDrawRange(0, flashCount);
    if (flashCount) flashPositions.needsUpdate = true;
    if (rayCount) {
      ray.start.data.needsUpdate = ray.opacity.needsUpdate = true;
      animate = true;
    }
    for (const [id, trace] of projectiles) {
      while (trace.trail.length && now - trace.trail[0].at >= traceLifetimeMs) trace.trail.shift();
      if (trace.missingSince != null && trace.trail.length < 2) {
        remove(trace);
        projectiles.delete(id);
        continue;
      }
      const nearby = camera.position.distanceToSquared(trace.to) < (trace.smoke ? 600 : 350) ** 2;
      const present = trace.missingSince == null;
      trace.anchor.visible = nearby && present;
      trace.line.visible = false;
      if (trace.cloud) {
        trace.cloud.visible = nearby && present && trace.smoke && smokeCount++ < smokeLimit;
        if (trace.cloud.visible) {
          trace.cloud.position.copy(trace.to);
          const age = (now - trace.smokeStarted) / 1000;
          const size = Math.min(1, .2 + age * .26);
          trace.smokeMaterial.opacity = Math.min(.88, .4 + age * .16);
          for (const [index, sprite] of trace.cloud.children.entries()) {
            sprite.visible = index < (pressure >= 2 ? 3 : 5);
            const angle = index * 2.4 + .1 * age;
            sprite.position.set(Math.cos(angle) * 2.2 * size, (1.1 + index * .58) * size,
              Math.sin(angle) * 2.2 * size);
            sprite.scale.setScalar((4.3 + index * .55) * size);
          }
          animate ||= age < 5;
        }
      }
      if (trace.anchor.visible) {
        motionWindow(trace.history, time ?? trace.history.at(-1).time, motion);
        interpolateMotion(motion, trace.anchor.position);
        const { left, right, ratio } = motion;
        trace.anchor.quaternion.copy(left.orientation);
        if (right) trace.anchor.quaternion.slerp(right.orientation, ratio);
        const asset = models.file("weapon", trace.mesh);
        const attached = models.attach(trace, asset, "projectile");
        trace.marker.visible = !attached && !trace.mesh && !trace.smoke && trace.kind === "projectile";
        animate ||= Boolean(right) && left.position.distanceToSquared(right.position) > .002;
      } else {
        models.release(trace);
      }
      if (nearby && trace.trail.length) {
        const { position: positions, color: colors } = trace.line.geometry.attributes;
        let written = 0;
        let last;
        const activeFlight = present && !trace.smoke;
        for (const point of trace.trail) {
          if (activeFlight && time != null && point.time >= time) break;
          const pos = point.position;
          positions.setXYZ(written, pos.x, pos.y, pos.z);
          colors.setXYZW(written++, 1, 1, 1, trailAlpha(now - point.at));
          last = pos;
        }
        if (activeFlight && last && written < trailLimit && last.distanceToSquared(trace.anchor.position) > .0001) {
          const end = trace.anchor.position;
          positions.setXYZ(written, end.x, end.y, end.z);
          colors.setXYZW(written++, 1, 1, 1, 1);
        }
        trace.line.geometry.setDrawRange(0, written);
        trace.line.visible = written >= 2;
        if (trace.line.visible) {
          positions.needsUpdate = colors.needsUpdate = true;
          animate = true;
        }
      }
    }
    if (animate) invalidate();
  }

  return { ingest, render, toggle(value) { enabled = group.visible = value; invalidate(); }, dispose() {
    clear();
    group.removeFromParent();
    projectileMesh.dispose();
    projectileMaterial.dispose();
    trailMaterial.dispose();
    ray.geometry.dispose();
    ray.material.dispose();
    flashGeometry.dispose();
    flashMaterial.dispose();
    smokeTexture.dispose();
  } };
}
