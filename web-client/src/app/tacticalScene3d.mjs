import {
  Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer,
  SRGBColorSpace, ACESFilmicToneMapping,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { captureVolumeOverlay } from "./tacticalCaptureVolumes3d.mjs";
import { openTerrainStream } from "./tacticalTerrainStream.mjs";
import { createBuildingStream } from "./tacticalBuildingStream.mjs";
import { batchStaticObjects, foliageName } from "./tacticalStaticBatches.mjs";
import { collectLodDisposables, objectLodController, prepareObjectLod } from "./tacticalObjectLod.mjs";
import { installFrameMeter, installViewportFlight, setImmersiveViewport } from "./tacticalViewportControls.mjs";
import { installFixedLighting } from "./tacticalFixedLighting.mjs";
import { installBuildingSettings } from "./tacticalBuildingSettings.mjs";
import { installWarmView } from "./tacticalWarmView.mjs";
import { repairBuildingMaterials } from "./tacticalBuildingMaterials.mjs";
import { loadTacticalEmbeddedImages } from "./tacticalEmbeddedImages.mjs";
import { createSceneAssetCache } from "./tacticalSceneCache.mjs";
import { createLivePlayerLayer } from "./tacticalPlayers3d.mjs";
import { createLiveActorLayer, createLiveModelCache } from "./tacticalLiveModels3d.mjs";
import { createFrameBudget, scenePriority } from "./tacticalFrameBudget.mjs";
import { createCombatEffects } from "./tacticalCombatEffects3d.mjs";
import { createPreviewModels } from "./tacticalPreviewModels.mjs";
import { createPreviewGround, createRoundPreview } from "./tacticalRoundPreview.mjs";
import { createSnapshotClock } from "./tacticalSnapshotMotion.mjs";

const mapTitles = {
  logar: "洛迦尔山谷", anvil: "Anvil", jensens: "Jensen 训练场", sumari: "Sumari",
  basrah: "巴士拉", belaya: "Belaya Pass", chora: "Chora", fallujah: "Fallujah",
  foolsroad: "Fools Road", goosebay: "Goose Bay", gorodok: "Gorodok", kamdesh: "Kamdesh",
  kohat: "Kohat", kokan: "Kokan", lashkar: "Lashkar Valley", manicouagan: "Manicouagan",
  mestia: "Mestia", mutaha: "Mutaha", narva: "Narva", skorpo: "Skorpo", tallil: "Tallil",
  yehorivka: "Yehorivka", forest: "Forest", ppg: "Pacific Proving Grounds",
};
const visibleViews = new WeakMap();

function sceneKey(name) {
  const value = String(name ?? "");
  if (/^(?:al[_\s-]?)?basrah(?:_|\b)/i.test(value)) return "basrah";
  if (/^belaya(?:_|\b)/i.test(value)) return "belaya";
  if (/^chora(?:_|\b)/i.test(value)) return "chora";
  if (/^fallujah(?:_|\b)/i.test(value)) return "fallujah";
  if (/^fools[_\s-]?road(?:_|\b)/i.test(value)) return "foolsroad";
  if (/^goose[_\s-]?bay(?:_|\b)/i.test(value)) return "goosebay";
  if (/^gorodok(?:_|\b)/i.test(value)) return "gorodok";
  if (/^kamdesh(?:_|\b)/i.test(value)) return "kamdesh";
  if (/^kohat(?:_|\b)/i.test(value)) return "kohat";
  if (/^kokan(?:_|\b)/i.test(value)) return "kokan";
  if (/^lashkar(?:_|\b)/i.test(value)) return "lashkar";
  if (/^manicouagan(?:_|\b)/i.test(value)) return "manicouagan";
  if (/^mestia(?:_|\b)/i.test(value)) return "mestia";
  if (/^mutaha(?:_|\b)/i.test(value)) return "mutaha";
  if (/^narva(?:_|\b)/i.test(value)) return "narva";
  if (/^skorpo(?:_|\b)/i.test(value)) return "skorpo";
  if (/^tallil(?:_|\b)/i.test(value)) return "tallil";
  if (/^yehorivka(?:_|\b)/i.test(value)) return "yehorivka";
  if (/^forest(?:_|\b)/i.test(value)) return "forest";
  if (/^(?:pacificprovinggrounds|ppg)(?:_|\b)/i.test(value)) return "ppg";
  if (/^anvil(?:_|\b)/i.test(value)) return "anvil";
  if (/^jensens?(?:_|\b)/i.test(value)) return "jensens";
  if (/^logar(?:_|\b)|洛迦尔/i.test(value)) return "logar";
  if (/^sumari(?:_|\b)/i.test(value)) return "sumari";
  return null;
}

const panelCss = `
  .tactical-map-layout.tactical-3d-active{grid-template-columns:minmax(0,1fr)}
  .tactical-map-layout.tactical-3d-active>.tactical-sidebar{display:none}
  .tactical-map-layout.tactical-3d-active .map-debug-hud{display:none}
  .tactical-scene-3d{position:absolute;inset:0;z-index:110;isolation:isolate;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:#101b24;color:#ebf4f7;cursor:default}
  .tactical-scene-3d__bar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;background:#101c26;border-bottom:1px solid #36525e;flex-wrap:wrap}
  .tactical-scene-3d__identity{display:flex;align-items:center;gap:8px;min-width:0;white-space:nowrap;font-size:13px}
  .tactical-scene-3d__identity strong{color:#c7f3f5;font-size:14px}
  .tactical-scene-3d__identity select{max-width:150px;padding:6px;color:#e9f7fa;background:#162d3a;border:1px solid #497583;border-radius:6px;font:inherit}
  .tactical-scene-3d__mode{color:#a6bfcb;font-size:11px}
  .tactical-scene-3d__actions{display:flex;gap:6px;flex-wrap:wrap}
  .tactical-scene-3d__actions button{padding:6px 9px;border:1px solid #497583;border-radius:6px;background:#162d3a;color:#f3fbff;font:inherit;font-size:12px;cursor:pointer}
  .tactical-scene-3d__actions select{padding:6px;border:1px solid #497583;border-radius:6px;background:#162d3a;color:#f3fbff;font:inherit;font-size:12px;cursor:pointer}
  .tactical-scene-3d__actions button:disabled{opacity:.5;cursor:default}
  .tactical-scene-3d__actions button[aria-pressed="true"]{background:#245366}
  .tactical-scene-3d__actions .tactical-scene-3d__back{background:#d1f3f4;color:#132c3a;border-color:#d1f3f4;font-weight:700}
  .tactical-scene-3d__stage{position:relative;min-height:0;overflow:hidden}
  .tactical-scene-3d__stage canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}
  .tactical-scene-3d__stage canvas:active{cursor:grabbing}
  .tactical-scene-3d__labels{position:absolute;inset:0;overflow:hidden;pointer-events:none}
  .tactical-scene-3d__labels span{position:absolute;top:0;left:0;white-space:nowrap;color:#eaffff;background:#0b2434e8;border:1px solid #498b9d;padding:2px 5px;border-radius:4px;font-size:11px}
  .tactical-scene-3d__player-labels span{background:#09131fdd;border-color:#506680}
  .tactical-scene-3d__player-labels span[data-team="1"]{border-color:#47d9ff}
  .tactical-scene-3d__player-labels span[data-team="2"]{border-color:#ff786c}
  .tactical-scene-3d__player-labels span[data-activity="aim"]{color:#ffe8a3}
  .tactical-scene-3d__player-labels span[data-activity="fire"]{color:#ffb482;background:#34180fee}
  .tactical-scene-3d__footer{min-height:32px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 12px;background:#101c26;border-top:1px solid #36525e;color:#aec5ce;font-size:11px}
  .tactical-scene-3d__status[data-error="true"]{color:#ffd2a2}
`;

function append(parent, tag, className, content) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (content) item.textContent = content;
  return parent.appendChild(item);
}

function guardPointerCapture(element) {
  const setPointerCapture = element.setPointerCapture;
  if (typeof setPointerCapture !== "function") return;

  element.setPointerCapture = pointerId => {
    try {
      setPointerCapture.call(element, pointerId);
    } catch (error) {
      if (error?.name !== "InvalidStateError") throw error;
    }
  };
}

function freeModels(models) {
  const disposable = new Set();
  const bitmaps = new Set();
  for (const model of models) {
    model.traverse(node => {
      if (node.geometry) collectLodDisposables(node.geometry, disposable);
      if (node.isInstancedMesh) disposable.add(node);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!material) continue;
        disposable.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) {
            disposable.add(value);
            if (value.source?.data?.close) bitmaps.add(value.source.data);
          }
        }
      }
    });
  }
  for (const item of disposable) item.dispose();
  for (const bitmap of bitmaps) bitmap.close();
}

export function mountTacticalScene3d(viewport, { liveMap = "", getFeed = () => null, opener, onBack } = {}) {
  const existing = visibleViews.get(viewport);
  if (existing?.resume({ liveMap, getFeed, opener })) return existing.cleanup;

  const standalone = typeof onBack === "function";
  const assetCache = createSceneAssetCache();
  const panel = append(viewport, "section", "tactical-scene-3d");
  const layout = viewport.closest(".tactical-map-layout");
  panel.setAttribute("aria-label", "3D 战术地图");
  append(panel, "style", "", panelCss);
  const header = append(panel, "header", "tactical-scene-3d__bar");
  const identity = append(header, "div", "tactical-scene-3d__identity");
  const picker = append(identity, "select", "");
  picker.setAttribute("aria-label", "3D 地图选择");
  for (const [value, name] of [["auto", "跟随对局"], ["preview", "演示对局"], ...Object.entries(mapTitles)]) {
    append(picker, "option", "", name).value = value;
  }
  const mapName = append(identity, "strong", "");
  const mode = append(identity, "span", "tactical-scene-3d__mode");
  const actions = append(header, "div", "tactical-scene-3d__actions");
  const overview = append(actions, "button", "", "重置视角");
  const trees = append(actions, "button", "", "植被");
  const mapTexture = append(actions, "button", "", "地图贴图");
  const zones = append(actions, "button", "", "占领区");
  const fly = append(actions, "button", "", "进入飞行视图");
  const light = append(actions, "button", "", "光影");
  const detail = append(actions, "button", "", "细节：自动");
  const distance = append(actions, "select", "");
  const fps = append(actions, "button", "", "FPS —");
  const players = append(actions, "button", "", "玩家");
  const vehicles = append(actions, "button", "", "载具");
  const deployables = append(actions, "button", "", "部署物");
  const effects = append(actions, "button", "", "弹道与烟雾");
  effects.type = "button";
  effects.title = "枪线与投掷轨迹保留约 3 秒";
  effects.setAttribute("aria-pressed", "true");
  const liveButtons = [[players, "玩家", "player"], [vehicles, "载具", "vehicle"], [deployables, "部署物", "deployable"]];
  for (const [button] of liveButtons) {
    button.setAttribute("aria-pressed", "true");
  }
  const focusPicker = append(actions, "select", "");
  focusPicker.setAttribute("aria-label", "跟随玩家");
  append(focusPicker, "option", "", "跟随玩家").value = "";
  focusPicker.disabled = true;
  const pausePreview = append(actions, "button", "", "暂停演示");
  const restartPreview = append(actions, "button", "", "重开演示");
  const previewRate = append(actions, "select", "");
  previewRate.setAttribute("aria-label", "演示速度");
  for (const value of [.5, 1, 2]) append(previewRate, "option", "", `${value}×`).value = String(value);
  previewRate.value = "1";
  const previewControls = [pausePreview, restartPreview, previewRate];
  for (const control of previewControls) control.hidden = true;
  const clearCache = standalone ? append(actions, "button", "", "清除地图缓存") : null;
  if (clearCache) {
    clearCache.title = "清除当前浏览器存储的地形、贴图和建筑文件";
    clearCache.disabled = !assetCache.stats.available;
  }
  const back = append(actions, "button", "tactical-scene-3d__back", standalone ? "返回遥测" : "返回 2D");
  for (const button of [overview, trees, mapTexture, zones, fly, light, detail, fps, back,
    players, vehicles, deployables, pausePreview, restartPreview]) button.type = "button";
  if (clearCache) clearCache.type = "button";
  overview.disabled = true;
  trees.disabled = true;
  trees.setAttribute("aria-pressed", "false");
  mapTexture.setAttribute("aria-pressed", "true");
  mapTexture.disabled = true;
  zones.setAttribute("aria-pressed", "true");
  const stage = append(panel, "div", "tactical-scene-3d__stage");
  const footer = append(panel, "footer", "tactical-scene-3d__footer");
  const status = append(footer, "span", "tactical-scene-3d__status", "正在初始化 3D 地图…");
  status.setAttribute("role", "status");
  const cacheStatus = standalone ? append(footer, "span", "") : null;
  const modelStatus = append(footer, "span", "");
  const timingStatus = append(footer, "span", "");
  const flightHint = append(footer, "span", "");

  const controller = new AbortController();
  const signal = controller.signal;
  const models = [];
  const foliage = [];
  let observer, renderer, controls, camera, scene, size, bounds, overlay, modelRequest, terrainStream, playerLayer;
  let liveActorLayer, liveModelCache, combatEffects;
  let activeMap, modelReady = false, zonesVisible = true, pollTimer = 0, volumeSignature = "";
  let lastZoneCheck = 0, lastZoneEpoch, lastRoundMap;
  let mapTextureVisible = true;
  let isClosed = false;
  let pendingFrame = 0;
  let renderFailed = false;
  let clearingCache = false;
  let cullObjects, updateObjectLod, flight, lighting;
  let buildingStream;
  const buildingSettings = installBuildingSettings({ select: distance, detailButton: detail, invalidate, signal });
  const recordFrame = installFrameMeter(fps, invalidate, signal);
  const frameBudget = createFrameBudget(invalidate);
  const previewModels = createPreviewModels();
  const preview = createRoundPreview();
  let previewGround, previewPaused = false, rosterSignature = "", initialFramingPending = false;
  const followAnchor = new Vector3();
  const followDelta = new Vector3();
  const snapshotClock = createSnapshotClock();
  let samplingMs;
  let previousRenderAt = 0;
  const focusOffset = new Vector3(-7, 4.5, 6);
  const defaultRatio = Math.min(1.5, window.devicePixelRatio || 1);
  let rememberedPressure = 0;
  const setStatus = (text, error = false) => {
    if (isClosed) return;
    status.textContent = text;
    status.dataset.error = String(error);
  };
  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    controller.abort();
    modelRequest?.abort();
    window.clearInterval(pollTimer);
    cancelAnimationFrame(pendingFrame);
    observer?.disconnect();
    controls?.dispose();
    overlay?.dispose();
    playerLayer?.dispose();
    liveActorLayer?.dispose();
    combatEffects?.dispose();
    liveModelCache?.dispose();
    frameBudget.dispose();
    previewGround?.dispose();
    previewModels.dispose();
    freeModels(models);
    renderer?.dispose();
    renderer?.forceContextLoss();
    panel.remove();
    visibleViews.delete(viewport);
  };
  const warm = installWarmView({ panel, viewport, layout, cleanup, signal,
    healthy: () => Boolean(camera && !renderFailed),
    paused() {
      flight?.stop();
      window.clearInterval(pollTimer);
      cancelAnimationFrame(pendingFrame);
      pollTimer = pendingFrame = 0;
      queueMicrotask(() => { if (!warm.active && opener?.isConnected) opener.focus({ preventScroll: true }); });
    },
    resumed(options) {
      ({ liveMap, getFeed, opener } = options);
      preview.resumeClock(performance.now());
      fitOverlay();
      resize();
      renderer.domElement.focus({ preventScroll: true });
      startPolling();
      invalidate();
    },
  });
  cleanup.refreshSnapshot = () => {
    if (warm.active && !isClosed && !renderFailed && picker.value !== "preview") syncRound();
  };
  cleanup.isActive = () => warm.active && !isClosed && !renderFailed;
  visibleViews.set(viewport, warm);
  back.addEventListener("click", standalone ? onBack : warm.suspend, { signal });
  for (const event of ["pointerdown", "wheel", "contextmenu", "dblclick"]) {
    panel.addEventListener(event, e => e.stopPropagation(), { signal });
  }
  panel.addEventListener("keydown", event => {
    if (standalone || event.key !== "Escape") return;
    event.stopPropagation();
    warm.suspend();
  }, { signal });
  back.focus({ preventScroll: true });

  function invalidate() {
    if (!warm.active || pendingFrame || isClosed || renderFailed) return;
    pendingFrame = requestAnimationFrame(now => {
      pendingFrame = 0;
      try {
        const frameStart = performance.now();
        const pressure = frameBudget?.pressure ?? 0;
        if (pressure !== rememberedPressure) {
          rememberedPressure = pressure;
          renderer.setPixelRatio(defaultRatio * [1, .9, .8, .7][pressure]);
        }
        const sampleTime = snapshotClock.advance(now);
        const timing = samplingMs == null ? "" : `采样设定 ${samplingMs} ms · 插值缓冲 ${snapshotClock.delayMs} ms`;
        if (timingStatus.textContent !== timing) timingStatus.textContent = timing;
        playerLayer?.advance(now, sampleTime);
        flight?.advance(now);
        const followed = playerLayer?.get(focusPicker.value);
        if (followed) {
          const dt = previousRenderAt ? Math.min(.1, (now - previousRenderAt) / 1000) : 1 / 60;
          followDelta.copy(followed.position).sub(followAnchor).multiplyScalar(1 - Math.exp(-15 * dt));
          followAnchor.add(followDelta);
          controls.target.add(followDelta);
          camera.position.add(followDelta);
          if (followAnchor.distanceToSquared(followed.position) > .0004) invalidate();
        }
        previousRenderAt = now;
        terrainStream?.update(camera, controls.target);
        const objectRange = buildingSettings.range(camera, bounds);
        buildingStream?.update(camera, controls.target, objectRange);
        cullObjects?.(camera, lighting?.beforeRender(camera, now), objectRange);
        updateObjectLod?.(camera, size?.height ?? 720, now, buildingSettings.lod);
        liveModelCache?.beginFrame();
        playerLayer?.render(now, camera, size, pressure);
        if (playerLayer) {
          const state = playerLayer.modelState();
          panel.dataset.detailedPlayers = String(state.visible);
          panel.dataset.soldierAnimation = state.animation;
          const pending = state.failures ? " · 模型重试中" : state.pending ? " · 加载模型中" : "";
          const animation = state.visible && state.animation !== "ready" ?
            (state.animation === "retry" ? " · 动画重试中" : " · 加载动画中") : "";
          const text = players.getAttribute("aria-pressed") !== "true" ? "玩家已隐藏" :
            `视野内 SDK 角色 ${state.visible}/${state.inView}${pending}${animation}`;
          if (modelStatus.textContent !== text) modelStatus.textContent = text;
        }
        liveActorLayer?.render(sampleTime, camera, size, pressure);
        combatEffects?.render(now, sampleTime, camera, pressure);
        renderer.render(scene, camera);
        overlay?.renderLabels(camera, size);
        recordFrame(now, renderer.info);
        frameBudget?.finish(now, performance.now() - frameStart);
      } catch (error) {
        console.error("BZSS 3D render", error);
        renderFailed = true;
        setStatus(standalone ? "3D 绘制失败，请刷新页面重试。" : "3D 地图绘制失败，请返回 2D 后重试。", true);
      }
    });
  }

  function resize() {
    if (!warm.active) return;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height || (width === size?.width && height === size?.height)) return;
    size = { width, height };
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    invalidate();
  }

  function fitOverlay() {
    if (standalone || !warm.active || panel.classList.contains("is-immersive")) return;
    const frame = viewport.getBoundingClientRect();
    const top = Math.max(0, -frame.top);
    const height = Math.max(0, Math.min(frame.bottom, window.innerHeight) - Math.max(0, frame.top));
    panel.style.top = `${top}px`;
    panel.style.bottom = "auto";
    panel.style.height = `${height}px`;
  }

  function frameOverview() {
    if (!bounds || bounds.isEmpty()) return;
    const center = bounds.getCenter(new Vector3());
    const extent = bounds.getSize(new Vector3());
    const viewAngle = Math.atan(Math.tan(camera.fov * Math.PI / 360) * Math.min(camera.aspect, 1));
    const distance = (extent.length() / 2) / Math.sin(viewAngle) * 1.02;
    camera.position.copy(center).addScaledVector(new Vector3(0.32, 1, 0.54).normalize(), distance);
    camera.near = 0.75;
    camera.far = Math.max(16_000, distance * 6);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.maxDistance = camera.far * 0.57;
    controls.update();
    invalidate();
  }

  function focusPlayer(id) {
    const row = playerLayer?.get(id);
    if (!row) return;
    focusPicker.value = id;
    followAnchor.copy(row.position);
    controls.target.copy(row.position);
    controls.target.y += row.seated ? 1.3 : .35;
    camera.position.copy(controls.target).add(focusOffset);
    camera.near = .15;
    camera.updateProjectionMatrix();
    controls.update();
    invalidate();
  }

  function updateRoster() {
    const roster = playerLayer.roster();
    const signature = JSON.stringify(roster);
    if (signature === rosterSignature) return roster;
    rosterSignature = signature;
    const selected = focusPicker.value;
    focusPicker.replaceChildren();
    append(focusPicker, "option", "", "跟随玩家").value = "";
    for (const row of roster) {
      const team = row.team ? `队伍 ${row.team} · ` : "";
      append(focusPicker, "option", "", `${team}${row.name}${row.seatKind === "turret" ? " · 炮手" : ""}`).value = row.id;
    }
    if (roster.some(row => row.id === selected)) focusPicker.value = selected;
    focusPicker.disabled = roster.length === 0;
    return roster;
  }

  async function getModel(modelRoot, file, signal, revision) {
    const buffer = assetCache
      ? await assetCache.get(modelRoot + file, signal, revision)
      : await fetch(modelRoot + file, { signal }).then(response => {
        if (!response.ok) throw new Error("模型文件暂不可用");
        return response.arrayBuffer();
      });
    if (signal.aborted) return null;
    const parse = () => new GLTFLoader().register(loadTacticalEmbeddedImages).parseAsync(buffer, modelRoot);
    const result = frameBudget ? await frameBudget.enqueue(scenePriority.buildings, parse, signal) : await parse();
    repairBuildingMaterials(result.scene, result.parser);
    await prepareObjectLod(result.scene, result.parser, signal);
    if (signal.aborted) {
      freeModels([result.scene]);
      return null;
    }
    models.push(result.scene);
    return result.scene;
  }

  async function loadModels(map) {
    modelRequest?.abort();
    modelRequest = new AbortController();
    const { signal } = modelRequest;
    frameBudget?.setBuildingsPending(true);
    activeMap = map;
    previewGround?.dispose();
    previewGround = null;
    initialFramingPending = true;
    focusPicker.value = "";
    modelReady = false;
    volumeSignature = "";
    lastZoneCheck = 0;
    overview.disabled = trees.disabled = mapTexture.disabled = true;
    zones.textContent = "占领区";
    zones.disabled = true;
    trees.setAttribute("aria-pressed", "false");
    mapName.textContent = map === "preview" ? "训练场" : mapTitles[map];
    bounds = undefined;
    delete panel.dataset.ready;
    overlay.update([]);
    playerLayer?.ingest(null);
    snapshotClock.observe(null, performance.now());
    liveActorLayer?.ingest(null);
    combatEffects?.ingest(null);
    for (const model of models) scene.remove(model);
    freeModels(models);
    models.length = foliage.length = 0;
    cullObjects = undefined;
    updateObjectLod = undefined;
    buildingStream = undefined;
    lighting?.reset();
    invalidate();
    terrainStream = undefined;
    const demo = map === "preview";
    for (const control of previewControls) control.hidden = !demo;
    if (cacheStatus) cacheStatus.hidden = demo;
    if (demo) {
      preview.resumeClock(performance.now());
      previewGround = createPreviewGround();
      scene.add(previewGround.group);
      bounds = previewGround.bounds;
      frameOverview();
      overview.disabled = false;
      modelReady = true;
      panel.dataset.ready = "true";
      frameBudget.setBuildingsPending(false);
      invalidate();
      return;
    }
    const root = `/api/tactical-scene/${map}/v2/`;
    let terrainProgress, objectsStatus = "正在载入建筑与物件", objectsError = false, objectsReady = false;
    const updateStatus = () => {
      const data = terrainProgress;
      const text = data ? `视野内地形 ${data.loaded}/${data.visible}` : "正在读取地形目录";
      const error = Boolean(data?.errors || objectsError);
      const retry = data?.errors ? ` · ${data.errors} 块待重试` : "";
      setStatus(`${text} · ${objectsStatus}${retry}`, error);
      if (cacheStatus) {
        const { files, bytes, hits, available, writeFailed } = assetCache.stats;
        const saved = `本地已保存 ${files} 个文件（${(bytes / 1048576).toFixed(1)} MiB）`;
        const disk = available ? `${saved} · 本地命中 ${hits}${writeFailed ? " · 本地写入受限" : ""}`
          : "本地存储不可用";
        cacheStatus.textContent = `视野外保留 ${data?.retained ?? 0} 块 · ${disk}`;
        clearCache.disabled = clearingCache || !assetCache.stats.available;
      }
      if (data?.loaded && !objectsError && objectsReady) panel.dataset.ready = "true";
    };
    try {
      updateStatus();
      const terrainRequest = openTerrainStream(root, scene, signal, progress => {
        terrainProgress = progress;
        updateStatus();
        invalidate();
      }, assetCache);
      // The standalone cache uses the current manifest to invalidate an older map export.
      const terrain = await terrainRequest;
      if (signal.aborted) return;
      terrainStream = terrain;
      terrain.showTexture(mapTextureVisible);
      mapTexture.disabled = !terrain.textureAvailable;
      bounds = terrain.bounds;
      if (!focusPicker.value) frameOverview();
      overview.disabled = false;
      modelReady = true;
      syncRound();

      const cullers = [];
      const lodControllers = [];
      function addObjects(objects) {
        cullers.push(batchStaticObjects(objects));
        lodControllers.push(objectLodController(objects, foliageName));
        objects.traverse(node => {
          if (!foliageName.test(node.name)) return;
          foliage.push(node);
          node.visible = trees.getAttribute("aria-pressed") === "true";
        });
        scene.add(objects);
        lighting?.setScenery(objects, bounds);
        frameBudget?.setBuildingsPending(false);
        invalidate();
      }
      cullObjects = (...args) => { for (const cull of cullers) cull(...args); };
      updateObjectLod = (...args) => { for (const update of lodControllers) update(...args); };
      buildingStream = createBuildingStream(terrain.objectTiles, {
        signal, invalidate, attach: addObjects,
        load: (file, revision) => getModel(root, file, signal, revision),
        status: ({ loaded, wanted, failed, treesLoading }) => {
          objectsStatus = `建筑分区 ${loaded}/${wanted}${treesLoading ? " · 正在载入植被" : ""}` +
            (failed ? ` · ${failed} 块待重试` : "");
          objectsError = Boolean(failed);
          objectsReady ||= loaded > 0;
          updateStatus();
        },
      });
      if (buildingStream) {
        trees.disabled = !buildingStream.hasVegetation;
        buildingStream.update(camera, controls.target, buildingSettings.range(camera, bounds));
        // Vehicle and infantry asset loads can proceed while other building tiles download.
        return;
      }
      const objects = await getModel(root, "objects.glb", signal, terrain.revision);
      if (signal.aborted || !objects) return;
      addObjects(objects);
      trees.disabled = !foliage.length;
      objectsStatus = "建筑与物件已载入";
      objectsReady = true;
      updateStatus();
      invalidate();
    } catch {
      if (signal.aborted) return;
      if (!terrainStream) {
        setStatus(standalone ? "地形目录载入失败，请切换地图或刷新重试。" : "地形目录载入失败，请返回 2D 后重试。", true);
        return;
      }
      objectsStatus = "建筑与物件载入失败";
      objectsError = true;
      updateStatus();
    } finally {
      if (!signal.aborted) frameBudget?.setBuildingsPending(false);
    }
  }

  function syncRound() {
    const live = getFeed();
    const liveMapKey = sceneKey(live?.map?.worldName);
    if (liveMapKey) lastRoundMap = liveMapKey;
    const demo = picker.value === "preview";
    const roundMap = demo ? "preview" : liveMapKey;
    const fallbackMap = standalone ? lastRoundMap : sceneKey(liveMap) ?? "logar";
    const desired = picker.value === "auto" ? (roundMap ?? fallbackMap) : picker.value;
    if (!desired) {
      if (!activeMap && status.textContent !== "等待对局地图，也可从菜单选择地图预览。") {
        setStatus("等待对局地图，也可从菜单选择地图预览。");
      }
      return;
    }
    if (activeMap !== desired) void loadModels(desired);
    const feed = demo ? preview.sample(performance.now()) : live;
    const matching = roundMap === activeMap && (Array.isArray(feed?.players) || Array.isArray(feed?.mapPoints));
    const modeText = demo ? "离线演示" : matching ? "当前对局" : "3D 模型预览";
    if (mode.textContent !== modeText) mode.textContent = modeText;
    if (playerLayer) {
      const interval = matching && !demo ? feed.sampling?.intervalSeconds : null;
      samplingMs = Number.isFinite(interval) ? Math.round(interval * 1000) : null;
      snapshotClock.observe(matching ? feed : null, performance.now());
      const playerCount = playerLayer.ingest(matching ? feed : null);
      liveActorLayer.ingest(matching ? feed : null);
      combatEffects.ingest(matching ? feed : null);
      effects.disabled = !matching;
      for (const [button, title, kind] of liveButtons) {
        const count = kind === "player" ? playerCount : liveActorLayer.count(kind);
        const label = matching ? `${title} ${count}` : title;
        if (button.textContent !== label) button.textContent = label;
        button.disabled = !matching;
      }
      const roster = updateRoster();
      if (initialFramingPending && roster.length) {
        initialFramingPending = false;
        const player = roster.find(row => playerLayer.get(row.id)?.infantry) ?? roster[0];
        focusPlayer(player.id);
      }
    }
    if (demo) {
      const { elapsed, blue, red, owner, finished } = feed.game;
      const text = `${finished ? "演示结束" : `演示 ${elapsed} / 72 秒`} · 青队 ${blue} · 棕队 ${red} · ${owner === 1 ? "青队控制" : owner === 2 ? "棕队控制" : "据点中立"}`;
      if (status.textContent !== text || status.dataset.error === "true") setStatus(text);
      pausePreview.disabled = finished;
    }
    if (!modelReady) return;
    {
      const now = performance.now();
      const epoch = matching ? feed.epoch : null;
      if (lastZoneCheck && epoch === lastZoneEpoch && now - lastZoneCheck < 700) return;
      lastZoneCheck = now;
      lastZoneEpoch = epoch;
    }
    const points = matching ? (feed.mapPoints ?? []).filter(point => point.kind === "capture_zone") : [];
    const signature = JSON.stringify([matching ? feed.epoch : null, points.map(point =>
      [point.id, point.name, point.teamId, point.capture?.volumes, point.capture?.locked,
        point.capture?.owningTeam, point.capture?.capturingTeam, Math.round(100 * point.capture?.percentRaw)])]);
    if (signature === volumeSignature) return;
    volumeSignature = signature;
    const count = overlay.update(points);
    zones.disabled = !count;
    zones.textContent = count ? `占领区 ${count}` : "占领区";
    zones.title = matching ? (count ? "显示或隐藏本局占领区" : "本局暂无范围数据") : "占领区随对应的实时对局显示";
    invalidate();
  }

  function startPolling() {
    syncRound();
    let terrainCheck = 0;
    pollTimer = window.setInterval(() => {
      syncRound();
      const now = performance.now();
      if (now - terrainCheck >= 700) {
        terrainCheck = now;
        terrainStream?.update(camera, controls.target);
        buildingStream?.update(camera, controls.target, buildingSettings.range(camera, bounds));
      }
    }, 75);
  }

  window.addEventListener("resize", fitOverlay, { signal });
  window.addEventListener("scroll", fitOverlay, { capture: true, signal });
  fitOverlay();
  try {
    renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(defaultRatio);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "使用鼠标浏览 3D 场景");
    guardPointerCapture(renderer.domElement);
    stage.append(renderer.domElement);
    renderer.domElement.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      renderFailed = true;
      setStatus(standalone ? "3D 图形上下文已断开，请刷新页面。" : "3D 图形上下文已断开，请返回 2D 后重试。", true);
    }, { signal });
    scene = new Scene();
    scene.background = new Color(0x455764);
    overlay = captureVolumeOverlay(scene, append(stage, "div", "tactical-scene-3d__labels"));
    {
      liveModelCache = createLiveModelCache(assetCache, invalidate, frameBudget);
      playerLayer = createLivePlayerLayer(scene,
        append(stage, "div", "tactical-scene-3d__labels tactical-scene-3d__player-labels"), invalidate, assetCache, liveModelCache, frameBudget, previewModels);
      liveActorLayer = createLiveActorLayer(scene,
        append(stage, "div", "tactical-scene-3d__labels tactical-scene-3d__player-labels"), invalidate, liveModelCache, previewModels);
      combatEffects = createCombatEffects(scene, liveModelCache, invalidate);
      effects.addEventListener("click", () => {
        const enabled = effects.getAttribute("aria-pressed") !== "true";
        effects.setAttribute("aria-pressed", String(enabled));
        combatEffects.toggle(enabled);
      }, { signal });
      for (const [button, , kind] of liveButtons) {
        button.addEventListener("click", () => {
          const enabled = button.getAttribute("aria-pressed") !== "true";
          button.setAttribute("aria-pressed", String(enabled));
          if (kind === "player") playerLayer.toggle(enabled);
          else liveActorLayer.toggle(kind, enabled);
        }, { signal });
      }
      clearCache?.addEventListener("click", async () => {
        clearingCache = true;
        clearCache.disabled = true;
        const cleared = await assetCache.clear();
        if (signal.aborted) return;
        clearingCache = false;
        clearCache.disabled = !assetCache.stats.available;
        clearCache.textContent = cleared ? "地图缓存已清除" : "无法清除地图缓存";
        if (cleared) terrainStream?.update(camera, controls.target);
        setTimeout(() => { if (!signal.aborted) clearCache.textContent = "清除地图缓存"; }, 2400);
      }, { signal });
    }
    camera = new PerspectiveCamera(49, 1, 0.75, 18_000);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 3;
    controls.maxPolarAngle = Math.PI * 0.485;
    controls.zoomSpeed = 1.35;
    flight = installViewportFlight({ canvas: renderer.domElement, button: fly, hint: flightHint,
      camera, orbit: controls, invalidate, signal, setImmersive(enabled) {
        setImmersiveViewport(panel, viewport, enabled);
        fitOverlay();
        resize();
      } });
    renderer.domElement.focus({ preventScroll: true });
    controls.addEventListener("change", invalidate);
    const sky = new HemisphereLight(0xd5ecff, 0x646051, 1.3);
    scene.add(sky);
    const sun = new DirectionalLight(0xfff1da, 1.65);
    sun.position.set(-750, 950, 500);
    scene.add(sun);
    lighting = installFixedLighting({ button: light, sun, sky, scene, renderer, invalidate, signal, foliageName });
    overview.addEventListener("click", () => {
      initialFramingPending = false;
      focusPicker.value = "";
      frameOverview();
    }, { signal });
    focusPicker.addEventListener("change", () => focusPlayer(focusPicker.value), { signal });
    pausePreview.addEventListener("click", () => {
      previewPaused = !previewPaused;
      preview.setPaused(previewPaused, performance.now());
      pausePreview.textContent = previewPaused ? "继续演示" : "暂停演示";
      syncRound();
    }, { signal });
    restartPreview.addEventListener("click", () => {
      preview.restart(performance.now());
      previewPaused = false;
      pausePreview.textContent = "暂停演示";
      syncRound();
      if (focusPicker.value) focusPlayer(focusPicker.value);
    }, { signal });
    previewRate.addEventListener("change", () => preview.setRate(Number(previewRate.value), performance.now()), { signal });
    picker.addEventListener("change", syncRound, { signal });
    zones.addEventListener("click", () => {
      zonesVisible = !zonesVisible;
      zones.setAttribute("aria-pressed", String(zonesVisible));
      overlay.toggle(zonesVisible);
      invalidate();
    }, { signal });
    mapTexture.addEventListener("click", () => {
      mapTextureVisible = !mapTextureVisible;
      mapTexture.setAttribute("aria-pressed", String(mapTextureVisible));
      terrainStream?.showTexture(mapTextureVisible);
      invalidate();
    }, { signal });
    trees.addEventListener("click", () => {
      const visible = trees.getAttribute("aria-pressed") !== "true";
      for (const item of foliage) item.visible = visible;
      trees.setAttribute("aria-pressed", String(visible));
      buildingStream?.showVegetation(visible);
      invalidate();
    }, { signal });
    observer = new ResizeObserver(() => { fitOverlay(); resize(); });
    observer.observe(viewport);
    observer.observe(stage);
    resize();
    startPolling();
  } catch {
    renderFailed = true;
    setStatus(standalone ? "当前浏览器无法启动 WebGL。" : "当前浏览器无法启动 WebGL，可返回 2D 地图。", true);
  }
  return cleanup;
}
