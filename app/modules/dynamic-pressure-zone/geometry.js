// -*- coding: utf-8 -*-

export function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(Math.max(numeric, min), max);
}

export function distance(a, b) {
  const dx = Number(b?.x) - Number(a?.x);
  const dy = Number(b?.y) - Number(a?.y);
  return Math.hypot(dx, dy);
}

export function normalizeBounds(bounds) {
  const minX = Number(bounds?.minX);
  const minY = Number(bounds?.minY);
  const maxX = Number(bounds?.maxX);
  const maxY = Number(bounds?.maxY);
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY };
}

export function resolveCoordinateScaleMeters(bounds, explicitScale = null) {
  const configured = Number(explicitScale);
  if (Number.isFinite(configured) && configured > 0) return configured;
  const normalized = normalizeBounds(bounds);
  if (!normalized) return 1;
  const rawDiagonal = Math.hypot(normalized.maxX - normalized.minX, normalized.maxY - normalized.minY);
  // Squad/UE coordinates are normally centimeters. Simulator inputs are meters.
  return rawDiagonal > 20_000 ? 0.01 : 1;
}

export function buildCapsulePolygon(a, b, longitudinalRadius, lateralRadius, arcSegments = 18) {
  const ax = Number(a?.x);
  const ay = Number(a?.y);
  const bx = Number(b?.x);
  const by = Number(b?.y);
  const longitudinal = Math.max(0, Number(longitudinalRadius) || 0);
  const lateral = Math.max(0, Number(lateralRadius) || 0);
  if (![ax, ay, bx, by].every(Number.isFinite) || longitudinal <= 0 || lateral <= 0) return [];

  const dx = bx - ax;
  const dy = by - ay;
  const gap = Math.hypot(dx, dy);
  const ux = gap > 0 ? dx / gap : 1;
  const uy = gap > 0 ? dy / gap : 0;
  const vx = -uy;
  const vy = ux;

  // Keep polygon generation bounded even when a legacy config or direct module
  // config bypasses base-config-store validation. An unbounded arc segment count
  // can produce a huge JSON response and then lock the browser while SVG points
  // are created on both the tactical map and the pressure-zone simulator.
  const requestedSegments = Math.floor(Number(arcSegments) || 18);
  const count = Math.min(128, Math.max(6, requestedSegments));
  const points = [];

  const pushLocal = (origin, along, across) => {
    points.push({
      x: origin.x + (ux * along) + (vx * across),
      y: origin.y + (uy * along) + (vy * across),
    });
  };

  for (let index = 0; index <= count; index += 1) {
    const angle = (-Math.PI / 2) + (Math.PI * index / count);
    pushLocal({ x: bx, y: by }, Math.cos(angle) * longitudinal, Math.sin(angle) * lateral);
  }
  for (let index = 0; index <= count; index += 1) {
    const angle = (Math.PI / 2) + (Math.PI * index / count);
    pushLocal({ x: ax, y: ay }, Math.cos(angle) * longitudinal, Math.sin(angle) * lateral);
  }
  return points;
}

export function pointInCircle(point, center, radius) {
  return distance(point, center) <= Math.max(0, Number(radius) || 0);
}

export function pointInCapsule(point, geometry) {
  const a = geometry?.a;
  const b = geometry?.b;
  const dx = Number(b?.x) - Number(a?.x);
  const dy = Number(b?.y) - Number(a?.y);
  const gap = Math.hypot(dx, dy);
  if (!Number.isFinite(gap)) return false;
  const ux = gap > 0 ? dx / gap : 1;
  const uy = gap > 0 ? dy / gap : 0;
  const vx = -uy;
  const vy = ux;
  const px = Number(point?.x) - Number(a?.x);
  const py = Number(point?.y) - Number(a?.y);
  const along = (px * ux) + (py * uy);
  const across = (px * vx) + (py * vy);
  const longitudinal = Math.max(0.000001, Number(geometry?.longitudinalRadius) || 0);
  const lateral = Math.max(0.000001, Number(geometry?.lateralRadius) || 0);
  if (along >= 0 && along <= gap) return Math.abs(across) <= lateral;
  const endDistance = along < 0 ? along : along - gap;
  return ((endDistance / longitudinal) ** 2) + ((across / lateral) ** 2) <= 1;
}

export function pointInZone(point, zone) {
  const geometry = zone?.geometry ?? {};
  if (geometry.type === "circle") return pointInCircle(point, geometry.center, geometry.radius);
  if (geometry.type === "capsule") return pointInCapsule(point, geometry);
  return false;
}

export function classifyPoint(point, zones = []) {
  return [...zones]
    .filter((zone) => pointInZone(point, zone))
    .sort((left, right) => Number(right.priority ?? 0) - Number(left.priority ?? 0))[0]
    ?? { id: "free", type: "free", priority: 0 };
}
