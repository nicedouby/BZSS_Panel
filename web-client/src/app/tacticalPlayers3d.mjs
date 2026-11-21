import {
  Color, ConeGeometry, Group, InstancedMesh, MathUtils, MeshBasicMaterial, Object3D, SphereGeometry, Vector3,
} from "three";
import { createSoldierModels, resolveSoldierFamily, resolveWeaponCategory } from "./tacticalSoldiers3d.mjs";
import { interpolateHeading, interpolateMotion, motionWindow, pushMotionSample } from "./tacticalSnapshotMotion.mjs";

const limit = 256;
const headingRadians = Math.PI / 180;
const colors = [new Color(0xc2c8d0), new Color(0x47d9ff), new Color(0xff786c)];

export function createLivePlayerLayer(scene, labelLayer, invalidate, assetCache, liveModels, budget, preview) {
  const root = new Group();
  const bodyShape = new SphereGeometry(1.6, 8, 6);
  const arrowShape = new ConeGeometry(1.1, 2.9, 4).rotateZ(-Math.PI / 2).translate(2.5, 0, 0);
  const material = new MeshBasicMaterial();
  const bodies = new InstancedMesh(bodyShape, material, limit);
  const arrows = new InstancedMesh(arrowShape, material, limit);
  for (const mesh of [bodies, arrows]) { mesh.frustumCulled = false; mesh.count = 0; }
  root.add(bodies, arrows);
  scene.add(root);
  const soldiers = createSoldierModels(root, assetCache, invalidate, liveModels, budget, preview);
  const rows = new Map();
  const transform = new Object3D();
  const projected = new Vector3();
  const motion = {};
  let lastFeed, lastEpoch, visible = true;

  function clear() {
    soldiers.clear();
    rows.clear();
    labelLayer.replaceChildren();
    bodies.count = arrows.count = 0;
  }

  function ingest(feed) {
    if (feed === lastFeed) return rows.size;
    lastFeed = feed;
    if (feed?.epoch !== lastEpoch) clear();
    lastEpoch = feed?.epoch;
    const online = new Set();
    const now = performance.now();
    const intervalSeconds = feed?.sampling?.intervalSeconds;
    const holdSeconds = Number.isFinite(intervalSeconds) ? MathUtils.clamp(intervalSeconds * 3, .16, .30) : .25;
    const factions = feed?.map?.layerSettings?.fields;
    for (const player of feed?.players ?? []) {
      if (online.size >= limit) break;
      const { id, position, yaw } = player;
      const time = feed.observedAt;
      if (!id || online.has(id) || player.positionStatus !== "ok" || !position ||
          ![time, position.x, position.y, position.z].every(Number.isFinite)) continue;
      online.add(id);
      const end = new Vector3(position.x / 100, position.z / 100, position.y / 100);
      const angle = Number.isFinite(yaw) ? yaw * headingRadians : null;
      const infantry = player.hasPawn && !player.seated && !player.vehicleId &&
        /soldier|infantry/i.test(player.pawnClass ?? "");
      const modelFamily = infantry ? resolveSoldierFamily({
        ...player, faction: player.faction ?? factions?.[`Faction${player.teamId}`],
      }) : null;
      const weaponCategory = infantry ? resolveWeaponCategory(player) : "rifle";
      let row = rows.get(id);
      if (!row) {
        const label = document.createElement("span");
        label.hidden = true;
        labelLayer.append(label);
        row = { label, position: end.clone(), movement: new Vector3(), history: [], speed: 0 };
        rows.set(id, row);
      }
      const label = player.name || (player.playerId == null ? "玩家" : `玩家 ${player.playerId}`);
      row.name = label;
      row.demo = feed.demo === true;
      const team = player.teamId === 1 || player.teamId === 2 ? player.teamId : 0;
      if (row.team !== team) row.label.dataset.team = String(team);
      row.team = team;
      const rawVelocity = player.velocity;
      const velocity = rawVelocity && [rawVelocity.x, rawVelocity.y, rawVelocity.z].every(Number.isFinite) ?
        new Vector3(rawVelocity.x / 100, rawVelocity.z / 100, rawVelocity.y / 100) : null;
      const pitch = Number.isFinite(player.pitch) ? player.pitch : null;
      const previous = row.history.at(-1);
      const sample = {
        time, position: end, velocity, angle, pitch, infantry, modelFamily, weaponCategory, holdSeconds,
        stance: ["prone", "crouched"].includes(player.stance) ? player.stance : "standing",
        capsuleHalfHeight: Number.isFinite(player.capsuleHalfHeight) ? player.capsuleHalfHeight / 100 : null,
        weaponMesh: player.weaponMesh, weaponClass: player.weaponClass, weaponMount: player.weaponMount,
        weaponId: player.weaponId, shotCounter: player.shotCounter, shotTime: player.shotTime,
        throwing: player.throwing === true, itemReleased: player.itemReleased === true,
        aiming: player.aiming ?? player.weaponAiming ?? false, airborne: player.airborne === true,
        sprinting: player.sprinting === true, firing: player.firing === true, seated: player.seated === true,
        seatKind: player.seatKind, vehicleId: player.vehicleId,
        lean: Number.isFinite(player.lean) ? MathUtils.clamp(player.lean, -1, 1) : 0,
      };
      const interval = time - (previous?.time ?? time);
      const travel = previous?.position.distanceTo(end) ?? 0;
      // Keep respawns and entering vehicles as discrete moves.
      const snap = !previous || previous.infantry !== infantry || previous.modelFamily !== modelFamily ||
        previous.vehicleId !== player.vehicleId || travel > 50 || (infantry && travel > 4 && travel > 24 * interval);
      pushMotionSample(row.history, sample, snap);
      row.received = now;
      if (snap) {
        row.position.copy(end);
        row.angle = angle;
        row.pitch = pitch;
        row.travelAngle = null;
        row.speed = 0;
        row.equippedAt = undefined;
        row.applied = null;
        applyPlayerState(row, sample, now);
      }
    }
    for (const [id, row] of rows) {
      if (online.has(id)) continue;
      row.label.remove();
      rows.delete(id);
    }
    invalidate();
    return rows.size;
  }

  function applyPlayerState(row, sample, now) {
    const previous = row.applied;
    if (previous === sample) return;
    const shot = sample.weaponId && sample.weaponId === previous?.weaponId && sample.shotTime > 0 &&
      (sample.shotCounter !== previous.shotCounter || sample.shotTime !== previous.shotTime);
    if (sample.weaponId !== previous?.weaponId) row.flashUntil = 0;
    if (shot || (sample.firing && !previous?.firing)) {
      row.flashUntil = now + 110;
      row.shotAt = now;
    }
    const { position, velocity, time, angle, pitch, holdSeconds, ...state } = sample;
    if (sample.infantry && !sample.itemReleased) {
      const sameWeapon = state.weaponId && state.weaponId === row.weaponId;
      const hasDescription = state.weaponClass || state.weaponMesh;
      const hasReading = state.weaponId || hasDescription;
      if (sameWeapon || (!hasReading && time - row.equippedAt <= holdSeconds)) {
        state.weaponId ??= row.weaponId;
        state.weaponClass ??= row.weaponClass;
        state.weaponMesh ??= row.weaponMesh;
        state.weaponMount ??= row.weaponMount;
        if (!hasDescription) state.weaponCategory = row.weaponCategory;
      }
      if (hasReading) row.equippedAt = time;
    } else row.equippedAt = undefined;
    if (state.weaponMount !== row.weaponMount) row.mountRevision = JSON.stringify(state.weaponMount ?? null);
    Object.assign(row, state);
    row.applied = sample;
  }

  function advance(now, time) {
    if (time == null) return;
    let moving = false;
    for (const row of rows.values()) {
      motionWindow(row.history, time, motion);
      interpolateMotion(motion, row.position, row.movement, !row.demo && row.infantry);
      const { left, right, ratio } = motion;
      applyPlayerState(row, left, now);
      row.angle = interpolateHeading(left.angle, right?.angle, ratio);
      row.pitch = Number.isFinite(left.pitch) && Number.isFinite(right?.pitch) ?
        MathUtils.lerp(left.pitch, right.pitch, ratio) : left.pitch ?? right?.pitch ?? null;
      row.lean = right ? MathUtils.lerp(left.lean, right.lean, ratio) : left.lean;
      const fresh = right || now - row.received < (row.demo ? 350 : 850);
      row.speed = fresh ? Math.min(16, Math.hypot(row.movement.x, row.movement.z)) : 0;
      if (row.speed > .13) row.travelAngle = Math.atan2(row.movement.z, row.movement.x);
      moving ||= Boolean(right) || (fresh && row.speed > .13) || now < (row.flashUntil ?? 0);
    }
    if (moving) invalidate();
  }

  let previousBodies = 0, previousArrows = 0;
  function render(now, camera, size, pressure) {
    if (!visible || !size) return;
    camera.updateMatrixWorld();
    let bodyCount = 0, arrowCount = 0;
    const animating = soldiers.update(now, camera, rows, pressure);
    for (const row of rows.values()) {
      const hasModel = soldiers.hasModel(row);
      const firing = row.firing || now < (row.flashUntil ?? 0);
      const state = row.throwing ? "投掷" : firing ? "开火" : row.aiming ? "瞄准" :
        row.airborne ? "腾空" : row.sprinting ? "冲刺" : "";
      const status = row.seatKind === "turret" ? ["炮塔", state].filter(Boolean).join(" · ") : state;
      if (row.labelStatus !== status || row.labelName !== row.name) {
        row.labelStatus = status;
        row.labelName = row.name;
        row.label.textContent = status ? `${row.name} · ${status}` : row.name;
        row.label.dataset.activity = firing ? "fire" : row.aiming ? "aim" : "";
      }
      const cameraDistance = camera.position.distanceTo(row.position);
      if (!hasModel && !row.seated && !row.vehicleId && cameraDistance > 2) {
        transform.position.copy(row.position);
        const markerScale = MathUtils.clamp(cameraDistance / 220, .16, 7);
        transform.position.y += Math.min(2.6, 1.1 + markerScale * .45);
        transform.rotation.set(0, 0, 0);
        transform.scale.setScalar(markerScale);
        transform.updateMatrix();
        bodies.setMatrixAt(bodyCount, transform.matrix);
        bodies.setColorAt(bodyCount++, colors[row.team]);
        if (row.angle !== null) {
          transform.rotation.set(0, -row.angle, Math.max(-75, Math.min(75, row.pitch ?? 0)) * headingRadians, "YXZ");
          transform.updateMatrix();
          arrows.setMatrixAt(arrowCount, transform.matrix);
          arrows.setColorAt(arrowCount++, colors[row.team]);
        }
      }
      projected.copy(row.position);
      projected.y += hasModel ? 1.2 : 5.1;
      projected.project(camera);
      const inView = cameraDistance < 600 &&
        Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && Math.abs(projected.z) < 1;
      row.label.hidden = !inView;
      if (inView) row.label.style.transform = `translate(${(projected.x + 1) * size.width / 2}px,${(1 - projected.y) * size.height / 2}px) translate(-50%,-100%)`;
    }
    for (const [mesh, count, previous] of [[bodies, bodyCount, previousBodies], [arrows, arrowCount, previousArrows]]) {
      mesh.count = count;
      if (!count && !previous) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    previousBodies = bodyCount;
    previousArrows = arrowCount;
    if (animating || soldiers.hasIdleAnimation()) invalidate();
  }

  return {
    ingest, advance, render,
    get(id) { return rows.get(id); },
    roster() {
      return [...rows.entries()].map(([id, { name, team, seatKind }]) => ({ id, name, team, seatKind }));
    },
    modelState: soldiers.modelState,
    toggle(enabled) {
      visible = root.visible = enabled;
      labelLayer.hidden = !enabled;
      if (!enabled) soldiers.clear();
      invalidate();
    },
    dispose() {
      clear();
      soldiers.dispose();
      root.removeFromParent();
      bodies.dispose();
      arrows.dispose();
      bodyShape.dispose();
      arrowShape.dispose();
      material.dispose();
    },
  };
}
