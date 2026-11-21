import { Quaternion, Vector3 } from "three";

const moveKeys = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
]);

export function setImmersiveViewport(panel, viewport, enabled) {
  panel.classList.toggle("is-immersive", enabled);
  if (enabled) {
    Object.assign(panel.style, { position: "fixed", inset: "0", height: "100dvh", zIndex: "10000" });
    panel.ownerDocument.body.append(panel);
  } else {
    for (const property of ["position", "inset", "height", "z-index"]) panel.style.removeProperty(property);
    viewport.append(panel);
  }
  panel.querySelector(".tactical-scene-3d__back").hidden = enabled;
}

export function installViewportFlight({ canvas, button, hint, camera, orbit, invalidate, signal, setImmersive }) {
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  const keys = new Set();
  const forward = new Vector3();
  const right = new Vector3();
  const up = new Vector3(0, 1, 0);
  const desired = new Vector3();
  const velocity = new Vector3();
  const step = new Vector3();
  const yawRotation = new Quaternion();
  const pitchRotation = new Quaternion();
  let immersive = false;
  let drag = null;
  let previousFrame = null;
  let speedScale = 1;

  function baseSpeed() {
    return Math.max(4, Math.min(85, orbit.getDistance() * 0.055));
  }

  function updateHint() {
    button.textContent = immersive ? "退出飞行" : "进入飞行视图";
    button.setAttribute("aria-pressed", String(immersive));
    canvas.dataset.flying = String(immersive || drag !== null);
    hint.textContent = drag || hasMovement()
      ? `右键按住转向 · WASD 移动 · Q/E 升降 · 当前速度 ${Math.round(baseSpeed() * speedScale)} 米/秒`
      : "按住右键转向并隐藏鼠标 · WASD 移动 · Q/E 升降 · Shift 加速 · 移动时滚轮调速";
  }

  function hasMovement() {
    return keys.has("KeyW") || keys.has("KeyA") || keys.has("KeyS") ||
      keys.has("KeyD") || keys.has("KeyQ") || keys.has("KeyE");
  }

  function stopDrag() {
    if (!drag) return;
    orbit.enabled = drag.orbitEnabled;
    drag = null;
    if (doc.pointerLockElement === canvas) doc.exitPointerLock();
    orbit.update();
    updateHint();
  }

  function clearInput() {
    stopDrag();
    keys.clear();
    velocity.set(0, 0, 0);
    previousFrame = null;
    updateHint();
  }

  function changeLayout(enabled) {
    if (immersive === enabled) return;
    stopDrag();
    immersive = enabled;
    setImmersive(enabled);
    canvas.focus({ preventScroll: true });
    updateHint();
    invalidate();
  }

  function stop() {
    clearInput();
    changeLayout(false);
  }

  canvas.addEventListener("pointerdown", event => {
    canvas.focus({ preventScroll: true });
    if (event.button !== 2 || drag) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    camera.getWorldDirection(forward);
    drag = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      yaw: Math.atan2(-forward.x, -forward.z), pitch: Math.asin(Math.max(-1, Math.min(1, forward.y))),
      orbitEnabled: orbit.enabled,
    };
    orbit.enabled = false;
    try {
      const lockRequest = canvas.requestPointerLock?.();
      lockRequest?.catch?.(() => {});
    } catch {}
    updateHint();
  }, { signal, capture: true });
  canvas.addEventListener("contextmenu", event => event.preventDefault(), { signal });
  button.addEventListener("click", () => changeLayout(!immersive), { signal });
  win.addEventListener("pointerup", event => {
    if (event.button === 2) stopDrag();
  }, { signal, capture: true });
  win.addEventListener("mouseup", event => {
    if (event.button === 2) stopDrag();
  }, { signal, capture: true });
  win.addEventListener("pointercancel", stopDrag, { signal, capture: true });
  doc.addEventListener("pointerlockchange", () => {
    if (!doc.pointerLockElement && drag) stopDrag();
  }, { signal });
  win.addEventListener("blur", clearInput, { signal });
  canvas.addEventListener("blur", clearInput, { signal });

  win.addEventListener("pointermove", event => {
    if (!drag) return;
    const locked = doc.pointerLockElement === canvas;
    if (!locked && event.pointerId !== drag.id) return;
    if (!locked && !(event.buttons & 2)) { stopDrag(); return; }
    const dx = locked ? event.movementX : event.clientX - drag.x;
    const dy = locked ? event.movementY : event.clientY - drag.y;
    if (!locked) {
      drag.x = event.clientX;
      drag.y = event.clientY;
    }
    if (!dx && !dy) return;
    drag.yaw -= dx * 0.003;
    drag.pitch = Math.max(-1.553, Math.min(1.553, drag.pitch - dy * 0.003));
    yawRotation.setFromAxisAngle(up, drag.yaw);
    right.set(1, 0, 0).applyQuaternion(yawRotation);
    pitchRotation.setFromAxisAngle(right, drag.pitch);
    const distance = orbit.getDistance();
    camera.quaternion.copy(pitchRotation).multiply(yawRotation);
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    orbit.target.copy(camera.position).addScaledVector(forward, distance);
    orbit.maxPolarAngle = Math.PI - 0.01;
    invalidate();
  }, { signal, capture: true });

  canvas.addEventListener("wheel", event => {
    if (!drag && !hasMovement()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1);
    speedScale = Math.max(0.125, Math.min(12, speedScale * Math.exp(-delta * 0.0017)));
    updateHint();
  }, { signal, capture: true, passive: false });

  function onKey(event) {
    if (event.code === "Escape" && (immersive || drag)) {
      if (event.type === "keydown") clearInput();
      event.stopImmediatePropagation();
      return;
    }
    if (!moveKeys.has(event.code) || (doc.activeElement !== canvas && !keys.has(event.code))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "keydown") keys.add(event.code);
    else keys.delete(event.code);
    if (!event.repeat) updateHint();
    invalidate();
  }
  win.addEventListener("keydown", onKey, { signal, capture: true });
  win.addEventListener("keyup", onKey, { signal, capture: true });
  updateHint();

  function advance(timestamp) {
    if (!hasMovement() && velocity.lengthSq() < 0.0025) {
      velocity.set(0, 0, 0);
      previousFrame = null;
      return;
    }
    const dt = previousFrame === null ? 1 / 60 : Math.max(0, Math.min(0.09, (timestamp - previousFrame) / 1000));
    previousFrame = timestamp;
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    desired.set(0, 0, 0);
    desired.addScaledVector(forward, Number(keys.has("KeyW")) - Number(keys.has("KeyS")));
    desired.addScaledVector(right, Number(keys.has("KeyD")) - Number(keys.has("KeyA")));
    desired.addScaledVector(up, Number(keys.has("KeyE")) - Number(keys.has("KeyQ")));
    if (desired.lengthSq() > 1) desired.normalize();
    const boost = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 3 : 1) *
      (keys.has("ControlLeft") || keys.has("ControlRight") ? 0.25 : 1);
    desired.multiplyScalar(baseSpeed() * speedScale * boost);

    // Integrate a short acceleration ramp with faster braking on release or reversal.
    const rate = desired.lengthSq() < 0.0025 || velocity.dot(desired) < 0 ? 34 : 17;
    const blend = -Math.expm1(-rate * dt);
    step.copy(velocity).sub(desired).multiplyScalar(blend / rate).addScaledVector(desired, dt);
    velocity.lerp(desired, blend);
    camera.position.add(step);
    orbit.target.add(step);
    invalidate();
  }
  return { advance, stop };
}

export function installFrameMeter(button, invalidate, signal) {
  let sampleUntil = 0, started = 0, frames = 0, previous = 0, idleTimer = 0, latest = "—";
  button.title = "显示实际绘制帧率。点击连续测量 5 秒";
  button.textContent = "FPS —";
  button.addEventListener("click", () => {
    sampleUntil = performance.now() + 5000;
    started = previous = frames = 0;
    button.textContent = "FPS 测量中";
    invalidate();
  }, { signal });
  signal.addEventListener("abort", () => clearTimeout(idleTimer), { once: true });
  return function recordFrame(now, info) {
    const sampling = sampleUntil > 0 && previous <= sampleUntil;
    if (!started || (!sampling && now - previous > 1300)) { started = now; frames = 0; }
    else frames++;
    previous = now;
    if (now - started >= 500) {
      latest = Math.round(frames * 1000 / (now - started));
      button.textContent = `FPS ${latest}`;
      button.title = `当前 ${info.render.calls.toLocaleString()} 次绘制 · ${info.render.triangles.toLocaleString()} 个三角面。点击连续测量 5 秒`;
      started = now;
      frames = 0;
    }
    clearTimeout(idleTimer);
    if (now < sampleUntil) invalidate();
    else {
      sampleUntil = 0;
      idleTimer = setTimeout(() => { button.textContent = `FPS ${latest} · 静止`; }, 1300);
    }
  };
}
