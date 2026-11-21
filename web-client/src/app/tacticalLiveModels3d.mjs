import {
  BufferGeometry, Color, Frustum, Group, LineBasicMaterial, LineLoop, Matrix4, Mesh, MeshBasicMaterial, OctahedronGeometry,
  Quaternion, Sphere, Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { loadTacticalEmbeddedImages } from "./tacticalEmbeddedImages.mjs";
import { scenePriority } from "./tacticalFrameBudget.mjs";
import { interpolateMotion, motionWindow, pushMotionSample } from "./tacticalSnapshotMotion.mjs";

const modelRoot = "/assets/live-models/";
const manifestName = "catalog-v3.json";
const worldRange = 8000;
const meshRange = 430;
const colors = [0xc3d0dc, 0x47d9ff, 0xff786c];
const titles = { vehicle: "载具", fob: "FOB 电台", hab: "HAB", deployable: "部署物", rally: "集结点" };
const normalized = value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const modelStem = value => normalized(String(value ?? "").replace(/^(?:BP_|SK_|SM_)/i, "").replace(/_C$/i, ""));

function disposeModel(scene) {
  const resources = new Set();
  const images = new Set();
  scene.traverse(node => {
    if (node.skeleton) resources.add(node.skeleton);
    if (!node.isMesh) return;
    resources.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      resources.add(material);
      for (const texture of Object.values(material)) {
        if (!texture?.isTexture) continue;
        resources.add(texture);
        if (texture.source?.data?.close) images.add(texture.source.data);
      }
    }
  });
  for (const resource of resources) resource.dispose();
  for (const image of images) image.close();
}

export function createLiveModelCache(assetCache, invalidate, budget) {
  const controller = new AbortController();
  const { signal } = controller;
  const loader = new GLTFLoader().register(loadTacticalEmbeddedImages);
  const templates = new Map();
  let catalog, families = [], nextCatalogRetry = 0, fetching = false;
  const equipmentByStem = new Map();
  const pending = new Map();
  const retries = new Set();
  let attached = 0;

  function loadCatalog() {
    if (fetching || catalog || performance.now() < nextCatalogRetry) return;
    fetching = true;
    fetch(modelRoot + manifestName, { signal }).then(response => {
      if (!response.ok) throw new Error("实时模型目录未载入");
      return response.json();
    }).then(document => {
      families = Object.keys(document.vehicleFamilies).sort((a, b) => b.length - a.length);
      for (const [key, model] of Object.entries(document.models)) {
        if (!key.startsWith("weapon:")) continue;
        const stem = modelStem(key.slice(7));
        if (!equipmentByStem.has(stem)) equipmentByStem.set(stem, model);
        else if (equipmentByStem.get(stem) !== model) equipmentByStem.set(stem, null);
      }
      catalog = document;
    }).catch(() => {
      nextCatalogRetry = performance.now() + 15_000;
    }).finally(() => { fetching = false; if (!signal.aborted) invalidate(); });
  }

  function file(category, mesh, actorClass, primary = false) {
    if (!mesh && !actorClass) return null;
    loadCatalog();
    if (!catalog) return null;
    const id = String(mesh ?? "").toLowerCase();
    let model = catalog.models[category + ":" + id];
    if (category === "vehicle") {
      const chassis = normalized(String(actorClass ?? "").replace(/^BP_/i, ""));
      const family = families.find(key => chassis.startsWith(key));
      if (family) model = catalog.vehicleVariants[family + ":" + id] ?? model ??
        (primary ? catalog.vehicleFamilies[family] : null);
    } else if (category === "weapon" && !model) {
      const base = id.replace(/_(?:grippod|foregrip|bipod|verticalgrip|ironsights?)$/i, "");
      model = catalog.models["weapon:" + base] ?? equipmentByStem.get(modelStem(id)) ??
        equipmentByStem.get(modelStem(base)) ?? equipmentByStem.get(modelStem(actorClass));
    }
    return typeof model === "string" && /^[a-z0-9_.-]+\.glb$/.test(model) ? model : null;
  }

  function prune() {
    if (templates.size <= 48) return;
    for (const [key, value] of templates) {
      if (templates.size <= 48) break;
      if (value.refs || value.loading) continue;
      if (value.scene) disposeModel(value.scene);
      templates.delete(key);
    }
  }

  function load(key, category) {
    const previous = templates.get(key);
    if (previous?.scene || previous?.loading || performance.now() < (previous?.retryAt ?? 0) ||
        (pending.get(category) ?? 0) >= (category === "weapon" ? 3 : 2)) return;
    const entry = { refs: 0, loading: true };
    templates.set(key, entry);
    pending.set(category, (pending.get(category) ?? 0) + 1);
    const priority = category === "vehicle" ? scenePriority.vehicle :
      category === "projectile" ? scenePriority.soldier :
      category === "weapon" ? scenePriority.equipped : scenePriority.buildings;
    const request = typeof AbortSignal.any === "function" && typeof AbortSignal.timeout === "function" ?
      AbortSignal.any([signal, AbortSignal.timeout(18_000)]) : signal;
    assetCache.get(modelRoot + key, request, "", { reload: Boolean(previous?.retryAt) })
      .then(buffer => budget.enqueue(priority, () => loader.parseAsync(buffer, ""), signal))
      .then(result => {
        if (signal.aborted) return disposeModel(result.scene);
        const tuned = new Set();
        result.scene.traverse(node => {
          if (node.isMesh) {
            node.castShadow = category === "deployable";
            node.receiveShadow = true;
            if (category === "vehicle") for (const material of [node.material].flat()) {
              if (!material?.isMeshStandardMaterial || tuned.has(material) || material.transparent) continue;
              tuned.add(material);
              material.color.multiplyScalar(1.17);
              material.metalness *= .48;
              material.roughness = Math.max(.66, material.roughness);
              if (material.map) {
                material.emissiveMap = material.map;
                material.emissive.setScalar(.08);
                material.emissiveIntensity = 1;
              }
              material.needsUpdate = true;
            }
          }
        });
        entry.scene = result.scene;
      })
      .catch(() => {
        if (signal.aborted) return;
        entry.retryAt = performance.now() + 4000;
        const timer = window.setTimeout(() => {
          retries.delete(timer);
          invalidate();
        }, 4050);
        retries.add(timer);
      })
      .finally(() => {
        pending.set(category, pending.get(category) - 1);
        entry.loading = false;
        if (!signal.aborted) {
          invalidate();
          prune();
        }
      });
  }

  function release(slot) {
    if (!slot.visual) return;
    slot.visual.traverse(node => {
      if (node.isSkinnedMesh) node.skeleton.dispose();
    });
    slot.visual.removeFromParent();
    templates.get(slot.modelKey).refs--;
    slot.visual = null;
    slot.modelKey = null;
  }

  function attach(slot, key, category) {
    if (slot.modelKey !== key) release(slot);
    if (!key || slot.visual) return Boolean(slot.visual);
    const entry = templates.get(key);
    if (!entry?.scene) {
      load(key, category);
      return false;
    }
    // Cloning a skinned component and its first GPU upload also consume a frame.
    const limit = category === "vehicle" ? (budget.pressure ? 1 : 2) : (budget.pressure ? 2 : 4);
    if (attached >= limit) {
      invalidate();
      return false;
    }
    slot.visual = clone(entry.scene);
    slot.modelKey = key;
    slot.anchor.add(slot.visual);
    entry.refs++;
    attached++;
    return true;
  }

  return { file, attach, release, preload(mesh, category, actorClass) {
    const key = file("weapon", mesh, actorClass);
    if (key) load(key, category);
  }, beginFrame() { attached = 0; }, dispose() {
    controller.abort();
    for (const timer of retries) window.clearTimeout(timer);
    retries.clear();
    for (const entry of templates.values()) if (entry.scene) disposeModel(entry.scene);
    templates.clear();
  } };
}

function applySample(track, sample, observedAt, vehicle) {
  const p = sample?.position;
  const q = sample?.quaternion;
  const s = sample?.scale;
  if (!p || ![p.x, p.y, p.z].every(Number.isFinite) || q?.length !== 4 ||
      !q.every(Number.isFinite) || s?.length !== 3 || !s.every(Number.isFinite)) return false;
  const position = new Vector3(p.x / 100, p.z / 100, p.y / 100);
  const orientation = new Quaternion(-q[0], -q[2], -q[1], q[3]).normalize();
  const { anchor } = track;
  if (vehicle && Number.isFinite(observedAt)) {
    track.history ??= [];
    const previous = track.history.at(-1);
    const snap = !previous || previous.position.distanceToSquared(position) > 1600;
    pushMotionSample(track.history, { time: observedAt, position, orientation }, snap);
    if (snap) {
      anchor.position.copy(position);
      anchor.quaternion.copy(orientation);
    }
  } else {
    anchor.position.copy(position);
    anchor.quaternion.copy(orientation);
  }
  anchor.scale.set(s[0], s[2], s[1]);
  return true;
}

function interpolate(track, time, motion) {
  if (!track.history?.length || time == null) return false;
  motionWindow(track.history, time, motion);
  interpolateMotion(motion, track.anchor.position);
  const { left, right, ratio } = motion;
  track.anchor.quaternion.copy(left.orientation);
  if (!right) return false;
  track.anchor.quaternion.slerp(right.orientation, ratio);
  return left.position.distanceToSquared(right.position) > .0001 ||
    left.orientation.angleTo(right.orientation) > .002;
}

export function createLiveActorLayer(scene, labels, invalidate, models, preview) {
  const root = new Group();
  scene.add(root);
  const rows = new Map();
  const geometry = new OctahedronGeometry(1);
  const materials = colors.map(color => new MeshBasicMaterial({ color: new Color(color), wireframe: true }));
  const ringGeometry = new BufferGeometry().setFromPoints(Array.from({ length: 96 }, (_, index) => {
    const angle = index * Math.PI * 2 / 96;
    return new Vector3(Math.cos(angle), 0, Math.sin(angle));
  }));
  const ringMaterials = colors.map(color => [.83, .36].map(opacity =>
    new LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false })));
  const enabled = { vehicle: true, deployable: true };
  const frustum = new Frustum();
  const projection = new Matrix4();
  const envelope = new Sphere(new Vector3(), 12);
  const projected = new Vector3();
  const motion = {};
  let previousFeed = null;

  function removePart(part) {
    models.release(part);
    part.anchor.removeFromParent();
  }

  function removeRow(id, row) {
    for (const part of row.parts.values()) removePart(part);
    row.anchor.removeFromParent();
    row.rings?.removeFromParent();
    row.label.remove();
    rows.delete(id);
  }

  function clear() {
    for (const [id, row] of rows) removeRow(id, row);
  }

  function ingest(feed) {
    if (feed === previousFeed) return;
    if (feed?.epoch !== previousFeed?.epoch) clear();
    previousFeed = feed;
    const seen = new Set();
    const gunners = new Map();
    for (const player of feed?.players ?? []) {
      if (player.seatKind === "turret" && player.vehicleId) gunners.set(player.vehicleId, player.name);
    }
    for (const item of feed?.liveActors ?? []) {
      if (!item?.id || !titles[item.kind] || seen.has(item.id)) continue;
      const team = [1, 2].includes(item.teamId) ? item.teamId : 0;
      let row = rows.get(item.id);
      const newRow = !row;
      if (!row) {
        const marker = new Mesh(geometry, materials[team]);
        const label = document.createElement("span");
        const anchor = new Group();
        marker.position.y = item.kind === "vehicle" ? 1.8 : 1.2;
        anchor.add(marker);
        row = { anchor, marker, label, parts: new Map() };
      }
      const observedAt = item.observedAt ?? feed.observedAt;
      if (row.observedAt === observedAt) {
        if (item.kind === "vehicle") row.label.textContent = gunners.has(item.id) ?
          `${row.title} · 炮手 ${gunners.get(item.id)}` : row.title;
        seen.add(item.id);
        continue;
      }
      const vehicle = item.kind === "vehicle";
      if (!applySample(row, item, observedAt, vehicle)) continue;
      row.observedAt = observedAt;
      if (newRow) {
        rows.set(item.id, row);
        root.add(row.anchor);
        labels.append(row.label);
      }
      const name = String(item.class ?? "").replace(/^BP_/i, "").replace(/_C$/i, "").replaceAll("_", " ");
      let title = `${titles[item.kind]}${name ? " · " + name : ""}`;
      if (item.kind === "rally") title = item.squadId == null ? "集结点" : `集结点 · 小队 ${item.squadId}`;
      if (item.kind === "fob") {
        row.radii = 0;
        if (!row.rings) {
          row.rings = new Group();
          row.ringLines = ringMaterials[team].map(material => new LineLoop(ringGeometry, material));
          row.rings.add(...row.ringLines);
          root.add(row.rings);
        }
        const display = [];
        for (const [i, type] of ["inner", "outer"].entries()) {
          const line = row.ringLines[i], sample = item.radii?.[type];
          line.visible = Number.isFinite(sample?.radius) && Boolean(sample.position);
          if (!line.visible) continue;
          const radius = sample.radius / 100;
          const { x, y, z } = sample.position;
          line.position.set(x / 100, z / 100 + .2, y / 100);
          line.scale.setScalar(radius);
          line.material = ringMaterials[team][i];
          row.radii = Math.max(row.radii, radius);
          display.push(`${type === "inner" ? "内" : "外"} ${Math.round(radius)} 米`);
        }
        if (display.length) title = "FOB · " + display.join(" · ");
      }
      row.title = title;
      if (gunners.has(item.id)) title += ` · 炮手 ${gunners.get(item.id)}`;
      if (row.label.textContent !== title) row.label.textContent = title;
      row.label.dataset.team = String(team);
      row.marker.material = materials[team];
      row.kind = item.kind;
      row.actorClass = item.class;
      const seenParts = new Set();
      for (const part of item.parts ?? []) {
        if (!part?.id || (!part.mesh && !(feed.demo && part.previewType)) || seenParts.has(part.id)) continue;
        const old = row.parts.get(part.id);
        const track = old ?? { anchor: new Group() };
        if (!applySample(track, part, observedAt, vehicle)) continue;
        track.mesh = part.mesh;
        track.role = part.role ?? "body";
        if (!old) {
          if (feed.demo && part.previewType) {
            track.preview = preview.scenery(part.previewType, team);
            track.anchor.add(track.preview);
          }
          root.add(track.anchor);
          row.parts.set(part.id, track);
        }
        seenParts.add(part.id);
      }
      for (const [id, part] of row.parts) {
        if (seenParts.has(id)) continue;
        removePart(part);
        row.parts.delete(id);
      }
      seen.add(item.id);
    }
    for (const [id, row] of rows) if (!seen.has(id)) removeRow(id, row);
    invalidate();
  }

  function render(time, camera, size, pressure = 0) {
    if (!size) return;
    // The live bridge samples different groups of vehicles in successive snapshots.
    const vehicleTime = time == null ? time : time - (previousFeed?.demo ? 0 : .15);
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const candidates = [];
    for (const row of rows.values()) {
      const animated = interpolate(row, vehicleTime, motion);
      const distance = camera.position.distanceToSquared(row.anchor.position);
      envelope.center.copy(row.anchor.position);
      envelope.radius = Math.max(12, row.radii ?? 0);
      const visible = enabled[row.kind === "vehicle" ? "vehicle" : "deployable"] &&
        distance < worldRange ** 2 && frustum.intersectsSphere(envelope);
      row.anchor.visible = visible;
      if (row.rings) row.rings.visible = visible;
      row.label.hidden = true;
      if (!visible) {
        for (const part of row.parts.values()) {
          part.anchor.visible = false;
          models.release(part);
        }
        continue;
      }
      candidates.push({ row, distance, animated });
    }
    candidates.sort((a, b) => (a.row.kind === "vehicle") - (b.row.kind === "vehicle") || a.distance - b.distance);
    let detailedVehicles = 0;
    for (const [index, { row, distance, animated }] of candidates.entries()) {
      if (animated) invalidate();
      let showModel = false;
      const vehicle = row.kind === "vehicle";
      const range = vehicle ? meshRange * [1, .86, .7, .57][pressure] : meshRange;
      const detailed = distance < range ** 2 && (!vehicle || detailedVehicles++ < [20, 15, 11, 7][pressure]);
      for (const part of row.parts.values()) {
        if (interpolate(part, vehicleTime, motion)) invalidate();
        const category = vehicle ? "vehicle" : "deployable";
        const key = detailed ? models.file(category, part.mesh, row.actorClass, part.role === "body") : null;
        part.anchor.visible = part.preview ? detailed : models.attach(part, key, category);
        showModel ||= part.anchor.visible;
      }
      row.marker.visible = !showModel;
      row.marker.scale.setScalar(Math.max(1, Math.min(8, Math.sqrt(distance) / 170)));
      projected.copy(row.anchor.position);
      projected.y += row.kind === "vehicle" ? 3.2 : 2.5;
      projected.project(camera);
      if (index >= 40 || distance > 1400 ** 2 ||
          Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) continue;
      row.label.hidden = false;
      row.label.style.transform = `translate(${(projected.x + 1) * size.width / 2}px,${(1 - projected.y) * size.height / 2}px) translate(-50%,-100%)`;
    }
  }

  return { ingest, render, count(kind) {
    return [...rows.values()].filter(row => kind === "vehicle" ? row.kind === "vehicle" : row.kind !== "vehicle").length;
  }, toggle(kind, value) { enabled[kind] = value; invalidate(); }, dispose() {
    clear();
    root.removeFromParent();
    geometry.dispose();
    ringGeometry.dispose();
    for (const line of ringMaterials.flat()) line.dispose();
    for (const material of materials) material.dispose();
  } };
}
