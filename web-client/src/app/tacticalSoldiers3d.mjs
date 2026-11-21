import { AnimationClip, AnimationMixer, Euler, Frustum, LoopOnce, MathUtils, Matrix4, Object3D, Quaternion, Sphere, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { loadTacticalEmbeddedImages } from "./tacticalEmbeddedImages.mjs";
import { scenePriority } from "./tacticalFrameBudget.mjs";

const animationUrl = "/assets/infantry/locomotion-v4.glb";
const factionModelRoot = "/assets/infantry/factions/";
// Keep soldier meshes visible at tactical zoom. The per-frame model cap and
// adaptive pressure limit still bound skinning cost when many players are near.
const modelRange = 500;
const maxModels = 24;
const capsuleHalfHeight = 0.9;
const retriesAfterFailureMs = 4000;
const factionAliases = [
  ["PLANMC", ["PLANMC"]],
  ["USMC", ["USMC"]],
  ["WPMC", ["WPMC"]],
  ["AFU", ["AFU", "UKR"]],
  ["AU", ["AU", "ADF", "AUS"]],
  ["CRF", ["CRF"]],
  ["CAF", ["CAF"]],
  ["GFI", ["GFI"]],
  ["Gb", ["BAF", "GBR", "UK", "GB"]],
  ["Ins", ["INSURGENT", "INSURGENCY", "INS"]],
  ["Mil", ["IMF", "MIL"]],
  ["PLA", ["PLAAGF", "PLA"]],
  ["Ru", ["RUS", "RGF", "RU"]],
  ["TLF", ["TLF"]],
  ["Usa", ["USARMY", "USA"]],
  ["VDV", ["VDV"]],
].flatMap(([family, aliases]) => aliases.map(alias => [alias, family]))
  .sort((left, right) => right[0].length - left[0].length);
const weaponPoseBone = /^Bip01_(?:[LR]_(?:Clavicle|UpperArm|Forearm|Hand|Finger\d+(?:Nub)?|ForeTwist\d*)|IK_Weapon(?:_.*)?|IK_(?:Hand_Root|[LR]_Hand)|Weapon\d+)$/i;

export function resolveSoldierFamily(player) {
  for (const value of [player?.pawnClass, player?.role, player?.factionId, player?.faction]) {
    const text = String(value ?? "").toUpperCase();
    for (const [alias, family] of factionAliases) {
      if (new RegExp(`(?:^|[^A-Z0-9])${alias}(?:[^A-Z0-9]|$)`).test(text)) return family;
    }
  }
  return null;
}

export function resolveWeaponCategory(player) {
  // A player's role stays the same when they switch to a sidearm or equipment.
  const text = `${player?.weaponClass ?? ""} ${player?.weaponMesh ?? ""}`.toLowerCase();
  if (/grenade|smoke|m67|m18|rgd5|f1_gr|dsf161|type86p/.test(text) && !/launcher|ugl|m203|gp25/.test(text)) return "throwable";
  if (/shovel|binocular|repair|wrench|knife|rangefinder/.test(text)) return "tool";
  if (/pistol|mp443|qsz.?92|m17|m9\b|m1911|p226|glock|beretta|mk23/.test(text)) return "pistol";
  if (/rocket|launcher|carl.?gustaf|rpg|at4|\blaw\b|rgw90|m72|dzj/.test(text)) return "launcher";
  if (/shotgun|sawnoff|870/.test(text)) return "shotgun";
  if (/medic.?bag|medkit|first.?aid|bandage|dressing|_medic_|\bmedic\b/.test(text)) return "medic";
  if (/sks/.test(text)) return "sks";
  if (/sniper|marksman|dmr|long.?rifle|m110|svd|l129|m14|m38|qbu/.test(text)) return "longrifle";
  if (/machine.?gun|m249|m240|m2[_\W]|pkm|rpk|mg3|mg4|qjb201|lmg|hmg|saaw|_mg_|_gpmg_/.test(text)) return "heavy";
  return "rifle";
}

function upperBodyTrack(track) {
  const match = /^([^.]+)\.(?:quaternion|position|scale)$/i.exec(track.name);
  return Boolean(match && weaponPoseBone.test(match[1]));
}

function lowerBodyClip(source, name) {
  return new AnimationClip(name, source.duration, source.tracks.filter(track => !upperBodyTrack(track)));
}

function sampledUpperBodyPose(source, name, seconds) {
  const time = Math.min(source.duration, Math.max(0, seconds));
  const tracks = source.tracks.filter(track => {
    const match = /^([^.]+)\.(?:quaternion|position|scale)$/i.exec(track.name);
    return Boolean(match && weaponPoseBone.test(match[1]));
  }).map(track => {
    const pose = track.createInterpolant().evaluate(time);
    return new track.constructor(track.name, [0], pose);
  });
  return new AnimationClip(name, 1, tracks);
}

function stationaryRoot(clip) {
  const track = clip.tracks.find(track => /^root\.position$/i.test(track.name));
  if (track) for (let i = 3; i < track.values.length; i += 3) {
    track.values[i] = track.values[0];
    track.values[i + 2] = track.values[2];
  }
  return clip.optimize();
}

function prepareWorldLitMaterials(template) {
  const materials = new Set();
  template.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!material?.isMaterial || materials.has(material)) continue;
      materials.add(material);
      if (material.emissive) {
        // Keep soldiers under the same scene lighting and tone mapping as the map.
        // An emissive lift made them look like flat, self-lit cutouts.
        material.emissive.setRGB(0, 0, 0);
        material.emissiveIntensity = 1;
      }
      if (typeof material.roughness === "number") material.roughness = Math.max(material.roughness, 0.86);
      if (typeof material.metalness === "number") material.metalness = 0;
      if (material.emissive || "roughness" in material || "metalness" in material) {
        material.needsUpdate = true;
      }
    }
  });
}

function freeTemplate(template) {
  const resources = new Set();
  const bitmaps = new Set();
  template.traverse(node => {
    if (node.skeleton) resources.add(node.skeleton);
    if (!node.isMesh) return;
    resources.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      resources.add(material);
      for (const texture of Object.values(material)) {
        if (!texture?.isTexture) continue;
        resources.add(texture);
        if (texture.source?.data?.close) bitmaps.add(texture.source.data);
      }
    }
  });
  for (const item of resources) item.dispose();
  for (const bitmap of bitmaps) bitmap.close();
}

function validTriple(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function setUnrealRelative(object, position, rotation, scale) {
  const [x, y, z] = validTriple(position) ? position : [0, 0, 0];
  const [pitch, yaw, roll] = validTriple(rotation) ? rotation : [0, 0, 0];
  object.position.set(x / 100, z / 100, y / 100);
  object.quaternion.setFromEuler(new Euler(
    roll * MathUtils.DEG2RAD, -yaw * MathUtils.DEG2RAD, pitch * MathUtils.DEG2RAD, "YZX",
  ));
  if (validTriple(scale) && scale.every(value => Math.abs(value) >= .01 && Math.abs(value) <= 20)) {
    object.scale.set(scale[0], scale[2], scale[1]);
  }
  else object.scale.setScalar(1);
}

export function createSoldierModels(root, assetCache, invalidate, models, budget, preview) {
  const controller = new AbortController();
  const { signal } = controller;
  const active = new Map();
  const templates = new Map();
  const pools = new Map();
  const loading = new Map();
  const retryAt = new Map();
  const modelErrors = new Set();
  const frustum = new Frustum();
  const viewProjection = new Matrix4();
  const envelope = new Sphere(new Vector3(), 1.25);
  const aimAxis = new Vector3();
  const orientation = new Quaternion();
  const aimRotation = new Quaternion();
  let clips;
  let clipsLoading;
  let clipsRetryAt = 0, clipsFailed = false, viewCount = 0;
  let retryTimer, scheduledRetry = Infinity;
  let previousFrame = 0;

  function wakeForRetry(at) {
    if (at >= scheduledRetry) return;
    window.clearTimeout(retryTimer);
    scheduledRetry = at;
    retryTimer = window.setTimeout(() => {
      scheduledRetry = Infinity;
      invalidate();
    }, Math.max(1, at - performance.now() + 8));
  }

  function readSdkAsset(url, revision, reload) {
    const request = typeof AbortSignal.any === "function" && typeof AbortSignal.timeout === "function" ?
      AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : signal;
    return assetCache.get(url, request, revision, { reload });
  }

  function ensureClips(now) {
    if (clips || clipsLoading) return;
    if (now < clipsRetryAt) {
      wakeForRetry(clipsRetryAt);
      return;
    }
    clipsLoading = (async () => {
      const buffer = await readSdkAsset(animationUrl, "locomotion-v4", clipsFailed);
      const loader = new GLTFLoader();
      const result = await budget.enqueue(scenePriority.soldier, () => loader.parseAsync(buffer, ""), signal);
      const find = name => result.animations.find(clip => clip.name === name);
      const idle = find("Idle Standing Rifle");
      const walk = find("Walk Forward Rifle");
      const run = find("Run Forward Rifle");
      const stances = {
        crouchedIdle: find("Idle Crouched Rifle"),
        crouchedWalk: find("Walk Crouched Rifle"),
        proneIdle: find("Idle Prone Rifle"),
        proneWalk: find("Crawl Prone Rifle"),
        sprint: find("Sprint Standing Rifle"),
        jump: find("Jump Start Rifle"),
        land: find("Jump Land Rifle"),
        strafeLeft: find("Walk Left Rifle"),
        strafeRight: find("Walk Right Rifle"),
      };
      const poseSources = {
        heavy: find("Pose Heavy"),
        longrifle: find("Pose Long Rifle"),
        medic: find("Pose Medic Bag"),
        pistol: find("Pose Pistol"),
        launcher: find("Pose Rocket Launcher"),
        shotgun: find("Pose Shotgun"),
        sks: find("Pose SKS"),
      };
      if (!idle || !walk || !run || [...Object.values(poseSources), ...Object.values(stances)].some(clip => !clip)) {
        throw new Error("Idle, locomotion, or weapon stance clips are missing.");
      }
      const locomotion = { idle, walk, run, ...stances };
      clips = {
        ...Object.fromEntries(Object.entries(locomotion).flatMap(([key, clip]) => [
          [key, stationaryRoot(clip)], [`${key}Body`, lowerBodyClip(clip, `${key} body`)],
        ])),
        "pose:rifleAim": sampledUpperBodyPose(idle, "Standing rifle aim", .42),
        "pose:crouchedAim": sampledUpperBodyPose(stances.crouchedIdle, "Crouched rifle aim", .42),
        "pose:proneAim": sampledUpperBodyPose(stances.proneIdle, "Prone rifle aim", .42),
        ...Object.fromEntries(Object.entries(poseSources).map(([category, clip]) => [
          `pose:${category}`, sampledUpperBodyPose(clip, `Pose ${category}`, 0.42),
        ])),
      };
      clipsFailed = false;
    })().catch(error => {
      if (signal.aborted) return;
      if (!clipsFailed) console.warn("BZSS 3D soldier animations", error);
      clipsFailed = true;
      clipsRetryAt = performance.now() + retriesAfterFailureMs;
      wakeForRetry(clipsRetryAt);
    }).finally(() => {
      clipsLoading = null;
      if (!signal.aborted) invalidate();
    });
  }

  async function loadFamily(family) {
    const loader = new GLTFLoader().register(loadTacticalEmbeddedImages);
    try {
      const modelUrl = `${factionModelRoot}${family.toLowerCase()}-v2.glb`;
      const buffer = await readSdkAsset(modelUrl, "faction-model-v2", modelErrors.has(family));
      signal.throwIfAborted();
      const result = await budget.enqueue(scenePriority.soldier, () => loader.parseAsync(buffer, ""), signal);
      if (signal.aborted) {
        freeTemplate(result.scene);
        return;
      }
      prepareWorldLitMaterials(result.scene);
      templates.set(family, result.scene);
      modelErrors.delete(family);
      invalidate();
    } catch (error) {
      if (signal.aborted) return;
      if (!modelErrors.has(family)) console.warn(`BZSS 3D soldier model (${family})`, error);
      modelErrors.add(family);
      const at = performance.now() + retriesAfterFailureMs;
      retryAt.set(family, at);
      wakeForRetry(at);
      invalidate();
    } finally {
      loading.delete(family);
    }
  }

  function ensureLoaded(family, now) {
    if (templates.has(family) || loading.has(family)) return;
    const at = retryAt.get(family) ?? 0;
    if (now < at) wakeForRetry(at);
    else loading.set(family, loadFamily(family));
  }

  function acquire(family) {
    const familyPool = pools.get(family);
    const recycled = familyPool?.pop();
    if (recycled) {
      root.add(recycled.pivot);
      return recycled;
    }
    const pivot = new Object3D();
    const model = clone(templates.get(family));
    const mixer = new AnimationMixer(model);
    const skeletons = new Map();
    model.traverse(node => {
      if (!node.isSkinnedMesh) return;
      node.frustumCulled = false;
      const skeleton = skeletons.get(node.skeleton.boneInverses);
      if (skeleton) node.skeleton = skeleton;
      else skeletons.set(node.skeleton.boneInverses, node.skeleton);
    });
    pivot.add(model);
    const weapon = { socket: new Object3D(), anchor: new Object3D(), mountKey: null, fallback: null };
    weapon.socket.add(weapon.anchor);
    root.add(pivot);
    const chest = model.getObjectByName("Bip01_Spine2");
    return {
      family, model, pivot, mixer, actions: {}, skeletons, chest, weapon, head: model.getObjectByName("Bip01_Head"),
      throwingArm: model.getObjectByName("Bip01_R_UpperArm"),
      movementState: null, baseKey: null, poseKey: null, settleAt: 0, unpitchedChest: null,
    };
  }

  function release(row, avatar) {
    avatar.pivot.removeFromParent();
    models.release(avatar.weapon);
    avatar.weapon.fallback?.removeFromParent();
    avatar.weapon.fallback = null;
    avatar.weapon.mountKey = null;
    if (avatar.unpitchedChest) avatar.chest.quaternion.copy(avatar.unpitchedChest);
    if (avatar.unpitchedHead) avatar.head.quaternion.copy(avatar.unpitchedHead);
    if (avatar.unposedArm) avatar.throwingArm.quaternion.copy(avatar.unposedArm);
    avatar.unpitchedChest = null;
    avatar.unpitchedHead = null;
    avatar.unposedArm = null;
    avatar.throwAmount = 0;
    avatar.mixer.stopAllAction();
    avatar.movementState = null;
    avatar.baseKey = null;
    avatar.poseKey = null;
    avatar.height = null;
    avatar.landUntil = 0;
    avatar.lean = avatar.aim = avatar.velocity = undefined;
    active.delete(row);
    let familyPool = pools.get(avatar.family);
    if (!familyPool) pools.set(avatar.family, familyPool = []);
    familyPool.push(avatar);
  }

  function clear() {
    for (const [row, avatar] of active) release(row, avatar);
    previousFrame = 0;
    viewCount = 0;
  }

  function updateAvatar(avatar, row, now, delta) {
    // Use the SDK mesh in its bind pose while the shared animation file is unavailable.
    if (clips && !avatar.animated) {
      avatar.actions = Object.fromEntries(Object.entries(clips).map(([key, clip]) => [key, avatar.mixer.clipAction(clip)]));
      for (const phase of ["jump", "land", "jumpBody", "landBody"]) {
        avatar.actions[phase].setLoop(LoopOnce, 1);
        avatar.actions[phase].clampWhenFinished = true;
      }
      avatar.animated = true;
      avatar.baseKey = avatar.poseKey = avatar.movementState = null;
    }
    avatar.pivot.position.copy(row.position);
    const stance = row.stance ?? "standing";
    const defaultHeight = stance === "prone" ? .34 : stance === "crouched" ? .62 : capsuleHalfHeight;
    const footOffset = row.capsuleHalfHeight ?? defaultHeight;
    avatar.height = MathUtils.damp(avatar.height ?? footOffset, footOffset, 20, delta);
    avatar.pivot.position.y -= avatar.height;
    avatar.pivot.rotation.y = -(row.angle ?? row.travelAngle ?? 0);

    const speed = avatar.velocity = MathUtils.damp(avatar.velocity ?? row.speed, row.speed, 11, delta);
    const moving = speed >= (avatar.movementState === "idle" ? 0.23 : 0.13);
    const running = stance === "standing" && speed >= (avatar.movementState === "run" ? 2.65 : 3.2);
    const aim = avatar.aim = MathUtils.damp(avatar.aim ?? 0, row.aiming ? 1 : 0, 14, delta);
    const lean = avatar.lean = MathUtils.damp(avatar.lean ?? 0, row.lean, 12, delta);
    const relativeTravel = row.travelAngle != null && row.angle != null ? row.travelAngle - row.angle : 0;
    const lateral = Math.sin(relativeTravel);
    const wasStrafing = avatar.movementState === "strafeLeft" || avatar.movementState === "strafeRight";
    const strafing = stance === "standing" && Math.abs(lateral) > (wasStrafing ? .62 : .77);
    if (!row.airborne && avatar.movementState === "jump") avatar.landUntil = now + 250;
    let state = !moving ? "idle" : row.sprinting && stance === "standing" ? "sprint" :
      strafing ? (lateral > 0 ? "strafeRight" : "strafeLeft") : running ? "run" : "walk";
    if (row.airborne) state = "jump";
    else if (now < (avatar.landUntil ?? 0)) state = "land";
    const weaponCategory = row.weaponCategory ?? "rifle";
    const airborne = state === "jump" || state === "land";
    const held = Boolean(row.weaponMesh || row.weaponClass);
    const locomotionKey = airborne || stance === "standing" ? state : `${stance}${moving ? "Walk" : "Idle"}`;
    const gripPose = weaponCategory === "throwable" || weaponCategory === "tool" ? "pistol" : weaponCategory;
    const aimPose = stance === "standing" ? "rifleAim" : `${stance}Aim`;
    let poseKey = null;
    if (held && clips) {
      if (clips[`pose:${gripPose}`]) poseKey = `pose:${gripPose}`;
      else if (row.aiming && state !== "sprint" && !airborne) poseKey = `pose:${aimPose}`;
    }
    const baseKey = poseKey ? `${locomotionKey}Body` : locomotionKey;

    function transition(slot, nextKey, randomStart = false) {
      if (avatar[slot] === nextKey) return nextKey ? avatar.actions[nextKey] : null;
      const previous = avatar[slot] ? avatar.actions[avatar[slot]] : null;
      const next = nextKey ? avatar.actions[nextKey] : null;
      if (next) {
        next.reset();
        if (randomStart && next.getClip().duration > 0) {
          const previousDuration = previous?.getClip().duration;
          const phase = previousDuration && avatar.movementState !== "idle" && state !== "idle" ?
            previous.time / previousDuration : Math.random();
          next.time = phase * next.getClip().duration;
        }
        next.setEffectiveWeight(1).play();
        if (previous || (slot === "poseKey" && avatar.movementState)) next.fadeIn(.18);
      }
      previous?.fadeOut(0.2);
      avatar[slot] = nextKey;
      avatar.settleAt = now + 240;
      return next;
    }

    const baseAction = transition("baseKey", baseKey, !airborne);
    const poseAction = transition("poseKey", poseKey);
    avatar.movementState = state;
    const pace = stance === "prone" ? .8 : stance === "crouched" ? 1.2 :
      state === "sprint" ? 5.5 : state === "run" ? 4.3 : 1.45;
    const backwards = !strafing && Math.cos(relativeTravel) < -.55;
    baseAction?.setEffectiveTimeScale(airborne || state === "idle" ? 1 :
      MathUtils.clamp(speed / pace, .22, 2.1) * (backwards ? -1 : 1));
    poseAction?.setEffectiveTimeScale(0);
    if (avatar.unpitchedChest) avatar.chest.quaternion.copy(avatar.unpitchedChest);
    if (avatar.unpitchedHead) avatar.head.quaternion.copy(avatar.unpitchedHead);
    if (avatar.unposedArm) avatar.throwingArm.quaternion.copy(avatar.unposedArm);
    avatar.unpitchedChest = null;
    avatar.unpitchedHead = null;
    avatar.unposedArm = null;
    avatar.mixer.update(delta);
    const { chest, head, weapon, pivot } = avatar;
    const shotAge = Math.max(0, now - (row.shotAt ?? -Infinity));
    const recoil = shotAge < 160 ? 4.6 * Math.sin(Math.PI * Math.min(1, shotAge / 160) ** .4) : 0;
    const aimPitch = MathUtils.clamp(row.pitch ?? 0, -65, 65) * MathUtils.DEG2RAD;
    const pitch = aimPitch * (state === "sprint" ? .13 : .24 + aim * .57) + recoil * MathUtils.DEG2RAD;
    function tilt(bone, x, z, angle) {
      if (!angle || !bone?.parent) return;
      pivot.getWorldQuaternion(orientation);
      aimAxis.set(x, 0, z).applyQuaternion(orientation);
      bone.parent.getWorldQuaternion(orientation).invert();
      aimAxis.applyQuaternion(orientation).normalize();
      bone.quaternion.premultiply(aimRotation.setFromAxisAngle(aimAxis, angle));
    }
    if (chest?.parent && (pitch || Math.abs(lean) > .01)) {
      avatar.unpitchedChest = chest.quaternion.clone();
      tilt(chest, 0, 1, pitch * (stance === "prone" ? .52 : 1));
      tilt(chest, 1, 0, lean * .23);
    }
    if (head?.parent && aim > .01) {
      avatar.unpitchedHead = head.quaternion.clone();
      tilt(head, 1, 0, aim * .18);
    }
    const throwAmount = avatar.throwAmount = MathUtils.damp(avatar.throwAmount ?? 0, row.throwing ? 1 : 0, 16, delta);
    if (avatar.throwingArm && throwAmount > .01) {
      avatar.unposedArm = avatar.throwingArm.quaternion.clone();
      tilt(avatar.throwingArm, 0, 1, 1.25 * throwAmount);
    }
    const mount = row.weaponMount;
    const defaultBone = weaponCategory === "throwable" ? "Bip01_R_Hand" : "Bip01_Weapon1";
    const mountKey = `${row.weaponId ?? ""}:${row.mountRevision ?? ""}:${defaultBone}`;
    if (weapon.mountKey !== mountKey) {
      weapon.mountKey = mountKey;
      const bone = avatar.model.getObjectByName(mount?.bone ?? defaultBone) ?? avatar.model.getObjectByName(defaultBone);
      if (bone) {
        bone.add(weapon.socket);
        setUnrealRelative(weapon.socket, mount?.position, mount?.rotation, mount?.scale);
        setUnrealRelative(weapon.anchor, mount?.relativePosition, mount?.relativeRotation, mount?.relativeScale);
      } else {
        weapon.socket.removeFromParent();
      }
    }
    const holding = Boolean(!row.itemReleased && (row.weaponMesh || row.weaponClass) && weapon.socket.parent);
    const attached = models.attach(weapon, holding ? models.file("weapon", row.weaponMesh, row.weaponClass) : null, "weapon");
    const category = holding && !attached && weaponCategory !== "throwable" ? weaponCategory : null;
    if (weapon.fallbackCategory !== category || (category && !weapon.fallback)) {
      weapon.fallback?.removeFromParent();
      weapon.fallback = category ? preview.item(category) : null;
      weapon.fallbackCategory = category;
      if (weapon.fallback) {
        // The SDK weapon socket faces -X after conversion from Unreal.
        weapon.fallback.rotation.y = Math.PI;
        weapon.anchor.add(weapon.fallback);
      }
    }
    return state !== "idle" || now < avatar.settleAt || throwAmount > .01;
  }

  function update(now, camera, rows, pressure = 0) {
    const delta = previousFrame ? Math.min((now - previousFrame) / 1000, 0.1) : 0;
    previousFrame = now;
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const candidates = [];
    for (const row of rows.values()) {
      if (!row.infantry) continue;
      if (row.demo && row.modelFamily) ensureLoaded(row.modelFamily, now);
      const distance = camera.position.distanceToSquared(row.position);
      const range = modelRange * [1, 1, .9, .8][pressure];
      if (distance > range * range) continue;
      envelope.center.copy(row.position);
      if (!frustum.intersectsSphere(envelope)) continue;
      candidates.push({ row, distance, family: row.modelFamily });
      if (row.modelFamily) ensureLoaded(row.modelFamily, now);
    }
    viewCount = candidates.length;
    if (candidates.some(item => item.family)) ensureClips(now);
    const selected = new Map(candidates.filter(item => item.family).sort((left, right) => left.distance - right.distance)
      .slice(0, maxModels - pressure * 3).map(item => [item.row, item]));
    for (const [row, avatar] of active) {
      const next = selected.get(row);
      if (!next || next.family !== avatar.family) release(row, avatar);
    }
    let animating = false;
    let created = false;
    for (const [row, item] of selected) {
      const incoming = row.history.at(-1);
      if (incoming && !incoming.itemReleased && (incoming.weaponMesh || incoming.weaponClass)) {
        models.preload(incoming.weaponMesh, "weapon", incoming.weaponClass);
      }
      let avatar = active.get(row);
      if (!avatar && !created && templates.has(item.family)) {
        active.set(row, avatar = acquire(item.family));
        created = true;
      }
      if (avatar) animating = updateAvatar(avatar, row, now, delta) || animating;
      else animating ||= templates.has(item.family);
    }
    return animating;
  }

  return {
    update,
    clear,
    hasModel: row => active.has(row),
    modelState: () => ({
      visible: active.size, inView: viewCount, pending: loading.size, failures: modelErrors.size,
      animation: clips ? "ready" : clipsFailed ? "retry" : "loading",
    }),
    hasIdleAnimation: () => Boolean(clips) && [...active.values()].some(avatar => avatar.movementState === "idle"),
    dispose() {
      controller.abort();
      window.clearTimeout(retryTimer);
      clear();
      for (const familyPool of pools.values()) {
        for (const avatar of familyPool) {
          avatar.mixer.uncacheRoot(avatar.mixer.getRoot());
          for (const skeleton of avatar.skeletons.values()) skeleton.dispose();
        }
      }
      pools.clear();
      for (const template of templates.values()) freeTemplate(template);
      templates.clear();
    },
  };
}
