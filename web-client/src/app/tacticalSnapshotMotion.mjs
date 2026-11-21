import { MathUtils } from "three";

const historySize = 16;
const predictionLimit = .12;
const axes = ["x", "y", "z"];

// Render on the sender's time axis. The delay absorbs uneven HTTP arrivals.
export function createSnapshotClock() {
  let latest, cursor, arrival, frame, epoch, rate = 1, demo = false;
  let spacing = .10, jitter = .012, period = .10, lag = .12;
  function reset() {
    latest = cursor = arrival = frame = epoch = undefined;
    rate = 1;
    demo = false;
    spacing = .10;
    jitter = .012;
    period = .10;
    lag = .12;
  }
  function observe(sample, now) {
    const time = sample?.observedAt;
    if (!Number.isFinite(time)) { reset(); return; }
    const configured = sample.sampling?.intervalSeconds;
    const nextPeriod = Number.isFinite(configured) ? MathUtils.clamp(configured, .05, 1) : .10;
    if (sample.epoch !== epoch || latest == null || time < latest || time - latest > 1.5) {
      reset();
      latest = cursor = time;
      arrival = frame = now;
      epoch = sample.epoch;
      demo = sample.demo === true;
      rate = sample.playbackRate ?? 1;
      period = spacing = nextPeriod;
      return;
    }
    if (time === latest) return;
    rate = sample.playbackRate ?? 1;
    if (Math.abs(nextPeriod - period) > .02) {
      spacing = nextPeriod;
      jitter = .012;
    }
    period = nextPeriod;
    const observed = (time - latest) / rate;
    const received = (now - arrival) / 1000;
    // One missed packet should not add hundreds of milliseconds to subsequent frames.
    const maximum = MathUtils.clamp(period * 2.3, .125, .59);
    const interval = MathUtils.clamp(Math.max(observed, received), .025, maximum);
    const variation = Math.min(.06, Math.abs(interval - spacing));
    spacing = MathUtils.lerp(spacing, interval, .28);
    jitter = MathUtils.lerp(jitter, variation, .27);
    latest = time;
    arrival = now;
  }
  function advance(now) {
    if (latest == null) return undefined;
    const delta = MathUtils.clamp((now - frame) / 1000, 0, .10);
    frame = now;
    lag = MathUtils.clamp(spacing * 1.02 + jitter * 1.08 + .008,
      Math.max(.048, Math.min(.54, period * .85)), MathUtils.clamp(period * 2.5, .155, .62));
    const desired = latest + (MathUtils.clamp((now - arrival) / 1000, 0, .75) - lag) * rate;
    const correction = MathUtils.clamp((desired - cursor) / (.23 * rate), -.45, .55);
    const upper = demo ? latest : latest + predictionLimit;
    cursor = Math.min(upper, cursor + delta * rate * (1 + correction));
    return cursor;
  }
  return { observe, advance, get delayMs() { return Math.round(lag * 1000); } };
}

export function pushMotionSample(history, sample, snap = false) {
  if (snap || (history.length && sample.time - history.at(-1).time > 1.5)) history.length = 0;
  const latest = history.at(-1);
  if (latest && sample.time <= latest.time) return;
  if (history.length >= historySize) history.shift();
  history.push(sample);
}

export function motionWindow(history, time, window) {
  let index = history.length - 1;
  while (index > 0 && history[index].time > time) index--;
  const left = history[index], right = history[index + 1];
  window.left = left;
  window.right = right;
  window.ratio = right ? MathUtils.clamp((time - left.time) / (right.time - left.time), 0, 1) : 0;
  window.ahead = right ? 0 : MathUtils.clamp(time - left.time, 0, predictionLimit);
  window.before = history[index - 1];
  window.after = history[index + 2];
  return window;
}

export function interpolateMotion(window, position, velocity, predict = false) {
  const { left, right, before, after, ratio: t, ahead } = window;
  if (!right) {
    position.copy(left.position);
    if (velocity) {
      if (left.velocity) velocity.copy(left.velocity);
      else if (before) velocity.copy(left.position).sub(before.position).divideScalar(left.time - before.time);
      else velocity.set(0, 0, 0);
      if (predict && ahead > 0) {
        // Ease out during a missing packet and limit the distance predicted.
        position.addScaledVector(velocity, ahead * (1 - .5 * ahead / predictionLimit));
        velocity.multiplyScalar(1 - ahead / predictionLimit);
      }
    }
    return;
  }
  const dt = right.time - left.time;
  const u = 1 - t;
  for (const axis of axes) {
    const start = left.position[axis], end = right.position[axis], distance = end - start;
    if (Math.abs(distance) < .00001) {
      position[axis] = start;
      if (velocity) velocity[axis] = 0;
      continue;
    }
    const v0 = left.velocity?.[axis] ?? (before ?
      (end - before.position[axis]) / (right.time - before.time) : distance / dt);
    const v1 = right.velocity?.[axis] ?? (after ?
      (after.position[axis] - start) / (after.time - left.time) : distance / dt);
    const m0 = MathUtils.clamp(v0 * dt / distance, 0, 2);
    const m1 = MathUtils.clamp(v1 * dt / distance, 0, 2);
    position[axis] = start + distance * (t * t * (3 - 2 * t) + m0 * t * u * u - m1 * t * t * u);
    if (velocity) velocity[axis] = distance / dt * (6 * t * u + m0 * u * (1 - 3 * t) + m1 * t * (3 * t - 2));
  }
}

export function interpolateHeading(a, b, t) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a ?? b ?? null;
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * t;
}
